import { companyAccess } from "@/server/companyAccess";
import { jsonError } from "@/server/http";
import { saveJobRow } from "@/server/jobs";
import type { Job } from "@/lib/types";

/** Save one job. The rules live in saveJobRow so photo uploads follow the same ones. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { s, a } = await companyAccess();
    await saveJobRow(s, a, (await req.json()) as Job, id);
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
