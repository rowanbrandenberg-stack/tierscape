import { feeConfigFromEnv, platformFeeCents } from "@/lib/payments";
import { accountsReady } from "./accounts";
import { ProviderError } from "./http";
import { adminDb } from "./supabase";

/**
 * Homeowner payments go to the contractor's own Stripe account: an Accounts
 * v2 connected account with the full Stripe Dashboard, where Stripe collects
 * its fees and covers losses, paid by direct charges through Stripe Checkout
 * (Stripe's recommended setup for SaaS platforms). Tierscape never holds the
 * money. Its own subscription billing (stripe.ts) is a separate flow.
 */

const env = (k: string) => (process.env[k] ?? "").trim();
const secret = () => env("STRIPE_SECRET_KEY");
const VERSION = () => env("STRIPE_CONNECT_API_VERSION") || "2026-11-18.endive";
export const isTestKey = (k = secret()) => k.startsWith("sk_test_") || k.startsWith("rk_test_");

export interface Blocker {
  code: string;
  message: string;
}

/** Platform side setup. Each missing piece is named, nothing pretends to work. */
export function connectPlatformBlockers(): Blocker[] {
  const out: Blocker[] = [];
  if (!accountsReady().ok) out.push({ code: "accounts", message: "Accounts are not connected on this server (Supabase keys)." });
  if (!secret()) out.push({ code: "stripe_key", message: "Stripe is not set up on this server (STRIPE_SECRET_KEY)." });
  else if (!isTestKey() && env("STRIPE_ALLOW_LIVE") !== "1") out.push({ code: "stripe_live", message: "Only Stripe sandbox keys are allowed until payments have been reviewed." });
  if (!env("STRIPE_CONNECT_WEBHOOK_SECRET")) out.push({ code: "connect_webhook", message: "The Connect webhook is not set up (STRIPE_CONNECT_WEBHOOK_SECRET). Without it no payment can ever be confirmed, so payments stay off." });
  return out;
}

async function v2<T>(method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const r = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: { authorization: `Bearer ${secret()}`, "stripe-version": VERSION(), "content-type": "application/json", ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: { message?: string; code?: string } };
  if (!r.ok) {
    if (j.error?.code === "accounts_v2_access_blocked") throw new ProviderError("Accounts v2 is not enabled on the Tierscape Stripe platform yet. Turn on Connect for the platform account.", 502, "connect_not_enabled");
    throw new Error(j.error?.message ?? `Stripe answered ${r.status}`);
  }
  return j;
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

/** A v1 call made as the connected account (direct charges). */
export async function asAccount<T>(account: string, method: "GET" | "POST", path: string, body?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
  const q = method === "GET" && body ? `?${form(body)}` : "";
  const r = await fetch(`https://api.stripe.com/v1/${path}${q}`, {
    method,
    headers: { authorization: `Bearer ${secret()}`, "stripe-account": account, "content-type": "application/x-www-form-urlencoded", ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) },
    body: method === "POST" && body ? form(body).toString() : undefined,
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!r.ok) throw new Error(j.error?.message ?? `Stripe answered ${r.status}`);
  return j;
}

type V2Account = {
  id: string;
  livemode?: boolean;
  configuration?: { merchant?: { capabilities?: { card_payments?: { status?: string }; stripe_balance?: { payouts?: { status?: string } } } } };
  requirements?: { entries?: { minimum_deadline?: { status?: string } }[] };
};

export interface ConnectRow {
  company_id: string;
  stripe_account_id: string;
  livemode: boolean;
  card_payments: string;
  payouts: string;
  requirements_due: number;
  checked_at: string;
}

export async function connectRow(companyId: string): Promise<ConnectRow | null> {
  const r = await adminDb().from("connect_accounts").select("*").eq("company_id", companyId).maybeSingle();
  if (r.error) throw new Error(r.error.message);
  return (r.data as ConnectRow) ?? null;
}

/** Read the account's real capability status from Stripe and store it. */
export async function refreshConnect(companyId: string, accountId: string): Promise<ConnectRow> {
  const a = await v2<V2Account>("GET", `/v2/core/accounts/${encodeURIComponent(accountId)}?include=configuration.merchant&include=requirements`);
  const caps = a.configuration?.merchant?.capabilities;
  const row: ConnectRow = {
    company_id: companyId,
    stripe_account_id: a.id,
    livemode: !!a.livemode,
    card_payments: caps?.card_payments?.status ?? "pending",
    payouts: caps?.stripe_balance?.payouts?.status ?? "pending",
    requirements_due: (a.requirements?.entries ?? []).filter((e) => ["currently_due", "past_due"].includes(e.minimum_deadline?.status ?? "")).length,
    checked_at: new Date().toISOString(),
  };
  const up = await adminDb().from("connect_accounts").upsert(row);
  if (up.error) throw new Error(up.error.message);
  return row;
}

/** Create the contractor's account once, then a single use onboarding link. */
export async function onboardingLink(o: { companyId: string; companyName: string; email: string | null; origin: string }): Promise<string> {
  let row = await connectRow(o.companyId);
  if (!row) {
    const a = await v2<V2Account>(
      "POST",
      "/v2/core/accounts",
      {
        ...(o.email ? { contact_email: o.email } : {}),
        display_name: o.companyName.slice(0, 100),
        dashboard: "full",
        identity: { country: "us" },
        configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
        defaults: { currency: "usd", responsibilities: { fees_collector: "stripe", losses_collector: "stripe" }, locales: ["en-US"] },
        metadata: { company_id: o.companyId },
        include: ["configuration.merchant", "requirements"],
      },
      `connect-account:${o.companyId}`,
    );
    row = { company_id: o.companyId, stripe_account_id: a.id, livemode: !!a.livemode, card_payments: a.configuration?.merchant?.capabilities?.card_payments?.status ?? "pending", payouts: "pending", requirements_due: 1, checked_at: new Date().toISOString() };
    const ins = await adminDb().from("connect_accounts").upsert(row);
    if (ins.error) throw new Error(ins.error.message);
  }
  const link = await v2<{ url: string }>("POST", "/v2/core/account_links", {
    account: row.stripe_account_id,
    use_case: {
      type: "account_onboarding",
      account_onboarding: { configurations: ["merchant"], return_url: `${o.origin}/settings?payments=returned`, refresh_url: `${o.origin}/settings?payments=refresh` },
    },
  });
  return link.url;
}

export type PaymentsState =
  | { ready: true; accountId: string; livemode: boolean; feeBps: number; blockers: [] }
  | { ready: false; accountId: string | null; livemode: boolean; feeBps: number; blockers: Blocker[] };

/** Can this contractor take homeowner payments right now, and if not, exactly why. */
export async function paymentsState(companyId: string, opts: { refresh?: boolean } = {}): Promise<PaymentsState> {
  const blockers = connectPlatformBlockers();
  const fee = feeConfigFromEnv(process.env);
  const feeBps = fee.enabled ? fee.bps : 0;
  if (blockers.some((b) => b.code === "accounts" || b.code === "stripe_key")) return { ready: false, accountId: null, livemode: false, feeBps, blockers };
  let row = await connectRow(companyId);
  if (row && (opts.refresh || Date.now() - new Date(row.checked_at).getTime() > 10 * 60_000)) row = await refreshConnect(companyId, row.stripe_account_id).catch(() => row);
  if (!row) blockers.push({ code: "not_connected", message: "Connect your Stripe account to take deposits and balances online." });
  else if (row.card_payments !== "active")
    blockers.push({ code: "onboarding", message: row.card_payments === "restricted" ? "Stripe needs more information before you can take card payments. Finish setup in Stripe." : row.card_payments === "unsupported" ? "Stripe does not support card payments for this account." : "Stripe is still reviewing your account. Card payments turn on when it is approved." });
  if (row && row.livemode && !isTestKey()) blockers.push({ code: "live_review", message: "Live payments are not turned on for Tierscape yet." });
  if (blockers.length) return { ready: false, accountId: row?.stripe_account_id ?? null, livemode: !!row?.livemode, feeBps, blockers };
  return { ready: true, accountId: row!.stripe_account_id, livemode: row!.livemode, feeBps, blockers: [] };
}

export function feeFor(amountCents: number, livemode: boolean) {
  return platformFeeCents(amountCents, feeConfigFromEnv(process.env), livemode);
}

/** Checkout for one deposit or balance, as a direct charge on the contractor's account. */
export function createPaymentCheckout(o: { account: string; paymentId: string; acceptanceId: string; amountCents: number; feeCents: number; title: string; email: string | null; returnBase: string }) {
  return asAccount<{ id: string; url: string; expires_at: number }>(
    o.account,
    "POST",
    "checkout/sessions",
    {
      mode: "payment",
      client_reference_id: o.paymentId,
      line_items: { 0: { quantity: 1, price_data: { currency: "usd", unit_amount: o.amountCents, product_data: { name: o.title.slice(0, 250) } } } },
      payment_intent_data: {
        ...(o.feeCents > 0 ? { application_fee_amount: o.feeCents } : {}),
        ...(o.email ? { receipt_email: o.email } : {}),
        metadata: { tierscape_payment_id: o.paymentId, tierscape_acceptance_id: o.acceptanceId },
      },
      ...(o.email ? { customer_email: o.email } : {}),
      metadata: { tierscape_payment_id: o.paymentId, tierscape_acceptance_id: o.acceptanceId },
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
      success_url: `${o.returnBase}?payment=submitted`,
      cancel_url: `${o.returnBase}?payment=cancelled`,
    },
    `tierscape-pay:${o.paymentId}`,
  );
}

/**
 * Close a Checkout Session at Stripe before replacing it, so an old tab can
 * never pay a second time. Returns false when Stripe says it was already paid
 * or is processing, in which case no new session may be made.
 */
export async function expireSession(account: string, sessionId: string): Promise<boolean> {
  const cs = await asAccount<{ status: string; payment_status: string }>(account, "GET", `checkout/sessions/${encodeURIComponent(sessionId)}`);
  if (cs.status === "complete") return false;
  if (cs.status === "expired") return true;
  await asAccount(account, "POST", `checkout/sessions/${encodeURIComponent(sessionId)}/expire`, {});
  return true;
}
