import { AREA_TYPES, GENERIC_SIZE, PRIVATE_LINES, UTILITIES } from "./catalog";
import { areaSqft, polylineDistance, polylineNearPolygon, pointInPolygon, polygonDistance } from "./geometry";
import { toGeo } from "./projection";
import type { Area, Job, Plant, Pt, UtilityType } from "./types";

/**
 * 811 rules by state. Only states we have checked are listed; anything else
 * falls back to generic guidance and never shows computed dates.
 * Arizona: 2 working days notice, marks valid 15 working days, hand tools
 * only within 24 in of a marked facility (Arizona Corporation Commission).
 */
export interface OneCallRules {
  state: string;
  center: string;
  website: string;
  noticeWorkingDays: number;
  marksValidWorkingDays: number;
  handDigFt: number;
}

export const ONE_CALL: Record<string, OneCallRules> = {
  AZ: { state: "AZ", center: "Arizona 811", website: "https://www.arizona811.com/", noticeWorkingDays: 2, marksValidWorkingDays: 15, handDigFt: 2 },
};

export const DEFAULT_HAND_DIG_FT = 2;

export function rulesFor(state: string | null | undefined): OneCallRules | null {
  return (state && ONE_CALL[state.toUpperCase()]) || null;
}

/** Adds working days (Mon to Fri). Holidays are not known here and push real dates later. */
export function addWorkingDays(isoDate: string, n: number): Date {
  const d = new Date(`${isoDate}T12:00:00`);
  let k = 0;
  while (k < n) {
    d.setDate(d.getDate() + 1);
    const w = d.getDay();
    if (w !== 0 && w !== 6) k++;
  }
  return d;
}

export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function ticketDates(rules: OneCallRules, requestedOn: string) {
  const clear = addWorkingDays(requestedOn, rules.noticeWorkingDays);
  const expires = addWorkingDays(isoDay(clear), rules.marksValidWorkingDays);
  return { clear, expires };
}

/* ---------- conflicts ---------- */

export function utilitiesNearArea(job: Pick<Job, "utilities">, a: Area, r = DEFAULT_HAND_DIG_FT): UtilityType[] {
  const out: UtilityType[] = [];
  for (const u of job.utilities) if (u.pts.length > 1 && polylineNearPolygon(u.pts, a.pts, r) && !out.includes(u.type)) out.push(u.type);
  return out;
}

export function utilitiesNearPlant(job: Pick<Job, "utilities">, p: Plant, spot: Pt): UtilityType[] {
  const spread = (p.estimate?.spreadFt ?? GENERIC_SIZE[p.kind][1]) / 2;
  const r = Math.max(DEFAULT_HAND_DIG_FT, spread);
  return [...new Set(job.utilities.filter((u) => u.pts.length > 1 && polylineDistance(spot, u.pts) <= r).map((u) => u.type))];
}

export function outsideLot(lot: Pt[] | null, pts: Pt[]): boolean {
  if (!lot || lot.length < 3) return false;
  return pts.some((q) => !pointInPolygon(q, lot) && polygonDistance(q, lot) > 0.15);
}

/** The "Before you dig" list for the build pack. */
export function beforeYouDig(job: Job): string[] {
  const rules = rulesFor(job.site.state);
  const out: string[] = [];
  out.push(
    rules
      ? `Request a locate through ${rules.center} at least ${rules.noticeWorkingDays} full working days before digging.`
      : "Call 811 for a utility locate before digging. Notice periods vary by state.",
  );
  out.push(job.locate.number ? `811 ticket ${job.locate.number}${job.locate.requestedOn ? `, requested ${job.locate.requestedOn}` : ""}.` : "811 ticket not requested yet.");
  out.push("Do not dig until every utility on the ticket has responded.");
  out.push(`Use hand tools only within ${rules ? rules.handDigFt * 12 : 24} in of any marked line.`);
  for (const a of job.areas) {
    const near = utilitiesNearArea(job, a);
    if (near.length)
      out.push(`${near.map((t) => UTILITIES[t].name).join(" and ")} runs within 2 ft of the ${AREA_TYPES[a.type].label.toLowerCase()} (${Math.round(areaSqft(a))} sq ft). Hand dig that section.`);
  }
  for (const p of job.plants)
    for (const s of p.spots) {
      const near = utilitiesNearPlant(job, p, s);
      if (near.length) out.push(`${p.name || "A plant"} sits near the ${near.map((t) => UTILITIES[t].name.toLowerCase()).join(" and ")}. Move it or hand dig the hole.`);
    }
  const likely = (job.likely ?? []).filter((l) => !l.overhead);
  if (likely.length) {
    const types = [...new Set(likely.map((l) => UTILITIES[l.type].name.toLowerCase()))];
    out.push(`Likely but not located: ${types.join(", ")}. Treat these as live until 811 marks them or the ticket comes back clear.`);
  }
  if ((job.likely ?? []).some((l) => l.overhead)) out.push("Overhead power lines near the work. Keep equipment and long tools at least 10 ft away.");
  const priv = PRIVATE_LINES.filter((p) => job.privateLines?.[p.key] === "yes" || job.privateLines?.[p.key] === "unsure");
  if (priv.length) out.push(`811 will not mark private lines. Locate these before digging: ${priv.map((p) => p.name.toLowerCase()).join(", ")}.`);
  if (job.lot) out.push("Stay inside the property line. Confirm the corners before work that runs along it.");
  return out;
}

/* ---------- the locate request ---------- */

export interface LocateRequest {
  address: string;
  county: string | null;
  state: string | null;
  workType: string;
  /** The dig areas as GeoJSON, which is the electronic white lining. */
  digArea: GeoJSON;
  plannedStart: string | null;
  excavator: { company: string; phone: string; email: string; license: string };
}

type GeoJSON = { type: "FeatureCollection"; features: { type: "Feature"; properties: Record<string, string | number>; geometry: { type: "Polygon"; coordinates: number[][][] } }[] };

/** Builds the request from the plan. Needs a geo origin, so the sample job cannot produce one. */
export function buildLocateRequest(job: Job, excavator: LocateRequest["excavator"], plannedStart: string | null): LocateRequest | null {
  const o = job.site.origin;
  if (!o) return null;
  const ring = (pts: Pt[]) => {
    const r = pts.map((q) => {
      const g = toGeo(o, q);
      return [Math.round(g.lon * 1e7) / 1e7, Math.round(g.lat * 1e7) / 1e7];
    });
    return [...r, r[0]];
  };
  const features = job.areas.map((a) => ({
    type: "Feature" as const,
    properties: { work: AREA_TYPES[a.type].label, sqft: Math.round(areaSqft(a)) },
    geometry: { type: "Polygon" as const, coordinates: [ring(a.pts)] },
  }));
  const plantSpots = job.plants.reduce((s, p) => s + p.spots.length, 0);
  const kinds = [...new Set(job.areas.map((a) => AREA_TYPES[a.type].label.toLowerCase()))];
  return {
    address: job.site.matchedAddress ?? job.site.address,
    county: job.site.county,
    state: job.site.state,
    workType: `Landscaping: ${[...kinds, plantSpots ? "planting" : ""].filter(Boolean).join(", ")}`,
    digArea: { type: "FeatureCollection", features },
    plannedStart,
    excavator,
  };
}
