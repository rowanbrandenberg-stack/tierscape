import { access } from "@/lib/billing/core";
import { FOUNDING, PLANS, sellable, type Cadence, type PlanKey } from "@/lib/billing/plans";
import { accountsReady, canManageBilling, session } from "@/server/accounts";
import { dbStore, holdFoundingInDb, recordEvent } from "@/server/billingStore";
import { jsonError, ProviderError } from "@/server/http";
import { createCheckout, createCustomer, stripeReady } from "@/server/stripe";

/**
 * Starts Stripe Checkout for the signed in company. The company comes from the
 * session, the Price from server configuration, and the founding discount is
 * only attached after the database grants a place. The browser only names a plan.
 */
export async function POST(req: Request) {
  try {
    const a = accountsReady();
    if (!a.ok) throw new ProviderError(a.why ?? "Accounts are not live.", 501, "not_ready");
    const st = stripeReady();
    if (!st.ok) throw new ProviderError(st.why ?? "Billing is not set up.", 501, "not_ready");
    const s = await session();
    if (!s?.company) throw new ProviderError("Sign in first.", 401, "signed_out");
    if (!canManageBilling(s)) throw new ProviderError("Only the owner or a billing admin can buy a plan.", 403, "forbidden");

    const body = (await req.json().catch(() => ({}))) as { plan?: string; cadence?: string; founding?: boolean };
    const plan = body.plan as PlanKey;
    const cadence = body.cadence as Cadence;
    if (!PLANS[plan] || (cadence !== "monthly" && cadence !== "annual")) throw new ProviderError("Pick a plan.", 400, "bad_request");
    if (!sellable(plan, true).ok) throw new ProviderError(`${PLANS[plan].name} is not on sale yet.`, 409, "not_sellable");
    const founding = body.founding === true;
    if (founding && (plan !== FOUNDING.plan || cadence !== FOUNDING.cadence)) throw new ProviderError("The founding price is for monthly Pro only.", 400, "bad_request");

    const store = dbStore();
    const company = (await store.company(s.company.id))!;
    const current = await store.subscription(company.id);
    const mode = access(company, current, Date.now()).mode;
    if (current && (mode === "paid" || mode === "grace")) throw new ProviderError("This company already has a plan. Change it from your account instead.", 409, "has_plan");

    if (founding) {
      const h = await holdFoundingInDb(company.id, FOUNDING.limit, FOUNDING.holdMinutes);
      if (!h.ok) throw new ProviderError(h.reason ?? "The founding offer is not available.", 409, "founding_unavailable");
    }

    let customerId = company.stripeCustomerId;
    if (!customerId) {
      customerId = (await createCustomer(company.id, s.email, s.company.name)).id;
      await store.saveCompany({ ...company, stripeCustomerId: customerId });
    }
    const origin = new URL(req.url).origin;
    const attempt = String(Math.floor(Date.now() / (FOUNDING.holdMinutes * 60_000)));
    const session_ = await createCheckout({ companyId: company.id, customerId, plan, cadence, founding, origin, attempt });
    await recordEvent("checkout_start", company.id, founding ? "founding" : plan, cadence).catch(() => undefined);
    return Response.json({ url: session_.url });
  } catch (e) {
    return jsonError(e);
  }
}
