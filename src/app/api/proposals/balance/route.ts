import { isOffice } from "@/server/accounts";
import { companyAccess } from "@/server/companyAccess";
import { jsonError, ProviderError } from "@/server/http";
import { activeAcceptance } from "@/server/proposals";
import { adminDb } from "@/server/supabase";

/** The work is done: let the homeowner pay the balance from their link. */
export async function POST(req: Request) {
  try {
    const { s } = await companyAccess();
    if (!isOffice(s)) throw new ProviderError("Crew accounts cannot request payment.", 403, "forbidden");
    const { jobId } = (await req.json().catch(() => ({}))) as { jobId?: string };
    const acc = jobId ? await activeAcceptance(String(jobId)) : null;
    if (!acc || acc.company_id !== s.company.id) throw new ProviderError("This job has no accepted proposal.", 404, "not_found");
    if (acc.balance_cents <= 0) throw new ProviderError("No balance is due on this agreement.", 409, "no_balance");
    if (!acc.balance_requested_at) {
      const r = await adminDb().from("acceptances").update({ balance_requested_at: new Date().toISOString() }).eq("id", acc.id);
      if (r.error) throw new Error(r.error.message);
    }
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
