import { describe, expect, it } from "vitest";
import { annualIsTwoMonthsFree, annualMonthly, annualSavings, FEATURES, foundingSavings, PLANS, sellable } from "./plans";

describe("plan math", () => {
  it("matches the published numbers", () => {
    expect([PLANS.starter, PLANS.pro, PLANS.team].map(annualMonthly)).toEqual([65.83, 124.17, 249.17]);
    expect([PLANS.starter, PLANS.pro, PLANS.team].map(annualSavings)).toEqual([158, 298, 598]);
    expect(Object.values(PLANS).every(annualIsTwoMonthsFree)).toBe(true);
    expect(foundingSavings()).toBe(600);
  });
  it("never sells a plan with features that do not work yet", () => {
    for (const p of Object.values(PLANS)) {
      const s = sellable(p.key, true);
      expect(s.ok).toBe(p.features.every((f) => FEATURES[f].ready));
    }
    expect(sellable("starter", false).ok).toBe(false);
  });
});
