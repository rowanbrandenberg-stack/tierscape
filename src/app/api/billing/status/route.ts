import { foundingAvailability } from "@/lib/billing/core";
import { FOUNDING } from "@/lib/billing/plans";
import { accountsReady } from "@/server/accounts";
import { dbStore } from "@/server/billingStore";
import { stripeReady } from "@/server/stripe";

/** What the pricing page may offer right now. The place count comes from the database or not at all. */
export async function GET() {
  const accounts = accountsReady();
  const stripe = stripeReady();
  const f = accounts.ok ? await foundingAvailability(dbStore(), Date.now()).catch(() => null) : null;
  return Response.json({
    checkout: accounts.ok && stripe.ok,
    why: !accounts.ok ? accounts.why : !stripe.ok ? stripe.why : null,
    founding: { limit: FOUNDING.limit, remaining: f?.remaining ?? null },
  });
}
