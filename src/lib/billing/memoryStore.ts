import type { Company, FoundingPlace, Store, Subscription, UsageEntry } from "./core";

/** In memory store for tests and local development. The database store follows the same contract. */
export function memoryStore(): Store & { companies: Map<string, Company> } {
  const companies = new Map<string, Company>();
  const subs = new Map<string, Subscription>();
  const events = new Set<string>();
  let places: FoundingPlace[] = [];
  const usage = new Map<string, UsageEntry>();
  let lock: Promise<unknown> = Promise.resolve();
  return {
    companies,
    company: async (id) => companies.get(id) ?? null,
    companyByCustomer: async (cid) => [...companies.values()].find((c) => c.stripeCustomerId === cid) ?? null,
    saveCompany: async (c) => void companies.set(c.id, c),
    subscription: async (id) => subs.get(id) ?? null,
    saveSubscription: async (s) => void subs.set(s.companyId, s),
    claimEvent: async (id) => (events.has(id) ? false : (events.add(id), true)),
    foundingPlaces: async () => places.map((p) => ({ ...p })),
    withFoundingLock: <T,>(fn: () => Promise<T>) => {
      const run = lock.then(fn, fn);
      lock = run.catch(() => undefined);
      return run;
    },
    // One record per company: a held place becomes confirmed or released; confirmed is final.
    saveFoundingPlace: async (p) => {
      const cur = places.find((x) => x.companyId === p.companyId);
      if (cur?.state === "confirmed") return;
      places = [...places.filter((x) => x.companyId !== p.companyId), p];
    },
    usage: async (cid, w) => [...usage.values()].filter((e) => e.companyId === cid && e.window === w),
    usageEntry: async (k) => usage.get(k) ?? null,
    reserveUsage: async (e, limit) => {
      const used = [...usage.values()].filter((x) => x.companyId === e.companyId && x.window === e.window && x.state !== "refunded").reduce((n, x) => n + x.units, 0);
      if (used + e.units > limit) return false;
      usage.set(e.key, e);
      return true;
    },
    setUsageState: async (k, state) => {
      const e = usage.get(k);
      if (e) usage.set(k, { ...e, state });
    },
  };
}
