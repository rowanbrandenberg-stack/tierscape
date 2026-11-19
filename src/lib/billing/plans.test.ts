import { describe, expect, it } from "vitest";
import { annualIsTwoMonthsFree, annualMonthly, annualSavings, distinguishing, FEATURES, foundingSavings, PLANS, sellable } from "./plans";

describe("plan math", () => {
  it("matches the published numbers", () => {
    expect([PLANS.starter, PLANS.pro, PLANS.team].map(annualMonthly)).toEqual([65.83, 124.17, 249.17]);
    expect([PLANS.starter, PLANS.pro, PLANS.team].map(annualSavings)).toEqual([158, 298, 598]);
    expect(Object.values(PLANS).every(annualIsTwoMonthsFree)).toBe(true);
    expect(foundingSavings()).toBe(600);
  });
  it("sells a plan only when what it adds works, and lists the rest as coming soon", () => {
    for (const p of Object.values(PLANS)) {
      const s = sellable(p.key, true);
      expect(s.ok).toBe(distinguishing(p.key).some((f) => FEATURES[f].ready));
      expect(s.comingSoon).toEqual(p.features.filter((f) => !FEATURES[f].ready).map((f) => FEATURES[f].label));
    }
    expect([sellable("starter", true).ok, sellable("pro", true).ok, sellable("team", true).ok]).toEqual([true, true, false]);
    expect(sellable("starter", false).ok).toBe(false);
  });
});
