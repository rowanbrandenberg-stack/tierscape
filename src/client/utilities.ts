"use client";
import { uid } from "@/lib/jobs";
import { round1 } from "@/lib/geometry";
import { toPlan } from "@/lib/projection";
import type { Camera, Job, LikelyUtility, Pt, UtilityLine } from "@/lib/types";
import { api } from "./api";
import { useEditor } from "./editor";
import { planImage } from "./planImage";

/** The plan as Claude sees it, including the sample lot drawing when there is no aerial. */
export function currentPlanImage(job: Job, camera?: Camera | null) {
  const sample = job.sample ? document.querySelector("[data-sample-lot]")?.outerHTML ?? null : null;
  return planImage(job, sample ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 105">${sample}</svg>` : null, { camera });
}

const fromPct = (job: Job, [x, y]: [number, number]): Pt => {
  const e = job.site.extent;
  return round1([e.x + (x / 100) * e.w, e.y + (y / 100) * e.h]);
};

/**
 * Fill the likely utilities layer from public maps and the aerial. Each
 * source runs on its own, so one failing still leaves the other.
 */
export async function findLikelyUtilities(opts: { aerial: boolean }): Promise<{ found: number; errors: string[] }> {
  const job = useEditor.getState().job!;
  const errors: string[] = [];
  const found: LikelyUtility[] = [];
  const origin = job.site.origin;

  const tasks: Promise<void>[] = [];
  if (origin) {
    tasks.push(
      api
        .publicUtilities({ lat: origin.lat, lon: origin.lon, radiusM: Math.max(120, Math.hypot(job.site.extent.w, job.site.extent.h) * 0.3048) })
        .then((r) => {
          for (const f of r.features) found.push({ id: uid("lk"), type: f.type, pts: f.pts.map((p) => round1(toPlan(origin, p))), label: f.label, source: "public", overhead: f.overhead || undefined });
        })
        .catch((e) => void errors.push(`Public maps: ${e instanceof Error ? e.message : "unavailable"}`)),
    );
  }
  if (opts.aerial) {
    tasks.push(
      currentPlanImage(job)
        .then((img) => api.detectUtilities(img))
        .then((r) => {
          for (const c of r.clues) found.push({ id: uid("lk"), type: c.type, pts: [fromPct(job, [c.xPct, c.yPct])], label: c.label, source: "aerial" });
          for (const x of r.routes) found.push({ id: uid("lk"), type: x.type, pts: x.pts.map((p) => fromPct(job, p)), label: x.label || "Probable service route", source: "aerial" });
        })
        .catch((e) => void errors.push(`Aerial: ${e instanceof Error ? e.message : "unavailable"}`)),
    );
  }
  await Promise.all(tasks);
  const ran = new Set<LikelyUtility["source"]>();
  if (origin && !errors.some((e) => e.startsWith("Public"))) ran.add("public");
  if (opts.aerial && !errors.some((e) => e.startsWith("Aerial"))) ran.add("aerial");
  useEditor.getState().commit((j) => {
    j.likely = [...(j.likely ?? []).filter((l) => !ran.has(l.source)), ...found];
  });
  return { found: found.length, errors };
}

/** Trace locator paint from the active photo into marked lines. */
export async function traceMarksFromPhoto(photoBlob: Blob, camera: Camera | null): Promise<{ added: number; note: string }> {
  const job = useEditor.getState().job!;
  const img = await currentPlanImage(job, camera);
  const r = await api.traceMarks(img, photoBlob);
  const lines: UtilityLine[] = r.marks.map((m) => ({ id: uid("ut"), type: m.type, pts: m.pts.map((p) => fromPct(job, p)), source: "photo" }));
  if (lines.length) useEditor.getState().commit((j) => void j.utilities.push(...lines));
  return { added: lines.length, note: r.note };
}
