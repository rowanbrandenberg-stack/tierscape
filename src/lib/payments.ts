/**
 * Homeowner payments to the contractor, through the contractor's own Stripe
 * account (Connect direct charges). Separate from what contractors pay
 * Tierscape. Only verified webhook events change a payment's status: a
 * redirect back from Checkout proves nothing. Amounts always come from the
 * accepted proposal stored on the server.
 */

export type PayKind = "deposit" | "balance";
export type PayStatus = "open" | "processing" | "succeeded" | "failed" | "expired" | "refunded" | "partially_refunded" | "disputed" | "mismatch";

export interface PaymentRow {
  id: string;
  companyId: string;
  acceptanceId: string;
  kind: PayKind;
  amountCents: number;
  currency: string;
  /** Tierscape's platform fee on this payment. Zero unless a fee was deliberately configured. */
  feeCents: number;
  stripeAccount: string;
  sessionId: string | null;
  sessionUrl: string | null;
  sessionExpiresAt: number | null;
  paymentIntentId: string | null;
  status: PayStatus;
  refundedCents: number;
  receiptUrl: string | null;
  /** created time (seconds) of the last event applied, so late older events cannot undo newer ones. */
  lastEventAt: number;
  note: string | null;
}

export const SETTLED: PayStatus[] = ["succeeded", "refunded", "partially_refunded", "disputed"];
export const isPaid = (s: PayStatus) => s === "succeeded" || s === "partially_refunded" || s === "disputed";
export const isLive = (s: PayStatus) => s === "open" || s === "processing";

/* ---------- platform fee ---------- */

export interface FeeConfig {
  enabled: boolean;
  /** Basis points of the payment, 100 = 1%. */
  bps: number;
  fixedCents: number;
  /** A fee is never taken in live mode without this explicit approval. */
  allowLive: boolean;
}

export const NO_FEE: FeeConfig = { enabled: false, bps: 0, fixedCents: 0, allowLive: false };

export function feeConfigFromEnv(env: Record<string, string | undefined>): FeeConfig {
  const n = (k: string) => {
    const v = Number((env[k] ?? "").trim());
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  };
  return { enabled: (env.PLATFORM_FEE_ENABLED ?? "").trim() === "1", bps: Math.min(n("PLATFORM_FEE_BPS"), 1000), fixedCents: n("PLATFORM_FEE_FIXED_CENTS"), allowLive: (env.PLATFORM_FEE_ALLOW_LIVE ?? "").trim() === "1" };
}

/**
 * The fee Tierscape keeps from the contractor's payment, never added to what
 * the homeowner pays. Stripe's own processing fee is separate and is charged
 * to the contractor's Stripe account by Stripe.
 */
export function platformFeeCents(amountCents: number, cfg: FeeConfig, livemode: boolean): number {
  if (!cfg.enabled || (livemode && !cfg.allowLive)) return 0;
  const fee = Math.round((amountCents * cfg.bps) / 10_000) + cfg.fixedCents;
  return fee > 0 && fee < amountCents ? fee : 0;
}

/* ---------- what is owed ---------- */

export interface AcceptedAmounts {
  totalCents: number;
  depositCents: number;
  balanceCents: number;
  balanceRequested: boolean;
}

export interface LedgerLine {
  kind: PayKind;
  dueCents: number;
  status: "not_due" | "due" | "processing" | "paid" | "refunded" | "failed" | "review";
  paidCents: number;
  refundedCents: number;
}

export function ledger(a: AcceptedAmounts, payments: Pick<PaymentRow, "kind" | "status" | "amountCents" | "refundedCents">[]) {
  const line = (kind: PayKind, due: number, requested: boolean): LedgerLine => {
    const mine = payments.filter((p) => p.kind === kind);
    const paid = mine.filter((p) => isPaid(p.status) || p.status === "refunded");
    const paidCents = paid.reduce((s, p) => s + p.amountCents, 0);
    const refundedCents = paid.reduce((s, p) => s + p.refundedCents, 0);
    let status: LedgerLine["status"];
    if (due <= 0) status = "not_due";
    else if (mine.some((p) => p.status === "mismatch")) status = "review";
    else if (paid.some((p) => p.status === "refunded") && !paid.some((p) => isPaid(p.status))) status = "refunded";
    else if (paid.length) status = "paid";
    else if (mine.some((p) => p.status === "processing")) status = "processing";
    else if (!requested) status = "not_due";
    else status = mine.some((p) => p.status === "failed") ? "failed" : "due";
    return { kind, dueCents: due, status, paidCents, refundedCents };
  };
  const deposit = line("deposit", a.depositCents, true);
  const depositDone = deposit.status === "paid" || a.depositCents <= 0;
  const balance = line("balance", a.balanceCents, a.balanceRequested && depositDone);
  const paidCents = deposit.paidCents + balance.paidCents;
  const refundedCents = deposit.refundedCents + balance.refundedCents;
  return { deposit, balance, paidCents, refundedCents, outstandingCents: Math.max(0, a.totalCents - paidCents) };
}

/** May the homeowner start this payment now? */
export function canStart(kind: PayKind, a: AcceptedAmounts, payments: PaymentRow[]): { ok: true } | { ok: false; reason: string } {
  const l = ledger(a, payments);
  const x = kind === "deposit" ? l.deposit : l.balance;
  if (x.dueCents <= 0) return { ok: false, reason: kind === "deposit" ? "No deposit is due on this proposal." : "No balance is due." };
  if (x.status === "paid") return { ok: false, reason: `The ${kind} is already paid.` };
  if (x.status === "processing") return { ok: false, reason: `The ${kind} payment is still processing. You will be notified when it clears.` };
  if (x.status === "review") return { ok: false, reason: "This payment needs a look from your contractor before you pay again." };
  if (x.status === "refunded") return { ok: false, reason: `The ${kind} was refunded. Contact your contractor.` };
  if (kind === "balance" && l.deposit.dueCents > 0 && l.deposit.status !== "paid") return { ok: false, reason: "Pay the deposit first." };
  if (kind === "balance" && !a.balanceRequested) return { ok: false, reason: "Your contractor has not asked for the balance yet." };
  return { ok: true };
}

/* ---------- webhook reconciliation ---------- */

export interface ConnectEvent {
  id: string;
  type: string;
  created: number;
  account?: string;
  livemode?: boolean;
  data: { object: Record<string, unknown> };
}

export interface PayStore {
  /** True when this event id was already applied. */
  seenEvent(id: string): Promise<boolean>;
  /** Remember an applied event. Called only after the state change is saved; a repeat is harmless. */
  recordEvent(id: string): Promise<void>;
  paymentBySession(sessionId: string): Promise<PaymentRow | null>;
  paymentByIntent(account: string, paymentIntentId: string): Promise<PaymentRow | null>;
  /** Another payment of the same amount for the same agreement that already went through. */
  otherPaid(p: PaymentRow): Promise<boolean>;
  savePayment(p: PaymentRow): Promise<void>;
}

export type ConnectResult = "duplicate" | "ignored" | "unknown_payment" | "stale" | "applied" | "mismatch";

const str = (v: unknown) => (typeof v === "string" ? v : v && typeof v === "object" && "id" in v ? String((v as { id: unknown }).id) : null);

/** Does this Checkout Session really belong to this payment row, for this amount? */
function matches(p: PaymentRow, ev: ConnectEvent, o: Record<string, unknown>): string | null {
  if (!ev.account || ev.account !== p.stripeAccount) return "The event came from a different Stripe account.";
  const meta = (o.metadata ?? {}) as Record<string, unknown>;
  if (meta.tierscape_payment_id !== p.id) return "The session does not name this payment.";
  if (o.amount_total != null && Number(o.amount_total) !== p.amountCents) return `Paid ${o.amount_total} but ${p.amountCents} was due.`;
  if (o.currency != null && String(o.currency).toLowerCase() !== p.currency) return "The currency does not match.";
  return null;
}

/**
 * Apply one verified Connect event. Safe to run more than once for the same
 * event: every transition is guarded by the current status and by event
 * time, and the event id is recorded only after the change is saved, so a
 * function that dies halfway is simply retried by Stripe.
 */
export async function handleConnectEvent(store: PayStore, ev: ConnectEvent): Promise<ConnectResult> {
  if (await store.seenEvent(ev.id)) return "duplicate";
  const o = ev.data?.object ?? {};
  const t = ev.type;
  let p: PaymentRow | null = null;
  if (t.startsWith("checkout.session.")) p = await store.paymentBySession(String(o.id ?? ""));
  else if (t === "charge.refunded" || t === "charge.dispute.created" || t === "charge.dispute.closed") {
    const pi = str(o.payment_intent);
    p = pi && ev.account ? await store.paymentByIntent(ev.account, pi) : null;
  } else return "ignored";
  if (!p) return "unknown_payment";
  if (ev.account !== p.stripeAccount) return "ignored";
  const at = Number(ev.created) || 0;
  // An older event that arrives after a newer one must not undo it.
  if (at && at < p.lastEventAt) {
    await store.recordEvent(ev.id);
    return "stale";
  }

  const next: PaymentRow = { ...p };
  const done = async (r: ConnectResult) => {
    await store.recordEvent(ev.id);
    return r;
  };
  switch (t) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      if (SETTLED.includes(p.status) || p.status === "mismatch") return done("stale");
      const paid = t === "checkout.session.async_payment_succeeded" || o.payment_status === "paid";
      // A submitted bank payment only moves a session that is still open.
      if (!paid && p.status !== "open") return done("stale");
      const bad = matches(p, ev, o);
      if (bad) {
        next.status = "mismatch";
        next.note = bad;
        break;
      }
      next.paymentIntentId = str(o.payment_intent) ?? p.paymentIntentId;
      // Money arrived for an amount that is already paid (an old session paid in another tab): flag it for a refund.
      if (paid && (await store.otherPaid(p))) {
        next.status = "mismatch";
        next.note = "A second payment arrived for an amount that was already paid. Refund this one in Stripe.";
        break;
      }
      next.status = paid ? "succeeded" : "processing";
      next.note = paid ? null : "Bank payment submitted. It can take a few days to clear.";
      break;
    }
    case "checkout.session.async_payment_failed":
      if (p.status !== "processing" && p.status !== "open") return done("stale");
      next.status = "failed";
      next.note = "The bank payment failed.";
      break;
    case "checkout.session.expired":
      if (p.status !== "open") return done("stale");
      next.status = "expired";
      next.sessionUrl = null;
      break;
    case "charge.refunded": {
      if (!SETTLED.includes(p.status) && p.status !== "mismatch") return done("stale");
      const refunded = Math.min(p.amountCents, Math.max(p.refundedCents, Number(o.amount_refunded ?? 0)));
      next.refundedCents = refunded;
      if (p.status !== "mismatch") next.status = refunded >= p.amountCents ? "refunded" : refunded > 0 ? "partially_refunded" : p.status;
      else if (refunded >= p.amountCents) next.note = "Refunded in full.";
      break;
    }
    case "charge.dispute.created":
      if (!SETTLED.includes(p.status)) return done("stale");
      next.status = "disputed";
      next.note = "The homeowner's bank opened a dispute.";
      break;
    case "charge.dispute.closed":
      if (p.status !== "disputed") return done("stale");
      next.status = o.status === "lost" ? "refunded" : "succeeded";
      if (o.status === "lost") next.refundedCents = p.amountCents;
      next.note = `Dispute closed: ${String(o.status ?? "")}.`;
      break;
  }
  next.lastEventAt = Math.max(p.lastEventAt, at);
  await store.savePayment(next);
  return done(next.status === "mismatch" ? "mismatch" : "applied");
}
