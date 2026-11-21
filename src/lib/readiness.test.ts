import { describe, expect, it } from "vitest";
import { proposalReadiness, readinessOpen, readyToShare, reviewValue } from "./readiness";
import { defaultSettings } from "./settings";

const own = () => {
  const { profile, pricing } = defaultSettings();
  return {
    profile: { ...profile, company: "Pine Country Landscape", license: "ROC 123456", email: "office@pinecountry.co", phone: "928 555 1234" },
    pricing,
  };
};
const state = (items: ReturnType<typeof proposalReadiness>, key: string) => items.find((i) => i.key === key)!.state;

describe("proposal readiness", () => {
  it("blocks the sample company, license and contact details", () => {
    const { profile, pricing } = defaultSettings();
    const r = proposalReadiness(profile, pricing);
    expect(state(r, "company")).toBe("fix");
    expect(state(r, "license")).toBe("fix");
    expect(state(r, "contact")).toBe("fix");
    expect(readyToShare(r)).toBe(false);
  });

  it("asks to review default crew cost, overhead, warranty and license claim even with real identity", () => {
    const { profile, pricing } = own();
    const r = proposalReadiness(profile, pricing);
    expect(readinessOpen(r).map((i) => i.key).sort()).toEqual(["claim", "crewCost", "overhead", "warranty"]);
    expect(readinessOpen(r).every((i) => i.state === "review")).toBe(true);
  });

  it("clears a default once it is kept on purpose, and asks again if it changes to another default", () => {
    const { profile, pricing } = own();
    const keys = ["claim", "crewCost", "overhead", "warranty"] as const;
    const reviewed = Object.fromEntries(keys.map((k) => [k, reviewValue(k, profile, pricing)]));
    expect(readyToShare(proposalReadiness({ ...profile, reviewed }, pricing))).toBe(true);
    // A stale confirmation for a different value does not count.
    expect(state(proposalReadiness({ ...profile, reviewed: { ...reviewed, crewCost: "50" } }, pricing), "crewCost")).toBe("review");
  });

  it("treats changed values as the contractor's own", () => {
    const { profile, pricing } = own();
    const r = proposalReadiness({ ...profile, licenseLine: "Licensed and insured", warranty: "One year on everything." }, { ...pricing, laborRate: 48, overheadPct: 12 });
    expect(readyToShare(r)).toBe(true);
  });

  it("requires warranty text", () => {
    const { profile, pricing } = own();
    expect(state(proposalReadiness({ ...profile, warranty: "  " }, pricing), "warranty")).toBe("fix");
  });
});
