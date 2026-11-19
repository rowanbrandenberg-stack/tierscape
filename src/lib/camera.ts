import { AREA_TYPES, GENERIC_SIZE } from "./catalog";
import { areaSqft, centroid } from "./geometry";
import { quote } from "./pricing";
import type { Pricing } from "./settings";
import type { Area, Camera, Job, Pt, TierKey } from "./types";
import { TIERS } from "./types";

/** Horizontal field of view of a typical phone main camera. */
export const FOV = (65 * Math.PI) / 180;
const MAX_FT = 200;

const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
export function compass(angle: number): string {
  const deg = (((angle * 180) / Math.PI + 90) % 360 + 360) % 360;
  return COMPASS[Math.round(deg / 45) % 8];
}

/** Compass bearing in degrees (0 = north) to plan angle, and back. */
export const bearingToAngle = (deg: number) => ((deg - 90) * Math.PI) / 180;

export interface Seen {
  inView: boolean;
  distanceFt: number;
  side: "left" | "center" | "right";
  depth: "foreground" | "middle distance" | "background";
}

export function seen(cam: Camera, q: Pt): Seen {
  const dx = q[0] - cam.x;
  const dy = q[1] - cam.y;
  const d = Math.hypot(dx, dy);
  const off = Math.atan2(Math.sin(Math.atan2(dy, dx) - cam.angle), Math.cos(Math.atan2(dy, dx) - cam.angle));
  return {
    inView: Math.abs(off) <= FOV / 2 + 0.12 && d < MAX_FT && d > 1,
    distanceFt: d,
    side: off < -0.2 ? "left" : off > 0.2 ? "right" : "center",
    depth: d < 25 ? "foreground" : d < 60 ? "middle distance" : "background",
  };
}

export function areaInView(cam: Camera, a: Area): { visible: boolean; partly: boolean; at: Seen } {
  const c = centroid(a.pts);
  const pts = [c, ...a.pts];
  const hits = pts.map((q) => seen(cam, q)).filter((s) => s.inView);
  const atC = seen(cam, c);
  return { visible: hits.length > 0, partly: hits.length > 0 && hits.length < pts.length, at: atC.inView ? atC : hits[0] ?? atC };
}

/** Rough position on the lot, used when no photo is placed. */
export function lotPosition(extent: Job["site"]["extent"], q: Pt): string {
  const ns = ["north", "middle", "south"][Math.min(2, Math.max(0, Math.floor(((q[1] - extent.y) / extent.h) * 3)))];
  const ew = ["west", "center", "east"][Math.min(2, Math.max(0, Math.floor(((q[0] - extent.x) / extent.w) * 3)))];
  return ns === "middle" && ew === "center" ? "middle" : `${ns} ${ew}`;
}

export function cameraSummary(job: Job, cam: Camera): string {
  const vis = job.areas.filter((a) => areaInView(cam, a).visible).map((a) => AREA_TYPES[a.type].label.toLowerCase());
  return `Taken from the ${lotPosition(job.site.extent, [cam.x, cam.y])} of the lot, facing ${compass(cam.angle)}. ${
    vis.length ? `Sees the ${[...new Set(vis)].join(", ")}.` : "No planned areas are in view."
  }`;
}

/**
 * The text that goes to the image model with the site photo. It names the
 * location (plants grow differently by climate), where the camera is, where
 * each planned area lands in the frame, and what must stay untouched.
 */
export function renderPrompt(job: Job, pricing: Pricing, tier: TierKey): string {
  const q = quote(job, pricing, tier);
  const photo = job.photos.find((p) => p.id === job.activePhotoId);
  const cam = photo?.camera ?? null;
  const L: string[] = [
    `Edit the attached site photo into a realistic after image of this yard. Change only the areas listed below and leave everything else exactly as it is in the photo. Keep the house, fence, camera angle and lighting. Location: ${job.site.matchedAddress ?? job.site.address}. Show every plant at the size it really reaches in this location, not catalog size.`,
  ];
  if (cam) {
    L.push("", `Where this photo was taken: from the ${lotPosition(job.site.extent, [cam.x, cam.y])} of the lot, looking ${compass(cam.angle)}.`);
    const vis: string[] = [];
    const hid: string[] = [];
    for (const a of job.areas) {
      const v = areaInView(cam, a);
      const lab = `${AREA_TYPES[a.type].label} (${Math.round(areaSqft(a))} sq ft)`;
      if (v.visible) vis.push(`• ${lab}: ${v.at.depth}, ${v.at.side}${v.partly ? ", partly in frame" : ""}`);
      else hid.push(lab.toLowerCase());
    }
    if (vis.length) L.push("Where each planned area appears in this photo:", ...vis);
    if (hid.length) L.push(`Out of frame, so do not draw: ${hid.join(", ")}.`);
  }
  L.push("", `${TIERS.find((t) => t.key === tier)!.name} plan surfaces:`);
  for (const g of q.groups) if (g.kind !== "plants" && g.kind !== "extras") L.push(`• ${g.title}, ${Math.round(g.sqft)} sq ft`);
  const placed = job.plants.filter((p) => p.spots.length);
  if (placed.length) {
    L.push("", cam ? "Plants, by where they land in this photo:" : "Plants, positioned from the plan (north is up):");
    for (const p of placed) {
      const where = [...new Set(p.spots.map((s) => (cam ? (seen(cam, s).inView ? `${seen(cam, s).depth} ${seen(cam, s).side}` : "out of frame") : lotPosition(job.site.extent, s))))].join(", ");
      const size = pricing.plantSizes[p.kind][tier].size;
      const est = p.estimate
        ? `Expected here after 10 years: about ${p.estimate.heightFt} ft tall and ${p.estimate.spreadFt} ft wide. ${p.estimate.note}`
        : `Local size not estimated yet; assume about ${GENERIC_SIZE[p.kind][0]} ft tall.`;
      L.push(`• ${p.spots.length} x ${p.name || "unnamed plant"}, installed as ${size}, positions: ${where}. ${est}`);
    }
  }
  L.push("", "Do not add plants, furniture or features that are not listed.");
  return L.join("\n");
}
