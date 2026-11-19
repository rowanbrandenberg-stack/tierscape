import { accountsReady } from "@/server/accounts";
import { stripeConfig, verifyStripeSignature } from "@/server/stripe";

/**
 * Stripe webhooks. The raw body is verified against the signing secret before
 * anything is read. Until the database is connected the event is refused with
 * a retryable status, so Stripe keeps it and delivers it again later.
 */
export async function POST(req: Request) {
  const body = await req.text();
  const { webhookSecret } = stripeConfig();
  if (!verifyStripeSignature(body, req.headers.get("stripe-signature"), webhookSecret)) return new Response("Bad signature", { status: 400 });
  const db = accountsReady();
  if (!db.ok) return new Response("Not ready to record billing events yet", { status: 503 });
  // With the database connected: handleStripeEvent(supabaseStore(), JSON.parse(body), priceMap(), stripeConfig().foundingCoupon)
  return new Response("Not ready", { status: 503 });
}
