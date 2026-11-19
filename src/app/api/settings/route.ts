import { isOffice } from "@/server/accounts";
import { companyAccess } from "@/server/companyAccess";
import { jsonError, ProviderError } from "@/server/http";
import { adminDb } from "@/server/supabase";

/** Company profile and price book. Crew never reads or writes these. */
export async function GET() {
  try {
    const { s } = await companyAccess();
    if (!isOffice(s)) throw new ProviderError("Crew accounts do not see prices.", 403, "forbidden");
    const r = await adminDb().from("settings").select("profile, pricing, updated_at").eq("company_id", s.company.id).maybeSingle();
    return Response.json({ settings: r.data ?? null });
  } catch (e) {
    return jsonError(e);
  }
}

export async function PUT(req: Request) {
  try {
    const { s } = await companyAccess();
    if (!isOffice(s)) throw new ProviderError("Crew accounts cannot change settings.", 403, "forbidden");
    const b = (await req.json()) as { profile?: unknown; pricing?: unknown };
    if (!b.profile || !b.pricing) throw new ProviderError("Send the profile and price book.", 400, "bad_request");
    const r = await adminDb().from("settings").upsert({ company_id: s.company.id, profile: b.profile, pricing: b.pricing, updated_at: new Date().toISOString() });
    if (r.error) throw new Error(r.error.message);
    if (typeof (b.profile as { company?: unknown }).company === "string")
      await adminDb().from("companies").update({ name: String((b.profile as { company: string }).company).slice(0, 120) }).eq("id", s.company.id);
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
