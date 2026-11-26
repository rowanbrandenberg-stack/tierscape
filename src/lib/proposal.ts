import { allocateMoney, breakdown, explainTotal, priceAlternative, type PackageLine, type PricedAlternative } from "./breakdown";
import { AREA_TYPES } from "./catalog";
import { TIER_LABEL, TIER_ORDER } from "./concept";
import { estimate, type EstimateResult } from "./estimate";
import { groupSize, quote, type Quote } from "./pricing";
import { DEFAULT_WARRANTY, depositPctOf, profileProblems, type Pricing, type Profile } from "./settings";
import { TIERS, type Job, type TierKey } from "./types";
import { proposalReadiness, readinessOpen } from "./readiness";

/**
 * Both ways into a job, from an address and plan or from a photo, end here:
 * three options with a price, scope and terms. The contractor side keeps the
 * costs; the homeowner side is built from a whitelist so internal numbers
 * cannot leak into a share link or a public API answer.
 */

export interface OptionView {
  tier: TierKey;
  name: string;
  label: string;
  price: number;
  days: number;
  summary: string;
  prepNote: string;
  scope: { title: string; size: string }[];
  includes: string[];
  excludes: string[];
  limitations: string[];
  benefits: string[];
  preliminary: string[];
  hasRender: boolean;
  /** The total split into work packages at customer prices. Adds up to the price exactly. */
  breakdown: PackageLine[];
  /** Contractor reviewed ways to save, each recalculated with the same arithmetic. */
  alternatives: PricedAlternative[];
  /** Contractor only. */
  internal: { quote: Quote | null; estimate: EstimateResult | null };
}

export const isPhotoJob = (j: Pick<Job, "kind" | "concept">) => j.kind === "photo" && !!j.concept;

export function jobOptions(job: Job, pricing: Pricing): OptionView[] {
  if (isPhotoJob(job)) {
    const c = job.concept!;
    return TIER_ORDER.map((t) => c.options.find((o) => o.tier === t))
      .filter((o): o is NonNullable<typeof o> => !!o)
      .map((o) => {
        const e = estimate(o.items, c.measurement, pricing);
        const size = c.measurement.areaSqft > 0 ? `${Math.round(c.measurement.areaSqft).toLocaleString("en-US")} sq ft${c.measurement.confirmed ? "" : " (estimated)"}` : "";
        return {
          tier: o.tier,
          name: o.name,
          label: TIER_LABEL[o.tier],
          price: e.price,
          days: e.days,
          summary: o.summary,
          prepNote: o.prepNote,
          scope: [{ title: o.name, size }],
          includes: o.includes,
          excludes: o.excludes,
          limitations: o.limitations,
          benefits: o.benefits,
          preliminary: e.preliminary,
          hasRender: !!o.render,
          breakdown: breakdown(o.items, c.measurement, pricing, toCents(e.price)),
          alternatives: (o.alternatives ?? []).filter((a) => a.reviewed && a.label.trim()).map((a) => priceAlternative(o.items, c.measurement, pricing, a)).filter((a): a is PricedAlternative => !!a),
          internal: { quote: null, estimate: e },
        };
      });
  }
  return TIERS.map((t) => {
    const q = quote(job, pricing, t.key);
    return {
      tier: t.key,
      name: t.name,
      label: t.name,
      price: q.price,
      days: q.days,
      summary: "",
      prepNote: "",
      scope: q.groups.map((g) => ({ title: g.title, size: groupSize(g) })),
      includes: q.groups.map((g) => g.title),
      excludes: [],
      limitations: [],
      benefits: [],
      preliminary: [],
      hasRender: false,
      breakdown: planBreakdown(q),
      alternatives: [],
      internal: { quote: q, estimate: null },
    };
  });
}

/** Plan jobs explain the total by work area: each area's installed price, adding up to the quote. */
function planBreakdown(q: Quote): PackageLine[] {
  const cents = allocateMoney(toCents(q.price), q.groups.map((g) => g.sell));
  return q.groups
    .map((g, i) => ({ key: "install" as const, label: g.kind === "plants" ? "Plants" : g.kind === "extras" ? "Other work" : `${AREA_TYPES[g.kind].label}, ${groupSize(g)}`, cents: cents[i], parts: [g.title] }))
    .filter((l) => l.cents > 0);
}

/* ---------- money ---------- */

export const toCents = (dollars: number) => Math.round(Math.max(0, dollars) * 100);
export const usdCents = (c: number) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });

/** Deposit and balance in cents. The two always add up to the total exactly. */
export function splitAmounts(totalCents: number, depositPct: number): { depositCents: number; balanceCents: number } {
  const t = Math.max(0, Math.round(totalCents));
  const pct = Math.min(100, Math.max(0, depositPct));
  const depositCents = Math.round((t * pct) / 100);
  return { depositCents, balanceCents: t - depositCents };
}

/* ---------- what the homeowner receives ---------- */

export interface PublicOption {
  tier: TierKey;
  name: string;
  label: string;
  priceCents: number;
  depositCents: number;
  balanceCents: number;
  days: number;
  summary: string;
  prepNote: string;
  scope: { title: string; size: string }[];
  includes: string[];
  excludes: string[];
  limitations: string[];
  benefits: string[];
  preliminary: boolean;
  /** A concept image exists for this option (served through the share link). */
  render: boolean;
  /** Customer prices by work package, overhead and profit included, adding up to priceCents. */
  breakdown: PackageLine[];
  explanation: string;
  alternatives: PricedAlternative[];
}

export interface PublicProposal {
  v: 2;
  kind: "plan" | "photo";
  createdAt: string;
  expiresAt: string;
  currency: "usd";
  company: Pick<Profile, "company" | "license" | "licenseLine" | "phone" | "email" | "website" | "brandColor" | "accentColor" | "logo"> & { warranty: string };
  address: string;
  request: string | null;
  /** The original yard photo is shown (served through the share link). */
  photo: boolean;
  plan: {
    origin: { lat: number; lon: number } | null;
    zoom: number | null;
    extent: { x: number; y: number; w: number; h: number };
    lot: [number, number][] | null;
    areas: { type: "patio" | "lawn" | "bed"; pts: [number, number][] }[];
    plants: { kind: "tree" | "shrub" | "perennial"; spots: [number, number][] }[];
  } | null;
  recommended: TierKey;
  options: PublicOption[];
  terms: { depositPct: number; lines: string[] };
  /** Plain statements the homeowner must see: preliminary pricing, concept images, assumptions. */
  disclosures: string[];
  assumptions: string[];
}

const r1 = (p: [number, number]): [number, number] => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
const VALID_DAYS = 30;

export function buildPublicProposal(job: Job, profile: Profile, pricing: Pricing, now = new Date()): PublicProposal {
  const opts = jobOptions(job, pricing);
  const photo = isPhotoJob(job);
  const depositPct = job.terms === "bid" ? 0 : depositPctOf(pricing);
  const anyPrelim = opts.some((o) => o.preliminary.length > 0);
  const anyRender = opts.some((o) => o.hasRender);
  const logo = profile.logo && profile.logo.length < 60_000 ? profile.logo : null;
  const disclosures: string[] = [];
  if (anyPrelim)
    disclosures.push(
      photo
        ? "These prices are preliminary. They are based on a photo and the information available today. The final price is confirmed after the area is measured on site, and any change is agreed with you in writing before work starts."
        : "These prices are preliminary and are confirmed in writing before work starts.",
    );
  if (anyRender) disclosures.push("The pictures of each option are concept images made from your photo. They show the idea, not an exact result: real materials, colors and plants will vary.");
  if (photo) disclosures.push("Nothing about what lies under the surface, such as soil, existing base or buried lines, can be known from a photo. If the crew finds something different when work starts, any change in price is agreed with you first.");
  const terms = [
    "We locate underground utilities through 811 before any digging. Work starts once every utility has responded.",
    "Any change to the scope is priced in writing before the work is done.",
    depositPct > 0
      ? `A ${depositPct}% deposit secures your place on the schedule and orders materials. The balance is due when the work is complete.`
      : "Payment is due in full when the work is complete.",
  ];
  if (!photo) terms.push("Property lines come from public parcel maps and are approximate. Work along a boundary needs the corners confirmed first.");

  return {
    v: 2,
    kind: photo ? "photo" : "plan",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + VALID_DAYS * 864e5).toISOString(),
    currency: "usd",
    company: {
      company: profile.company,
      license: profile.license,
      licenseLine: profile.licenseLine,
      phone: profile.phone,
      email: profile.email,
      website: profile.website,
      brandColor: profile.brandColor,
      accentColor: profile.accentColor,
      logo,
      warranty: profile.warranty?.trim() || DEFAULT_WARRANTY,
    },
    address: job.site.matchedAddress ?? job.site.address,
    request: photo ? job.concept!.request || null : null,
    photo: photo && !!job.concept!.photoId,
    plan: photo
      ? null
      : {
          origin: job.site.origin,
          zoom: job.site.imagery?.zoom ?? null,
          extent: job.site.extent,
          lot: job.lot ? job.lot.map(r1) : null,
          areas: job.areas.map((a) => ({ type: a.type, pts: a.pts.map(r1) })),
          plants: job.plants.filter((p) => p.spots.length).map((p) => ({ kind: p.kind, spots: p.spots.map(r1) })),
        },
    recommended: job.tier,
    options: opts.map((o) => {
      const priceCents = toCents(o.price);
      const { depositCents, balanceCents } = splitAmounts(priceCents, depositPct);
      return {
        tier: o.tier,
        name: o.name,
        label: o.label,
        priceCents,
        depositCents,
        balanceCents,
        days: o.days,
        summary: o.summary,
        prepNote: o.prepNote,
        scope: o.scope,
        includes: o.includes,
        excludes: o.excludes,
        limitations: o.limitations,
        benefits: o.benefits,
        preliminary: o.preliminary.length > 0,
        render: o.hasRender,
        breakdown: o.breakdown,
        explanation: photo ? explainTotal(o.breakdown) : o.breakdown.length > 1 ? "This is the installed price for the whole job, including materials, labor and cleanup. Here is how it divides by area." : "",
        alternatives: o.alternatives,
      };
    }),
    terms: { depositPct, lines: terms },
    disclosures,
    assumptions: photo ? job.concept!.assumptions.slice(0, 8) : [],
  };
}

/** A stable JSON form, so the same proposal always hashes the same. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as object)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

/** Keys that must never appear anywhere in a homeowner payload. */
export const PRIVATE_KEYS = ["unitCost", "cost", "costs", "labor", "laborRate", "hours", "markupPct", "overheadPct", "overhead", "profit", "marginPct", "margin", "items", "notes", "internal", "rateKey", "wastePct", "crewSteps", "stripeAccount", "secret", "token"];

export function findPrivateKeys(v: unknown, path = "$"): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => findPrivateKeys(x, `${path}[${i}]`));
  if (v && typeof v === "object")
    return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => [...(PRIVATE_KEYS.includes(k) ? [`${path}.${k}`] : []), ...findPrivateKeys(x, `${path}.${k}`)]);
  return [];
}

/* ---------- before anything is published ---------- */

export interface Readiness {
  blockers: string[];
  warnings: string[];
}

export function publishReadiness(job: Job, profile: Profile, pricing: Pricing): Readiness {
  const blockers = [...profileProblems(profile)];
  // Placeholders replaced, and starting values (crew cost, overhead, license claim, warranty) kept on purpose.
  for (const r of readinessOpen(proposalReadiness(profile, pricing))) {
    const line = r.state === "fix" ? `${r.label}: ${r.detail}` : `${r.label}: check it in Settings and keep it on purpose. ${r.detail}`;
    if (!blockers.some((b) => b.toLowerCase().includes(r.label.toLowerCase().split(" ")[0]))) blockers.push(line);
  }
  const warnings: string[] = [];
  if (job.sample) blockers.push("The sample job cannot be shared.");
  const opts = jobOptions(job, pricing);
  if (opts.length !== 3) blockers.push("All three options are needed before publishing.");
  if (opts.some((o) => !(o.price > 0))) blockers.push("Every option needs a price above zero.");
  if (isPhotoJob(job)) {
    const c = job.concept!;
    if (!c.review.scopes) blockers.push("Review the three scopes, inclusions and exclusions, and tick that you checked them.");
    const prelim = opts.some((o) => o.preliminary.length);
    if (prelim && !c.review.preliminary) blockers.push("Some sizes or costs are still estimates. Confirm them, or tick that you are publishing a preliminary price.");
    const basic = c.options.find((o) => o.tier === "basic");
    if (basic && !basic.excludes.length && !basic.limitations.length) blockers.push("The affordable option must say what it leaves out.");
    if (!c.photoId) warnings.push("The yard photo is not saved to your account, so the homeowner will not see it.");
    if (opts.some((o) => !o.hasRender)) warnings.push("Some options have no concept picture yet.");
  } else if (!job.areas.length && !job.plants.length && !(job.extras ?? []).length) blockers.push("Draw at least one work area on the plan.");
  return { blockers, warnings };
}
