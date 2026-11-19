import { describeChange } from "@/lib/billing/core";
import { FOUNDING, PLANS, sellable, type Cadence, type PlanKey } from "@/lib/billing/plans";
import { canManageBilling, session } from "@/server/accounts";
import { dbStore, recordEvent } from "@/server/billingStore";
import { jsonError, ProviderError } from "@/server/http";
import { getSubscription, previewSwitch, setCancelAtPeriodEnd, stripeConfig, stripeReady, switchAtPeriodEnd, switchNow } from "@/server/stripe";

/**
 * Plan changes. "preview" explains what happens and what it costs, "confirm"
 * does it. Upgrades apply now and only once the prorated charge is paid;
 * downgrades, annual to monthly and cancellation wait for the period end.
 */
export async function POST(req: Request) {
  try {
    if (!stripeReady().ok) throw new ProviderError("Billing is not set up.", 501, "not_ready");
    const s = await session();
    if (!s?.company) throw new ProviderError("Sign in first.", 401, "signed_out");
    if (!canManageBilling(s)) throw new ProviderError("Only the owner or a billing admin can change billing.", 403, "forbidden");
    const body = (await req.json().catch(() => ({}))) as { step?: "preview" | "confirm"; to?: { plan: PlanKey; cadence: Cadence } | "cancel" | "reactivate"; nonce?: string };
    const store = dbStore();
    const company = (await store.company(s.company.id))!;
    const sub = await store.subscription(company.id);
    if (!sub || !company.stripeCustomerId) throw new ProviderError("There is no plan to change.", 404, "no_plan");
    const to = body.to;
    if (!to) throw new ProviderError("Say what to change to.", 400, "bad_request");
    if (typeof to === "object" && (!PLANS[to.plan] || !sellable(to.plan, true).ok)) throw new ProviderError("That plan is not on sale yet.", 409, "not_sellable");

    const plan = describeChange(sub, to);
    const leavingFounding = !!plan.foundingWarning;
    const price = typeof to === "object" ? stripeConfig().prices[to.plan][to.cadence] : null;
    const next = typeof to === "object" ? (to.cadence === "annual" ? PLANS[to.plan].annual : PLANS[to.plan].monthly) : null;

    if (body.step !== "confirm") {
      let dueNow = 0;
      if (plan.when === "now" && price) dueNow = (await previewSwitch(company.stripeCustomerId, await getSubscription(sub.stripeSubscriptionId), price, leavingFounding)).dueNow;
      return Response.json({
        ...plan,
        dueNow,
        nextAmount: to === "cancel" ? null : to === "reactivate" ? (sub.founding && sub.founding.paidPeriods < FOUNDING.periods ? FOUNDING.price : sub.cadence === "annual" ? PLANS[sub.plan].annual : PLANS[sub.plan].monthly) : next,
        effective: plan.when === "now" ? Date.now() : sub.periodEnd,
        taxNote: "Plus any sales tax, shown on the invoice.",
      });
    }

    const live = await getSubscription(sub.stripeSubscriptionId);
    if (to === "cancel") {
      await setCancelAtPeriodEnd(live, true);
      await recordEvent("cancellation", company.id, sub.plan, sub.cadence).catch(() => undefined);
      return Response.json({ ok: true, message: `Cancelled. Your plan stays active until ${new Date(sub.periodEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.` });
    }
    if (to === "reactivate") {
      await setCancelAtPeriodEnd(live, false);
      return Response.json({ ok: true, message: "Your plan will renew as usual." });
    }
    if (plan.kind === "same") return Response.json({ ok: true, message: "That is already your plan." });
    if (plan.when === "now") {
      const r = await switchNow(live, price!, leavingFounding, `change:${company.id}:${to.plan}:${to.cadence}:${body.nonce ?? ""}`);
      return Response.json({ ok: !r.pending, message: r.pending ? "The payment did not go through, so nothing changed. Update your payment method and try again." : `Switched to ${PLANS[to.plan].name}.` });
    }
    await switchAtPeriodEnd(live, price!, sub.founding && !leavingFounding ? stripeConfig().foundingCoupon : null);
    return Response.json({ ok: true, message: `You move to ${PLANS[to.plan].name} on ${new Date(sub.periodEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.` });
  } catch (e) {
    return jsonError(e);
  }
}
