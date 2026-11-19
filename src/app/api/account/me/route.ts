import { access, foundingAvailability, imagesUsed } from "@/lib/billing/core";
import { FOUNDING, PLANS } from "@/lib/billing/plans";
import { accountsReady, canManageBilling, session } from "@/server/accounts";
import { dbStore } from "@/server/billingStore";
import { stripeReady } from "@/server/stripe";

/** Everything the account center and pricing page need, from verified state only. */
export async function GET() {
  const ready = accountsReady();
  const s = ready.ok ? await session() : null;
  const store = ready.ok ? dbStore() : null;
  const now = Date.now();
  const founding = store ? await foundingAvailability(store, now).catch(() => null) : null;
  const base = { accounts: ready.ok, checkout: ready.ok && stripeReady().ok, founding: { limit: FOUNDING.limit, remaining: founding?.remaining ?? null } };
  if (!s) return Response.json({ ...base, signedIn: false });
  if (!s.company) return Response.json({ ...base, signedIn: true, email: s.email, company: null });
  const company = (await store!.company(s.company.id))!;
  const sub = await store!.subscription(s.company.id);
  const a = access(company, sub, now);
  const used = a.images.allowance ? await imagesUsed(store!, s.company.id, a.images.window) : 0;
  const places = await store!.foundingPlaces();
  const myPlace = places.find((p) => p.companyId === s.company!.id);
  let nextCharge: { at: number; amount: number } | null = null;
  if (sub && !sub.cancelAtPeriodEnd && ["active", "past_due", "trialing"].includes(sub.status)) {
    const p = PLANS[sub.plan];
    const amount = sub.founding && sub.founding.paidPeriods < FOUNDING.periods ? FOUNDING.price : sub.cadence === "annual" ? p.annual : p.monthly;
    nextCharge = { at: sub.periodEnd, amount };
  }
  return Response.json({
    ...base,
    signedIn: true,
    email: s.email,
    role: s.role,
    canManageBilling: canManageBilling(s),
    company: { id: s.company.id, name: s.company.name, trialStartedAt: company.trialStartedAt, hold: company.billingHold },
    access: a,
    subscription: sub
      ? { plan: sub.plan, cadence: sub.cadence, status: sub.status, periodEnd: sub.periodEnd, cancelAtPeriodEnd: sub.cancelAtPeriodEnd, founding: sub.founding ? { paidPeriods: sub.founding.paidPeriods, left: Math.max(0, FOUNDING.periods - sub.founding.paidPeriods) } : null }
      : null,
    nextCharge,
    foundingUsed: myPlace?.state === "confirmed",
    usage: { images: { used, allowance: a.images.allowance, resetsAt: a.images.resetsAt } },
  });
}
