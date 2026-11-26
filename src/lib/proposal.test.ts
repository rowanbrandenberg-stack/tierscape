import { describe, expect, it } from "vitest";
import { adoptDraft, emptyConcept, type DraftOutput } from "./concept";
import { DEFAULT_RATES } from "./estimate";
import { sampleJob } from "./jobs";
import { buildPublicProposal, canonical, findPrivateKeys, jobOptions, publishReadiness, splitAmounts } from "./proposal";
import { defaultSettings } from "./settings";
import type { Job } from "./types";

const settings = () => {
  const s = defaultSettings();
  s.profile = { ...s.profile, company: "Pine Ridge Landscapes", license: "ROC 123456", email: "office@pineridge.test", phone: "(928) 555 0199" };
  return s;
};

/** TEST FIXTURE ONLY: a stand in for a model reply. */
const item = (label: string, rate_key: string | null, kind: "material" | "labor" = "material") => ({ label, kind, basis: "area" as const, rate: kind === "labor" ? 0.1 : 1, unit: kind === "labor" ? "person hr" : "sq ft", rate_key, unit_cost_estimate: 4, waste_pct: 5, work_package: "materials" as const });
const draft: DraftOutput = {
  observations: [],
  assumptions: ["Existing sand is uneven"],
  questions: [],
  size_estimate: { low_sqft: 90, high_sqft: 110, edge_ft: 40, basis: "pavers" },
  options: (["basic", "standard", "premium"] as const).map((tier) => ({
    tier,
    name: tier,
    summary: "s",
    prep_note: "p",
    includes: ["a"],
    excludes: tier === "basic" ? ["No aggregate base"] : [],
    limitations: tier === "basic" ? ["May settle"] : [],
    benefits: [],
    crew_steps: ["Step"],
    items: tier === "basic" ? [item("Relay", "labor_reset_pavers", "labor")] : [item("Pavers", "pavers"), item("Base", "road_base"), item("Lay", "labor_lay_pavers", "labor"), item("Custom", null)],
    visual_change: "c",
    visual_keep: "k",
  })),
};

function photoJob(): Job {
  const j = { ...sampleJob(), sample: false, kind: "photo" as const, areas: [], plants: [], photos: [] };
  j.concept = { ...adoptDraft(draft, emptyConcept("Can you fix this patio?"), DEFAULT_RATES, "m"), photoId: "ph_1" };
  return j;
}

describe("one option list for both kinds of job", () => {
  it("address jobs keep pricing through the plan quote", () => {
    const s = settings();
    const opts = jobOptions({ ...sampleJob(), sample: false }, s.pricing);
    expect(opts.map((o) => o.tier)).toEqual(["basic", "standard", "premium"]);
    expect(opts[1].price).toBeGreaterThan(opts[0].price);
    expect(opts[0].internal.quote).not.toBeNull();
  });

  it("photo jobs price each option from its lines", () => {
    const opts = jobOptions(photoJob(), settings().pricing);
    expect(opts).toHaveLength(3);
    expect(opts[0].price).toBeGreaterThan(0);
    expect(opts[2].preliminary.length).toBeGreaterThan(0);
    expect(opts[0].scope[0].size).toMatch(/estimated/);
  });
});

describe("deposit and balance", () => {
  it("always add up to the total", () => {
    for (const [t, p] of [[350000, 50], [85001, 33], [1, 50], [0, 50], [99999, 100], [12345, 0]] as const) {
      const { depositCents, balanceCents } = splitAmounts(t, p);
      expect(depositCents + balanceCents).toBe(t);
      expect(depositCents).toBeGreaterThanOrEqual(0);
    }
    expect(splitAmounts(350000, 50)).toEqual({ depositCents: 175000, balanceCents: 175000 });
  });
});

describe("homeowner payload", () => {
  it("carries no costs, hours, margins, notes or line items, for either kind of job", () => {
    const s = settings();
    for (const j of [photoJob(), { ...sampleJob(), sample: false }]) {
      const p = buildPublicProposal(j, s.profile, s.pricing);
      expect(findPrivateKeys(p)).toEqual([]);
      const flat = JSON.stringify(p);
      expect(flat).not.toContain("office@yourlandscape.example");
      expect(flat).not.toContain(String(s.pricing.laborRate) + " per");
    }
  });

  it("states preliminary pricing, concept images and below grade unknowns for photo jobs", () => {
    const s = settings();
    const j = photoJob();
    j.concept!.options[0].render = { assetId: "a", createdAt: "", model: "m" };
    const p = buildPublicProposal(j, s.profile, s.pricing);
    expect(p.kind).toBe("photo");
    expect(p.disclosures.join(" ")).toMatch(/preliminary/);
    expect(p.disclosures.join(" ")).toMatch(/concept images/);
    expect(p.disclosures.join(" ")).toMatch(/under the surface/);
    expect(p.options[0].excludes).toContain("No aggregate base");
    expect(p.options.every((o) => o.depositCents + o.balanceCents === o.priceCents)).toBe(true);
  });

  it("bid terms take no deposit", () => {
    const s = settings();
    const p = buildPublicProposal({ ...photoJob(), terms: "bid" }, s.profile, s.pricing);
    expect(p.terms.depositPct).toBe(0);
    expect(p.options.every((o) => o.depositCents === 0)).toBe(true);
  });

  it("hashes the same content the same way regardless of key order", () => {
    expect(canonical({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonical({ a: [{ c: 3, d: 2 }], b: 1 }));
  });
});

describe("publish readiness", () => {
  it("blocks until the contractor reviews scopes and accepts preliminary pricing", () => {
    const s = settings();
    const j = photoJob();
    expect(publishReadiness(j, s.profile, s.pricing).blockers.join(" ")).toMatch(/Review the three scopes/);
    j.concept!.review = { scopes: true, preliminary: false };
    expect(publishReadiness(j, s.profile, s.pricing).blockers.join(" ")).toMatch(/preliminary/);
    j.concept!.review = { scopes: true, preliminary: true };
    expect(publishReadiness(j, s.profile, s.pricing).blockers).toEqual([]);
  });

  it("blocks placeholder company details and the sample job", () => {
    const d = defaultSettings();
    const r = publishReadiness(sampleJob(), d.profile, d.pricing);
    expect(r.blockers.join(" ")).toMatch(/company name/);
    expect(r.blockers.join(" ")).toMatch(/sample job/);
  });
});
