import { startTrial } from "@/lib/billing/core";
import { canManageBilling, session } from "@/server/accounts";
import { dbStore, recordEvent } from "@/server/billingStore";
import { jsonError, ProviderError } from "@/server/http";

/** One 14 day Pro trial per company. No card, and nothing is charged when it ends. */
export async function POST() {
  try {
    const s = await session();
    if (!s?.company) throw new ProviderError("Sign in first.", 401, "signed_out");
    if (!canManageBilling(s)) throw new ProviderError("Only the owner can start the trial.", 403, "forbidden");
    const r = await startTrial(dbStore(), s.company.id, Date.now());
    if (!r.ok) throw new ProviderError(r.reason ?? "The trial could not start.", 409, "trial_used");
    await recordEvent("trial_start", s.company.id, "pro", null).catch(() => undefined);
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
