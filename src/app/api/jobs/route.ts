import { jsonError } from "@/server/http";
import { companyAccess } from "@/server/companyAccess";
import { adminDb } from "@/server/supabase";

/** Every job for the signed in company. Viewing always works, on any plan or none. */
export async function GET() {
  try {
    const { s } = await companyAccess();
    const r = await adminDb().from("jobs").select("data, updated_at").eq("company_id", s.company.id).order("updated_at", { ascending: false });
    if (r.error) throw new Error(r.error.message);
    return Response.json({ jobs: (r.data ?? []).map((x) => x.data) });
  } catch (e) {
    return jsonError(e);
  }
}
