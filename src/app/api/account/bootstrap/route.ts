import { defaultSettings } from "@/lib/settings";
import { session } from "@/server/accounts";
import { jsonError, ProviderError } from "@/server/http";
import { adminDb } from "@/server/supabase";

/**
 * First sign in: make the company, make this person its owner, and save the
 * profile and price book they already set up in this browser.
 */
export async function POST(req: Request) {
  try {
    const s = await session();
    if (!s) throw new ProviderError("Sign in first.", 401, "signed_out");
    if (s.company) return Response.json({ company: s.company, created: false });
    const body = (await req.json().catch(() => ({}))) as { profile?: Record<string, unknown>; pricing?: Record<string, unknown> };
    const d = defaultSettings();
    const raw = typeof body.profile?.company === "string" ? body.profile.company.trim() : "";
    const name = (raw && raw !== d.profile.company ? raw : (s.email?.split("@")[0] ?? "My company")).slice(0, 120);
    const db = adminDb();
    const c = await db.from("companies").insert({ name }).select("id, name").single();
    if (c.error) throw new Error(c.error.message);
    const m = await db.from("memberships").insert({ company_id: c.data.id, user_id: s.userId, role: "owner" });
    if (m.error) throw new Error(m.error.message);
    await db.from("settings").insert({ company_id: c.data.id, profile: body.profile ?? d.profile, pricing: body.pricing ?? d.pricing });
    return Response.json({ company: c.data, created: true });
  } catch (e) {
    return jsonError(e);
  }
}
