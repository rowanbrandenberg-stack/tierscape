import { beforeEach, describe, expect, it } from "vitest";
import { access, confirmImages, describeChange, foundingAvailability, handleStripeEvent, holdFoundingPlace, imagesUsed, refundImages, releaseFoundingHold, reserveImages, startTrial, usageWindow, type Subscription } from "./core";
import { memoryStore } from "./memoryStore";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 19, 12);
const prices = { price_pro_m: { plan: "pro" as const, cadence: "monthly" as const }, price_pro_y: { plan: "pro" as const, cadence: "annual" as const }, price_starter_m: { plan: "starter" as const, cadence: "monthly" as const } };

function co(store: ReturnType<typeof memoryStore>, id: string) {
  store.companies.set(id, { id, stripeCustomerId: `cus_${id}`, trialStartedAt: null, billingHold: null });
}
const subEvent = (id: string, created: number, customer: string, status: string, price = "price_pro_m", coupon: string | null = null, extra: Record<string, unknown> = {}) => ({
  id,
  type: "customer.subscription.updated",
  created,
  data: { object: { id: "sub_1", customer, status, cancel_at_period_end: false, discounts: coupon ? [{ coupon: { id: coupon } }] : [], items: { data: [{ price: { id: price }, current_period_start: T0 / 1000, current_period_end: T0 / 1000 + 30 * 86400 }] }, ...extra } },
});

describe("founding offer", () => {
  let store: ReturnType<typeof memoryStore>;
  beforeEach(() => {
    store = memoryStore();
    for (let i = 0; i < 12; i++) co(store, `c${i}`);
  });

  it("never goes over 10 places, even with checkouts racing", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => holdFoundingPlace(store, `c${i}`, T0)));
    expect(results.filter((r) => r.ok)).toHaveLength(10);
    expect((await foundingAvailability(store, T0)).remaining).toBe(0);
  });

  it("gives a repeat click the same hold, and frees abandoned holds", async () => {
    const a = await holdFoundingPlace(store, "c0", T0);
    const b = await holdFoundingPlace(store, "c0", T0 + 1000);
    expect(a).toEqual(b);
    expect((await foundingAvailability(store, T0)).taken).toBe(1);
    expect((await foundingAvailability(store, T0 + 46 * 60_000)).taken).toBe(0);
    await holdFoundingPlace(store, "c1", T0);
    await releaseFoundingHold(store, "c1");
    expect((await foundingAvailability(store, T0)).taken).toBe(1);
  });

  it("confirms on the first paid invoice, counts 12 paid periods, and allows one redemption per company", async () => {
    await holdFoundingPlace(store, "c0", T0);
    await handleStripeEvent(store, subEvent("evt_1", T0 / 1000, "cus_c0", "active", "price_pro_m", "FOUNDING"), prices, "FOUNDING");
    for (let i = 0; i < 12; i++) await handleStripeEvent(store, { id: `evt_inv_${i}`, type: "invoice.paid", created: T0 / 1000 + i, data: { object: { customer: "cus_c0", subscription: "sub_1", amount_paid: 9900 } } }, prices, "FOUNDING");
    expect((await store.subscription("c0"))!.founding!.paidPeriods).toBe(12);
    expect((await store.foundingPlaces()).filter((p) => p.state === "confirmed")).toHaveLength(1);
    expect((await holdFoundingPlace(store, "c0", T0)).ok).toBe(false);
    // a $0 invoice is not a paid period
    await handleStripeEvent(store, { id: "evt_zero", type: "invoice.paid", created: T0 / 1000 + 99, data: { object: { customer: "cus_c0", subscription: "sub_1", amount_paid: 0 } } }, prices, "FOUNDING");
    expect((await store.subscription("c0"))!.founding!.paidPeriods).toBe(12);
  });
});

describe("Stripe events", () => {
  it("applies each event once and ignores older events that arrive late", async () => {
    const store = memoryStore();
    co(store, "a");
    expect(await handleStripeEvent(store, subEvent("e1", 2000, "cus_a", "active"), prices, null)).toBe("applied");
    expect(await handleStripeEvent(store, subEvent("e1", 2000, "cus_a", "active"), prices, null)).toBe("duplicate");
    expect(await handleStripeEvent(store, subEvent("e0", 1000, "cus_a", "incomplete"), prices, null)).toBe("stale");
    expect((await store.subscription("a"))!.status).toBe("active");
  });
  it("ignores customers it does not know and prices it did not approve", async () => {
    const store = memoryStore();
    co(store, "a");
    expect(await handleStripeEvent(store, subEvent("e1", 1, "cus_someone_else", "active"), prices, null)).toBe("unknown_company");
    expect(await handleStripeEvent(store, subEvent("e2", 1, "cus_a", "active", "price_made_up"), prices, null)).toBe("ignored");
    expect(await store.subscription("a")).toBeNull();
  });
  it("pauses creation on a dispute but keeps viewing", async () => {
    const store = memoryStore();
    co(store, "a");
    await handleStripeEvent(store, subEvent("e1", 1, "cus_a", "active"), prices, null);
    await handleStripeEvent(store, { id: "d1", type: "charge.dispute.created", created: 2, data: { object: { customer: "cus_a" } } }, prices, null);
    const a = access((await store.company("a"))!, await store.subscription("a"), T0);
    expect(a.canCreate).toBe(false);
    expect(a.mode).toBe("readonly");
  });
});

describe("trial and access", () => {
  it("runs 14 days on Pro with one job, then goes read only without charging", async () => {
    const store = memoryStore();
    co(store, "a");
    expect((await startTrial(store, "a", T0)).ok).toBe(true);
    expect((await startTrial(store, "a", T0 + DAY)).ok).toBe(false);
    const c = (await store.company("a"))!;
    const during = access(c, null, T0 + 13 * DAY);
    expect([during.mode, during.plan, during.activeJobLimit, during.images.allowance]).toEqual(["trial", "pro", 1, 3]);
    const after = access(c, null, T0 + 15 * DAY);
    expect([after.mode, after.canCreate, after.features]).toEqual(["readonly", false, ["export"]]);
  });
  it("keeps creating through a failed payment, then stops when Stripe gives up", () => {
    const c = { id: "a", stripeCustomerId: "cus_a", trialStartedAt: null, billingHold: null };
    const s: Subscription = { companyId: "a", stripeSubscriptionId: "sub", plan: "pro", cadence: "monthly", status: "past_due", periodStart: T0, periodEnd: T0 + 30 * DAY, cancelAtPeriodEnd: false, founding: null, asOf: 0 };
    expect(access(c, s, T0).mode).toBe("grace");
    expect(access(c, { ...s, status: "unpaid" }, T0).canCreate).toBe(false);
  });
});

describe("image allowance", () => {
  it("counts successes once, refunds failures, and never lets parallel requests go over", async () => {
    const store = memoryStore();
    co(store, "a");
    await startTrial(store, "a", T0);
    const a = access((await store.company("a"))!, null, T0);
    const tries = await Promise.all([1, 2, 3, 4, 5].map((i) => reserveImages(store, "a", a, `k${i}`, 1)));
    expect(tries.filter((t) => t.ok)).toHaveLength(3);
    await confirmImages(store, "k1");
    await refundImages(store, "k2");
    expect(await imagesUsed(store, "a", a.images.window)).toBe(2);
    expect((await reserveImages(store, "a", a, "k1", 1)).ok).toBe(true);
    expect(await imagesUsed(store, "a", a.images.window)).toBe(2);
    expect((await reserveImages(store, "a", a, "k9", 3)).ok).toBe(false);
  });
  it("gives annual plans a fresh allowance each month", () => {
    const start = Date.UTC(2026, 0, 31);
    expect(usageWindow(start, Date.UTC(2026, 1, 15)).key).toBe("m0");
    expect(usageWindow(start, Date.UTC(2026, 1, 28, 1)).key).toBe("m1");
    expect(usageWindow(start, Date.UTC(2026, 11, 31, 1)).key).toBe("m11");
  });
});

describe("explaining changes", () => {
  const s: Subscription = { companyId: "a", stripeSubscriptionId: "sub", plan: "pro", cadence: "monthly", status: "active", periodStart: T0, periodEnd: T0 + 30 * DAY, cancelAtPeriodEnd: false, founding: { paidPeriods: 3 }, asOf: 0 };
  it("upgrades now, downgrades and cancels at period end, and warns before ending the founding price", () => {
    expect(describeChange(s, { plan: "team", cadence: "monthly" }).when).toBe("now");
    expect(describeChange(s, { plan: "starter", cadence: "monthly" }).when).toBe("period_end");
    expect(describeChange(s, "cancel").when).toBe("period_end");
    expect(describeChange(s, { plan: "pro", cadence: "annual" }).foundingWarning).toMatch(/founding/);
    expect(describeChange(s, { plan: "pro", cadence: "annual" }).kind).toBe("cadence_up");
  });
});
