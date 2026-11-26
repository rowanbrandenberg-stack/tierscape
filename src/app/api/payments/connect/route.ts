import { canManageBilling } from "@/server/accounts";
import { companyAccess } from "@/server/companyAccess";
import { connectPlatformBlockers, onboardingLink, paymentsState } from "@/server/connect";
import { jsonError, ProviderError } from "@/server/http";

export const dynamic = "force-dynamic";

/** Whether this contractor can take homeowner payments, checked live with Stripe. */
export async function GET() {
  try {
    const { s } = await companyAccess();
    return Response.json(await paymentsState(s.company.id, { refresh: true }));
  } catch (e) {
    return jsonError(e);
  }
}

/** Start or continue Stripe onboarding for the contractor's own account. Owner or billing admin only. */
export async function POST(req: Request) {
  try {
    const { s } = await companyAccess();
    if (!canManageBilling(s)) throw new ProviderError("Only the owner or a billing admin can connect a payout account.", 403, "forbidden");
    const missing = connectPlatformBlockers().filter((b) => b.code !== "connect_webhook");
    if (missing.length) throw new ProviderError(missing.map((b) => b.message).join(" "), 501, "not_ready");
    const url = await onboardingLink({ companyId: s.company.id, companyName: s.company.name, email: s.email, origin: new URL(req.url).origin });
    return Response.json({ url });
  } catch (e) {
    return jsonError(e);
  }
}
