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
