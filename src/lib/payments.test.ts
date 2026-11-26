import { beforeEach, describe, expect, it } from "vitest";
import { canStart, feeConfigFromEnv, handleConnectEvent, ledger, NO_FEE, platformFeeCents, type ConnectEvent, type PaymentRow, type PayStore } from "./payments";

class MemStore implements PayStore {
  events = new Set<string>();
  rows = new Map<string, PaymentRow>();
  async seenEvent(id: string) {
    return this.events.has(id);
  }
  async recordEvent(id: string) {
    this.events.add(id);
  }
  async otherPaid(p: PaymentRow) {
    return [...this.rows.values()].some((r) => r.id !== p.id && r.acceptanceId === p.acceptanceId && r.kind === p.kind && ["succeeded", "partially_refunded", "disputed", "refunded"].includes(r.status));
  }
  async paymentBySession(s: string) {
    return [...this.rows.values()].find((r) => r.sessionId === s) ?? null;
  }
  async paymentByIntent(a: string, pi: string) {
    return [...this.rows.values()].find((r) => r.stripeAccount === a && r.paymentIntentId === pi) ?? null;
  }
  async savePayment(p: PaymentRow) {
    this.rows.set(p.id, p);
  }
}

const row = (p: Partial<PaymentRow> = {}): PaymentRow => ({
  id: "pay_1",
  companyId: "co_1",
  acceptanceId: "acc_1",
  kind: "deposit",
  amountCents: 175000,
  currency: "usd",
  feeCents: 0,
  stripeAccount: "acct_A",
  sessionId: "cs_1",
  sessionUrl: "https://checkout.stripe.com/x",
  sessionExpiresAt: null,
  paymentIntentId: null,
  status: "open",
  refundedCents: 0,
  receiptUrl: null,
  lastEventAt: 0,
  note: null,
  ...p,
});

let n = 0;
const ev = (type: string, object: Record<string, unknown>, account = "acct_A", id = `evt_${n++}`): ConnectEvent => ({ id, type, created: 1000 + n, account, data: { object } });
const session = (o: Record<string, unknown> = {}) => ({ id: "cs_1", amount_total: 175000, currency: "usd", payment_status: "paid", payment_intent: "pi_1", metadata: { tierscape_payment_id: "pay_1" }, ...o });

describe("Connect webhook reconciliation", () => {
  let store: MemStore;
  beforeEach(() => {
    store = new MemStore();
    store.rows.set("pay_1", row());
  });

  it("marks paid only from a verified matching completion event", async () => {
    expect(await handleConnectEvent(store, ev("checkout.session.completed", session()))).toBe("applied");
    expect(store.rows.get("pay_1")).toMatchObject({ status: "succeeded", paymentIntentId: "pi_1" });
  });

  it("applies a replayed event once", async () => {
    const e = ev("checkout.session.completed", session(), "acct_A", "evt_same");
    expect(await handleConnectEvent(store, e)).toBe("applied");
    expect(await handleConnectEvent(store, e)).toBe("duplicate");
  });

  it("holds an async bank payment as processing until it succeeds or fails", async () => {
    await handleConnectEvent(store, ev("checkout.session.completed", session({ payment_status: "unpaid" })));
    expect(store.rows.get("pay_1")!.status).toBe("processing");
    await handleConnectEvent(store, ev("checkout.session.async_payment_failed", session()));
    expect(store.rows.get("pay_1")!.status).toBe("failed");
  });

  it("never lets a late expiry or failure undo a success", async () => {
    await handleConnectEvent(store, ev("checkout.session.completed", session()));
    expect(await handleConnectEvent(store, ev("checkout.session.expired", session()))).toBe("stale");
    expect(await handleConnectEvent(store, ev("checkout.session.async_payment_failed", session()))).toBe("stale");
    expect(store.rows.get("pay_1")!.status).toBe("succeeded");
  });

  it("flags a wrong amount, account or payment id for review instead of marking paid", async () => {
    await handleConnectEvent(store, ev("checkout.session.completed", session({ amount_total: 100 })));
    expect(store.rows.get("pay_1")).toMatchObject({ status: "mismatch" });
    store.rows.set("pay_1", row());
    expect(await handleConnectEvent(store, ev("checkout.session.completed", session(), "acct_EVIL"))).toBe("ignored");
    expect(store.rows.get("pay_1")!.status).toBe("open");
    await handleConnectEvent(store, ev("checkout.session.completed", session({ metadata: { tierscape_payment_id: "pay_other" } })));
    expect(store.rows.get("pay_1")!.status).toBe("mismatch");
  });

  it("tracks partial and full refunds, and ignores an older smaller refund event", async () => {
    await handleConnectEvent(store, ev("checkout.session.completed", session()));
    await handleConnectEvent(store, ev("charge.refunded", { payment_intent: "pi_1", amount_refunded: 50000 }));
    expect(store.rows.get("pay_1")).toMatchObject({ status: "partially_refunded", refundedCents: 50000 });
    await handleConnectEvent(store, ev("charge.refunded", { payment_intent: "pi_1", amount_refunded: 175000 }));
    await handleConnectEvent(store, ev("charge.refunded", { payment_intent: "pi_1", amount_refunded: 50000 }));
    expect(store.rows.get("pay_1")).toMatchObject({ status: "refunded", refundedCents: 175000 });
  });

  it("an expired session can be replaced, and unknown sessions are ignored", async () => {
    await handleConnectEvent(store, ev("checkout.session.expired", session()));
    expect(store.rows.get("pay_1")!.status).toBe("expired");
    expect(await handleConnectEvent(store, ev("checkout.session.completed", session({ id: "cs_unknown" })))).toBe("unknown_payment");
  });

  it("a function that dies after claiming nothing loses no event: Stripe's retry is applied", async () => {
    const save = store.savePayment.bind(store);
    store.savePayment = async () => {
      throw new Error("killed");
    };
    const e = ev("checkout.session.completed", session(), "acct_A", "evt_retry");
    await expect(handleConnectEvent(store, e)).rejects.toThrow();
    expect(store.events.has("evt_retry")).toBe(false);
    store.savePayment = save;
    expect(await handleConnectEvent(store, e)).toBe("applied");
    expect(store.rows.get("pay_1")!.status).toBe("succeeded");
  });

  it("an event saved but not yet recorded is safe to apply again", async () => {
    await handleConnectEvent(store, ev("checkout.session.completed", session(), "acct_A", "evt_x"));
    store.events.delete("evt_x");
    expect(await handleConnectEvent(store, ev("checkout.session.completed", session(), "acct_A", "evt_x"))).toBe("stale");
    expect(store.rows.get("pay_1")!.status).toBe("succeeded");
  });

  it("a second payment for an amount already paid is flagged for a refund, not counted", async () => {
    store.rows.set("pay_1", row({ status: "expired", sessionId: "cs_old" }));
    store.rows.set("pay_2", row({ id: "pay_2", sessionId: "cs_new", status: "open" }));
    await handleConnectEvent(store, ev("checkout.session.completed", session({ id: "cs_old" })));
    expect(store.rows.get("pay_1")!.status).toBe("succeeded");
    await handleConnectEvent(store, ev("checkout.session.completed", session({ id: "cs_new", metadata: { tierscape_payment_id: "pay_2" } })));
    expect(store.rows.get("pay_2")).toMatchObject({ status: "mismatch", note: expect.stringMatching(/Refund/) });
  });

  it("events out of order cannot leave a payment stuck", async () => {
    const failed: ConnectEvent = { id: "evt_f", type: "checkout.session.async_payment_failed", created: 2000, account: "acct_A", data: { object: session() } };
    const submitted: ConnectEvent = { id: "evt_s", type: "checkout.session.completed", created: 1500, account: "acct_A", data: { object: session({ payment_status: "unpaid" }) } };
    await handleConnectEvent(store, failed);
    expect(await handleConnectEvent(store, submitted)).toBe("stale");
    expect(store.rows.get("pay_1")!.status).toBe("failed");
    // A late unpaid completion never moves a failed row back to processing either.
    store.rows.set("pay_1", row({ status: "failed" }));
    expect(await handleConnectEvent(store, ev("checkout.session.completed", session({ payment_status: "unpaid" })))).toBe("stale");
  });
});

describe("what the homeowner owes", () => {
  const acc = { totalCents: 350000, depositCents: 175000, balanceCents: 175000, balanceRequested: false };

  it("deposit first, balance only once requested and the deposit is paid", () => {
    expect(canStart("deposit", acc, [])).toEqual({ ok: true });
    expect(canStart("balance", { ...acc, balanceRequested: true }, [])).toMatchObject({ ok: false, reason: /deposit first/ });
    const paid = [row({ status: "succeeded" })];
    expect(canStart("deposit", acc, paid)).toMatchObject({ ok: false, reason: /already paid/ });
    expect(canStart("balance", acc, paid)).toMatchObject({ ok: false, reason: /not asked/ });
    expect(canStart("balance", { ...acc, balanceRequested: true }, paid)).toEqual({ ok: true });
    const l = ledger({ ...acc, balanceRequested: true }, [...paid, row({ id: "p2", kind: "balance", status: "succeeded" })]);
    expect(l.outstandingCents).toBe(0);
  });

  it("blocks a second payment while one is processing or under review", () => {
    expect(canStart("deposit", acc, [row({ status: "processing" })])).toMatchObject({ ok: false });
    expect(canStart("deposit", acc, [row({ status: "mismatch" })])).toMatchObject({ ok: false });
    expect(canStart("deposit", acc, [row({ status: "expired" }), row({ id: "x", status: "failed" })])).toEqual({ ok: true });
  });

  it("bid terms: nothing at signing, the whole price as the balance", () => {
    const bid = { totalCents: 85000, depositCents: 0, balanceCents: 85000, balanceRequested: true };
    expect(canStart("deposit", bid, [])).toMatchObject({ ok: false });
    expect(canStart("balance", bid, [])).toEqual({ ok: true });
  });
});

describe("platform fee", () => {
  it("is off and zero by default", () => {
    expect(feeConfigFromEnv({})).toEqual(NO_FEE);
    expect(platformFeeCents(350000, feeConfigFromEnv({}), false)).toBe(0);
    expect(platformFeeCents(350000, feeConfigFromEnv({ PLATFORM_FEE_BPS: "100" }), false)).toBe(0);
  });

  it("applies only when enabled, never in live mode without approval, and is capped", () => {
    const cfg = feeConfigFromEnv({ PLATFORM_FEE_ENABLED: "1", PLATFORM_FEE_BPS: "100" });
    expect(platformFeeCents(350000, cfg, false)).toBe(3500);
    expect(platformFeeCents(350000, cfg, true)).toBe(0);
    expect(platformFeeCents(350000, { ...cfg, allowLive: true }, true)).toBe(3500);
    expect(feeConfigFromEnv({ PLATFORM_FEE_ENABLED: "1", PLATFORM_FEE_BPS: "99999" }).bps).toBe(1000);
    expect(platformFeeCents(50, { ...cfg, fixedCents: 100 }, false)).toBe(0);
  });
});
