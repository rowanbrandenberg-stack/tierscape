import { isOffice } from "@/server/accounts";
import { companyAccess } from "@/server/companyAccess";
import { jsonError, ProviderError } from "@/server/http";
import { adminDb } from "@/server/supabase";
import type { Job } from "@/lib/types";

/**
 * Save one job. Crew cannot write; a job id that belongs to another company is
 * refused; new jobs need an active plan or trial, and the trial allows one.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { s, a } = await companyAccess();
    if (!isOffice(s)) throw new ProviderError("Crew accounts can view jobs but not change them.", 403, "forbidden");
    const job = (await req.json()) as Job;
    if (!job || job.id !== id || job.sample) throw new ProviderError("That is not a job that can be saved.", 400, "bad_request");
    const db = adminDb();
    const existing = await db.from("jobs").select("company_id").eq("id", id).maybeSingle();
    if (existing.data && existing.data.company_id !== s.company.id) throw new ProviderError("That job belongs to another company.", 403, "forbidden");
    if (!a.canCreate) throw new ProviderError(a.notice ?? "Choose a plan or start the free trial to save work to your account.", 402, "no_plan");
    if (!existing.data && a.activeJobLimit != null) {
      const { count } = await db.from("jobs").select("id", { count: "exact", head: true }).eq("company_id", s.company.id);
      if ((count ?? 0) >= a.activeJobLimit) throw new ProviderError(`The trial includes ${a.activeJobLimit} real job. Choose a plan to add more.`, 402, "trial_limit");
    }
    const row = {
      id,
      company_id: s.company.id,
      name: String(job.name ?? "").slice(0, 200),
      address: String(job.site?.matchedAddress ?? job.site?.address ?? "").slice(0, 300),
      state: job.site?.state ?? null,
      county: job.site?.county ?? null,
      data: { ...job, photos: (job.photos ?? []).map((p) => ({ ...p, dataUrl: null })) },
      updated_at: job.updatedAt ?? new Date().toISOString(),
    };
    const r = await db.from("jobs").upsert(row);
    if (r.error) throw new Error(r.error.message);
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
