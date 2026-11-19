import { describe, expect, it } from "vitest";
import { sampleJob } from "./jobs";
import { marginFromMarkup, markupFromMargin, quote, unitPrice } from "./pricing";
import { defaultSettings } from "./settings";

describe("pricing", () => {
  const job = sampleJob();
  const { pricing } = defaultSettings();
  it("prices the sample job higher at each tier", () => {
    const [b, s, p] = (["basic", "standard", "premium"] as const).map((t) => quote(job, pricing, t).price);
    expect(b).toBeLessThan(s);
    expect(s).toBeLessThan(p);
  });
  it("charges more for herringbone than running bond", () => {
    const run = quote(job, pricing, "standard").price;
    const j2 = sampleJob();
    j2.areas[0].paver.layout = "herring";
    j2.areas[0].paver.size = "4x8";
    expect(quote(j2, pricing, "standard").price).toBeGreaterThan(run);
  });
  it("uses the landscaper's installed price when set", () => {
    const p2 = defaultSettings().pricing;
    const svc = p2.services.find((s) => s.id === "patio-paver")!;
    svc.installedPrice = 30;
    expect(unitPrice(p2, svc)).toBe(30);
    expect(quote(job, p2, "standard").price).not.toBe(quote(job, pricing, "standard").price);
  });
  it("adds the lawn border by the foot", () => {
    const q = quote(job, pricing, "standard");
    expect(q.groups.find((g) => g.kind === "lawn")!.lines.some((l) => l.name.startsWith("River rock"))).toBe(true);
  });
});

describe("plants are not counted twice", () => {
  it("drops the generic planting allowance from a bed that has placed plants", () => {
    const job = sampleJob();
    const pricing = defaultSettings().pricing;
    for (const tier of ["standard", "premium"] as const) {
      const beds = quote(job, pricing, tier).groups.find((g) => g.kind === "bed")!;
      expect(beds.lines.some((l) => l.name.startsWith("Planting allowance"))).toBe(false);
      expect(beds.title).toContain("planted as shown");
    }
  });
  it("keeps the allowance, labeled, for a bed with nothing placed", () => {
    const job = sampleJob();
    job.plants = [];
    const beds = quote(job, defaultSettings().pricing, "standard").groups.find((g) => g.kind === "bed")!;
    expect(beds.lines.some((l) => l.name.startsWith("Planting allowance: Native shrubs"))).toBe(true);
  });
});

describe("margin and markup", () => {
  it("converts both ways", () => {
    expect(Math.round(marginFromMarkup(35) * 10) / 10).toBe(25.9);
    expect(markupFromMargin(25.9259)).toBeCloseTo(35, 1);
    expect(markupFromMargin(30)).toBeCloseTo(42.86, 2);
  });
});

describe("other job costs", () => {
  const cost = (o: Partial<import("./types").ExtraCost>) => ({ id: "x", description: "Dump fee", kind: "disposal" as const, qty: 2, unit: "load", cost: 85, tiers: ["basic", "standard", "premium"] as import("./types").TierKey[], showCustomer: true, ...o });

  it("adds each cost to the tiers that include it, marked up like everything else", () => {
    const pricing = defaultSettings().pricing;
    const job = sampleJob();
    const before = quote(job, pricing, "standard");
    job.extras = [cost({}), cost({ id: "y", description: "Skid steer rental", kind: "equipment", qty: 1, unit: "day", cost: 300, tiers: ["premium"], showCustomer: false })];
    const std = quote(job, pricing, "standard");
    expect(std.materials - before.materials).toBeCloseTo(170, 5);
    expect(std.price - before.price).toBeGreaterThanOrEqual(170 * 1.35 - 10);
    const g = std.groups.find((x) => x.kind === "extras")!;
    expect(g.title).toBe("Also included: Dump fee");
    const prem = quote(job, pricing, "premium");
    expect(prem.groups.find((x) => x.kind === "extras")!.lines.map((l) => l.name)).toEqual(["Dump fee", "Skid steer rental"]);
    expect(prem.groups.find((x) => x.kind === "extras")!.customerItems).toEqual(["Dump fee"]);
  });

  it("treats extra labor as person hours at crew cost, never as something to order", () => {
    const pricing = defaultSettings().pricing;
    const job = sampleJob();
    const before = quote(job, pricing, "basic");
    job.extras = [cost({ kind: "labor", description: "Hand dig near gas line", qty: 6, unit: "person hr", cost: 0 })];
    const q = quote(job, pricing, "basic");
    expect(q.hours - before.hours).toBe(6);
    expect(q.labor - before.labor).toBe(6 * pricing.laborRate);
    expect(q.groups.find((x) => x.kind === "extras")!.lines[0].labor).toBe(true);
  });

  it("ignores costs with no price, and applies overhead before margin", () => {
    const pricing = defaultSettings().pricing;
    const job = sampleJob();
    job.extras = [cost({ cost: 0 })];
    expect(quote(job, pricing, "standard").price).toBe(quote(sampleJob(), pricing, "standard").price);
    const withOverhead = quote(sampleJob(), { ...pricing, overheadPct: 10 }, "standard");
    expect(withOverhead.overhead).toBeGreaterThan(0);
    expect(withOverhead.price).toBeGreaterThan(quote(sampleJob(), pricing, "standard").price);
  });
});
