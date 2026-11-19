import { FOUNDING, PLANS, TRIAL, type Cadence, type FeatureKey, type PlanKey } from "./plans";

/**
 * Billing rules for TierScape, independent of Stripe's SDK and the database.
 * The server feeds verified Stripe events in; everything that decides access
 * reads the stored state back out. Nothing here trusts the browser.
 */

export type SubStatus = "trialing" | "active" | "past_due" | "unpaid" | "canceled" | "incomplete" | "incomplete_expired" | "paused";

export interface Company {
  id: string;
  stripeCustomerId: string | null;
  /** In app trial, no card. One per company, ever. */
  trialStartedAt: number | null;
  /** Set by disputes and fraud warnings. Blocks paid creation until reviewed. */
  billingHold: string | null;
}

export interface Subscription {
  companyId: string;
  stripeSubscriptionId: string;
  plan: PlanKey;
  cadence: Cadence;
  status: SubStatus;
  periodStart: number;
  periodEnd: number;
  cancelAtPeriodEnd: boolean;
  /** Founding Pro: paid periods at $99 so far. Null when not founding. */
  founding: { paidPeriods: number } | null;
  /** created time of the Stripe event this state came from, to ignore older events that arrive late. */
  asOf: number;
}

export interface FoundingPlace {
  companyId: string;
  state: "held" | "confirmed" | "released";
  heldUntil: number;
}

export interface UsageEntry {
  key: string;
  companyId: string;
  window: string;
  units: number;
  state: "pending" | "used" | "refunded";
}

export interface Store {
  company(id: string): Promise<Company | null>;
  companyByCustomer(customerId: string): Promise<Company | null>;
  saveCompany(c: Company): Promise<void>;
  subscription(companyId: string): Promise<Subscription | null>;
  saveSubscription(s: Subscription): Promise<void>;
  /** Returns false if this event id was already processed. Must be atomic. */
  claimEvent(eventId: string): Promise<boolean>;
  foundingPlaces(): Promise<FoundingPlace[]>;
  /** Runs fn while no other founding change can run. The database version takes an advisory lock. */
  withFoundingLock<T>(fn: () => Promise<T>): Promise<T>;
  saveFoundingPlace(p: FoundingPlace): Promise<void>;
  usage(companyId: string, window: string): Promise<UsageEntry[]>;
  usageEntry(key: string): Promise<UsageEntry | null>;
  /** Adds a pending entry only if used plus pending stays within the limit. Must be atomic. */
  reserveUsage(e: UsageEntry, limit: number): Promise<boolean>;
  setUsageState(key: string, state: UsageEntry["state"]): Promise<void>;
}

const DAY = 86_400_000;

/* ---------- founding offer ---------- */

export async function foundingAvailability(store: Store, now: number) {
  const places = await store.foundingPlaces();
  const taken = places.filter((p) => p.state === "confirmed" || (p.state === "held" && p.heldUntil > now)).length;
  return { limit: FOUNDING.limit, taken, remaining: Math.max(0, FOUNDING.limit - taken) };
}

/**
 * Hold a founding place while the company is in checkout. One redemption per
 * company, never more than the limit counting live holds, and a repeat click
 * gets the same hold back instead of a second one.
 */
export async function holdFoundingPlace(store: Store, companyId: string, now: number): Promise<{ ok: true; until: number } | { ok: false; reason: string }> {
  return store.withFoundingLock(async () => {
    const places = await store.foundingPlaces();
    const mine = places.filter((p) => p.companyId === companyId);
    if (mine.some((p) => p.state === "confirmed")) return { ok: false, reason: "This company has already used the founding contractor offer." };
    const live = mine.find((p) => p.state === "held" && p.heldUntil > now);
    if (live) return { ok: true, until: live.heldUntil };
    const taken = places.filter((p) => p.state === "confirmed" || (p.state === "held" && p.heldUntil > now)).length;
    if (taken >= FOUNDING.limit) return { ok: false, reason: "All founding contractor places are taken." };
    const until = now + FOUNDING.holdMinutes * 60_000;
    await store.saveFoundingPlace({ companyId, state: "held", heldUntil: until });
    return { ok: true, until };
  });
}

export async function releaseFoundingHold(store: Store, companyId: string) {
  await store.withFoundingLock(async () => {
    for (const p of await store.foundingPlaces()) if (p.companyId === companyId && p.state === "held") await store.saveFoundingPlace({ ...p, state: "released" });
  });
}

/* ---------- Stripe events ---------- */

/** The slice of a Stripe event TierScape reads. Signature verification happens before this. */
export interface StripeEvent {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
}

export interface PriceMap {
  /** Stripe Price id to plan and cadence, resolved on the server from configuration. */
  [priceId: string]: { plan: PlanKey; cadence: Cadence };
}

type Obj = Record<string, unknown>;
const get = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Obj)[k] : undefined), o);

export type EventResult = "duplicate" | "ignored" | "stale" | "applied" | "unknown_company";

export async function handleStripeEvent(store: Store, ev: StripeEvent, prices: PriceMap, foundingCouponId: string | null): Promise<EventResult> {
  if (!(await store.claimEvent(ev.id))) return "duplicate";
  const o = ev.data.object;
  const customer = String(get(o, "customer") ?? "");
  const company = customer ? await store.companyByCustomer(customer) : null;

  switch (ev.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      if (!company) return "unknown_company";
      const priceId = String(get(o, "items.data.0.price.id") ?? "");
      const plan = prices[priceId];
      if (!plan) return "ignored";
      const prev = await store.subscription(company.id);
      const asOf = ev.created * 1000;
      if (prev && prev.stripeSubscriptionId === String(o.id) && prev.asOf > asOf) return "stale";
      const discounts = (get(o, "discounts") as unknown[] | undefined) ?? [];
      const couponHere = foundingCouponId !== null && (get(o, "discount.coupon.id") === foundingCouponId || discounts.some((d) => get(d, "coupon.id") === foundingCouponId || d === foundingCouponId));
      const keepFounding = prev?.founding && plan.plan === FOUNDING.plan && plan.cadence === FOUNDING.cadence ? prev.founding : null;
      const item = get(o, "items.data.0") as Obj | undefined;
      await store.saveSubscription({
        companyId: company.id,
        stripeSubscriptionId: String(o.id),
        plan: plan.plan,
        cadence: plan.cadence,
        status: (ev.type === "customer.subscription.deleted" ? "canceled" : String(o.status)) as SubStatus,
        periodStart: Number(get(item, "current_period_start") ?? o.current_period_start ?? 0) * 1000,
        periodEnd: Number(get(item, "current_period_end") ?? o.current_period_end ?? 0) * 1000,
        cancelAtPeriodEnd: Boolean(o.cancel_at_period_end),
        founding: keepFounding ?? (couponHere ? { paidPeriods: 0 } : null),
        asOf,
      });
      return "applied";
    }
    case "invoice.paid": {
      if (!company) return "unknown_company";
      const sub = await store.subscription(company.id);
      const paid = Number(o.amount_paid ?? 0);
      if (sub?.founding && paid > 0 && String(get(o, "subscription") ?? get(o, "parent.subscription_details.subscription") ?? "") === sub.stripeSubscriptionId) {
        // A paid founding period confirms the place for good.
        await store.withFoundingLock(async () => {
          for (const p of await store.foundingPlaces()) if (p.companyId === company.id && p.state === "held") await store.saveFoundingPlace({ ...p, state: "confirmed" });
          const places = await store.foundingPlaces();
          if (!places.some((p) => p.companyId === company.id && p.state === "confirmed")) await store.saveFoundingPlace({ companyId: company.id, state: "confirmed", heldUntil: 0 });
        });
        await store.saveSubscription({ ...sub, founding: { paidPeriods: sub.founding.paidPeriods + 1 } });
      }
      return "applied";
    }
    case "invoice.payment_failed":
      // Access follows the subscription status Stripe sends next (past_due); nothing to grant here.
      return company ? "applied" : "unknown_company";
    case "checkout.session.expired": {
      const companyId = String(get(o, "metadata.company_id") ?? "");
      const c = companyId ? await store.company(companyId) : null;
      if (c && c.stripeCustomerId === customer) await releaseFoundingHold(store, c.id);
      return "applied";
    }
    case "charge.dispute.created":
    case "radar.early_fraud_warning.created":
      if (!company) return "unknown_company";
      await store.saveCompany({ ...company, billingHold: ev.type === "charge.dispute.created" ? "A payment is disputed." : "A payment was flagged for review." });
      return "applied";
    case "charge.dispute.closed":
      if (!company) return "unknown_company";
      if (get(o, "status") === "won") await store.saveCompany({ ...company, billingHold: null });
      return "applied";
    case "charge.refunded":
      return "applied";
    default:
      return "ignored";
  }
}

/* ---------- access ---------- */

export type Mode = "none" | "trial" | "paid" | "grace" | "readonly";

export interface Access {
  mode: Mode;
  plan: PlanKey | null;
  features: FeatureKey[];
  /** May create jobs and run paid features. Viewing and export are always allowed. */
  canCreate: boolean;
  activeJobLimit: number | null;
  estimators: number;
  trialEndsAt: number | null;
  images: { allowance: number; window: string; resetsAt: number | null };
  notice: string | null;
}

/** The monthly usage window, so annual plans get a fresh allowance each month rather than all at once. */
export function usageWindow(anchor: number, now: number): { key: string; start: number; end: number } {
  const a = new Date(anchor);
  const n = new Date(now);
  let months = (n.getUTCFullYear() - a.getUTCFullYear()) * 12 + (n.getUTCMonth() - a.getUTCMonth());
  const at = (m: number) => {
    const d = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + m, 1, a.getUTCHours(), a.getUTCMinutes()));
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(a.getUTCDate(), last));
    return d.getTime();
  };
  if (at(months) > now) months--;
  return { key: `m${months}`, start: at(months), end: at(months + 1) };
}

export function access(company: Company, sub: Subscription | null, now: number): Access {
  const base = { estimators: 0, activeJobLimit: null, trialEndsAt: null, images: { allowance: 0, window: "none", resetsAt: null }, notice: null };
  const live = sub && ["active", "trialing", "past_due"].includes(sub.status);
  if (sub && live) {
    const p = PLANS[sub.plan];
    const w = usageWindow(sub.periodStart, now);
    const hold = company.billingHold;
    const grace = sub.status === "past_due";
    return {
      ...base,
      mode: hold ? "readonly" : grace ? "grace" : "paid",
      plan: sub.plan,
      features: p.features,
      canCreate: !hold,
      estimators: p.estimators,
      images: { allowance: p.images, window: `${sub.stripeSubscriptionId}:${w.key}`, resetsAt: w.end },
      notice: hold ? `${hold} Creating new work is paused until it is resolved. Viewing and export still work.` : grace ? "Your last payment failed. Update your payment method to keep creating work." : null,
    };
  }
  if (company.trialStartedAt) {
    const ends = company.trialStartedAt + TRIAL.days * DAY;
    if (now < ends) {
      return { ...base, mode: "trial", plan: TRIAL.plan, features: PLANS[TRIAL.plan].features, canCreate: true, activeJobLimit: TRIAL.activeJobs, estimators: 1, trialEndsAt: ends, images: { allowance: TRIAL.images, window: "trial", resetsAt: null }, notice: null };
    }
    return { ...base, mode: "readonly", plan: null, features: ["export"], canCreate: false, trialEndsAt: ends, notice: "Your trial has ended. Your work is still here to view and export. Choose a plan to keep creating." };
  }
  if (sub) return { ...base, mode: "readonly", plan: null, features: ["export"], canCreate: false, notice: "Your subscription has ended. Your work is still here to view and export." };
  return { ...base, mode: "none", plan: null, features: [], canCreate: false };
}

export async function startTrial(store: Store, companyId: string, now: number): Promise<{ ok: boolean; reason?: string }> {
  const c = await store.company(companyId);
  if (!c) return { ok: false, reason: "No company." };
  if (c.trialStartedAt) return { ok: false, reason: "This company has already had its trial." };
  if (await store.subscription(companyId)) return { ok: false, reason: "This company already has a subscription." };
  await store.saveCompany({ ...c, trialStartedAt: now });
  return { ok: true };
}

/* ---------- metered images ---------- */

/**
 * Reserve allowance before generating, confirm on success, refund on failure.
 * The idempotency key makes a retried request count once, and the store's
 * atomic reserve stops parallel requests from going over the limit.
 */
export async function reserveImages(store: Store, companyId: string, a: Access, key: string, units: number): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!a.canCreate) return { ok: false, reason: "Creating new work is not available on this account right now." };
  const existing = await store.usageEntry(key);
  if (existing) return existing.state === "refunded" ? { ok: false, reason: "That request already failed. Start a new one." } : { ok: true };
  const ok = await store.reserveUsage({ key, companyId, window: a.images.window, units, state: "pending" }, a.images.allowance);
  return ok ? { ok: true } : { ok: false, reason: `This needs ${units} ${units === 1 ? "image" : "images"} and your allowance for this period is used up.` };
}
export const confirmImages = (store: Store, key: string) => store.setUsageState(key, "used");
export const refundImages = (store: Store, key: string) => store.setUsageState(key, "refunded");

export async function imagesUsed(store: Store, companyId: string, window: string) {
  return (await store.usage(companyId, window)).filter((e) => e.state !== "refunded").reduce((n, e) => n + e.units, 0);
}

/* ---------- explaining a change before it happens ---------- */

export interface ChangePlan {
  kind: "upgrade" | "downgrade" | "cadence_up" | "cadence_down" | "same" | "cancel" | "reactivate";
  when: "now" | "period_end";
  summary: string;
  foundingWarning: string | null;
}

const rank: Record<PlanKey, number> = { starter: 0, pro: 1, team: 2 };

export function describeChange(sub: Subscription, to: { plan: PlanKey; cadence: Cadence } | "cancel" | "reactivate"): ChangePlan {
  const end = new Date(sub.periodEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const leavingFounding = sub.founding && sub.founding.paidPeriods < FOUNDING.periods ? "This ends your founding contractor price for good. It cannot be applied again." : null;
  if (to === "cancel")
    return { kind: "cancel", when: "period_end", summary: `Your plan stays active until ${end}. After that you can still view and export your work, but not create new work.`, foundingWarning: leavingFounding };
  if (to === "reactivate") return { kind: "reactivate", when: "now", summary: `Your plan will renew on ${end} as usual. Nothing is charged today.`, foundingWarning: null };
  if (to.plan === sub.plan && to.cadence === sub.cadence) return { kind: "same", when: "now", summary: "That is your current plan.", foundingWarning: null };
  const up = rank[to.plan] > rank[sub.plan];
  const down = rank[to.plan] < rank[sub.plan];
  const name = PLANS[to.plan].name;
  if (up) return { kind: "upgrade", when: "now", summary: `${name} starts as soon as payment for the prorated difference goes through. You will see the exact amount before confirming.`, foundingWarning: leavingFounding };
  if (down) return { kind: "downgrade", when: "period_end", summary: `You keep ${PLANS[sub.plan].name} until ${end}, then move to ${name}. Nothing is deleted; anything over the new limits becomes view only.`, foundingWarning: leavingFounding };
  if (to.cadence === "annual") return { kind: "cadence_up", when: "now", summary: `Annual billing starts today. You are charged the annual price minus credit for the unused part of this month.`, foundingWarning: leavingFounding };
  return { kind: "cadence_down", when: "period_end", summary: `Your annual plan runs until ${end}, then switches to monthly billing.`, foundingWarning: null };
}
