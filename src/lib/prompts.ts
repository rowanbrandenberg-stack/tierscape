import type { UtilityType } from "./types";

/**
 * Every AI instruction Tierscape uses, shared by the server (API keys) and
 * manual mode (the contractor pastes it into their own Claude or ChatGPT),
 * so both give the same answer shape.
 */

const TYPES: UtilityType[] = ["gas", "elec", "comm", "water", "irr", "sewer"];
const PAINT: Record<string, UtilityType> = { yellow: "gas", red: "elec", orange: "comm", blue: "water", purple: "irr", green: "sewer" };
const pct = (n: unknown) => Number.isFinite(Number(n)) && Number(n) >= -5 && Number(n) <= 105;

/** Pull the JSON out of a model reply, with or without a code fence or chatter around it. */
export function parseJsonReply<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1];
  const start = Math.min(...["{", "["].map((c) => (text.indexOf(c) < 0 ? Infinity : text.indexOf(c))));
  const raw = fenced ?? (Number.isFinite(start) ? text.slice(start) : text);
  return JSON.parse(raw.trim().replace(/[^}\]]*$/, "")) as T;
}

/* ---------- plant growth ---------- */

export const estimatePrompt = (location: string, plants: { name: string; kind: string }[]) =>
  `You are a horticulture reference for a landscape contractor. Job location: ${location}.\n` +
  "For each plant below, estimate its realistic size 10 years after planting in that specific location. Account for elevation, growing season length, winter lows, summer heat, rainfall and typical soil there, so the same plant can come out a different size in a different place. If a plant is unlikely to survive there, say so in the note.\n" +
  'Reply with only a JSON array, one object per plant in the same order: {"name": string, "height_ft": number, "spread_ft": number, "note": string}. Keep each note under 20 words and use no hyphens or dashes.\n\nPlants:\n' +
  plants.slice(0, 40).map((p, i) => `${i + 1}. ${p.name.slice(0, 80)} (${p.kind})`).join("\n");

export type Estimate = { name: string; height_ft: number; spread_ft: number; note: string };
export const normEstimates = (r: unknown): Estimate[] =>
  (Array.isArray(r) ? r : []).filter((x) => x && Number.isFinite(Number(x.height_ft)) && Number.isFinite(Number(x.spread_ft))).map((x) => ({ name: String(x.name ?? ""), height_ft: Number(x.height_ft), spread_ft: Number(x.spread_ft), note: String(x.note ?? "").slice(0, 200) }));

/* ---------- where a photo was taken ---------- */

export const LOCATE_PROMPT =
  "Image 1 is a top down plan of one property with north at the top. A grid splits it into columns A to J from left to right and rows 1 to 10 from top to bottom. Colored outlines are planned work areas with labels.\n" +
  "Image 2 is a photo taken at ground level somewhere on this property.\n" +
  "Work out where the photographer stood and which way the camera pointed. Match what is in the photo to the plan: the house walls and roof line, fences, driveway, sidewalk and street, trees, sheds and any paving.\n" +
  'Reply with only JSON: {"x_pct": number, "y_pct": number, "facing_deg": number, "confidence": "high" or "medium" or "low", "reason": string}. x_pct runs 0 to 100 from the left edge, y_pct 0 to 100 from the top edge. facing_deg is the compass direction the camera points: 0 north, 90 east, 180 south, 270 west. Keep the reason under 25 words and use no hyphens or dashes.';

export type Located = { xPct: number; yPct: number; facingDeg: number; confidence: string; reason: string };
export function normLocate(r: { x_pct?: unknown; y_pct?: unknown; facing_deg?: unknown; confidence?: unknown; reason?: unknown }): Located | null {
  if (![r.x_pct, r.y_pct, r.facing_deg].every((n) => Number.isFinite(Number(n)))) return null;
  return { xPct: Number(r.x_pct), yPct: Number(r.y_pct), facingDeg: Number(r.facing_deg), confidence: String(r.confidence ?? "low"), reason: String(r.reason ?? "").slice(0, 200) };
}

/* ---------- utility clues on the aerial ---------- */

export const DETECT_PROMPT =
  "This is a top down aerial of one residential property with north at the top, under a lettered grid (columns A to J, rows 1 to 10). The dashed amber outline is the property line. Colored outlines are planned dig areas.\n" +
  "Find visible clues to underground utilities on or next to this lot: power poles, pad mount transformers, utility pedestals and boxes, gas and electric meters on the house wall, water meter boxes near the curb, fire hydrants, manholes, sewer cleanouts, valve covers, irrigation controllers or valve boxes, AC units, propane tanks, septic lids.\n" +
  "Then sketch the probable route of each service line from where it most likely enters the lot (street, alley or a pole or pedestal) to where it most likely meets the house. Services usually run in a fairly straight line from the street side to the meter. Only sketch a route when you can see or reasonably infer both ends.\n" +
  `Types: gas, elec, comm (phone, cable, fiber), water, irr (irrigation), sewer. Reply with only JSON: {"clues": [{"type": one of ${TYPES.join(", ")}, "x_pct": number, "y_pct": number, "label": string}], "routes": [{"type": string, "pts": [[x_pct, y_pct], ...], "label": string}]}. Percentages run 0 to 100 from the left and top edges. Labels under 8 words, plain words, no hyphens or dashes. Include at most 12 clues and 6 routes. Leave out anything you are not reasonably confident you can see.`;

export type Detected = { clues: { type: UtilityType; xPct: number; yPct: number; label: string }[]; routes: { type: UtilityType; pts: [number, number][]; label: string }[] };
export function normDetect(r: { clues?: { type: string; x_pct: number; y_pct: number; label: string }[]; routes?: { type: string; pts: [number, number][]; label: string }[] }): Detected {
  const ok = (t: string): t is UtilityType => (TYPES as string[]).includes(t);
  return {
    clues: (r.clues ?? []).filter((c) => ok(c.type) && pct(c.x_pct) && pct(c.y_pct)).slice(0, 12).map((c) => ({ type: c.type as UtilityType, xPct: Number(c.x_pct), yPct: Number(c.y_pct), label: String(c.label ?? "").slice(0, 80) })),
    routes: (r.routes ?? [])
      .filter((x) => ok(x.type) && Array.isArray(x.pts) && x.pts.length >= 2 && x.pts.every((p) => pct(p?.[0]) && pct(p?.[1])))
      .slice(0, 6)
      .map((x) => ({ type: x.type as UtilityType, pts: x.pts.map((p) => [Number(p[0]), Number(p[1])] as [number, number]), label: String(x.label ?? "").slice(0, 80) })),
  };
}

/* ---------- locator paint from a photo ---------- */

export const TRACE_PROMPT =
  "Image 1 is a top down plan of one property with north at the top and a lettered grid (columns A to J, rows 1 to 10). The cyan wedge marked PHOTO shows where image 2 was taken and the direction the camera faced.\n" +
  "Image 2 is a ground photo after an 811 locate. Find every locator mark: spray paint lines, dashes and arrows, and small colored flags. Colors follow the APWA code: yellow gas, red electric, orange communications, blue water, purple irrigation or reclaimed, green sewer or storm.\n" +
  "For each run of marks, trace where it lies on the plan. Use the photo position and facing, plus landmarks such as the house, driveway, fence and trees, to place it. Follow dashes and arrows to extend the line across what the photo shows.\n" +
  'Reply with only JSON: {"marks": [{"color": "yellow" or "red" or "orange" or "blue" or "purple" or "green", "pts": [[x_pct, y_pct], ...], "confidence": "high" or "medium" or "low"}], "note": string}. Percentages run 0 to 100 from the left and top edges of image 1. Use at least two points per mark. Keep the note under 25 words with no hyphens or dashes. If you see no locator marks, return an empty list and say so in the note.';

export type Traced = { marks: { type: UtilityType; pts: [number, number][]; confidence: string }[]; note: string };
export function normTrace(r: { marks?: { color: string; pts: [number, number][]; confidence: string }[]; note?: string }): Traced {
  return {
    marks: (r.marks ?? [])
      .filter((m) => PAINT[m.color] && Array.isArray(m.pts) && m.pts.length >= 2 && m.pts.every((p) => pct(p?.[0]) && pct(p?.[1])))
      .slice(0, 12)
      .map((m) => ({ type: PAINT[m.color], pts: m.pts.map((p) => [Number(p[0]), Number(p[1])] as [number, number]), confidence: String(m.confidence ?? "low") })),
    note: String(r.note ?? "").slice(0, 200),
  };
}
