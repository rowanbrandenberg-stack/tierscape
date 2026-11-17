import { AREA_TYPES, COLORS, LAYOUTS, SIZES, type Service, type Unit } from "./catalog";
import { areaPerimeter, areaSqft, borderedLength } from "./geometry";
import type { Pricing } from "./settings";
import type { Area, AreaType, Job, TierKey } from "./types";

export interface Line {
  name: string;
  unit: Unit;
  qty: number;
  cost: number;
}

export interface Group {
  kind: AreaType | "plants";
  title: string;
  sqft: number;
  plantCount: number;
  lines: Line[];
  hours: number;
  steps: string[];
}

export interface Quote {
  tier: TierKey;
  groups: Group[];
  materials: number;
  hours: number;
  labor: number;
  price: number;
  days: number;
}

export function serviceFor(pricing: Pricing, type: AreaType, tier: TierKey): Service {
  const id = pricing.tierMap[type][tier];
  const s = pricing.services.find((x) => x.id === id) ?? pricing.services.find((x) => x.areaType === type);
  if (!s) throw new Error(`No service for ${type}`);
  return s;
}

/** Bulk materials round up to a tenth, everything else to a whole unit. */
export const roundQty = (unit: Unit, raw: number) =>
  unit === "ton" || unit === "cu yd" ? Math.ceil(raw * 10 - 1e-9) / 10 : Math.ceil(raw - 1e-9);

export function paverText(a: Area): string {
  const size = a.paver.layout === "ashlar" ? "mixed size" : a.paver.size;
  return `${size} ${COLORS[a.paver.color].name} pavers in ${LAYOUTS[a.paver.layout].name.toLowerCase()}`;
}

/**
 * Price one tier of a job.
 * Services with the landscaper's own installed price sell at that price per
 * square foot (scaled for slower paver layouts). Everything else is
 * materials plus labor, marked up.
 */
export function quote(job: Pick<Job, "areas" | "plants">, pricing: Pricing, tier: TierKey): Quote {
  const groups: Group[] = [];
  let materials = 0;
  let hours = 0;
  let fixedPrice = 0;
  let markedMaterials = 0;
  let markedHours = 0;

  for (const type of Object.keys(AREA_TYPES) as AreaType[]) {
    const areas = job.areas.filter((a) => a.type === type);
    if (!areas.length) continue;
    const svc = serviceFor(pricing, type, tier);
    const isPaver = svc.fill === "paver";
    const bulk = new Map<string, { unit: Unit; raw: number; cost: number }>();
    const add = (name: string, unit: Unit, raw: number, cost: number) => {
      const e = bulk.get(name) ?? { unit, raw: 0, cost };
      e.raw += raw;
      bulk.set(name, e);
    };
    const borderLines = new Map<string, { raw: number; cost: number }>();
    const paverNotes: string[] = [];
    const borderNames: string[] = [];
    let sqft = 0;
    let h = 0;
    let borderHours = 0;

    for (const a of areas) {
      const A = areaSqft(a);
      const P = areaPerimeter(a);
      const layout = LAYOUTS[a.paver.layout];
      const size = SIZES[a.paver.size];
      const laborMult = isPaver ? layout.labor * (a.paver.layout === "ashlar" ? 1 : size.labor) : 1;
      sqft += A;
      for (const it of svc.items) {
        if (it.per === "job") continue;
        let raw = it.per === "sqft" ? A * it.qty : P * it.qty;
        let cost = it.cost;
        let name = it.name;
        if (it.bulk) raw *= 1 + (it.paver && isPaver ? layout.waste : pricing.wastePct) / 100;
        if (it.paver && isPaver) {
          cost *= a.paver.layout === "ashlar" ? 1.1 : size.material;
          name = `${it.name}, ${paverText(a).replace(" pavers", "")}`;
        }
        add(name, it.unit, raw, cost);
      }
      h += A * svc.laborPerSqft * laborMult;
      if (svc.installedPrice > 0) fixedPrice += A * svc.installedPrice * (1 + (laborMult - 1) * 0.6);
      if (isPaver && !paverNotes.includes(paverText(a))) paverNotes.push(paverText(a));
      if (type === "lawn" && a.border !== "none") {
        const B = pricing.borders[a.border];
        const len = borderedLength(a);
        if (len > 0) {
          const e = borderLines.get(B.name) ?? { raw: 0, cost: B.costPerFt };
          e.raw += len;
          borderLines.set(B.name, e);
          borderHours += len * B.laborPerFt;
          if (!borderNames.includes(B.name)) borderNames.push(B.name);
        }
      }
    }
    for (const it of svc.items) if (it.per === "job") add(it.name, it.unit, it.qty, it.cost);

    const lines: Line[] = [...bulk.entries()].map(([name, e]) => {
      const qty = roundQty(e.unit, e.raw);
      return { name, unit: e.unit, qty, cost: qty * e.cost };
    });
    const bLines: Line[] = [...borderLines.entries()].map(([name, e]) => {
      const qty = Math.ceil(e.raw);
      return { name, unit: "lin ft", qty, cost: qty * e.cost };
    });
    const gMat = lines.reduce((s, l) => s + l.cost, 0);
    const bMat = bLines.reduce((s, l) => s + l.cost, 0);
    materials += gMat + bMat;
    hours += h + borderHours;
    markedMaterials += bMat;
    markedHours += borderHours;
    if (!(svc.installedPrice > 0)) {
      markedMaterials += gMat;
      markedHours += h;
    }
    const title =
      svc.title +
      (paverNotes.length ? `, ${paverNotes.join(" and ")}` : "") +
      (borderNames.length ? `, edged with ${borderNames.join(" and ").toLowerCase()}` : "");
    groups.push({
      kind: type,
      title,
      sqft,
      plantCount: 0,
      lines: [...lines, ...bLines],
      hours: h + borderHours,
      steps: [...svc.steps, ...borderNames.map((n) => `Install the ${n.toLowerCase()} along the marked lawn edges`)],
    });
  }

  const placed = job.plants.filter((p) => p.spots.length);
  const count = placed.reduce((s, p) => s + p.spots.length, 0);
  if (count > 0) {
    const lines: Line[] = [];
    const kinds: string[] = [];
    let h = 0;
    for (const p of placed) {
      const row = pricing.plantSizes[p.kind][tier];
      const q = p.spots.length;
      lines.push({ name: `${p.name || "Unnamed plant"}, ${row.size}`, unit: "each", qty: q, cost: q * row.cost });
      h += q * row.hours;
      const k = `${row.size} ${p.kind}s`;
      if (!kinds.includes(k)) kinds.push(k);
    }
    const bags = Math.ceil(count / 3);
    lines.push({ name: "Planting soil amendment", unit: "bag", qty: bags, cost: bags * 11 });
    if (tier !== "basic") lines.push({ name: "Drip emitter and tubing", unit: "each", qty: count, cost: count * 6 });
    const steps = ["Stake every plant location for the homeowner to approve", "Dig holes twice the width of the root ball", "Set plants at grade and backfill with amended soil", "Water in deeply and mulch each plant"];
    if (tier !== "basic") steps.push("Run a drip emitter to each plant");
    if (tier === "premium") steps.push("Stake the trees and wrap trunks for winter");
    const m = lines.reduce((s, l) => s + l.cost, 0);
    materials += m;
    hours += h;
    markedMaterials += m;
    markedHours += h;
    groups.push({ kind: "plants", title: `Plant installation: ${count} plants (${kinds.join(", ")})`, sqft: 0, plantCount: count, lines, hours: h, steps });
  }

  const labor = hours * pricing.laborRate;
  const price = Math.round((fixedPrice + (markedMaterials + markedHours * pricing.laborRate) * (1 + pricing.markupPct / 100)) / 10) * 10;
  const days = Math.max(0.5, Math.ceil((hours / (pricing.crewSize * 8)) * 2) / 2);
  return { tier, groups, materials, hours, labor, price, days };
}

/** Installed price per sq ft of one service, worked out on a reference 400 sq ft square. */
export function unitPrice(pricing: Pricing, svc: Service): number {
  if (svc.installedPrice > 0) return svc.installedPrice;
  let m = 0;
  for (const it of svc.items) {
    const raw = it.per === "sqft" ? 400 * it.qty * (it.bulk ? 1 + pricing.wastePct / 100 : 1) : it.per === "lf" ? 80 * it.qty : it.qty;
    m += raw * it.cost;
  }
  return ((m + 400 * svc.laborPerSqft * pricing.laborRate) * (1 + pricing.markupPct / 100)) / 400;
}

export const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
