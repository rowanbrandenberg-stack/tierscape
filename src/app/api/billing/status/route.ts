import { FOUNDING } from "@/lib/billing/plans";
import { accountsReady } from "@/server/accounts";
import { stripeReady } from "@/server/stripe";

/**
 * What the pricing page may offer right now. The founding place count is
 * only sent when it comes from the database; otherwise just the limit.
 */
export async function GET() {
  const accounts = accountsReady();
  const stripe = stripeReady();
  return Response.json({
    checkout: accounts.ok && stripe.ok,
    why: !accounts.ok ? accounts.why : !stripe.ok ? stripe.why : null,
    founding: { limit: FOUNDING.limit, remaining: null as number | null },
  });
}
