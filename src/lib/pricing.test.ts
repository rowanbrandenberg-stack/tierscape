import { describe, expect, it } from "vitest";
import { sampleJob } from "./jobs";
import { quote, unitPrice } from "./pricing";
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
