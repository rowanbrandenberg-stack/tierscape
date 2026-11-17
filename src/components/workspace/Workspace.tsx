"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { copySelection, deleteSelection, finishDraft, hasClipboard, paste } from "@/client/actions";
import { useEditor } from "@/client/editor";
import { useJobs } from "@/client/jobsStore";
import { getPhoto } from "@/client/photoStore";
import { useMounted } from "@/client/useMounted";
import { PlanView } from "./PlanView";
import { TiersView } from "../tiers/TiersView";
import { ProposalView } from "../proposal/ProposalView";
import { BuildPack } from "../build/BuildPack";
import s from "./Workspace.module.css";

const TABS = [
  { key: "plan", name: "Plan" },
  { key: "tiers", name: "Tiers" },
  { key: "proposal", name: "Proposal" },
  { key: "build", name: "Build pack" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export function Workspace({ id }: { id: string }) {
  const mounted = useMounted();
  const stored = useJobs((x) => x.jobs[id]);
  const save = useJobs((x) => x.save);
  const ed = useEditor();
  const job = ed.job;
  const [tab, setTab] = useState<Tab>("plan");
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
  useEffect(() => {
    if (!job || job.id !== id) return;
    const t = setTimeout(() => save(job), 400);
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
    return (
      <main className="page">
        <div className={s.missing}>
          <h1 className="title">This job is not on this device.</h1>
          <p className="muted">Jobs are saved in this browser for now.</p>
          <Link className="btn" href="/">Back to jobs <span aria-hidden="true">→</span></Link>
        </div>
      </main>
    );
  }
  if (!job || job.id !== id) return null;

  return (
    <main className={s.main}>
      <div className={`${s.head} no-print`}>
        <div className={s.titleBlock}>
          <span className="label">{job.sample ? "Sample job" : job.site.county ? `${job.site.county} County, ${job.site.state}` : "Job"}</span>
          <h1 className="title">{job.name}</h1>
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
      {tab === "plan" && <PlanView onNext={() => setTab("tiers")} />}
      {tab === "tiers" && <TiersView onNext={() => setTab("proposal")} />}
      {tab === "proposal" && <ProposalView onBuild={() => setTab("build")} />}
      {tab === "build" && <BuildPack />}
    </main>
  );
}
