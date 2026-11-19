import { NextResponse } from "next/server";
import { userDb } from "@/server/supabase";

/** The email link lands here: swap the one time code for a session cookie, then go to the account. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const code = u.searchParams.get("code");
  const next = u.searchParams.get("next");
  const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/account";
  if (code) {
    const db = await userDb();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(dest, u.origin));
  }
  return NextResponse.redirect(new URL("/signin?error=link", u.origin));
}
