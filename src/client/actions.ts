"use client";
import { newArea, newPlant, uid } from "@/lib/jobs";
import { round1 } from "@/lib/geometry";
import type { Area, Pt } from "@/lib/types";
import { toGeo, toPlan } from "@/lib/projection";
import { api, ApiError } from "./api";
import { useEditor } from "./editor";

/** Editor actions shared by the canvas, the toolbar and keyboard shortcuts. */

const ed = () => useEditor.getState();

export function addArea(pts: Pt[], type: Area["type"] = ed().drawType) {
  const a = newArea(type, pts.map(round1));
  ed().commit((j) => void j.areas.push(a));
  ed().set({ tool: "select", draft: [], selection: { kind: "area", id: a.id } });
}

export function finishDraft() {
  const { tool, draft, utilityType } = ed();
  if (tool === "outline" && draft.length >= 3) return addArea(draft);
  if (tool === "lot" && draft.length >= 3) {
    ed().commit((j) => void (j.lot = draft.map(round1)));
    return ed().set({ tool: "select", draft: [], selection: { kind: "lot" } });
  }
  if (tool === "utility" && draft.length >= 2) {
    const id = uid("util");
    ed().commit((j) => void j.utilities.push({ id, type: utilityType, pts: draft.map(round1) }));
    ed().set({ tool: "select", draft: [], selection: { kind: "utility", id } });
  }
}

let clipboard: { kind: "area"; area: Area } | { kind: "plant"; id: string; spot: Pt } | null = null;
let pastes = 0;

export function copySelection(): boolean {
  const { job, selection } = ed();
  if (!job || !selection) return false;
  if (selection.kind === "area") {
    const a = job.areas.find((x) => x.id === selection.id);
    if (a) clipboard = { kind: "area", area: structuredClone(a) };
  } else if (selection.kind === "plant") {
    const p = job.plants.find((x) => x.id === selection.id);
    if (p) clipboard = { kind: "plant", id: p.id, spot: p.spots[selection.index] };
  } else return false;
  pastes = 0;
  return true;
}

export const hasClipboard = () => clipboard !== null;

export function paste() {
  const c = clipboard;
  if (!c) return;
  pastes++;
  const off = 4 * pastes;
  if (c.kind === "area") {
    const a: Area = { ...structuredClone(c.area), id: uid("area"), pts: c.area.pts.map(([x, y]) => round1([x + off, y + off])) };
    ed().commit((j) => void j.areas.push(a));
    ed().set({ selection: { kind: "area", id: a.id }, tool: "select", draft: [] });
  } else {
    let index = -1;
    ed().commit((j) => {
      const p = j.plants.find((x) => x.id === c.id);
      if (!p) return;
      p.spots.push(round1([c.spot[0] + off, c.spot[1] + off]));
      index = p.spots.length - 1;
    });
    if (index >= 0) ed().set({ selection: { kind: "plant", id: c.id, index } });
  }
}

export function deleteSelection() {
  const { selection } = ed();
  if (!selection) return;
  ed().commit((j) => {
    if (selection.kind === "area") j.areas = j.areas.filter((a) => a.id !== selection.id);
    else if (selection.kind === "plant") j.plants.find((p) => p.id === selection.id)?.spots.splice(selection.index, 1);
    else if (selection.kind === "lot") j.lot = null;
    else j.utilities = j.utilities.filter((u) => u.id !== selection.id);
  });
  ed().set({ selection: null });
}

/** Replace the property line with the parcel under a clicked plan point. */
export async function pickLotAt(q: Pt) {
  const job = ed().job;
  const origin = job?.site.origin;
  if (!job || !origin) return;
  ed().set({ draft: [q], lotNotice: "Looking up that lot." });
  try {
    const { parcel } = await api.parcelAt({ ...toGeo(origin, q), county: job.site.county });
    const pts = parcel.ring.map((p) => round1(toPlan(origin, p)));
    const [a, b] = [pts[0], pts[pts.length - 1]];
    if (pts.length > 3 && Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.05) pts.pop();
    ed().commit((j) => {
      j.lot = pts;
      j.site.parcel = { apn: parcel.apn, address: parcel.address, pts, source: parcel.source, matchedBy: "picked" };
    });
    ed().set({ tool: "select", draft: [], lotNotice: null });
  } catch (e) {
    ed().set({ draft: [], lotNotice: e instanceof ApiError ? e.message : "Could not look up that lot." });
  }
}

/** Drop the last point of the shape being drawn, or leave the tool if none are left. */
export function undoPoint() {
  const { draft } = ed();
  if (draft.length) ed().set({ draft: draft.slice(0, -1) });
}

/** Leave whatever tool is active and go back to moving and selecting. */
export function cancelTool() {
  ed().set({ tool: "select", draft: [], placingPlantId: null });
}

/** Start drawing a new area of a type, with the chosen shape tool. */
export function startArea(type: Area["type"], shape: "outline" | "rect" | "circle" = "outline") {
  ed().set({ drawType: type, tool: shape, draft: [], selection: null, placingPlantId: null });
}

/** A new plant, straight into placing it on the plan. */
export function startPlant() {
  const p = newPlant();
  ed().commit((j) => void j.plants.push(p));
  ed().set({ placingPlantId: p.id, tool: "select", draft: [], selection: null });
  return p.id;
}

export function duplicateSelection() {
  if (copySelection()) paste();
}

export function setSelectedAreaType(type: Area["type"]) {
  const { selection } = ed();
  if (selection?.kind !== "area") return;
  ed().commit((j) => {
    const a = j.areas.find((x) => x.id === selection.id);
    if (a) a.type = type;
  });
}
