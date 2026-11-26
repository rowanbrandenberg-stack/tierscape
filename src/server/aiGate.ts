import { defaultSettings, type Settings } from "@/lib/settings";
import { accountsReady, isOffice, session } from "./accounts";
import { dbStore } from "./billingStore";
import { access } from "@/lib/billing/core";
import { config } from "./config";
import { ProviderError } from "./http";
import { adminDb } from "./supabase";

/**
 * Everything that must be true before a paid AI call runs, listed exactly so
 * the contractor sees what is missing instead of a fake success.
 */
export async function aiReadiness() {
  const blockers: { code: string; message: string }[] = [];
  const acc = accountsReady();
  if (!acc.ok) blockers.push({ code: "accounts", message: "Accounts are not connected on this server (Supabase keys). Photo proposals save photos privately to your account, so they need sign in." });
  if (!config.anthropic.key) blockers.push({ code: "claude", message: "Drafting is not set up: the server needs an Anthropic API key (ANTHROPIC_API_KEY). A Claude subscription does not include API access." });
  const render = !!config.render.openaiKey;
  const s = acc.ok ? await session() : null;
  let images = { used: 0, allowance: 0 };
  if (acc.ok && !s) blockers.push({ code: "signed_out", message: "Sign in to draft from a photo." });
  if (s && !s.company) blockers.push({ code: "no_company", message: "Your company is not set up yet." });
  if (s?.company) {
    if (!isOffice(s)) blockers.push({ code: "crew", message: "Crew accounts cannot draft proposals." });
    const store = dbStore();
    const c = await store.company(s.company.id);
    const a = c ? access(c, await store.subscription(c.id), Date.now()) : null;
    if (!a?.canCreate) blockers.push({ code: "plan", message: a?.notice ?? "Start the free trial or choose a plan to draft from a photo." });
    else if (!a.features.includes("three_tier")) blockers.push({ code: "plan_feature", message: "Three option proposals are on the Pro and Team plans." });
    if (a) images = { used: 0, allowance: a.images.allowance };
  }
  return {
    ready: blockers.length === 0,
    blockers,
    renders: render ? (images.allowance > 0 ? { ok: true as const } : { ok: false as const, why: "Your plan has no concept picture allowance." }) : { ok: false as const, why: "Concept pictures are not set up: the server needs an OpenAI API key (OPENAI_API_KEY)." },
    model: config.anthropic.key ? config.anthropic.model : null,
  };
}

/** The signed in company's saved settings, or the defaults. */
export async function companySettings(companyId: string): Promise<Settings> {
  const d = defaultSettings();
  const r = await adminDb().from("settings").select("profile, pricing").eq("company_id", companyId).maybeSingle();
  if (r.error) throw new Error(r.error.message);
  if (!r.data) return d;
  return { profile: { ...d.profile, ...(r.data.profile as object) }, pricing: { ...d.pricing, ...(r.data.pricing as object) } };
}

export function assertDraftable(a: { canCreate: boolean; features: string[]; notice: string | null }) {
  if (!config.anthropic.key) throw new ProviderError("Drafting is not set up: the server needs an Anthropic API key (ANTHROPIC_API_KEY).", 501, "not_configured");
  if (!a.canCreate) throw new ProviderError(a.notice ?? "Start the free trial or choose a plan to draft from a photo.", 402, "no_plan");
  if (!a.features.includes("three_tier")) throw new ProviderError("Three option proposals are on the Pro and Team plans.", 402, "plan_feature");
}
