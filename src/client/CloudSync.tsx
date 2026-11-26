"use client";
import { useEffect, useRef } from "react";
import { useAccount } from "./account";
import { useJobs } from "./jobsStore";
import { useSettings } from "./settingsStore";
import { browserDb } from "./supabase";
import type { Job } from "@/lib/types";

/**
 * Keeps this browser and the company account in step once someone signs in.
 * The browser copy stays the working copy, so nothing is lost offline: newer
 * wins in each direction, and the server decides what the plan allows.
 */
export function CloudSync() {
  const signedIn = useAccount((x) => !!x.me?.signedIn);
  const companyId = useAccount((x) => x.me?.company?.id ?? null);
  const ready = useRef(false);
  const pending = useRef(new Map<string, Job>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sign in state changes reload the account.
  useEffect(() => {
    const db = browserDb();
    void useAccount.getState().refresh();
    if (!db) return;
    const { data } = db.auth.onAuthStateChange(() => void useAccount.getState().refresh());
    return () => data.subscription.unsubscribe();
  }, []);

  // First load after sign in: make the company if needed, then merge both ways.
  useEffect(() => {
    const me = useAccount.getState().me;
    if (!me?.signedIn) {
      ready.current = false;
      useAccount.setState({ cloud: "off", sync: "idle" });
      return;
    }
    let stop = false;
    useAccount.setState({ cloud: "loading" });
    (async () => {
      if (!me.company) {
        const { profile, pricing } = useSettings.getState();
        const r = await fetch("/api/account/bootstrap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profile, pricing }) });
        if (stop) return;
        if (!r.ok) return void useAccount.setState({ cloud: "off", syncNote: "Your company account could not be set up, so work is saved in this browser only." });
        await useAccount.getState().refresh();
        return;
      }
      const [jobsRes, setRes] = await Promise.all([fetch("/api/jobs").then((r) => r.json()).catch(() => null), fetch("/api/settings").then((r) => r.json()).catch(() => null)]);
      if (stop) return;
      if (setRes?.settings?.profile && setRes.settings.pricing) useSettings.setState({ profile: { ...useSettings.getState().profile, ...setRes.settings.profile }, pricing: { ...useSettings.getState().pricing, ...setRes.settings.pricing } });
      const local = useJobs.getState().jobs;
      const remote = new Map<string, Job>(((jobsRes?.jobs ?? []) as Job[]).map((j) => [j.id, j]));
      for (const j of remote.values()) if (!local[j.id] || j.updatedAt > local[j.id].updatedAt) useJobs.getState().put(j);
      for (const j of Object.values(local)) if (!j.sample && (!remote.has(j.id) || j.updatedAt > remote.get(j.id)!.updatedAt)) pending.current.set(j.id, j);
      ready.current = true;
      useAccount.setState({ cloud: "ready", sync: pending.current.size ? "pending" : "saved", syncedAt: pending.current.size ? null : Date.now() });
      flushSoon();
    })();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, companyId]);

  function flushSoon() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 1200);
  }

  async function flush() {
    if (!ready.current) return;
    const batch = [...pending.current.values()];
    pending.current.clear();
    if (!batch.length) return;
    useAccount.setState({ sync: "saving" });
    let worst: "saved" | "error" | "offline" = "saved";
    for (const j of batch) {
      const r = await fetch(`/api/jobs/${encodeURIComponent(j.id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(j) }).catch(() => null);
      if (!r) {
        pending.current.set(j.id, j);
        worst = "offline";
        useAccount.setState({ syncNote: "Offline. Changes are saved on this device and will upload when you reconnect." });
      } else if (!r.ok) {
        const m = (await r.json().catch(() => ({}))) as { message?: string };
        if (worst === "saved") worst = "error";
        useAccount.setState({ syncNote: m.message ?? "This change was saved on this device only." });
      } else useAccount.setState({ syncNote: null });
    }
    // Changes made while uploading are queued again, so they are not reported as saved yet.
    useAccount.setState(worst === "saved" ? { sync: pending.current.size ? "pending" : "saved", syncedAt: Date.now() } : { sync: worst });
    if (pending.current.size) setTimeout(flush, 15_000);
  }

  // Every job change queues an upload; settings changes save directly.
  useEffect(() => {
    const unJobs = useJobs.subscribe((s, prev) => {
      if (!ready.current) return;
      for (const j of Object.values(s.jobs)) if (!j.sample && prev.jobs[j.id] !== j && (!prev.jobs[j.id] || prev.jobs[j.id].updatedAt !== j.updatedAt)) pending.current.set(j.id, j);
      if (pending.current.size) {
        if (useAccount.getState().sync !== "saving") useAccount.setState({ sync: "pending" });
        flushSoon();
      }
    });
    let st: ReturnType<typeof setTimeout> | null = null;
    const unSet = useSettings.subscribe((s, prev) => {
      if (!ready.current || (s.profile === prev.profile && s.pricing === prev.pricing)) return;
      if (st) clearTimeout(st);
      st = setTimeout(() => void fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ profile: s.profile, pricing: s.pricing }) }), 1500);
    });
    return () => {
      unJobs();
      unSet();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
