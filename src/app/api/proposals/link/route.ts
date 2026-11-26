import { isOffice } from "@/server/accounts";
import { companyAccess } from "@/server/companyAccess";
import { jsonError, ProviderError } from "@/server/http";
import { loadJob } from "@/server/jobs";
import { revokeLinks, rotateLink } from "@/server/proposals";

/** Make a new homeowner link (the old one stops working) or turn sharing off. */
export async function POST(req: Request) {
  try {
    const { s } = await companyAccess();
    if (!isOffice(s)) throw new ProviderError("Crew accounts cannot share proposals.", 403, "forbidden");
    const { jobId, action } = (await req.json().catch(() => ({}))) as { jobId?: string; action?: string };
    if (!jobId || !(await loadJob(s.company.id, String(jobId)))) throw new ProviderError("Job not found.", 404, "not_found");
    if (action === "revoke") {
      await revokeLinks(s.company.id, String(jobId));
      return Response.json({ token: null });
    }
    if (action !== "rotate") throw new ProviderError("Say rotate or revoke.", 400, "bad_request");
    return Response.json({ token: await rotateLink(s.company.id, String(jobId)) });
  } catch (e) {
    return jsonError(e);
  }
}
