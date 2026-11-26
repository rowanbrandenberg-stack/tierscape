import { isOffice } from "@/server/accounts";
import { companyAccess } from "@/server/companyAccess";
import { jsonError, ProviderError } from "@/server/http";
import { adminDb } from "@/server/supabase";
import { publish, rotateLink } from "@/server/proposals";

/**
 * Publish the job as a new proposal version, priced on the server from the
 * stored job and price book. Makes the share link the first time.
 */
export async function POST(req: Request) {
  try {
    const { s } = await companyAccess();
    if (!isOffice(s)) throw new ProviderError("Crew accounts cannot publish proposals.", 403, "forbidden");
    const { jobId } = (await req.json().catch(() => ({}))) as { jobId?: string };
    if (!jobId) throw new ProviderError("Which job?", 400, "bad_request");
    const p = await publish(s.company.id, String(jobId), s.userId);
    const live = await adminDb().from("share_links").select("id", { count: "exact", head: true }).eq("job_id", p.job_id).is("revoked_at", null);
    const token = (live.count ?? 0) === 0 ? await rotateLink(s.company.id, p.job_id) : null;
    return Response.json({ proposal: { id: p.id, version: p.version, hash: p.snapshot_hash, createdAt: p.created_at }, token });
  } catch (e) {
    return jsonError(e);
  }
}
