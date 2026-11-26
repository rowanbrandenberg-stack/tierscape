"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { copySelection, deleteSelection, finishDraft, hasClipboard, paste } from "@/client/actions";
import { useEditor } from "@/client/editor";
import { useJobs } from "@/client/jobsStore";
import { getPhoto } from "@/client/photoStore";
import { useMounted } from "@/client/useMounted";
import { useAccount } from "@/client/account";
import { PlanView } from "./PlanView";
import { SaveStatus } from "./SaveStatus";
import { TiersView } from "../tiers/TiersView";
import { ProposalView } from "../proposal/ProposalView";
import { BuildPack } from "../build/BuildPack";
import { OptionsView } from "../concept/OptionsView";
import s from "./Workspace.module.css";

const PLAN_TABS = [
  { key: "plan", name: "Plan" },
  { key: "tiers", name: "Tiers" },
  { key: "proposal", name: "Proposal" },
  { key: "build", name: "Build pack" },
] as const;
/** Photo jobs skip the aerial plan: the three options come from the photo. */
const PHOTO_TABS = [
  { key: "options", name: "Options" },
  { key: "proposal", name: "Proposal" },
  { key: "build", name: "Build pack" },
] as const;
type Tab = (typeof PLAN_TABS)[number]["key"] | (typeof PHOTO_TABS)[number]["key"];

export function Workspace({ id }: { id: string }) {
  const mounted = useMounted();
  const stored = useJobs((x) => x.jobs[id]);
  const save = useJobs((x) => x.save);
  const cloud = useAccount((x) => x.cloud);
  // Signed in but the first cloud load has not started yet counts as loading, unless setup already failed.
  const cloudPending = useAccount((x) => !x.checked || x.cloud === "loading" || (!!x.me?.signedIn && x.cloud === "off" && !x.syncNote));
  const ed = useEditor();
  const job = ed.job;
  const [tab, setTab] = useState<Tab>(stored?.kind === "photo" ? "options" : "plan");
  // The saved job arrives after hydration on a direct load, so put each kind on a tab it has.
  const kind = stored?.kind === "photo" && stored.concept ? "photo" : stored ? "plan" : null;
  useEffect(() => {
    if (kind === "photo" && (tab === "plan" || tab === "tiers")) setTab("options");
    if (kind === "plan" && tab === "options") setTab("plan");
  }, [kind, tab]);
  const loaded = useRef<string | null>(null);

  // Open the job and bring its photos back from local storage.
  useEffect(() => {
    if (!mounted || !stored || loaded.current === id) return;
    loaded.current = id;
    ed.load(structuredClone(stored));
    stored.photos.forEach(async (p) => {
      const blob = await getPhoto(p.id).catch(() => undefined);
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      useEditor.setState((st) => (st.job ? { job: { ...st.job, photos: st.job.photos.map((x) => (x.id === p.id ? { ...x, dataUrl: url } : x)) } } : {}));
    });
  }, [mounted, stored, id, ed]);

  // Save shortly after each change.
  const [localSaved, setLocalSaved] = useState(true);
  const firstSave = useRef(true);
  useEffect(() => {
    if (!job || job.id !== id) return;
    if (firstSave.current) firstSave.current = false;
    else setLocalSaved(false);
    const t = setTimeout(() => {
      save(job);
      setLocalSaved(true);
    }, 400);
    return () => clearTimeout(t);
  }, [job, id, save]);

  // Keyboard shortcuts for the plan.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (tab !== "plan") return;
      if (/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName)) return;
      const st = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") {
        e.preventDefault();
        e.shiftKey ? st.redo() : st.undo();
      } else if (mod && k === "y") {
        e.preventDefault();
        st.redo();
      } else if (mod && k === "c") {
        if (!String(window.getSelection() ?? "") && copySelection()) e.preventDefault();
      } else if (mod && k === "v") {
        if (hasClipboard()) {
          e.preventDefault();
          paste();
        }
      } else if (mod && k === "d") {
        if (copySelection()) {
          e.preventDefault();
          paste();
        }
      } else if (k === "delete" || k === "backspace") {
        if (st.selection && st.tool === "select") {
          e.preventDefault();
          deleteSelection();
        }
      } else if (k === "enter") {
        finishDraft();
      } else if (k === "escape") {
        st.set({ tool: "select", draft: [], placingPlantId: null, selection: st.tool === "select" && !st.placingPlantId ? null : st.selection });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab]);

  if (!mounted) return null;
  if (!stored) {
    if (cloudPending)
      return (
        <main className="page">
          <div className={s.missing}>
            <p className="muted" role="status">Loading your jobs from your account…</p>
          </div>
        </main>
      );
    return (
      <main className="page">
        <div className={s.missing}>
          <h1 className="title">{cloud === "ready" ? "This job is not in your account or this browser." : "This job is not on this device."}</h1>
          <p className="muted">
            {cloud === "ready"
              ? "It may have been deleted, or saved in another browser before you signed in there."
              : "You are not signed in, so only jobs saved in this browser are available here."}
          </p>
          <Link className="btn" href="/">Back to jobs <span aria-hidden="true">→</span></Link>
        </div>
      </main>
    );
  }
  if (!job || job.id !== id) return null;
  const photo = job.kind === "photo" && !!job.concept;
  const TABS = photo ? PHOTO_TABS : PLAN_TABS;

  return (
    <main className={s.main}>
      <div className={`${s.head} no-print`}>
        <div className={s.titleBlock}>
          <span className="label">{job.sample ? "Sample job" : photo ? "Photo job" : job.site.county ? `${job.site.county} County, ${job.site.state}` : "Job"}</span>
          <h1 className="title">{job.name}</h1>
          <SaveStatus sample={job.sample} localSaved={localSaved} hasPhotos={job.photos.some((p) => p.placedBy !== "sample")} />
        </div>
        <nav className={s.tabs} aria-label="Job sections" role="tablist">
          {TABS.map((t, i) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>
              <span className={s.n}>{i + 1}</span>
              {t.name}
            </button>
          ))}
        </nav>
      </div>
      {tab === "options" && photo && <OptionsView onNext={() => setTab("proposal")} />}
      {tab === "plan" && !photo && <PlanView onNext={() => setTab("tiers")} />}
      {tab === "tiers" && !photo && <TiersView onNext={() => setTab("proposal")} />}
      {tab === "proposal" && <ProposalView onBuild={() => setTab("build")} />}
      {tab === "build" && <BuildPack />}
    </main>
  );
}
