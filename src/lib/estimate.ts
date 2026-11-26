/**
 * Line item estimating for photo-first jobs. Every number that reaches a
 * price goes through this file: quantities from a measurement, the
 * contractor's unit costs and production rates, waste, crew cost, overhead
 * and margin. Nothing here calls a model. A model can suggest quantities and
 * costs, but each suggestion stays marked as an estimate until the contractor
 * confirms it, and an unconfirmed estimate makes the price preliminary.
 */

export type ItemKind = "material" | "labor" | "equipment" | "disposal" | "delivery" | "subcontract" | "other";
/** area: per sq ft of the work area. edge: per lin ft of its edge. fixed: a total for the job. */
export type Basis = "area" | "edge" | "fixed";
/** Where a unit cost came from. Only rate_book and contractor are the contractor's own numbers. */
export type CostSource = "rate_book" | "contractor" | "ai_estimate";

export const ITEM_KINDS: { key: ItemKind; name: string }[] = [
  { key: "material", name: "Material" },
  { key: "labor", name: "Labor" },
  { key: "equipment", name: "Equipment rental" },
  { key: "disposal", name: "Demolition and disposal" },
  { key: "delivery", name: "Delivery and hauling" },
  { key: "subcontract", name: "Subcontractor" },
  { key: "other", name: "Other" },
];

export interface EstimateItem {
  id: string;
  label: string;
  kind: ItemKind;
  basis: Basis;
  /** Quantity per sq ft (area), per lin ft (edge), or the job total (fixed). Labor is person hours. */
  rate: number;
  unit: string;
  /** Your cost per unit. Labor ignores this and uses the crew cost per person hour. */
  unitCost: number;
  /** Extra for cuts, compaction and spillage. Applied to materials only. */
  wastePct: number;
  costSource: CostSource;
  /** The rate book entry this line uses, if any. */
  rateKey: string | null;
  /** The contractor has looked at this line's quantity rate and cost and kept it. */
  reviewed: boolean;
  /** Which customer work package the line is explained under. Missing = by kind. */
  pkg?: "prep" | "materials" | "install" | "haul" | null;
}

/** A reusable estimating rule from Settings: what you pay and, optionally, how much a job uses. */
export interface RateRule {
  key: string;
  label: string;
  kind: ItemKind;
  unit: string;
  unitCost: number;
  /** Quantity per basis unit (e.g. 0.15 person hr per sq ft). Null = the draft suggests it. */
  rate: number | null;
  basis: Basis;
  wastePct: number;
  pkg?: EstimateItem["pkg"];
}

export interface Measurement {
  areaSqft: number;
  edgeFt: number;
  /** photo_estimate is a guess from a picture and is never treated as measured. */
  source: "photo_estimate" | "contractor" | "plan";
  confirmed: boolean;
  note: string;
}

export interface EstimateRules {
  laborRate: number;
  crewSize: number;
  overheadPct: number;
  markupPct: number;
}

export interface ItemResult {
  id: string;
  label: string;
  kind: ItemKind;
  unit: string;
  qty: number;
  cost: number;
  hours: number;
  estimated: boolean;
}

export interface EstimateResult {
  items: ItemResult[];
  /** Everything that is not crew time: materials, rentals, disposal, delivery, subs. */
  costs: number;
  hours: number;
  labor: number;
  direct: number;
  overhead: number;
  price: number;
  profit: number;
  marginPct: number;
  days: number;
  /** Why this price is preliminary. Empty when every input is the contractor's own. */
  preliminary: string[];
}

const HOURLY = /\b(hr|hrs|hour|hours|person hr|day|days|week)\b/i;
const BULK = /\b(ton|tons|cu yd|yd3|yard|yards)\b/i;

/** Bulk and time round up to a tenth or quarter, countable things to a whole unit. */
export function roundQty(kind: ItemKind, unit: string, raw: number): number {
  if (!(raw > 0)) return 0;
  if (kind === "labor") return Math.ceil(raw * 4 - 1e-9) / 4;
  if (BULK.test(unit)) return Math.ceil(raw * 10 - 1e-9) / 10;
  if (HOURLY.test(unit)) return Math.ceil(raw * 2 - 1e-9) / 2;
  return Math.ceil(raw - 1e-9);
}

const num = (n: unknown, fallback = 0) => (Number.isFinite(Number(n)) ? Number(n) : fallback);
const nonNeg = (n: unknown) => Math.max(0, num(n));

/** The raw quantity for one line from the measurement. */
export function itemQty(it: EstimateItem, m: Pick<Measurement, "areaSqft" | "edgeFt">): number {
  const base = it.basis === "area" ? nonNeg(m.areaSqft) : it.basis === "edge" ? nonNeg(m.edgeFt) : 1;
  // Waste is extra material for cuts and spillage. A rental day, a dump load or a delivery trip has none.
  const raw = base * nonNeg(it.rate) * (it.kind === "material" ? 1 + nonNeg(it.wastePct) / 100 : 1);
  return roundQty(it.kind, it.unit, raw);
}

export function estimate(items: EstimateItem[], m: Measurement, r: EstimateRules): EstimateResult {
  const out: ItemResult[] = [];
  let costs = 0;
  let hours = 0;
  for (const it of items) {
    const qty = itemQty(it, m);
    if (it.kind === "labor") {
      hours += qty;
      out.push({ id: it.id, label: it.label, kind: it.kind, unit: it.unit || "person hr", qty, cost: qty * nonNeg(r.laborRate), hours: qty, estimated: !it.reviewed });
    } else {
      const cost = qty * nonNeg(it.unitCost);
      costs += cost;
      out.push({ id: it.id, label: it.label, kind: it.kind, unit: it.unit, qty, cost, hours: 0, estimated: !it.reviewed });
    }
  }
  const labor = hours * nonNeg(r.laborRate);
  const direct = costs + labor;
  const overhead = direct * (nonNeg(r.overheadPct) / 100);
  const price = Math.round(((direct + overhead) * (1 + nonNeg(r.markupPct) / 100)) / 10) * 10;
  const profit = price - direct - overhead;
  const crew = Math.max(1, Math.round(nonNeg(r.crewSize)) || 1);
  const days = hours > 0 ? Math.max(0.5, Math.ceil((hours / (crew * 8)) * 2) / 2) : 0;
  const preliminary: string[] = [];
  if (!m.confirmed) preliminary.push(m.source === "photo_estimate" ? "The size is estimated from a photo, not measured." : "The size has not been confirmed.");
  const unreviewed = items.filter((it) => !it.reviewed).length;
  if (unreviewed) preliminary.push(`${unreviewed} ${unreviewed === 1 ? "line uses a suggested quantity or cost" : "lines use suggested quantities or costs"} you have not confirmed.`);
  return { items: out, costs, hours, labor, direct, overhead, price, profit, marginPct: price > 0 ? (profit / price) * 100 : 0, days, preliminary };
}

/** Apply a rate book entry to a line: the contractor's cost always wins, and their quantity rate when they set one. */
export function applyRule(it: EstimateItem, rule: RateRule): EstimateItem {
  return {
    ...it,
    rateKey: rule.key,
    kind: rule.kind,
    unit: rule.unit || it.unit,
    unitCost: rule.unitCost,
    rate: rule.rate != null && rule.rate > 0 ? rule.rate : it.rate,
    basis: rule.rate != null && rule.rate > 0 ? rule.basis : it.basis,
    wastePct: rule.wastePct,
    costSource: "rate_book",
    pkg: rule.pkg ?? it.pkg ?? null,
    // A rule with its own quantity rate is fully the contractor's. Without one the suggested quantity still needs a look.
    reviewed: rule.rate != null && rule.rate > 0,
  };
}

export function sanitizeItem(it: Partial<EstimateItem> & { id: string }): EstimateItem {
  const kind = ITEM_KINDS.some((k) => k.key === it.kind) ? (it.kind as ItemKind) : "other";
  const basis: Basis = it.basis === "area" || it.basis === "edge" ? it.basis : "fixed";
  const costSource: CostSource = it.costSource === "rate_book" || it.costSource === "contractor" ? it.costSource : "ai_estimate";
  return {
    id: String(it.id).slice(0, 60),
    label: String(it.label ?? "").slice(0, 140) || "Item",
    kind,
    basis,
    rate: Math.min(1e6, nonNeg(it.rate)),
    unit: String(it.unit ?? (kind === "labor" ? "person hr" : "each")).slice(0, 24),
    unitCost: Math.min(1e6, nonNeg(it.unitCost)),
    wastePct: Math.min(100, nonNeg(it.wastePct)),
    costSource,
    rateKey: it.rateKey ? String(it.rateKey).slice(0, 60) : null,
    reviewed: !!it.reviewed,
    pkg: it.pkg === "prep" || it.pkg === "materials" || it.pkg === "install" || it.pkg === "haul" ? it.pkg : null,
  };
}

/**
 * A starting rate book for hardscape and planting work. Every value is a
 * sample the contractor replaces with their own costs in Settings.
 */
export const DEFAULT_RATES: RateRule[] = [
  { key: "pavers", label: "Concrete pavers", kind: "material", unit: "sq ft", unitCost: 5.25, rate: 1, basis: "area", wastePct: 8 },
  { key: "road_base", label: "Aggregate road base, 4 in compacted", kind: "material", unit: "ton", unitCost: 38, rate: 0.0173, basis: "area", wastePct: 10 },
  { key: "bedding_sand", label: "Bedding sand, 1 in screeded", kind: "material", unit: "ton", unitCost: 45, rate: 0.0043, basis: "area", wastePct: 10 },
  { key: "poly_sand", label: "Polymeric joint sand", kind: "material", unit: "bag", unitCost: 32, rate: 1 / 60, basis: "area", wastePct: 0 },
  { key: "edge_restraint", label: "Paver edge restraint", kind: "material", unit: "lin ft", unitCost: 2.2, rate: 1, basis: "edge", wastePct: 5 },
  { key: "geotextile", label: "Geotextile fabric", kind: "material", unit: "sq ft", unitCost: 0.2, rate: 1, basis: "area", wastePct: 10 },
  { key: "flagstone", label: "Flagstone, 1.5 in", kind: "material", unit: "ton", unitCost: 420, rate: 0.0105, basis: "area", wastePct: 12 },
  { key: "labor_reset_pavers", label: "Lift and relay pavers", kind: "labor", unit: "person hr", unitCost: 0, rate: 0.06, basis: "area", wastePct: 0 },
  { key: "labor_excavate", label: "Excavate and grade, by hand and machine", kind: "labor", unit: "person hr", unitCost: 0, rate: 0.05, basis: "area", wastePct: 0, pkg: "prep" },
  { key: "labor_base", label: "Place and compact base in lifts", kind: "labor", unit: "person hr", unitCost: 0, rate: 0.04, basis: "area", wastePct: 0, pkg: "prep" },
  { key: "labor_lay_pavers", label: "Screed, lay, cut and compact pavers", kind: "labor", unit: "person hr", unitCost: 0, rate: 0.12, basis: "area", wastePct: 0 },
  { key: "plate_compactor", label: "Plate compactor rental", kind: "equipment", unit: "day", unitCost: 95, rate: null, basis: "fixed", wastePct: 0 },
  { key: "dump_fee", label: "Spoil haul and dump fee", kind: "disposal", unit: "load", unitCost: 180, rate: null, basis: "fixed", wastePct: 0 },
  { key: "delivery", label: "Aggregate delivery", kind: "delivery", unit: "trip", unitCost: 120, rate: null, basis: "fixed", wastePct: 0 },
];
