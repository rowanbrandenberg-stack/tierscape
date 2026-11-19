import { handleStripeEvent, type StripeEvent } from "@/lib/billing/core";
import { accountsReady } from "@/server/accounts";
import { dbStore, recordEvent } from "@/server/billingStore";
import { priceMap, stripeConfig, verifyStripeSignature } from "@/server/stripe";

/**
 * Stripe webhooks. The raw body is verified against the signing secret before
 * anything is read; each event applies once; access comes only from here.
 */
export async function POST(req: Request) {
  const body = await req.text();
  const { webhookSecret, foundingCoupon } = stripeConfig();
  if (!verifyStripeSignature(body, req.headers.get("stripe-signature"), webhookSecret)) return new Response("Bad signature", { status: 400 });
  if (!accountsReady().ok) return new Response("Not ready to record billing events yet", { status: 503 });
  const ev = JSON.parse(body) as StripeEvent;
  try {
    const store = dbStore();
    const result = await handleStripeEvent(store, ev, priceMap(), foundingCoupon);
    if (result === "applied" && ev.type === "invoice.paid" && ev.data.object.billing_reason === "subscription_create" && Number(ev.data.object.amount_paid ?? 0) > 0) {
      const c = await store.companyByCustomer(String(ev.data.object.customer));
      const sub = c ? await store.subscription(c.id) : null;
      await recordEvent("paid_conversion", c?.id ?? null, sub?.founding ? "founding" : sub?.plan ?? null, sub?.cadence ?? null).catch(() => undefined);
    }
    return Response.json({ received: true, result });
  } catch (e) {
    // Let Stripe retry: the event id was claimed, so release it first.
    await import("@/server/supabase").then(({ adminDb }) => adminDb().from("billing_events").delete().eq("id", ev.id)).catch(() => undefined);
    console.error("webhook failed", ev.type, e instanceof Error ? e.message : e);
    return new Response("Failed, retry later", { status: 500 });
  }
}
