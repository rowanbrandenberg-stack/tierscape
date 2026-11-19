import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Two Supabase clients. The admin client uses the service key and is only for
 * server code that has already checked who is asking. The user client carries
 * the signed in person's session from cookies.
 */
const url = () => process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";

let admin: SupabaseClient | null = null;
export function adminDb(): SupabaseClient {
  admin ??= createClient(url(), process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

export async function userDb() {
  const jar = await cookies();
  return createServerClient(url(), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "", {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          for (const c of list) jar.set(c.name, c.value, c.options);
        } catch {
          // Called from a server component: the middleware refreshes cookies instead.
        }
      },
    },
  });
}
