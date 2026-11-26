import { isOffice } from "@/server/accounts";
import { MAX_PHOTO_BYTES, putAsset } from "@/server/assets";
import { companyAccess } from "@/server/companyAccess";
import { jsonError, ProviderError } from "@/server/http";
import { loadJob, saveJobRow } from "@/server/jobs";
import type { Job } from "@/lib/types";

export const maxDuration = 60;

/**
 * Keep the original yard photo privately with the job. The job is saved
 * first under the usual rules, so the photo always belongs to a job this
 * company owns.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { s, a } = await companyAccess();
    if (!isOffice(s)) throw new ProviderError("Crew accounts cannot add photos.", 403, "forbidden");
    const fd = await req.formData();
    const photo = fd.get("photo");
    if (!(photo instanceof File)) throw new ProviderError("Send a photo.", 400, "bad_request");
    if (photo.size > MAX_PHOTO_BYTES) throw new ProviderError("The photo is larger than 10 MB.", 413, "too_large");
    if (!(await loadJob(s.company.id, id))) {
      const raw = fd.get("job");
      if (typeof raw !== "string") throw new ProviderError("Save the job first.", 400, "bad_request");
      await saveJobRow(s, a, JSON.parse(raw) as Job, id);
    } else if (!a.canCreate) throw new ProviderError(a.notice ?? "Choose a plan to add photos.", 402, "no_plan");
    const row = await putAsset({ id: `ph_${crypto.randomUUID()}`, companyId: s.company.id, jobId: id, kind: "photo", bytes: Buffer.from(await photo.arrayBuffer()) });
    return Response.json({ photoId: row.id, bytes: row.bytes, type: row.content_type });
  } catch (e) {
    return jsonError(e);
  }
}
