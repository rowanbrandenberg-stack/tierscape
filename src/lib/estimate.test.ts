import { describe, expect, it } from "vitest";
import { applyRule, DEFAULT_RATES, estimate, itemQty, roundQty, sanitizeItem, type EstimateItem, type Measurement } from "./estimate";

const rules = { laborRate: 60, crewSize: 2, overheadPct: 10, markupPct: 50 };
const measured: Measurement = { areaSqft: 200, edgeFt: 60, source: "contractor", confirmed: true, note: "" };
const item = (p: Partial<EstimateItem>): EstimateItem => sanitizeItem({ id: Math.random().toString(36), reviewed: true, costSource: "contractor", ...p });

describe("estimate arithmetic", () => {
  it("prices materials with waste, labor at the crew rate, then overhead and markup", () => {
    const e = estimate(
      [
        item({ label: "Pavers", kind: "material", basis: "area", rate: 1, unit: "sq ft", unitCost: 5, wastePct: 10 }), // 220 sq ft = 1100
        item({ label: "Lay pavers", kind: "labor", basis: "area", rate: 0.1, unit: "person hr" }), // 20 hr = 1200
        item({ label: "Plate compactor", kind: "equipment", basis: "fixed", rate: 1, unit: "day", unitCost: 100 }), // 100
      ],
      measured,
      rules,
    );
    expect(e.items.map((i) => i.qty)).toEqual([220, 20, 1]);
    expect(e.costs).toBe(1200);
    expect(e.hours).toBe(20);
    expect(e.labor).toBe(1200);
    expect(e.direct).toBe(2400);
    expect(e.overhead).toBe(240);
    expect(e.price).toBe(3960); // 2640 * 1.5
    expect(e.profit).toBe(1320);
    expect(e.days).toBe(1.5); // 20 / 16 = 1.25 -> 1.5
    expect(e.preliminary).toEqual([]);
  });

  it("applies waste to materials only, so a rental day or dump load stays whole", () => {
    expect(itemQty(item({ kind: "equipment", basis: "fixed", rate: 1, unit: "day", wastePct: 8 }), measured)).toBe(1);
    expect(itemQty(item({ kind: "disposal", basis: "fixed", rate: 1, unit: "load", wastePct: 8 }), measured)).toBe(1);
    expect(itemQty(item({ kind: "material", basis: "fixed", rate: 10, unit: "bag", wastePct: 8 }), measured)).toBe(11);
  });

  it("never applies waste to labor and rounds bulk to a tenth", () => {
    expect(itemQty(item({ kind: "labor", basis: "area", rate: 0.05, wastePct: 50 }), measured)).toBe(10);
    expect(roundQty("material", "ton", 3.4601)).toBe(3.5);
    expect(roundQty("material", "bag", 3.01)).toBe(4);
    expect(roundQty("labor", "person hr", 1.1)).toBe(1.25);
    expect(roundQty("material", "bag", -3)).toBe(0);
  });

  it("marks a photo guess and unconfirmed suggestions as preliminary", () => {
    const e = estimate([item({ kind: "material", basis: "area", rate: 1, unitCost: 2, reviewed: false, costSource: "ai_estimate" })], { ...measured, source: "photo_estimate", confirmed: false }, rules);
    expect(e.preliminary).toHaveLength(2);
    expect(e.preliminary[0]).toMatch(/photo/);
    expect(e.items[0].estimated).toBe(true);
  });

  it("changing the measurement moves every area and edge quantity, but not fixed lines", () => {
    const items = [item({ kind: "material", basis: "area", rate: 1, unitCost: 1 }), item({ kind: "material", basis: "edge", rate: 1, unitCost: 1 }), item({ kind: "disposal", basis: "fixed", rate: 1, unitCost: 100 })];
    const a = estimate(items, measured, rules);
    const b = estimate(items, { ...measured, areaSqft: 400, edgeFt: 80 }, rules);
    expect(b.items[0].qty).toBe(a.items[0].qty * 2);
    expect(b.items[1].qty).toBe(80);
    expect(b.items[2].qty).toBe(1);
  });

  it("treats junk numbers as zero instead of producing NaN", () => {
    const e = estimate([item({ kind: "material", basis: "area", rate: Number.NaN, unitCost: Infinity as number })], { ...measured, areaSqft: Number.NaN }, { ...rules, laborRate: Number.NaN });
    expect(Number.isFinite(e.price)).toBe(true);
    expect(e.price).toBe(0);
    expect(e.days).toBe(0);
  });

  it("a rate book rule replaces the suggested cost, and its quantity rate when it has one", () => {
    const base = item({ label: "Base", kind: "material", basis: "area", rate: 0.05, unitCost: 99, costSource: "ai_estimate", reviewed: false });
    const withRate = applyRule(base, DEFAULT_RATES.find((r) => r.key === "road_base")!);
    expect(withRate.unitCost).toBe(38);
    expect(withRate.rate).toBeCloseTo(0.0173);
    expect(withRate.costSource).toBe("rate_book");
    expect(withRate.reviewed).toBe(true);
    const fixed = applyRule(item({ kind: "equipment", basis: "fixed", rate: 2, unitCost: 1, reviewed: false }), DEFAULT_RATES.find((r) => r.key === "plate_compactor")!);
    expect(fixed.rate).toBe(2); // the draft's number of days stays, and still needs a look
    expect(fixed.reviewed).toBe(false);
  });
});
