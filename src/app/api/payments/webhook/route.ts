import { handleConnectEvent, type ConnectEvent } from "@/lib/payments";
import { accountsReady } from "@/server/accounts";
import { asAccount } from "@/server/connect";
import { dbPayStore } from "@/server/proposals";
import { verifyStripeSignature } from "@/server/stripe";
import { adminDb } from "@/server/supabase";

/**
 * Connect webhook ("events on connected accounts"). The only thing that ever
 * marks a homeowner payment paid, failed, expired or refunded. The raw body
 * is verified with its own signing secret before anything is read.
 */
export async function POST(req: Request) {
  const body = await req.text();
  const secret = (process.env.STRIPE_CONNECT_WEBHOOK_SECRET ?? "").trim();
  if (!secret || !verifyStripeSignature(body, req.headers.get("stripe-signature"), secret)) return new Response("Bad signature", { status: 400 });
  if (!accountsReady().ok) return new Response("Not ready to record payments yet", { status: 503 });
  const ev = JSON.parse(body) as ConnectEvent;
  try {
    const result = await handleConnectEvent(dbPayStore(), ev);
    // A receipt link for the homeowner, best effort, once a payment has cleared.
    const account = ev.account;
    const pi = String(ev.data?.object?.payment_intent ?? "");
    if (result === "applied" && account && pi && (ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded")) {
      await asAccount<{ latest_charge?: { receipt_url?: string } | string }>(account, "GET", `payment_intents/${encodeURIComponent(pi)}`, { expand: { 0: "latest_charge" } })
        .then(async (x) => {
          const url = typeof x.latest_charge === "object" ? x.latest_charge?.receipt_url : undefined;
          if (url) await adminDb().from("payments").update({ receipt_url: url }).eq("stripe_account", account).eq("payment_intent_id", pi);
        })
        .catch(() => undefined);
    }
    return Response.json({ received: true, result });
  } catch (e) {
    console.error("connect webhook failed", ev.type, e instanceof Error ? e.message : e);
    return new Response("Failed, retry later", { status: 500 });
  }
}
