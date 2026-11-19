import type { Company, FoundingPlace, Store, Subscription, UsageEntry } from "@/lib/billing/core";
import { adminDb } from "./supabase";

/**
 * The billing Store over Supabase with the service key. Only server code that
 * has already checked the session or a verified Stripe signature uses it.
 */
const ms = (t: string | null) => (t ? new Date(t).getTime() : null);
const iso = (n: number | null) => (n == null ? null : new Date(n).toISOString());

type CompanyRow = { id: string; stripe_customer_id: string | null; trial_started_at: string | null; billing_hold: string | null };
const toCompany = (r: CompanyRow): Company => ({ id: r.id, stripeCustomerId: r.stripe_customer_id, trialStartedAt: ms(r.trial_started_at), billingHold: r.billing_hold });

type SubRow = { company_id: string; stripe_subscription_id: string; plan: Subscription["plan"]; cadence: Subscription["cadence"]; status: Subscription["status"]; period_start: string; period_end: string; cancel_at_period_end: boolean; founding_paid_periods: number | null; as_of: string };
const toSub = (r: SubRow): Subscription => ({
  companyId: r.company_id,
  stripeSubscriptionId: r.stripe_subscription_id,
  plan: r.plan,
  cadence: r.cadence,
  status: r.status,
  periodStart: ms(r.period_start)!,
  periodEnd: ms(r.period_end)!,
  cancelAtPeriodEnd: r.cancel_at_period_end,
  founding: r.founding_paid_periods == null ? null : { paidPeriods: r.founding_paid_periods },
  asOf: ms(r.as_of)!,
});

function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

export function dbStore(): Store {
  const db = adminDb();
  return {
    company: async (id) => {
      const r = must(await db.from("companies").select("id, stripe_customer_id, trial_started_at, billing_hold").eq("id", id).maybeSingle());
      return r ? toCompany(r as CompanyRow) : null;
    },
    companyByCustomer: async (cid) => {
      const r = must(await db.from("companies").select("id, stripe_customer_id, trial_started_at, billing_hold").eq("stripe_customer_id", cid).maybeSingle());
      return r ? toCompany(r as CompanyRow) : null;
    },
    saveCompany: async (c) => {
      must(await db.from("companies").update({ stripe_customer_id: c.stripeCustomerId, trial_started_at: iso(c.trialStartedAt), billing_hold: c.billingHold }).eq("id", c.id));
    },
    subscription: async (id) => {
      const r = must(await db.from("subscriptions").select("*").eq("company_id", id).maybeSingle());
      return r ? toSub(r as SubRow) : null;
    },
    saveSubscription: async (s) => {
      must(
        await db.from("subscriptions").upsert({
          company_id: s.companyId,
          stripe_subscription_id: s.stripeSubscriptionId,
          plan: s.plan,
          cadence: s.cadence,
          status: s.status,
          period_start: iso(s.periodStart),
          period_end: iso(s.periodEnd),
          cancel_at_period_end: s.cancelAtPeriodEnd,
          founding_paid_periods: s.founding?.paidPeriods ?? null,
          as_of: iso(s.asOf),
          updated_at: new Date().toISOString(),
        }),
      );
    },
    claimEvent: async (id) => {
      const r = await db.from("billing_events").insert({ id, type: "stripe" });
      if (r.error?.code === "23505") return false;
      if (r.error) throw new Error(r.error.message);
      return true;
    },
    foundingPlaces: async () => {
      const rows = must(await db.from("founding_places").select("company_id, state, held_until")) as { company_id: string; state: FoundingPlace["state"]; held_until: string | null }[];
      return rows.map((r) => ({ companyId: r.company_id, state: r.state, heldUntil: ms(r.held_until) ?? 0 }));
    },
    // Holds go through the hold_founding_place function, which takes a real lock. Confirm and release are single row updates.
    withFoundingLock: (fn) => fn(),
    saveFoundingPlace: async (p) => {
      const cur = must(await db.from("founding_places").select("state").eq("company_id", p.companyId).maybeSingle()) as { state: string } | null;
      if (cur?.state === "confirmed") return;
      must(await db.from("founding_places").upsert({ company_id: p.companyId, state: p.state, held_until: iso(p.heldUntil || null), updated_at: new Date().toISOString() }));
    },
    usage: async (cid, w) => {
      const rows = must(await db.from("usage_ledger").select("key, company_id, window_key, units, state").eq("company_id", cid).eq("window_key", w)) as { key: string; company_id: string; window_key: string; units: number; state: UsageEntry["state"] }[];
      return rows.map((r) => ({ key: r.key, companyId: r.company_id, window: r.window_key, units: r.units, state: r.state }));
    },
    usageEntry: async (k) => {
      const r = must(await db.from("usage_ledger").select("key, company_id, window_key, units, state").eq("key", k).maybeSingle()) as { key: string; company_id: string; window_key: string; units: number; state: UsageEntry["state"] } | null;
      return r ? { key: r.key, companyId: r.company_id, window: r.window_key, units: r.units, state: r.state } : null;
    },
    reserveUsage: async (e, limit) => must(await db.rpc("reserve_usage", { k: e.key, cid: e.companyId, win: e.window, n: e.units, lim: limit })) as boolean,
    setUsageState: async (k, state) => {
      must(await db.from("usage_ledger").update({ state }).eq("key", k));
    },
  };
}

/** Hold a founding place through the locked database function. */
export async function holdFoundingInDb(companyId: string, limit: number, minutes: number): Promise<{ ok: boolean; until: number | null; reason: string | null }> {
  const rows = must(await adminDb().rpc("hold_founding_place", { cid: companyId, place_limit: limit, hold_minutes: minutes })) as { ok: boolean; until: string | null; reason: string | null }[];
  const r = rows[0];
  return { ok: !!r?.ok, until: ms(r?.until ?? null), reason: r?.reason ?? null };
}

/** Funnel events: names and plan choices only. */
export async function recordEvent(name: string, companyId: string | null, plan?: string | null, cadence?: string | null) {
  await adminDb().from("analytics_events").insert({ name, company_id: companyId, plan: plan ?? null, cadence: cadence ?? null });
}
