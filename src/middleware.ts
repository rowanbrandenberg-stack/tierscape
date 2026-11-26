import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Keeps the sign in session fresh on every request, so API routes see a valid user. */
export async function middleware(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let res = NextResponse.next({ request: req });
  if (!url || !key) return res;
  const db = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        for (const c of list) req.cookies.set(c.name, c.value);
        res = NextResponse.next({ request: req });
        for (const c of list) res.cookies.set(c.name, c.value, c.options);
      },
    },
  });
  await db.auth.getUser();
  return res;
}

export const config = {
  // Skip static files, imagery tiles and the Stripe webhook.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/imagery|api/billing/webhook|api/payments/webhook|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};
