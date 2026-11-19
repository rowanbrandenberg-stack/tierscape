/**
 * The one definition of what TierScape sells. The pricing page, checkout,
 * account center and every access check read from here, so they agree.
 * All prices are USD, per company.
 */

export type PlanKey = "starter" | "pro" | "team";
export type Cadence = "monthly" | "annual";

export interface Plan {
  key: PlanKey;
  name: string;
  /** Who it is for, one line. */
  audience: string;
  /** What they get out of it, one line. */
  outcome: string;
  monthly: number;
  annual: number;
  estimators: number;
  /** Monthly AI image allowance, once image generation is validated. */
  images: number;
  /** Feature keys from FEATURES that this plan includes. */
  features: FeatureKey[];
}

export type FeatureKey =
  | "unlimited_jobs"
  | "planning"
  | "price_book"
  | "single_proposal"
  | "build_pack"
  | "crew_view"
  | "three_tier"
  | "presentation"
  | "templates"
  | "version_history"
  | "team_permissions"
  | "approvals"
  | "reporting"
  | "export";

/**
 * Every advertised feature and whether it works today. Nothing marked
 * `ready: false` is sold as available: it shows as coming soon.
 */
export const FEATURES: Record<FeatureKey, { label: string; ready: boolean }> = {
  unlimited_jobs: { label: "Unlimited jobs and estimates", ready: true },
  planning: { label: "Property planning and measurement from the aerial", ready: true },
  price_book: { label: "Company price book with transparent cost math", ready: true },
  single_proposal: { label: "Branded proposals", ready: true },
  build_pack: { label: "Materials lists and crew build packs", ready: true },
  export: { label: "Data export", ready: true },
  crew_view: { label: "Crew viewing access", ready: false },
  three_tier: { label: "Three tier customer comparisons", ready: true },
  presentation: { label: "Customer presentation link", ready: true },
  templates: { label: "Reusable estimating templates", ready: false },
  version_history: { label: "Proposal version history", ready: false },
  team_permissions: { label: "Team permissions", ready: false },
  approvals: { label: "Approval workflows", ready: false },
  reporting: { label: "Reporting across jobs", ready: false },
};

const STARTER: FeatureKey[] = ["unlimited_jobs", "planning", "price_book", "single_proposal", "build_pack", "export", "crew_view"];
const PRO: FeatureKey[] = [...STARTER, "three_tier", "presentation", "templates", "version_history"];
const TEAM: FeatureKey[] = [...PRO, "team_permissions", "approvals", "reporting"];

export const PLANS: Record<PlanKey, Plan> = {
  starter: {
    key: "starter",
    name: "Starter",
    audience: "For an owner preparing their own estimates.",
    outcome: "Price every job from real measurements and your own costs.",
    monthly: 79,
    annual: 790,
    estimators: 1,
    images: 0,
    features: STARTER,
  },
  pro: {
    key: "pro",
    name: "Pro",
    audience: "For contractors selling project options and coordinating work.",
    outcome: "Show homeowners three priced options and close the bigger one.",
    monthly: 149,
    annual: 1490,
    estimators: 2,
    images: 30,
    features: PRO,
  },
  team: {
    key: "team",
    name: "Team",
    audience: "For companies with multiple estimators and crews.",
    outcome: "Keep every estimator on the same numbers and approvals.",
    monthly: 299,
    annual: 2990,
    estimators: 5,
    images: 90,
    features: TEAM,
  },
};

export const PLAN_ORDER: PlanKey[] = ["starter", "pro", "team"];

/** Monthly equivalent of the annual price, rounded to the cent. */
export const annualMonthly = (p: Plan) => Math.round((p.annual / 12) * 100) / 100;
/** What annual saves against twelve monthly payments. */
export const annualSavings = (p: Plan) => p.monthly * 12 - p.annual;
/** Two months free is the claim, so the annual price must be exactly ten months. */
export const annualIsTwoMonthsFree = (p: Plan) => p.annual === p.monthly * 10;

export const usd = (n: number, cents = false) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });

/** A plan can be bought only when everything it advertises works and accounts exist to attach it to. */
export function sellable(key: PlanKey, accountsReady: boolean): { ok: boolean; missing: string[] } {
  const missing = PLANS[key].features.filter((f) => !FEATURES[f].ready).map((f) => FEATURES[f].label);
  if (!accountsReady) missing.unshift("Sign in and estimator accounts");
  return { ok: missing.length === 0, missing };
}

/* ---------- founding contractor offer ---------- */

export const FOUNDING = {
  plan: "pro" as PlanKey,
  cadence: "monthly" as Cadence,
  price: 99,
  standard: 149,
  periods: 12,
  limit: 10,
  /** How long a checkout may hold a place before it is released. */
  holdMinutes: 45,
};
export const foundingSavings = () => (FOUNDING.standard - FOUNDING.price) * FOUNDING.periods;

/* ---------- trial and AI allowances ---------- */

export const TRIAL = { days: 14, plan: "pro" as PlanKey, activeJobs: 1, images: 3 };

/** Image allowances are prepared but stay hidden until rendering works and its cost is validated. */
export const IMAGES_ADVERTISED = false;
