import { describe, expect, it } from "vitest";
import { adoptDraft, conceptRenderPrompt, DraftInvalid, DraftSchema, draftPrompt, emptyConcept, type DraftOutput } from "./concept";
import { DEFAULT_RATES } from "./estimate";

/**
 * TEST FIXTURE ONLY. A hand written stand in for a model reply, used to check
 * validation and adoption. It is never shown as AI output in the app.
 */
const opt = (tier: "basic" | "standard" | "premium", extra: Partial<DraftOutput["options"][number]> = {}) => ({
  tier,
  name: `${tier} patio`,
  summary: "Summary",
  prep_note: "Prep differs",
  includes: ["Relay pavers"],
  excludes: tier === "basic" ? ["No new aggregate base or compaction"] : [],
  limitations: tier === "basic" ? ["Pavers may settle and shift on the existing sand"] : [],
  benefits: ["Looks tidy"],
  crew_steps: ["Lift pavers"],
  items: [
    { label: "Road base", kind: "material" as const, basis: "area" as const, rate: 0.02, unit: "ton", rate_key: "road_base", unit_cost_estimate: 999, waste_pct: 10, work_package: "prep" as const },
    { label: "Mystery stone", kind: "material" as const, basis: "area" as const, rate: 1, unit: "sq ft", rate_key: null, unit_cost_estimate: 7, waste_pct: 5, work_package: "materials" as const },
  ],
  visual_change: "New paver surface",
  visual_keep: "House and deck",
  ...extra,
});
const FIXTURE: DraftOutput = {
  observations: [{ text: "Reddish square pavers border a bare area", basis: "visible" }],
  assumptions: ["Existing sand is not compacted"],
  questions: [{ question: "Is there a downspout here?", why: "Drainage changes the base" }],
  size_estimate: { low_sqft: 100, high_sqft: 140, edge_ft: 44, basis: "12 in pavers" },
  options: [opt("basic"), opt("standard"), opt("premium")],
};

describe("adopting a draft", () => {
  it("matches the schema the model is held to", () => {
    expect(DraftSchema.safeParse(FIXTURE).success).toBe(true);
  });

  it("uses the contractor's rate book cost, keeps unmatched costs flagged as estimates", () => {
    const c = adoptDraft(FIXTURE, emptyConcept("Fix this patio"), DEFAULT_RATES, "test-model");
    expect(c.options.map((o) => o.tier)).toEqual(["basic", "standard", "premium"]);
    const [base, mystery] = c.options[1].items;
    expect(base.unitCost).toBe(38);
    expect(base.costSource).toBe("rate_book");
    expect(mystery.unitCost).toBe(7);
    expect(mystery.costSource).toBe("ai_estimate");
    expect(mystery.reviewed).toBe(false);
  });

  it("keeps a photo guess as an unconfirmed estimate", () => {
    const c = adoptDraft(FIXTURE, emptyConcept(), DEFAULT_RATES, "m");
    expect(c.measurement).toMatchObject({ areaSqft: 120, edgeFt: 44, source: "photo_estimate", confirmed: false });
    expect(c.sizeGuess).toMatchObject({ lowSqft: 100, highSqft: 140 });
  });

  it("never overwrites a size the contractor entered", () => {
    const prev = { ...emptyConcept(), measurement: { areaSqft: 96, edgeFt: 40, source: "contractor" as const, confirmed: true, note: "" } };
    expect(adoptDraft(FIXTURE, prev, DEFAULT_RATES, "m").measurement.areaSqft).toBe(96);
  });

  it("refuses a draft missing an option or an affordable option that hides its gaps", () => {
    expect(() => adoptDraft({ ...FIXTURE, options: FIXTURE.options.slice(0, 2) }, emptyConcept(), DEFAULT_RATES, "m")).toThrow(DraftInvalid);
    expect(() => adoptDraft({ ...FIXTURE, options: [opt("basic", { excludes: [], limitations: [] }), opt("standard"), opt("premium")] }, emptyConcept(), DEFAULT_RATES, "m")).toThrow(/leaves out/);
    expect(() => adoptDraft({ ...FIXTURE, options: [opt("basic", { items: [] }), opt("standard"), opt("premium")] }, emptyConcept(), DEFAULT_RATES, "m")).toThrow(/no line items/);
  });

  it("keeps answered questions and asks no more than three new ones", () => {
    const prev = { ...emptyConcept(), questions: [{ id: "q1", question: "Old", why: "", answer: "Yes" }] };
    const raw = { ...FIXTURE, questions: Array.from({ length: 6 }, (_, i) => ({ question: `Q${i}`, why: "w" })) };
    const c = adoptDraft(raw, prev, DEFAULT_RATES, "m");
    expect(c.questions[0].answer).toBe("Yes");
    expect(c.questions.filter((q) => !q.answer)).toHaveLength(3);
  });

  it("a new draft clears the contractor's earlier review", () => {
    const prev = { ...emptyConcept(), review: { scopes: true, preliminary: true } };
    expect(adoptDraft(FIXTURE, prev, DEFAULT_RATES, "m").review).toEqual({ scopes: false, preliminary: false });
  });
});

describe("instructions", () => {
  it("passes a contractor measurement and the rate book to the model", () => {
    const p = draftPrompt({ request: "Fix patio", notes: "Play sand, no base", location: null, answers: [], measurement: { areaSqft: 96, edgeFt: 40, source: "contractor", confirmed: true, note: "" }, laborRate: 60, crewSize: 2, experience: "", rates: DEFAULT_RATES });
    expect(p).toContain("96 sq ft");
    expect(p).toContain("road_base |");
    expect(p).toContain("Play sand, no base");
  });

  it("render instructions keep the viewpoint and surroundings", () => {
    const p = conceptRenderPrompt({ name: "x", visual: { change: "New pavers", keep: "Stone house" } }, "Fix patio");
    expect(p).toMatch(/exact camera position/);
    expect(p).toContain("Change only this: New pavers");
    expect(p).toContain("Stone house");
  });
});
