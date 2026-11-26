import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adoptDraft, emptyConcept, type DraftOutput } from "@/lib/concept";
import { DEFAULT_RATES } from "@/lib/estimate";
import { sampleJob } from "@/lib/jobs";
import { buildPublicProposal, findPrivateKeys } from "@/lib/proposal";
import { defaultSettings } from "@/lib/settings";

// next/headers needs a request; these tests run the routes with accounts switched off.
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => undefined }) }));

const KEYS = ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_CONNECT_WEBHOOK_SECRET", "STRIPE_ALLOW_LIVE", "PLATFORM_FEE_ENABLED", "PLATFORM_FEE_BPS"];
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  vi.resetModules();
});
afterEach(() => {
  for (const k of KEYS) (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]));
});

describe("missing configuration is reported, never faked", () => {
  it("photo drafting lists exactly what is missing", async () => {
    const { aiReadiness } = await import("./aiGate");
    const r = await aiReadiness();
    expect(r.ready).toBe(false);
    expect(r.blockers.map((b) => b.code)).toEqual(["accounts", "claude"]);
    expect(r.blockers[1].message).toMatch(/subscription does not include API access/);
    expect(r.renders.ok).toBe(false);
  });

  it("Claude and the image model refuse to run without keys", async () => {
    const { claudeStructured } = await import("./anthropic");
    const { DraftSchema } = await import("@/lib/concept");
    await expect(claudeStructured({ system: "x", content: [{ type: "text", text: "x" }], schema: DraftSchema })).rejects.toMatchObject({ code: "not_configured", status: 501 });
    const { editImage } = await import("./render");
    await expect(editImage(Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg", "x")).rejects.toMatchObject({ code: "not_configured" });
  });

  it("payments name every platform blocker and refuse live keys", async () => {
    const { connectPlatformBlockers } = await import("./connect");
    expect(connectPlatformBlockers().map((b) => b.code)).toEqual(["accounts", "stripe_key", "connect_webhook"]);
    process.env.STRIPE_SECRET_KEY = "sk_live_x";
    expect(connectPlatformBlockers().map((b) => b.code)).toContain("stripe_live");
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    expect(connectPlatformBlockers().map((b) => b.code)).not.toContain("stripe_live");
  });

  it("the retired image model is never used as the default", async () => {
    process.env.OPENAI_IMAGE_MODEL = "gpt-image-1";
    const { config } = await import("./config");
    expect(config.render.model).not.toBe("gpt-image-1");
    delete process.env.OPENAI_IMAGE_MODEL;
  });
});

describe("routes that spend money or show private data need the right caller", () => {
  it("the planner render route is no longer open to anyone", async () => {
    const { POST } = await import("@/app/api/render/route");
    const fd = new FormData();
    fd.set("photo", new File([new Uint8Array([1])], "a.jpg", { type: "image/jpeg" }));
    fd.set("prompt", "x");
    const r = await POST(new Request("http://x/api/render", { method: "POST", body: fd }));
    expect(r.status).toBe(401);
  });

  it("drafting, assets and publishing need a signed in company", async () => {
    const draft = await import("@/app/api/ai/draft/route");
    expect((await draft.POST(new Request("http://x", { method: "POST", body: "{}" }))).status).toBe(401);
    const asset = await import("@/app/api/jobs/[id]/assets/[assetId]/route");
    expect((await asset.GET(new Request("http://x"), { params: Promise.resolve({ id: "j", assetId: "a" }) })).status).toBe(401);
    const pub = await import("@/app/api/proposals/publish/route");
    expect((await pub.POST(new Request("http://x", { method: "POST", body: "{}" }))).status).toBe(401);
  });

  it("public links say plainly when online proposals are not available", async () => {
    const { GET } = await import("@/app/api/public/p/[token]/route");
    const r = await GET(new Request("http://x"), { params: Promise.resolve({ token: "a".repeat(43) }) });
    expect(r.status).toBe(501);
  });

  it("the Connect webhook rejects unsigned and wrongly signed events", async () => {
    const { POST } = await import("@/app/api/payments/webhook/route");
    const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: {} } });
    expect((await POST(new Request("http://x", { method: "POST", body }))).status).toBe(400);
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = "whsec_test";
    const t = Math.floor(Date.now() / 1000);
    const bad = `t=${t},v1=${createHmac("sha256", "whsec_other").update(`${t}.${body}`).digest("hex")}`;
    expect((await POST(new Request("http://x", { method: "POST", body, headers: { "stripe-signature": bad } }))).status).toBe(400);
    const good = `t=${t},v1=${createHmac("sha256", "whsec_test").update(`${t}.${body}`).digest("hex")}`;
    // Correctly signed, but there is no database to record it in: Stripe is told to retry, nothing is marked paid.
    expect((await POST(new Request("http://x", { method: "POST", body, headers: { "stripe-signature": good } }))).status).toBe(503);
  });
});

describe("share tokens and stored files", () => {
  it("tokens are long and random, only their hash is stored, malformed ones never reach the database", async () => {
    const { newToken, hashToken, resolveShare } = await import("./proposals");
    const a = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(a);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).not.toContain(a);
    await expect(resolveShare("../../etc")).resolves.toBeNull();
  });

  it("only real JPEG, PNG and WebP bytes are accepted as photos", async () => {
    const { sniff } = await import("./assets");
    expect(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniff(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniff(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(sniff(Buffer.from("RIFF0000WEBPVP8 "))).toBe("image/webp");
  });

  it("the concept sent by a browser is cleaned before it reaches the model", async () => {
    const { cleanConcept } = await import("./drafting");
    const c = cleanConcept({ request: "x".repeat(5000), measurement: { areaSqft: -5, edgeFt: "abc", source: "evil", confirmed: 1 }, questions: Array.from({ length: 30 }, () => ({ question: "q", answer: "a" })) });
    expect(c.request.length).toBe(800);
    expect(c.measurement).toMatchObject({ areaSqft: 0, edgeFt: 0, source: "photo_estimate", confirmed: true });
    expect(c.questions).toHaveLength(8);
  });
});

describe("what a homeowner link returns", () => {
  /** TEST FIXTURE ONLY: a stand in for a model reply. */
  const draft: DraftOutput = {
    observations: [],
    assumptions: ["Existing play sand, no aggregate base"],
    questions: [],
    size_estimate: { low_sqft: 90, high_sqft: 110, edge_ft: 40, basis: "pavers" },
    options: (["basic", "standard", "premium"] as const).map((tier) => ({
      tier,
      name: tier,
      summary: "s",
      prep_note: "p",
      includes: ["a"],
      excludes: tier === "basic" ? ["No new aggregate base or compaction"] : [],
      limitations: tier === "basic" ? ["Pavers may settle on the existing sand"] : [],
      benefits: [],
      crew_steps: ["secret crew step"],
      items: [{ label: "Pavers", kind: "material" as const, basis: "area" as const, rate: 1, unit: "sq ft", rate_key: "pavers", unit_cost_estimate: 0, waste_pct: 5, work_package: "materials" as const }],
      visual_change: "c",
      visual_keep: "k",
    })),
  };

  it("carries the snapshot and nothing internal", async () => {
    const { publicView } = await import("./proposals");
    const st = defaultSettings();
    st.profile = { ...st.profile, company: "Pine Ridge", license: "ROC 1", email: "a@b.test", phone: "1", experience: "secret how we work" };
    const job = { ...sampleJob(), sample: false, kind: "photo" as const, concept: { ...adoptDraft(draft, emptyConcept("Fix this patio"), DEFAULT_RATES, "m"), notes: "secret note", photoId: "ph_1" } };
    const snapshot = buildPublicProposal(job, st.profile, st.pricing);
    const view = await publicView(
      { linkId: "l", companyId: "c", jobId: job.id, acceptance: null, proposal: { id: "p", company_id: "c", job_id: job.id, version: 1, status: "published", snapshot, snapshot_hash: "h", internal: { assets: { photo: "ph_1", renders: {} }, options: [{ estimate: { costs: 123 } }] }, expires_at: snapshot.expiresAt, created_at: "" } },
      { ready: false },
    );
    expect(findPrivateKeys(view)).toEqual([]);
    const flat = JSON.stringify(view);
    for (const secret of ["secret note", "secret how we work", "secret crew step", "ph_1", "internal", "unitCost"]) expect(flat).not.toContain(secret);
    expect(view.proposal.options[0].excludes).toContain("No new aggregate base or compaction");
  });
});
