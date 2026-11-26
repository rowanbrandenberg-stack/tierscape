import { canStart, type PayKind, type PaymentRow } from "@/lib/payments";
import { usdCents } from "@/lib/proposal";
import type { TierKey } from "@/lib/types";
import { accountsReady } from "./accounts";
import { createPaymentCheckout, expireSession, feeFor, paymentsState } from "./connect";
import { ProviderError } from "./http";
import { fromPayDb, paymentsFor, resolveShare, toPayDb, type Shared } from "./proposals";
import { adminDb } from "./supabase";

/**
 * What a homeowner can do with a share link: read, accept one option of the
 * exact version shown, ask for changes, and pay what the signed agreement
 * says is due. No account, and nothing the browser sends sets a price.
 */

export async function shared(token: string): Promise<Shared> {
  if (!accountsReady().ok) throw new ProviderError("Online proposals are not available on this server yet.", 501, "not_ready");
  const sh = await resolveShare(token);
  if (!sh) throw new ProviderError("This link is not active. Ask your contractor for a current link.", 404, "not_found");
  return sh;
}

const clean = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export async function accept(token: string, body: Record<string, unknown>, userAgent: string | null) {
  const sh = await shared(token);
  if (sh.acceptance) throw new ProviderError("This proposal has already been accepted.", 409, "already_accepted");
  const p = sh.proposal;
  if (body.proposalId !== p.id || body.hash !== p.snapshot_hash || p.status !== "published")
    throw new ProviderError("This proposal was updated after you opened it. Review the current version before accepting.", 409, "stale_version");
  if (new Date(p.expires_at).getTime() < Date.now()) throw new ProviderError(`These prices expired. Contact ${p.snapshot.company.company} for a current proposal.`, 409, "expired");
  if (body.agree !== true) throw new ProviderError("Tick the box to agree to the terms.", 400, "bad_request");
  const name = clean(body.name, 120);
  if (name.length < 2) throw new ProviderError("Type your full name to sign.", 400, "bad_request");
  const email = clean(body.email, 254).toLowerCase();
  if (email && !EMAIL.test(email)) throw new ProviderError("That email address does not look right.", 400, "bad_request");
  const option = p.snapshot.options.find((o) => o.tier === (body.tier as TierKey));
  if (!option || !(option.priceCents > 0)) throw new ProviderError("Pick one of the options.", 400, "bad_request");
  const db = adminDb();
  const ins = await db
    .from("acceptances")
    .insert({
      company_id: sh.companyId,
      job_id: sh.jobId,
      proposal_id: p.id,
      snapshot_hash: p.snapshot_hash,
      tier: option.tier,
      option_snapshot: option,
      signer_name: name,
      signer_email: email || null,
      total_cents: option.priceCents,
      deposit_cents: option.depositCents,
      balance_cents: option.balanceCents,
      currency: p.snapshot.currency,
      // With no deposit, the whole price is the balance and is due on completion.
      balance_requested_at: null,
      user_agent: userAgent?.slice(0, 300) ?? null,
    })
    .select("id")
    .single();
  if (ins.error?.code === "23505") throw new ProviderError("This proposal has already been accepted.", 409, "already_accepted");
  // The database refuses an acceptance of a version that is no longer current (see the acceptances trigger).
  if (ins.error && /no longer current|expired/i.test(ins.error.message)) throw new ProviderError("This proposal was updated after you opened it. Review the current version before accepting.", 409, "stale_version");
  if (ins.error) throw new Error(ins.error.message);
  const up = await db.from("proposals").update({ status: "accepted" }).eq("id", p.id).eq("status", "published");
  if (up.error) throw new Error(up.error.message);
  return { ok: true };
}

export async function requestChanges(token: string, body: Record<string, unknown>) {
  const sh = await shared(token);
  const message = clean(body.message, 2000);
  if (message.length < 3) throw new ProviderError("Write what you would like changed.", 400, "bad_request");
  const db = adminDb();
  const open = await db.from("change_requests").select("id", { count: "exact", head: true }).eq("proposal_id", sh.proposal.id).eq("status", "open");
  if ((open.count ?? 0) >= 20) throw new ProviderError("Your contractor has your requests. Call them to talk it through.", 429, "too_many");
  const r = await db.from("change_requests").insert({ company_id: sh.companyId, job_id: sh.jobId, proposal_id: sh.proposal.id, name: clean(body.name, 120) || null, message });
  if (r.error) throw new Error(r.error.message);
  return { ok: true };
}

/**
 * Start (or resume) Checkout for the deposit or the balance. The amount and
 * destination come from the stored agreement and the contractor's connected
 * account. A repeated click gets the same open session.
 */
export async function startPayment(token: string, kind: PayKind, origin: string) {
  const sh = await shared(token);
  const acc = sh.acceptance;
  if (!acc) throw new ProviderError("Accept an option first.", 409, "not_accepted");
  const amounts = { totalCents: acc.total_cents, depositCents: acc.deposit_cents, balanceCents: acc.balance_cents, balanceRequested: !!acc.balance_requested_at };
  const db = adminDb();
  let pays = await paymentsFor(acc.id);

  // What is owed comes first: an open session is never reused once the amount is paid or processing.
  const ok = canStart(kind, amounts, pays);
  if (!ok.ok) throw new ProviderError(ok.reason, 409, "not_due");

  // An open session that is still good: send them back to it.
  const live = pays.find((p) => p.kind === kind && p.status === "open");
  if (live?.sessionUrl && (live.sessionExpiresAt ?? 0) > Date.now() + 2 * 60_000) return { url: live.sessionUrl };
  if (live) {
    // Close it at Stripe first. If it was already paid, wait for the webhook instead of opening another.
    if (live.sessionId) {
      const closed = await expireSession(live.stripeAccount, live.sessionId).catch(() => null);
      if (closed === null) throw new ProviderError("Your last payment page could not be checked. Try again in a moment.", 503, "retry");
      if (!closed) throw new ProviderError("Your payment went through and is being confirmed. This page updates shortly.", 409, "confirming");
    }
    await db.from("payments").update({ status: "expired", session_url: null, updated_at: new Date().toISOString() }).eq("id", live.id).eq("status", "open");
    pays = await paymentsFor(acc.id);
  }

  const ps = await paymentsState(sh.companyId);
  if (!ps.ready) throw new ProviderError(`${sh.proposal.snapshot.company.company} is not set up to take online payments yet. Contact them to pay.`, 409, "payments_off");

  const amount = kind === "deposit" ? acc.deposit_cents : acc.balance_cents;
  const id = `pay_${crypto.randomUUID()}`;
  const row: PaymentRow = { id, companyId: sh.companyId, acceptanceId: acc.id, kind, amountCents: amount, currency: acc.currency, feeCents: feeFor(amount, ps.livemode), stripeAccount: ps.accountId, sessionId: null, sessionUrl: null, sessionExpiresAt: null, paymentIntentId: null, status: "open", refundedCents: 0, receiptUrl: null, lastEventAt: 0, note: null };
  const ins = await db.from("payments").insert({ ...toPayDb(row), created_at: new Date().toISOString() });
  if (ins.error?.code === "23505") {
    // Another click got there first. Give them its session once it exists.
    const other = (await db.from("payments").select("*").eq("acceptance_id", acc.id).eq("kind", kind).eq("status", "open").maybeSingle()).data;
    const url = other ? fromPayDb(other).sessionUrl : null;
    if (url) return { url };
    throw new ProviderError("Your payment is being set up. Try again in a few seconds.", 409, "in_progress");
  }
  if (ins.error) throw new Error(ins.error.message);

  try {
    const o = acc.option_snapshot;
    const cs = await createPaymentCheckout({
      account: ps.accountId,
      paymentId: id,
      acceptanceId: acc.id,
      amountCents: amount,
      feeCents: row.feeCents,
      title: `${kind === "deposit" ? "Deposit" : "Balance"} for ${o.name}${sh.proposal.snapshot.address ? `, ${sh.proposal.snapshot.address}` : ""} (${usdCents(amount)})`,
      email: acc.signer_email,
      returnBase: `${origin}/p/${token}`,
    });
    const up = await db.from("payments").update({ session_id: cs.id, session_url: cs.url, session_expires_at: new Date(cs.expires_at * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
    if (up.error) throw new Error(up.error.message);
    return { url: cs.url };
  } catch (e) {
    // Free the slot so the homeowner can try again; nothing was charged.
    await db.from("payments").update({ status: "failed", note: "Checkout could not be started.", updated_at: new Date().toISOString() }).eq("id", id);
    console.error("checkout start failed", e instanceof Error ? e.message : e);
    throw new ProviderError("Payment could not be started. Nothing was charged. Try again in a moment.", 502, "checkout_failed");
  }
}
