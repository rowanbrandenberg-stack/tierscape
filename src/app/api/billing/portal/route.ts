import { canManageBilling, session } from "@/server/accounts";
import { dbStore } from "@/server/billingStore";
import { jsonError, ProviderError } from "@/server/http";
import { createPortal, stripeReady } from "@/server/stripe";

/** Stripe's Customer Portal for payment methods, invoices and receipts. Owners and billing admins only. */
export async function POST(req: Request) {
  try {
    if (!stripeReady().ok) throw new ProviderError("Billing is not set up.", 501, "not_ready");
    const s = await session();
    if (!s?.company) throw new ProviderError("Sign in first.", 401, "signed_out");
    if (!canManageBilling(s)) throw new ProviderError("Only the owner or a billing admin can manage billing.", 403, "forbidden");
    const c = await dbStore().company(s.company.id);
    if (!c?.stripeCustomerId) throw new ProviderError("There is no billing history yet.", 404, "no_customer");
    const { url } = await createPortal(c.stripeCustomerId, new URL(req.url).origin);
    return Response.json({ url });
  } catch (e) {
    return jsonError(e);
  }
}
