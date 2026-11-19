import { jsonError, ProviderError } from "@/server/http";
import { accountsReady } from "@/server/accounts";
import { stripeReady } from "@/server/stripe";

/**
 * Opens the Stripe Customer Portal for an owner or billing admin of the signed in
 * company: payment method, invoices and receipts.
 */
export async function POST() {
  try {
    const a = accountsReady();
    if (!a.ok) throw new ProviderError(`Checkout opens once accounts are live. ${a.why}`, 501, "not_ready");
    const s = stripeReady();
    if (!s.ok) throw new ProviderError(s.why ?? "Billing is not set up.", 501, "not_ready");
    throw new ProviderError("Checkout is not connected yet.", 501, "not_ready");
  } catch (e) {
    return jsonError(e);
  }
}
