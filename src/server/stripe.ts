import { createHmac, timingSafeEqual } from "node:crypto";
import type { PriceMap } from "@/lib/billing/core";
import type { Cadence, PlanKey } from "@/lib/billing/plans";

/**
 * Stripe Billing over its REST API. Keys and Price ids live only on the
 * server; the browser sends a plan and cadence, never a price or amount.
 */

const env = (k: string) => process.env[k]?.trim() ?? "";

export const stripeConfig = () => ({
  secret: env("STRIPE_SECRET_KEY"),
  webhookSecret: env("STRIPE_WEBHOOK_SECRET"),
  foundingCoupon: env("STRIPE_FOUNDING_COUPON") || null,
  prices: {
    starter: { monthly: env("STRIPE_PRICE_STARTER_MONTHLY"), annual: env("STRIPE_PRICE_STARTER_ANNUAL") },
    pro: { monthly: env("STRIPE_PRICE_PRO_MONTHLY"), annual: env("STRIPE_PRICE_PRO_ANNUAL") },
    team: { monthly: env("STRIPE_PRICE_TEAM_MONTHLY"), annual: env("STRIPE_PRICE_TEAM_ANNUAL") },
  } as Record<PlanKey, Record<Cadence, string>>,
});

/** Approved Price ids mapped back to plans, for reading webhook events. */
export function priceMap(): PriceMap {
  const out: PriceMap = {};
  for (const [plan, c] of Object.entries(stripeConfig().prices) as [PlanKey, Record<Cadence, string>][])
    for (const [cadence, id] of Object.entries(c) as [Cadence, string][]) if (id) out[id] = { plan, cadence };
  return out;
}

/** Sandbox keys only until the flow has been reviewed. */
export function stripeReady(): { ok: boolean; why?: string } {
  const c = stripeConfig();
  if (!c.secret || !c.webhookSecret) return { ok: false, why: "Stripe keys are not set." };
  if (!c.secret.startsWith("sk_test_") && !c.secret.startsWith("rk_test_") && process.env.STRIPE_ALLOW_LIVE !== "1") return { ok: false, why: "Only Stripe sandbox keys are allowed until billing has been reviewed." };
  if (!c.prices.starter.monthly || !c.prices.pro.monthly) return { ok: false, why: "Stripe Price ids are not set." };
  return { ok: true };
}

/** Verify a Stripe-Signature header: HMAC SHA256 of "timestamp.payload", within five minutes. */
export function verifyStripeSignature(payload: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("=", 2) as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(t) || !sigs.length || Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${payload}`, "utf8").digest("hex"), "utf8");
  return sigs.some((s) => {
    const got = Buffer.from(s, "utf8");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

function form(obj: Record<string, unknown>, prefix = "", out = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") form(v as Record<string, unknown>, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export async function stripe<T>(method: "GET" | "POST" | "DELETE", path: string, body?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
  const { secret } = stripeConfig();
  const r = await fetch(`https://api.stripe.com/v1/${path}${method !== "POST" && body ? `?${form(body)}` : ""}`, {
    method,
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: method === "POST" && body ? form(body).toString() : undefined,
  });
  const j = (await r.json()) as T & { error?: { message?: string } };
  if (!r.ok) throw new Error(j.error?.message ?? `Stripe answered ${r.status}`);
  return j;
}

/**
 * Checkout for one company. The idempotency key ties repeated clicks to one
 * session; the founding coupon is attached here on the server, never by the
 * browser. No Stripe trial is used, so every discounted month is a paid one.
 */
export function createCheckout(o: { companyId: string; customerId: string; plan: PlanKey; cadence: Cadence; founding: boolean; origin: string; attempt: string }) {
  const c = stripeConfig();
  const price = c.prices[o.plan][o.cadence];
  if (!price) throw new Error("That plan is not on sale yet.");
  return stripe<{ id: string; url: string }>(
    "POST",
    "checkout/sessions",
    {
      mode: "subscription",
      customer: o.customerId,
      client_reference_id: o.companyId,
      line_items: { 0: { price, quantity: 1 } },
      ...(o.founding && c.foundingCoupon ? { discounts: { 0: { coupon: c.foundingCoupon } } } : { allow_promotion_codes: "false" }),
      // Turn on with STRIPE_AUTOMATIC_TAX=1 once Stripe Tax has an origin address; Checkout then shows tax before payment.
      ...(process.env.STRIPE_AUTOMATIC_TAX === "1" ? { automatic_tax: { enabled: "true" }, customer_update: { address: "auto", name: "auto" }, tax_id_collection: { enabled: "true" } } : {}),
      subscription_data: { metadata: { company_id: o.companyId, founding: o.founding ? "1" : "0" } },
      metadata: { company_id: o.companyId },
      expires_at: Math.floor(Date.now() / 1000) + 45 * 60,
      success_url: `${o.origin}/account?checkout=done`,
      cancel_url: `${o.origin}/pricing?checkout=cancelled`,
    },
    `checkout:${o.companyId}:${o.plan}:${o.cadence}:${o.founding ? "f" : "s"}:${o.attempt}`,
  );
}

export const createPortal = (customerId: string, origin: string) =>
  stripe<{ url: string }>("POST", "billing_portal/sessions", { customer: customerId, return_url: `${origin}/account` });

/** One Stripe customer per company, created once and stored. */
export function createCustomer(companyId: string, email: string | null, name: string) {
  return stripe<{ id: string }>("POST", "customers", { email: email ?? undefined, name, metadata: { company_id: companyId } }, `customer:${companyId}`);
}

type StripeSub = { id: string; schedule: string | null; items: { data: { id: string; price: { id: string; unit_amount: number } }[] }; discounts?: unknown[] };

export const getSubscription = (id: string) => stripe<StripeSub>("GET", `subscriptions/${id}`);

/** What switching now would charge today, from Stripe's own proration. */
export async function previewSwitch(customer: string, sub: StripeSub, price: string, dropDiscount: boolean) {
  const inv = await stripe<{ amount_due: number; total_tax_amounts?: { amount: number }[]; total_taxes?: { amount: number }[] }>("POST", "invoices/create_preview", {
    customer,
    subscription: sub.id,
    subscription_details: {
      items: { 0: { id: sub.items.data[0].id, price } },
      proration_behavior: "always_invoice",
      ...(dropDiscount ? { discounts: "" } : {}),
    },
  });
  return { dueNow: inv.amount_due / 100 };
}

/** Upgrades and monthly to annual: switch now, charge the prorated difference, and only apply if it is paid. */
export async function switchNow(sub: StripeSub, price: string, dropDiscount: boolean, key: string) {
  if (sub.schedule) await stripe("POST", `subscription_schedules/${sub.schedule}/release`, {});
  const out = await stripe<{ id: string; pending_update: unknown | null }>(
    "POST",
    `subscriptions/${sub.id}`,
    { items: { 0: { id: sub.items.data[0].id, price } }, proration_behavior: "always_invoice", payment_behavior: "pending_if_incomplete" },
    key,
  );
  if (dropDiscount && !out.pending_update) await stripe("DELETE", `subscriptions/${sub.id}/discount`).catch(() => undefined);
  return { pending: !!out.pending_update };
}

/** Downgrades and annual to monthly: keep the current plan until the period ends, then switch. */
export async function switchAtPeriodEnd(sub: StripeSub, price: string, keepCoupon: string | null) {
  const sched = sub.schedule
    ? await stripe<{ id: string; phases: { start_date: number; end_date: number }[] }>("GET", `subscription_schedules/${sub.schedule}`)
    : await stripe<{ id: string; phases: { start_date: number; end_date: number }[] }>("POST", "subscription_schedules", { from_subscription: sub.id });
  const now = sched.phases[0];
  await stripe("POST", `subscription_schedules/${sched.id}`, {
    end_behavior: "release",
    phases: {
      0: { items: { 0: { price: sub.items.data[0].price.id } }, start_date: now.start_date, end_date: now.end_date, ...(keepCoupon ? { discounts: { 0: { coupon: keepCoupon } } } : {}) },
      1: { items: { 0: { price } }, iterations: 1 },
    },
  });
}

export const setCancelAtPeriodEnd = async (sub: StripeSub, on: boolean) => {
  if (sub.schedule) await stripe("POST", `subscription_schedules/${sub.schedule}/release`, {});
  return stripe("POST", `subscriptions/${sub.id}`, { cancel_at_period_end: on ? "true" : "false" });
};
