import { describe, expect, it } from "vitest";
import { sampleJob } from "./jobs";
import { defaultSettings, profileProblems } from "./settings";
import { buildSharedProposal, packProposal, scopeDiff, unpackProposal } from "./share";

describe("homeowner proposal link", () => {
  it("round trips through the link and carries no costs", async () => {
    const { profile, pricing } = defaultSettings();
    const p = buildSharedProposal(sampleJob(), profile, pricing, new Date("2026-11-17"));
    const token = await packProposal(p);
    expect(token.startsWith("v1.")).toBe(true);
    expect(token.length).toBeLessThan(6000);
    const back = await unpackProposal(token);
    expect(back).toEqual(p);
    const text = JSON.stringify(back);
    for (const word of ["materials", "labor", "hours", "markup", "margin", "cost"]) expect(text.toLowerCase()).not.toContain(word);
  });
  it("lists what changes between tiers", () => {
    const { profile, pricing } = defaultSettings();
    const p = buildSharedProposal(sampleJob(), profile, pricing);
    expect(scopeDiff(p.tiers[0], p.tiers[1]).length).toBeGreaterThan(0);
  });
  it("blocks sharing while the profile still has sample values", () => {
    const { profile } = defaultSettings();
    expect(profileProblems(profile).length).toBeGreaterThanOrEqual(4);
    expect(profileProblems({ ...profile, company: "Pine Country Landscape", license: "ROC 123456", email: "a@b.co", phone: "928 555 1234" })).toEqual([]);
  });
});
