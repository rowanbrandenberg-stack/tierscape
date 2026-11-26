import { estimate, type EstimateItem, type EstimateRules, type Measurement } from "./estimate";

/**
 * How a quoted total is explained to the homeowner: understandable work
 * packages at customer prices (overhead and profit included), built only
 * from the lines actually in the job, and always adding up to the total.
 * Supplier costs, wages and margin never appear.
 */

export type PackageKey = "prep" | "materials" | "install" | "haul";
export const PACKAGE_ORDER: PackageKey[] = ["prep", "materials", "install", "haul"];

/** Where a line belongs when the draft or the contractor did not say. */
export function packageOf(it: Pick<EstimateItem, "kind" | "pkg">): PackageKey {
  if (it.pkg && PACKAGE_ORDER.includes(it.pkg)) return it.pkg;
  switch (it.kind) {
    case "material":
    case "delivery":
      return "materials";
    case "disposal":
      return "haul";
    default:
      return "install";
  }
}

/**
 * Split a total in cents by weights with the largest remainder method, so
 * the parts are whole cents and add up to the total exactly.
 */
export function allocate(totalCents: number, weights: number[]): number[] {
  const t = Math.max(0, Math.round(totalCents));
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const sum = w.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return w.map(() => 0);
  const raw = w.map((x) => (t * x) / sum);
  const out = raw.map(Math.floor);
  let left = t - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    if (w[i] > 0) {
      out[i]++;
      left--;
    }
  }
  return out;
}

/** Whole dollar totals split into whole dollars, which read better than cents and still add up exactly. */
export function allocateMoney(totalCents: number, weights: number[]): number[] {
  const t = Math.max(0, Math.round(totalCents));
  return t % 100 === 0 ? allocate(t / 100, weights).map((d) => d * 100) : allocate(t, weights);
}

export interface PackageLine {
  key: PackageKey;
  label: string;
  cents: number;
  /** Plain names of what is in it, from the job's own lines. No quantities or costs. */
  parts: string[];
}

export function breakdown(items: EstimateItem[], m: Measurement, r: EstimateRules, priceCents: number): PackageLine[] {
  const e = estimate(items, m, r);
  const groups = new Map<PackageKey, { weight: number; parts: string[]; delivery: boolean }>();
  items.forEach((it, i) => {
    const key = packageOf(it);
    const g = groups.get(key) ?? { weight: 0, parts: [], delivery: false };
    g.weight += e.items[i]?.cost ?? 0;
    if ((e.items[i]?.cost ?? 0) > 0 && it.label && !g.parts.includes(it.label)) g.parts.push(it.label);
    if (it.kind === "delivery" && (e.items[i]?.cost ?? 0) > 0) g.delivery = true;
    groups.set(key, g);
  });
  const keys = PACKAGE_ORDER.filter((k) => (groups.get(k)?.weight ?? 0) > 0);
  const cents = allocateMoney(priceCents, keys.map((k) => groups.get(k)!.weight));
  return keys.map((k, i) => {
    const g = groups.get(k)!;
    const label = k === "prep" ? "Site preparation" : k === "materials" ? (g.delivery ? "Materials supplied and delivered" : "Materials supplied") : k === "install" ? "Installation" : "Haul away and cleanup";
    return { key: k, label, cents: cents[i], parts: g.parts.slice(0, 8) };
  });
}

/** One sentence built from the packages that are really there. Nothing is added to justify a price. */
export function explainTotal(lines: Pick<PackageLine, "label">[]): string {
  if (!lines.length) return "";
  const names = lines.map((l) => l.label.toLowerCase());
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `This is the installed price for the whole job. It includes ${list}.`;
}

/* ---------- ways to save, as real scope changes ---------- */

export interface Alternative {
  id: string;
  /** The contractor's own words for the change, shown to the homeowner. */
  label: string;
  kind: "smaller_area" | "swap" | "phase";
  /** smaller_area: the new size. */
  areaSqft?: number;
  edgeFt?: number;
  /** swap: lines replaced with a different material at its own cost. */
  swaps?: { itemId: string; label: string; unitCost: number }[];
  /** phase: lines moved to a later phase, priced separately later. */
  later?: string[];
  /** Only reviewed alternatives are shown to the homeowner. */
  reviewed: boolean;
}

export function applyAlternative(items: EstimateItem[], m: Measurement, a: Alternative): { items: EstimateItem[]; measurement: Measurement } {
  let next = items;
  let meas = m;
  if (a.kind === "smaller_area") meas = { ...m, areaSqft: Math.max(0, Number(a.areaSqft ?? m.areaSqft) || 0), edgeFt: Math.max(0, Number(a.edgeFt ?? m.edgeFt) || 0) };
  if (a.kind === "swap") {
    const sw = new Map((a.swaps ?? []).map((s) => [s.itemId, s]));
    next = items.map((it) => (sw.has(it.id) && it.kind !== "labor" ? { ...it, label: sw.get(it.id)!.label || it.label, unitCost: Math.max(0, Number(sw.get(it.id)!.unitCost) || 0), costSource: "contractor" as const, reviewed: true, rateKey: null } : it));
  }
  if (a.kind === "phase") {
    const drop = new Set(a.later ?? []);
    next = items.filter((it) => !drop.has(it.id));
  }
  return { items: next, measurement: meas };
}

export interface PricedAlternative {
  id: string;
  label: string;
  kind: Alternative["kind"];
  priceCents: number;
  savesCents: number;
  /** phase: what moves to later, by name. */
  later: string[];
}

/** Recalculate an alternative with the same arithmetic as the option. Only real savings are kept. */
export function priceAlternative(items: EstimateItem[], m: Measurement, r: EstimateRules, a: Alternative): PricedAlternative | null {
  const base = estimate(items, m, r).price;
  const alt = applyAlternative(items, m, a);
  const price = estimate(alt.items, alt.measurement, r).price;
  const saves = Math.round((base - price) * 100);
  if (!(saves > 0) || !(price > 0)) return null;
  const later = a.kind === "phase" ? items.filter((it) => (a.later ?? []).includes(it.id)).map((it) => it.label) : [];
  return { id: a.id, label: a.label.trim().slice(0, 160), kind: a.kind, priceCents: Math.round(price * 100), savesCents: saves, later };
}
