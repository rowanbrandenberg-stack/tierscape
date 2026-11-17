"use client";
import { create } from "zustand";
import type { Job, Pt } from "@/lib/types";

/**
 * The open job plus everything the plan canvas needs: tools, selection,
 * camera, and an undo history of committed changes.
 */
export type Tool = "select" | "outline" | "rect" | "circle" | "scale" | "lot" | "utility" | "camera" | "plant" | "pickLot";

export type Selection =
  | { kind: "area"; id: string }
  | { kind: "plant"; id: string; index: number }
  | { kind: "lot" }
  | { kind: "utility"; id: string }
  | null;

export interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface EditorState {
  job: Job | null;
  past: string[];
  future: string[];
  tool: Tool;
  draft: Pt[];
  selection: Selection;
  placingPlantId: string | null;
  utilityType: Job["utilities"][number]["type"];
  snapDeg: number;
  view: View | null;
  colorAerial: boolean;
  /** A short status line for the property line panel. */
  lotNotice: string | null;
  load: (job: Job) => void;
  /** Apply a change and record it for undo. */
  commit: (fn: (j: Job) => void) => void;
  /** Apply a change without recording it (used while dragging). */
  mutate: (fn: (j: Job) => void) => void;
  /** Record the state from before a drag started. */
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
  set: (p: Partial<Omit<EditorState, "job">>) => void;
}

const snap = (j: Job) => JSON.stringify({ ...j, photos: j.photos.map((p) => ({ ...p, dataUrl: null })) });
const LIMIT = 150;

export const useEditor = create<EditorState>()((set, get) => ({
  job: null,
  past: [],
  future: [],
  tool: "select",
  draft: [],
  selection: null,
  placingPlantId: null,
  utilityType: "gas",
  snapDeg: 90,
  view: null,
  colorAerial: true,
  lotNotice: null,
  load: (job) => set({ job, past: [], future: [], tool: "select", draft: [], selection: null, placingPlantId: null, view: { ...job.site.extent } }),
  commit: (fn) => {
    const { job, past } = get();
    if (!job) return;
    const before = snap(job);
    const next = structuredClone(job);
    fn(next);
    if (snap(next) === before) return;
    set({ job: next, past: [...past, before].slice(-LIMIT), future: [] });
  },
  mutate: (fn) => {
    const { job } = get();
    if (!job) return;
    const next = structuredClone(job);
    fn(next);
    set({ job: next });
  },
  checkpoint: () => {
    const { job, past } = get();
    if (job) set({ past: [...past, snap(job)].slice(-LIMIT), future: [] });
  },
  undo: () => {
    const { job, past, future, draft } = get();
    if (draft.length) return set({ draft: draft.slice(0, -1) });
    if (!job || !past.length) return;
    const prev = JSON.parse(past[past.length - 1]) as Job;
    prev.photos = prev.photos.map((p) => ({ ...p, dataUrl: job.photos.find((q) => q.id === p.id)?.dataUrl ?? null }));
    set({ job: prev, past: past.slice(0, -1), future: [snap(job), ...future], selection: null });
  },
  redo: () => {
    const { job, past, future } = get();
    if (!job || !future.length) return;
    const next = JSON.parse(future[0]) as Job;
    next.photos = next.photos.map((p) => ({ ...p, dataUrl: job.photos.find((q) => q.id === p.id)?.dataUrl ?? null }));
    set({ job: next, past: [...past, snap(job)], future: future.slice(1), selection: null });
  },
  set: (p) => set(p),
}));
