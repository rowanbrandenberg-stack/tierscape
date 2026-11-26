import * as z from "zod/v4";
import { applyRule, sanitizeItem, type EstimateItem, type Measurement, type RateRule } from "./estimate";
import type { Alternative } from "./breakdown";
import type { TierKey } from "./types";

/**
 * Photo-first jobs: a photo of the yard and the homeowner's request become
 * three options. The model drafts the scopes, quantities and visuals; this
 * file checks what comes back, ties lines to the contractor's own rate book
 * and keeps every guess marked as a guess.
 */

export const TIER_ORDER: TierKey[] = ["basic", "standard", "premium"];
export const TIER_LABEL: Record<TierKey, string> = { basic: "Affordable", standard: "Standard", premium: "Premium" };

export interface RenderRef {
  assetId: string;
  createdAt: string;
  model: string;
}

export interface ConceptOption {
  tier: TierKey;
  name: string;
  summary: string;
  /** How the preparation and build differ from the other options, in plain words. */
  prepNote: string;
  includes: string[];
  excludes: string[];
  limitations: string[];
  benefits: string[];
  crewSteps: string[];
  items: EstimateItem[];
  /** What the concept image changes, and what it must leave alone. */
  visual: { change: string; keep: string };
  render: RenderRef | null;
  source: "ai" | "edited";
  /** Ways to save the contractor set up as real scope changes. Older jobs have none. */
  alternatives?: Alternative[];
}

export interface Observation {
  text: string;
  /** visible in the photo, reported by the contractor or homeowner. Nothing else. */
  basis: "visible" | "reported";
}

export interface Question {
  id: string;
  question: string;
  why: string;
  answer: string;
}

export interface PhotoConcept {
  request: string;
  /** The original photo, stored privately on the server. */
  photoId: string | null;
  /** What the contractor already knows: soil, base, access, budget, their own past quotes. */
  notes: string;
  observations: Observation[];
  assumptions: string[];
  questions: Question[];
  measurement: Measurement;
  /** The draft's range, kept so the contractor can see what the model thought. */
  sizeGuess: { lowSqft: number; highSqft: number; basis: string } | null;
  options: ConceptOption[];
  draft: { model: string; createdAt: string } | null;
  /** The contractor has read the options and accepts publishing a preliminary price. */
  review: { scopes: boolean; preliminary: boolean };
  /** AI work still running on the server, so a reload picks it back up. */
  pending?: { id: string; kind: "draft" | "option" | "render"; tier: TierKey | null; key: string }[];
}

export function emptyConcept(request = ""): PhotoConcept {
  return {
    request,
    photoId: null,
    notes: "",
    observations: [],
    assumptions: [],
    questions: [],
    measurement: { areaSqft: 0, edgeFt: 0, source: "photo_estimate", confirmed: false, note: "" },
    sizeGuess: null,
    options: [],
    draft: null,
    review: { scopes: false, preliminary: false },
  };
}

/* ---------- what the model must return ---------- */

const Item = z.object({
  label: z.string().describe("Short line name a crew lead would recognise"),
  kind: z.enum(["material", "labor", "equipment", "disposal", "delivery", "subcontract", "other"]),
  basis: z.enum(["area", "edge", "fixed"]).describe("area = per sq ft of the work area, edge = per lin ft of its edge, fixed = a total for the job"),
  rate: z.number().describe("Quantity per sq ft (area), per lin ft (edge), or the total quantity (fixed). Labor is person hours."),
  unit: z.string(),
  rate_key: z.string().nullable().describe("The key of the matching rate book entry, or null when none matches"),
  unit_cost_estimate: z.number().describe("Your estimate of the contractor's cost per unit in USD. Ignored when rate_key matches. 0 for labor."),
  waste_pct: z.number(),
  work_package: z.enum(["prep", "materials", "install", "haul"]).describe("How the homeowner sees this line: prep = demolition, excavation, grading, base and compaction; materials = supplying and delivering materials; install = building and finishing; haul = spoil haul away, disposal and cleanup"),
});

export const OptionSchema = z.object({
  tier: z.enum(["basic", "standard", "premium"]),
  name: z.string().describe("A plain name for this approach, under 6 words"),
  summary: z.string().describe("One or two sentences a homeowner understands"),
  prep_note: z.string().describe("How preparation, base and build quality differ from the other options, and what that means for how long it lasts"),
  includes: z.array(z.string()),
  excludes: z.array(z.string()),
  limitations: z.array(z.string()),
  benefits: z.array(z.string()),
  crew_steps: z.array(z.string()),
  items: z.array(Item),
  visual_change: z.string().describe("Only the surfaces and features this option changes, as they would look finished"),
  visual_keep: z.string().describe("Everything in the photo that must stay exactly as it is"),
});

export const DraftSchema = z.object({
  observations: z.array(z.object({ text: z.string(), basis: z.enum(["visible", "reported"]) })),
  assumptions: z.array(z.string()),
  questions: z.array(z.object({ question: z.string(), why: z.string() })),
  size_estimate: z.object({
    low_sqft: z.number(),
    high_sqft: z.number(),
    edge_ft: z.number(),
    basis: z.string().describe("What in the photo the guess is scaled from"),
  }),
  options: z.array(OptionSchema),
});

export type DraftOutput = z.infer<typeof DraftSchema>;
export type OptionOutput = z.infer<typeof OptionSchema>;

/* ---------- checking and adopting a draft ---------- */

const text = (s: unknown, max = 300) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const list = (a: unknown, n = 10, max = 240) => (Array.isArray(a) ? a.map((x) => text(x, max)).filter(Boolean).slice(0, n) : []);
const finite = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0);

let seq = 0;
const lineId = (tier: string) => `li_${tier}_${Date.now().toString(36)}${(seq++).toString(36)}`;

export class DraftInvalid extends Error {}

/** One option from the model, tied to the rate book. Throws when it is unusable. */
export function adoptOption(raw: OptionOutput, tier: TierKey, rates: RateRule[]): ConceptOption {
  const byKey = new Map(rates.map((r) => [r.key, r]));
  const items: EstimateItem[] = (Array.isArray(raw.items) ? raw.items : []).slice(0, 30).map((x) => {
    const base = sanitizeItem({
      id: lineId(tier),
      label: text(x.label, 140),
      kind: x.kind,
      basis: x.basis,
      rate: finite(x.rate),
      unit: text(x.unit, 24),
      unitCost: x.kind === "labor" ? 0 : finite(x.unit_cost_estimate),
      wastePct: finite(x.waste_pct),
      costSource: "ai_estimate",
      rateKey: null,
      reviewed: false,
      pkg: x.work_package,
    });
    const rule = x.rate_key ? byKey.get(String(x.rate_key)) : undefined;
    // Labor costs come from the crew rate, so a labor line only needs its hours checked.
    return rule ? applyRule(base, rule) : base;
  });
  if (!items.length) throw new DraftInvalid(`The ${TIER_LABEL[tier]} option came back with no line items.`);
  return {
    tier,
    name: text(raw.name, 60) || TIER_LABEL[tier],
    summary: text(raw.summary, 400),
    prepNote: text(raw.prep_note, 500),
    includes: list(raw.includes, 12),
    excludes: list(raw.excludes, 12),
    limitations: list(raw.limitations, 8),
    benefits: list(raw.benefits, 8),
    crewSteps: list(raw.crew_steps, 14),
    items,
    visual: { change: text(raw.visual_change, 900), keep: text(raw.visual_keep, 600) },
    render: null,
    source: "ai",
  };
}

/** A whole draft: three options, one per tier, with the budget option's gaps written down. */
export function adoptDraft(raw: DraftOutput, prev: PhotoConcept, rates: RateRule[], model: string, now = new Date()): PhotoConcept {
  const opts = Array.isArray(raw.options) ? raw.options : [];
  const options = TIER_ORDER.map((t) => {
    const o = opts.find((x) => x.tier === t);
    if (!o) throw new DraftInvalid(`The draft is missing the ${TIER_LABEL[t]} option.`);
    return adoptOption(o, t, rates);
  });
  const basic = options[0];
  if (!basic.excludes.length && !basic.limitations.length)
    throw new DraftInvalid("The affordable option does not say what it leaves out. Generate again so the homeowner sees the trade off.");
  const lo = Math.max(0, finite(raw.size_estimate?.low_sqft));
  const hi = Math.max(lo, finite(raw.size_estimate?.high_sqft));
  const keepMeasure = prev.measurement.confirmed || prev.measurement.source === "contractor";
  const answered = new Map(prev.questions.filter((q) => q.answer.trim()).map((q) => [q.question, q.answer]));
  return {
    ...prev,
    observations: (Array.isArray(raw.observations) ? raw.observations : [])
      .map((o) => ({ text: text(o.text, 240), basis: o.basis === "reported" ? ("reported" as const) : ("visible" as const) }))
      .filter((o) => o.text)
      .slice(0, 10),
    assumptions: list(raw.assumptions, 10),
    questions: [
      ...prev.questions.filter((q) => q.answer.trim()),
      ...(Array.isArray(raw.questions) ? raw.questions : [])
        .filter((q) => !answered.has(text(q.question, 200)))
        .slice(0, 3)
        .map((q, i) => ({ id: `q_${now.getTime().toString(36)}_${i}`, question: text(q.question, 200), why: text(q.why, 200), answer: "" })),
    ].slice(0, 6),
    measurement: keepMeasure
      ? prev.measurement
      : { areaSqft: Math.round((lo + hi) / 2), edgeFt: Math.round(Math.max(0, finite(raw.size_estimate?.edge_ft))), source: "photo_estimate", confirmed: false, note: text(raw.size_estimate?.basis, 200) },
    sizeGuess: hi > 0 ? { lowSqft: Math.round(lo), highSqft: Math.round(hi), basis: text(raw.size_estimate?.basis, 200) } : null,
    options,
    draft: { model, createdAt: now.toISOString() },
    // A new draft needs a new review.
    review: { scopes: false, preliminary: false },
  };
}

/* ---------- the instructions ---------- */

export const DRAFT_SYSTEM = [
  "You draft landscaping proposals for a licensed landscape contractor. Landscaping and hardscape only: patios, pavers, walkways, flagstone, planting beds, lawn, edging, gravel, retaining walls under 3 ft, drip irrigation and low voltage lighting. Never propose other trades.",
  "You receive one photo of a client's yard, the client's request, the contractor's notes, the contractor's rate book and their crew cost.",
  "Write three genuinely different approaches: basic (affordable), standard and premium. Price is not yours to set: you give line items and the contractor's software does the arithmetic.",
  "Rules:",
  "1. Only describe what is visible in the photo or stated in the request or notes. Mark each observation visible or reported.",
  "2. Never infer underground conditions, base depth, soil type, drainage below grade, utilities, irrigation lines or exact dimensions from the photo. Anything you need about them is an assumption or a question.",
  "3. Give a size range in sq ft with what you scaled it from (a paver, a door, a step). It is a guess and will be labelled as one.",
  "4. The basic option must say plainly what preparation it skips (for example no new aggregate base or compaction) and what that means: settling, shifting, weeds, shorter life. Put that in excludes and limitations. Never present an unprepared base as equal quality, even when the finished surface looks the same.",
  "5. When two options look alike finished but differ underneath, explain the difference in prep_note.",
  "6. Premium adds upgrades a homeowner can see or feel and that are justified for this yard. Do not pad it.",
  "7. Items: use the rate book key whenever an entry matches, and use its unit. For lines with no match, set rate_key to null and give your best cost estimate; it will be shown to the contractor as a suggestion. Labor lines are person hours per sq ft, per lin ft, or in total. Include demolition, disposal, hauling, delivery and equipment rental when the work needs them.",
  "8. Ask at most three questions, only ones whose answer would change the scope or price by a lot. Skip anything already answered.",
  "9. visual_change describes only the finished surfaces and plants for this option. visual_keep lists the house, walls, deck, fences, trees, neighbouring paving and anything else that must not change.",
  "Write plainly, without hyphens or dashes, for a homeowner who is not in the trade.",
].join("\n");

export interface DraftContext {
  request: string;
  notes: string;
  location: string | null;
  answers: { question: string; answer: string }[];
  measurement: Measurement | null;
  laborRate: number;
  crewSize: number;
  experience: string;
  rates: RateRule[];
}

export function draftPrompt(c: DraftContext): string {
  const L = [
    `Client request: ${text(c.request, 600) || "(none given)"}`,
    c.location ? `Job location: ${text(c.location, 200)}` : "Job location: not given",
    `Contractor notes about this job: ${text(c.notes, 1500) || "(none)"}`,
    `How this contractor works: ${text(c.experience, 1500) || "(not described)"}`,
    `Crew cost: $${c.laborRate} per person hour, crew of ${c.crewSize}.`,
  ];
  if (c.measurement && (c.measurement.confirmed || c.measurement.source === "contractor"))
    L.push(`Measured by the contractor: ${c.measurement.areaSqft} sq ft of work area, ${c.measurement.edgeFt} lin ft of edge. Use these, not a guess.`);
  if (c.answers.length) L.push("Answers to earlier questions:", ...c.answers.map((a) => `- ${text(a.question, 200)} ${text(a.answer, 400)}`));
  L.push(
    "Rate book (key | name | kind | unit | contractor cost | quantity rule):",
    ...c.rates.slice(0, 80).map((r) => `${r.key} | ${r.label} | ${r.kind} | ${r.unit} | $${r.unitCost} | ${r.rate != null ? `${r.rate} per ${r.basis === "area" ? "sq ft" : r.basis === "edge" ? "lin ft" : "job"}` : "you suggest"}`),
  );
  return L.join("\n");
}

export function optionPrompt(c: DraftContext, concept: PhotoConcept, tier: TierKey, instruction: string): string {
  const others = concept.options.filter((o) => o.tier !== tier).map((o) => `${TIER_LABEL[o.tier]}: ${o.name}. ${o.summary}`);
  return [
    draftPrompt(c),
    `Estimated work area: ${concept.measurement.areaSqft} sq ft, ${concept.measurement.edgeFt} lin ft of edge (${concept.measurement.confirmed ? "measured" : "estimated"}).`,
    "The other options, which stay as they are:",
    ...others,
    `Rewrite only the ${tier} (${TIER_LABEL[tier]}) option. Keep it different from the others.`,
    `The contractor asks: ${text(instruction, 800) || "Draft it again."}`,
  ].join("\n");
}

/**
 * The image edit instructions for one option's concept picture. The photo's
 * viewpoint, house and surroundings must survive untouched.
 */
export function conceptRenderPrompt(o: Pick<ConceptOption, "name" | "visual">, request: string): string {
  return [
    "Edit this photo of a real yard into a realistic concept of finished landscaping work.",
    "Keep the exact camera position, lens, framing, perspective, time of day and lighting. Keep the house, siding, stone, windows, doors, deck, steps, fences, walls, trees, neighbouring paving, sky and every object not named below exactly as they are, in the same place and size.",
    `Change only this: ${o.visual.change}`,
    o.visual.keep ? `Must stay unchanged: ${o.visual.keep}` : "",
    `Context from the client: ${text(request, 300)}`,
    "No people, no furniture, no text, no logos, no watermarks. Do not add plants or features that are not named. Photorealistic, not an illustration.",
  ]
    .filter(Boolean)
    .join("\n");
}
