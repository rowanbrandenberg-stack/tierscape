import { adminDb, userDb } from "./supabase";

/** Sign in and the company database. Every billing route checks here first. */
export function accountsReady(): { ok: boolean; why?: string } {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return { ok: false, why: "Accounts are not connected yet." };
  return { ok: true };
}

export type Role = "owner" | "billing_admin" | "estimator" | "crew";

export interface Session {
  userId: string;
  email: string | null;
  company: { id: string; name: string } | null;
  role: Role | null;
}

/** Who is asking, from the verified session cookie. Never from the request body. */
export async function session(): Promise<Session | null> {
  if (!accountsReady().ok) return null;
  const db = await userDb();
  const { data } = await db.auth.getUser();
  const user = data.user;
  if (!user) return null;
  const { data: m } = await adminDb().from("memberships").select("role, companies(id, name)").eq("user_id", user.id).limit(1).maybeSingle();
  const c = (m?.companies ?? null) as unknown as { id: string; name: string } | null;
  return { userId: user.id, email: user.email ?? null, company: c, role: (m?.role as Role) ?? null };
}

export const canManageBilling = (s: Session) => s.role === "owner" || s.role === "billing_admin";
export const isOffice = (s: Session) => !!s.role && s.role !== "crew";
