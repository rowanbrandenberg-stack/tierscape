import { describe, expect, it } from "vitest";
import { allocate, allocateMoney, applyAlternative, breakdown, explainTotal, packageOf, priceAlternative } from "./breakdown";
import { estimate, sanitizeItem, type EstimateItem, type Measurement } from "./estimate";
import { sampleJob } from "./jobs";
import { jobOptions } from "./proposal";
import { quote } from "./pricing";
import { defaultSettings } from "./settings";

const rules = { laborRate: 60, crewSize: 2, overheadPct: 12, markupPct: 45 };
const m: Measurement = { areaSqft: 300, edgeFt: 70, source: "contractor", confirmed: true, note: "" };
const li = (p: Partial<EstimateItem> & { id: string }): EstimateItem => sanitizeItem({ reviewed: true, costSource: "contractor", ...p });

/** A rock area job: prep, rock supplied, spreading, haul away. No delivery line. */
const rockJob = [
  li({ id: "a", label: "Remove weeds and grade", kind: "labor", basis: "area", rate: 0.03, pkg: "prep" }),
  li({ id: "b", label: "Landscape rock, 3 in", kind: "material", basis: "area", rate: 0.0125, unit: "ton", unitCost: 65, wastePct: 10 }),
  li({ id: "c", label: "Weed barrier", kind: "material", basis: "area", rate: 1, unit: "sq ft", unitCost: 0.2, wastePct: 10, pkg: "prep" }),
  li({ id: "d", label: "Move and spread rock", kind: "labor", basis: "area", rate: 0.05 }),
  li({ id: "e", label: "Green waste dump fee", kind: "disposal", basis: "fixed", rate: 1, unit: "load", unitCost: 80 }),
];

describe("splitting a total", () => {
  it("always adds up to the total in whole cents", () => {
    for (const [t, w] of [[100, [1, 1, 1]], [99999, [3, 7, 11, 0.5]], [1, [5, 5]], [350000, [0.1, 0.2, 0.3]]] as const) {
      const out = allocate(t, [...w]);
      expect(out.reduce((a, b) => a + b, 0)).toBe(t);
      expect(out.every((x) => Number.isInteger(x) && x >= 0)).toBe(true);
    }
    expect(allocate(500, [0, 0])).toEqual([0, 0]);
    expect(allocate(500, [1, 0])).toEqual([500, 0]);
    // Whole dollar totals split into whole dollars.
    expect(allocateMoney(77000, [130, 640]).every((c) => c % 100 === 0)).toBe(true);
    expect(allocateMoney(77000, [130, 640]).reduce((a, b) => a + b, 0)).toBe(77000);
    expect(allocateMoney(77050, [1, 2]).reduce((a, b) => a + b, 0)).toBe(77050);
  });
});

describe("customer work packages", () => {
  it("adds up to the quoted price and only lists packages that are really in the job", () => {
    const e = estimate(rockJob, m, rules);
    const b = breakdown(rockJob, m, rules, Math.round(e.price * 100));
    expect(b.reduce((s, l) => s + l.cents, 0)).toBe(Math.round(e.price * 100));
    expect(b.map((l) => l.key)).toEqual(["prep", "materials", "install", "haul"]);
    // No delivery line, so the label never claims delivery.
    expect(b.find((l) => l.key === "materials")!.label).toBe("Materials supplied");
    expect(explainTotal(b)).toBe("This is the installed price for the whole job. It includes site preparation, materials supplied, installation and haul away and cleanup.");
    const withDelivery = [...rockJob, li({ id: "f", label: "Rock delivery", kind: "delivery", basis: "fixed", rate: 1, unit: "trip", unitCost: 90 })];
    expect(breakdown(withDelivery, m, rules, 100000).find((l) => l.key === "materials")!.label).toBe("Materials supplied and delivered");
  });

  it("carries names of the work only, never costs, wages or quantities", () => {
    const b = breakdown(rockJob, m, rules, 500000);
    expect(Object.keys(b[0]).sort()).toEqual(["cents", "key", "label", "parts"]);
    expect(JSON.stringify(b)).not.toMatch(/65|0\.0125|60/);
  });

  it("an empty package is left out instead of padded", () => {
    const b = breakdown(rockJob.filter((x) => x.kind !== "disposal"), m, rules, 300000);
    expect(b.map((l) => l.key)).not.toContain("haul");
  });

  it("lines default to a sensible package by kind", () => {
    expect(packageOf({ kind: "disposal" })).toBe("haul");
    expect(packageOf({ kind: "delivery" })).toBe("materials");
    expect(packageOf({ kind: "labor" })).toBe("install");
    expect(packageOf({ kind: "labor", pkg: "prep" })).toBe("prep");
  });

  it("plan jobs split the quote by area and still add up exactly", () => {
    const s = defaultSettings();
    for (const tier of ["basic", "standard", "premium"] as const) {
      const job = { ...sampleJob(), sample: false };
      const o = jobOptions(job, s.pricing).find((x) => x.tier === tier)!;
      expect(o.breakdown.reduce((a, l) => a + l.cents, 0)).toBe(Math.round(o.price * 100));
      const q = quote(job, s.pricing, tier);
      // The per group shares are the same arithmetic as the total before rounding.
      expect(Math.round(q.groups.reduce((a, g) => a + g.sell, 0) / 10) * 10).toBe(q.price);
    }
  });
});

describe("ways to save are recalculated scope changes", () => {
  it("a smaller area is repriced with the same arithmetic", () => {
    const a = priceAlternative(rockJob, m, rules, { id: "x", label: "Do the front half only", kind: "smaller_area", areaSqft: 150, edgeFt: 40, reviewed: true })!;
    const base = estimate(rockJob, m, rules).price;
    const half = estimate(rockJob, { ...m, areaSqft: 150, edgeFt: 40 }, rules).price;
    expect(a.priceCents).toBe(half * 100);
    expect(a.savesCents).toBe((base - half) * 100);
  });

  it("a different rock changes only that line's cost", () => {
    const alt = applyAlternative(rockJob, m, { id: "x", label: "Use local river rock", kind: "swap", swaps: [{ itemId: "b", label: "River rock", unitCost: 40 }], reviewed: true });
    expect(alt.items.find((x) => x.id === "b")).toMatchObject({ label: "River rock", unitCost: 40 });
    expect(alt.items.find((x) => x.id === "d")).toEqual(rockJob[3]);
    expect(priceAlternative(rockJob, m, rules, { id: "x", label: "Use local river rock", kind: "swap", swaps: [{ itemId: "b", label: "River rock", unitCost: 40 }], reviewed: true })!.savesCents).toBeGreaterThan(0);
  });

  it("phasing moves named lines to later", () => {
    const a = priceAlternative(rockJob, m, rules, { id: "x", label: "Haul away later", kind: "phase", later: ["e"], reviewed: true })!;
    expect(a.later).toEqual(["Green waste dump fee"]);
    expect(a.savesCents).toBeGreaterThan(0);
  });

  it("a change that saves nothing, or costs more, is not offered as a saving", () => {
    expect(priceAlternative(rockJob, m, rules, { id: "x", label: "Pricier rock", kind: "swap", swaps: [{ itemId: "b", label: "Marble", unitCost: 400 }], reviewed: true })).toBeNull();
    expect(priceAlternative(rockJob, m, rules, { id: "x", label: "Same", kind: "smaller_area", areaSqft: 300, edgeFt: 70, reviewed: true })).toBeNull();
  });
});
