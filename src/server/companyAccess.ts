import { access, type Access } from "@/lib/billing/core";
import { dbStore } from "./billingStore";
import { session, type Session } from "./accounts";
import { ProviderError } from "./http";

/** The signed in company and what its plan lets it do, or a clear error. */
export async function companyAccess(): Promise<{ s: Session & { company: { id: string; name: string } }; a: Access }> {
  const s = await session();
  if (!s) throw new ProviderError("Sign in first.", 401, "signed_out");
  if (!s.company) throw new ProviderError("Your company is not set up yet.", 409, "no_company");
  const store = dbStore();
  const company = (await store.company(s.company.id))!;
  return { s: s as Session & { company: { id: string; name: string } }, a: access(company, await store.subscription(company.id), Date.now()) };
}
