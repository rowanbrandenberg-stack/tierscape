/**
 * Sign in and the company database. Billing cannot attach to anything until
 * these exist, so every billing route checks here first.
 */
export function accountsReady(): { ok: boolean; why?: string } {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, why: "Accounts are not connected yet." };
  // Sign in is not wired into the app yet; flip this once it is.
  return { ok: false, why: "Sign in is not live yet." };
}
