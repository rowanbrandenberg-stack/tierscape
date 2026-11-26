import { confirmAiCall, refundAiCall, reserveAiCall, type Access } from "@/lib/billing/core";
import { dbStore } from "./billingStore";
import { companyAccess } from "./companyAccess";
import { config } from "./config";
import { ProviderError } from "./http";
import type { Session } from "./accounts";

type CompanySession = Session & { company: { id: string; name: string } };

/**
 * Hold one AI text call for the company: refused with 402 without a trial or
 * plan, 429 past today's cap. Returns the functions that settle it.
 */
export async function holdAiCall(companyId: string, a: Access) {
  const store = dbStore();
  const key = `ai:${companyId}:${crypto.randomUUID()}`;
  const r = await reserveAiCall(store, companyId, a, key, Date.now());
  if (!r.ok) throw new ProviderError(r.reason, r.status, r.status === 402 ? "no_plan" : "daily_limit");
  return {
    key,
    confirm: () => confirmAiCall(store, key),
    refund: () => refundAiCall(store, key).catch(() => undefined),
  };
}

/**
 * The gate for every route that spends the server's Anthropic key: a signed
 * in company (401) whose trial or plan allows creating work (402). Call it
 * before reading the request body, then pass the model call to run().
 */
export async function aiGate(): Promise<{ s: CompanySession; a: Access; run: <T>(work: () => Promise<T>) => Promise<T> }> {
  const { s, a } = await companyAccess();
  if (!a.canCreate) throw new ProviderError(a.notice ?? "Start the free trial or choose a plan to use AI assist.", 402, "no_plan");
  return {
    s,
    a,
    run: async <T>(work: () => Promise<T>) => {
      // Not configured is not the company's fault, so it never touches the count.
      if (!config.anthropic.key) throw new ProviderError("Claude is not set up. Add an Anthropic API key (ANTHROPIC_API_KEY) on the server. A Claude subscription does not include API access.", 501, "not_configured");
      const hold = await holdAiCall(s.company.id, a);
      try {
        const out = await work();
        await hold.confirm();
        return out;
      } catch (e) {
        await hold.refund();
        throw e;
      }
    },
  };
}
