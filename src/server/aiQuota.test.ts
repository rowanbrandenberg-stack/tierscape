import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, aiTextLimit, aiWindow, imagesUsed, reserveAiCall, type Access, type Subscription } from "@/lib/billing/core";
import { memoryStore } from "@/lib/billing/memoryStore";

/**
 * Every route that spends the Anthropic or OpenAI key: who may call it, how
 * many calls a day, and that the keys never reach the browser.
 */

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 26, 15);
const CO = "co_1";

const trialAccess = () => access({ id: CO, stripeCustomerId: null, trialStartedAt: NOW - DAY, billingHold: null }, null, NOW);
const sub = (plan: Subscription["plan"], status: Subscription["status"] = "active"): Subscription => ({ companyId: CO, stripeSubscriptionId: "sub_1", plan, cadence: "monthly", status, periodStart: NOW - 5 * DAY, periodEnd: NOW + 25 * DAY, cancelAtPeriodEnd: false, founding: null, asOf: NOW });
const paidAccess = (plan: Subscription["plan"] = "pro") => access({ id: CO, stripeCustomerId: "cus_1", trialStartedAt: null, billingHold: null }, sub(plan), NOW);
const endedTrial = () => access({ id: CO, stripeCustomerId: null, trialStartedAt: NOW - 30 * DAY, billingHold: null }, null, NOW);

describe("daily cap on AI text calls", () => {
  it("40 a day on paid plans, 10 in the trial, none without one", () => {
    expect(aiTextLimit(paidAccess("pro"))).toBe(40);
    expect(aiTextLimit(paidAccess("team"))).toBe(40);
    expect(aiTextLimit(paidAccess("starter"))).toBe(40);
    expect(aiTextLimit(access({ id: CO, stripeCustomerId: "cus_1", trialStartedAt: null, billingHold: null }, sub("pro", "past_due"), NOW))).toBe(40);
    expect(aiTextLimit(trialAccess())).toBe(10);
    expect(aiTextLimit(endedTrial())).toBe(0);
    expect(aiTextLimit(access({ id: CO, stripeCustomerId: "cus_1", trialStartedAt: null, billingHold: "A payment is disputed." }, sub("pro"), NOW))).toBe(0);
  });

  it("the window is the UTC day and does not mix with image windows", () => {
    expect(aiWindow(NOW)).toBe("ai:2026-11-26");
    expect(aiWindow(Date.UTC(2026, 10, 26, 23, 59))).toBe("ai:2026-11-26");
    expect(aiWindow(Date.UTC(2026, 10, 27, 0, 0))).toBe("ai:2026-11-27");
    expect(trialAccess().images.window).not.toMatch(/^ai:/);
  });

  it("the 11th trial call of the day is refused; refunded calls do not count; tomorrow opens again", async () => {
    const store = memoryStore();
    const a = trialAccess();
    for (let i = 0; i < 10; i++) expect((await reserveAiCall(store, CO, a, `k${i}`, NOW)).ok).toBe(true);
    const over = await reserveAiCall(store, CO, a, "k10", NOW);
    expect(over).toMatchObject({ ok: false, status: 429 });
    await store.setUsageState("k3", "refunded");
    expect((await reserveAiCall(store, CO, a, "k11", NOW)).ok).toBe(true);
    expect((await reserveAiCall(store, CO, a, "k12", NOW + DAY)).ok).toBe(true);
    // AI calls never use up pictures.
    expect(await imagesUsed(store, CO, a.images.window)).toBe(0);
  });

  it("no trial or plan is a 402, not a cap", async () => {
    expect(await reserveAiCall(memoryStore(), CO, endedTrial(), "k", NOW)).toMatchObject({ ok: false, status: 402 });
  });
});

/* ---------- the routes, with the session, ledger and providers stubbed ---------- */

const state: { access: Access | null; signedIn: boolean; store: ReturnType<typeof memoryStore> } = { access: null, signedIn: true, store: memoryStore() };
const claudeJson = vi.fn();
const renderAfter = vi.fn();

vi.mock("./companyAccess", () => ({
  companyAccess: async () => {
    const { ProviderError } = await import("./http");
    if (!state.signedIn) throw new ProviderError("Sign in first.", 401, "signed_out");
    return { s: { userId: "u1", email: null, role: "owner", company: { id: CO, name: "Pine Ridge" } }, a: state.access! };
  },
}));
vi.mock("./billingStore", () => ({ dbStore: () => state.store }));
vi.mock("./anthropic", () => ({ claudeJson: (...args: unknown[]) => claudeJson(...args), fileToBlock: async () => ({ type: "text", text: "img" }) }));
vi.mock("./render", () => ({ renderAfter: (...args: unknown[]) => renderAfter(...args) }));

const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "p.png", { type: "image/png" });
const form = (fields: Record<string, File | string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return new Request("http://x/api", { method: "POST", body: fd });
};
const json = (body: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

const ROUTES = {
  "plants/estimate": { mod: () => import("@/app/api/plants/estimate/route"), req: () => json({ location: "Flagstaff, AZ", plants: [{ name: "Ponderosa pine", kind: "tree" }] }), reply: [] },
  "photos/locate": { mod: () => import("@/app/api/photos/locate/route"), req: () => form({ plan: png(), photo: png() }), reply: { x: 0.5, y: 0.5, heading: 0, confidence: "low", reason: "test" } },
  "utilities/detect": { mod: () => import("@/app/api/utilities/detect/route"), req: () => form({ plan: png() }), reply: { clues: [], routes: [] } },
  "utilities/trace": { mod: () => import("@/app/api/utilities/trace/route"), req: () => form({ plan: png(), photo: png() }), reply: { marks: [] } },
} as const;

const aiRows = () => state.store.usage(CO, aiWindow(Date.now()));

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  state.access = paidAccess();
  state.signedIn = true;
  state.store = memoryStore();
  claudeJson.mockReset();
  renderAfter.mockReset();
});
afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe.each(Object.entries(ROUTES))("/api/%s", (_name, r) => {
  it("401 when signed out, before Claude is called", async () => {
    state.signedIn = false;
    const res = await (await r.mod()).POST(r.req());
    expect(res.status).toBe(401);
    expect(claudeJson).not.toHaveBeenCalled();
  });

  it("402 when the trial has ended or there is no plan", async () => {
    state.access = endedTrial();
    const res = await (await r.mod()).POST(r.req());
    expect(res.status).toBe(402);
    expect(claudeJson).not.toHaveBeenCalled();
  });

  it("a successful call is counted once", async () => {
    claudeJson.mockResolvedValue(r.reply);
    const res = await (await r.mod()).POST(r.req());
    expect(res.status).toBeLessThan(500);
    expect(claudeJson).toHaveBeenCalledTimes(1);
    expect((await aiRows()).map((e) => e.state)).toEqual(["used"]);
  });

  it("a failed call is refunded", async () => {
    const { ProviderError } = await import("./http");
    claudeJson.mockRejectedValue(new ProviderError("Claude is busy right now.", 503, "provider_busy"));
    const res = await (await r.mod()).POST(r.req());
    expect(res.status).toBe(503);
    expect((await aiRows()).map((e) => e.state)).toEqual(["refunded"]);
  });

  it("429 once today's cap is used, without calling Claude", async () => {
    state.access = trialAccess();
    for (let i = 0; i < 10; i++) await state.store.reserveUsage({ key: `pre${i}`, companyId: CO, window: aiWindow(Date.now()), units: 1, state: "used" }, 10);
    const res = await (await r.mod()).POST(r.req());
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("daily_limit");
    expect(claudeJson).not.toHaveBeenCalled();
  });

  it("501 without a key, and nothing is counted", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    vi.resetModules();
    const res = await (await r.mod()).POST(r.req());
    expect(res.status).toBe(501);
    expect(await aiRows()).toEqual([]);
    vi.resetModules();
  });
});

describe("/api/render uses the image allowance", () => {
  const req = () => form({ photo: png(), prompt: "new paver patio" });
  const post = async () => (await import("@/app/api/render/route")).POST(req());

  it("401 signed out, 402 without a trial or plan", async () => {
    state.signedIn = false;
    expect((await post()).status).toBe(401);
    state.signedIn = true;
    state.access = endedTrial();
    expect((await post()).status).toBe(402);
    expect(renderAfter).not.toHaveBeenCalled();
  });

  it("trial: 3 pictures in total, then 402", async () => {
    state.access = trialAccess();
    renderAfter.mockResolvedValue({ image: "data:image/png;base64,AA" });
    for (let i = 0; i < 3; i++) expect((await post()).status).toBe(200);
    const res = await post();
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("no_allowance");
    expect(renderAfter).toHaveBeenCalledTimes(3);
  });

  it("Pro gets 30 a month and Team 90", () => {
    expect(paidAccess("pro").images.allowance).toBe(30);
    expect(paidAccess("team").images.allowance).toBe(90);
    expect(trialAccess().images.allowance).toBe(3);
  });

  it("a failed picture is refunded", async () => {
    state.access = trialAccess();
    const { ProviderError } = await import("./http");
    renderAfter.mockRejectedValue(new ProviderError("The image model is busy.", 503, "provider_busy"));
    expect((await post()).status).toBe(503);
    expect(await imagesUsed(state.store, CO, trialAccess().images.window)).toBe(0);
  });
});

/* ---------- static checks over the source ---------- */

const SRC = join(process.cwd(), "src");
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const files = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
const read = (f: string) => readFileSync(f, "utf8");

describe("every AI route is gated", () => {
  it("routes that reach Claude or the image model go through the company gate", () => {
    const routes = files.filter((f) => /[\\/]app[\\/]api[\\/].*route\.ts$/.test(f));
    const spending = routes.filter((f) => /@\/server\/(anthropic|render|drafting)"/.test(read(f)));
    expect(spending.length).toBeGreaterThanOrEqual(8);
    for (const f of spending) expect(read(f), relative(SRC, f)).toMatch(/aiGate\(\)|companyAccess\(\)/);
    // The Claude routes use the gate that also counts calls.
    for (const f of spending.filter((f) => /@\/server\/anthropic"/.test(read(f)))) expect(read(f), relative(SRC, f)).toMatch(/aiGate\(\)/);
  });
});

describe("the keys stay on the server", () => {
  it("no client code imports the server config or providers, and no public variable names a key", () => {
    for (const f of files) {
      const t = read(f);
      expect(t, relative(SRC, f)).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(ANTHROPIC|OPENAI)/);
      if (/^["']use client["']/.test(t.trimStart())) expect(t, relative(SRC, f)).not.toMatch(/@\/server\//);
    }
  });

  it("the public feature list never includes a key", async () => {
    process.env.OPENAI_API_KEY = "test-openai-not-real";
    vi.resetModules();
    const { GET } = await import("@/app/api/config/route");
    const body = JSON.stringify(await GET().json());
    expect(body).not.toContain("test-key-not-real");
    expect(body).not.toContain("test-openai-not-real");
    delete process.env.OPENAI_API_KEY;
  });
});
