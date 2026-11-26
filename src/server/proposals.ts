import { createHash, randomBytes } from "node:crypto";
import { ledger, type PaymentRow, type PayStore } from "@/lib/payments";
import { buildPublicProposal, canonical, jobOptions, publishReadiness, isPhotoJob, type PublicProposal } from "@/lib/proposal";
import type { Job, TierKey } from "@/lib/types";
import { companySettings } from "./aiGate";
import { ProviderError } from "./http";
import { loadJob } from "./jobs";
import { adminDb } from "./supabase";

/* ---------- share tokens ---------- */

export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
export const hashSnapshot = (p: PublicProposal) => createHash("sha256").update(canonical(p), "utf8").digest("hex");
const TOKEN_RE = /^[A-Za-z0-9_-]{40,60}$/;

function must<T>(r: { data: T; error: { message: string; code?: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

export interface ProposalRow {
  id: string;
  company_id: string;
  job_id: string;
  version: number;
  status: "published" | "superseded" | "accepted" | "withdrawn";
  snapshot: PublicProposal;
  snapshot_hash: string;
  internal: { assets?: { photo: string | null; renders: Partial<Record<TierKey, string>> }; options?: unknown } | null;
  expires_at: string;
  created_at: string;
}

export interface AcceptanceRow {
  id: string;
  company_id: string;
  job_id: string;
  proposal_id: string;
  snapshot_hash: string;
  tier: TierKey;
  option_snapshot: PublicProposal["options"][number];
  signer_name: string;
  signer_email: string | null;
  total_cents: number;
  deposit_cents: number;
  balance_cents: number;
  currency: string;
  status: "active" | "cancelled";
  balance_requested_at: string | null;
  accepted_at: string;
}

/* ---------- contractor side ---------- */

export async function latestProposal(jobId: string): Promise<ProposalRow | null> {
  const r = must(await adminDb().from("proposals").select("*").eq("job_id", jobId).order("version", { ascending: false }).limit(1).maybeSingle());
  return (r as ProposalRow) ?? null;
}

export async function activeAcceptance(jobId: string): Promise<AcceptanceRow | null> {
  return ((must(await adminDb().from("acceptances").select("*").eq("job_id", jobId).eq("status", "active").maybeSingle()) as AcceptanceRow) ?? null);
}

/**
 * Publish a new version from the job and settings as stored on the server,
 * never from numbers the browser sends. An accepted job cannot be
 * republished: the signed agreement stays what it was.
 */
export async function publish(companyId: string, jobId: string, userId: string): Promise<ProposalRow> {
  const job = await loadJob(companyId, jobId);
  if (!job) throw new ProviderError("Save the job to your account first.", 404, "no_job");
  const st = await companySettings(companyId);
  const ready = publishReadiness(job, st.profile, st.pricing);
  if (ready.blockers.length) throw new ProviderError(`Not ready to publish: ${ready.blockers.join(" ")}`, 409, "not_ready");
  if (await activeAcceptance(jobId)) throw new ProviderError("The homeowner already accepted this proposal. The signed version stays as it is.", 409, "accepted");
  const snapshot = buildPublicProposal(job, st.profile, st.pricing);
  const hash = hashSnapshot(snapshot);
  const prev = await latestProposal(jobId);
  if (prev && prev.status === "published" && prev.snapshot_hash === hash) return prev;
  const internal = {
    assets: isPhotoJob(job) ? { photo: job.concept!.photoId, renders: Object.fromEntries(job.concept!.options.filter((o) => o.render).map((o) => [o.tier, o.render!.assetId])) } : { photo: null, renders: {} },
    options: jobOptions(job, st.pricing).map((o) => ({ tier: o.tier, price: o.price, estimate: o.internal.estimate, quoteTotals: o.internal.quote ? { materials: o.internal.quote.materials, labor: o.internal.quote.labor, overhead: o.internal.quote.overhead } : null })),
  };
  const db = adminDb();
  const ins = await db
    .from("proposals")
    .insert({ company_id: companyId, job_id: jobId, version: (prev?.version ?? 0) + 1, status: "published", snapshot, snapshot_hash: hash, internal, expires_at: snapshot.expiresAt, created_by: userId })
    .select("*")
    .single();
  if (ins.error?.code === "23505") throw new ProviderError("Someone published this job at the same moment. Refresh and try again.", 409, "conflict");
  if (ins.error && /already accepted/i.test(ins.error.message)) throw new ProviderError("The homeowner already accepted this proposal. The signed version stays as it is.", 409, "accepted");
  if (ins.error) throw new Error(ins.error.message);
  if (prev?.status === "published") await db.from("proposals").update({ status: "superseded" }).eq("job_id", jobId).eq("status", "published").neq("id", ins.data.id);
  return ins.data as ProposalRow;
}

/** One live link per job: making a new one revokes the old. The plain token is returned once. */
export async function rotateLink(companyId: string, jobId: string): Promise<string> {
  const db = adminDb();
  const token = newToken();
  must(await db.from("share_links").update({ revoked_at: new Date().toISOString() }).eq("job_id", jobId).eq("company_id", companyId).is("revoked_at", null));
  must(await db.from("share_links").insert({ company_id: companyId, job_id: jobId, token_hash: hashToken(token) }));
  return token;
}

export async function revokeLinks(companyId: string, jobId: string) {
  must(await adminDb().from("share_links").update({ revoked_at: new Date().toISOString() }).eq("job_id", jobId).eq("company_id", companyId).is("revoked_at", null));
}

/* ---------- payments store over the database ---------- */

type PayDb = { id: string; company_id: string; acceptance_id: string; kind: PaymentRow["kind"]; amount_cents: number; currency: string; fee_cents: number; stripe_account: string; session_id: string | null; session_url: string | null; session_expires_at: string | null; payment_intent_id: string | null; status: PaymentRow["status"]; refunded_cents: number; receipt_url: string | null; last_event_at: number; note: string | null };
export const fromPayDb = (r: PayDb): PaymentRow => ({ id: r.id, companyId: r.company_id, acceptanceId: r.acceptance_id, kind: r.kind, amountCents: r.amount_cents, currency: r.currency, feeCents: r.fee_cents, stripeAccount: r.stripe_account, sessionId: r.session_id, sessionUrl: r.session_url, sessionExpiresAt: r.session_expires_at ? new Date(r.session_expires_at).getTime() : null, paymentIntentId: r.payment_intent_id, status: r.status, refundedCents: r.refunded_cents, receiptUrl: r.receipt_url, lastEventAt: Number(r.last_event_at), note: r.note });
export const toPayDb = (p: PaymentRow): PayDb & { updated_at: string } => ({ id: p.id, company_id: p.companyId, acceptance_id: p.acceptanceId, kind: p.kind, amount_cents: p.amountCents, currency: p.currency, fee_cents: p.feeCents, stripe_account: p.stripeAccount, session_id: p.sessionId, session_url: p.sessionUrl, session_expires_at: p.sessionExpiresAt ? new Date(p.sessionExpiresAt).toISOString() : null, payment_intent_id: p.paymentIntentId, status: p.status, refunded_cents: p.refundedCents, receipt_url: p.receiptUrl, last_event_at: p.lastEventAt, note: p.note, updated_at: new Date().toISOString() });

export async function paymentsFor(acceptanceId: string): Promise<PaymentRow[]> {
  return (must(await adminDb().from("payments").select("*").eq("acceptance_id", acceptanceId).order("created_at")) as PayDb[]).map(fromPayDb);
}

export function dbPayStore(): PayStore {
  const db = adminDb();
  return {
    seenEvent: async (id) => !!must(await db.from("connect_events").select("id").eq("id", id).maybeSingle()),
    recordEvent: async (id) => {
      const r = await db.from("connect_events").insert({ id, type: "connect" });
      if (r.error && r.error.code !== "23505") throw new Error(r.error.message);
    },
    otherPaid: async (p) => {
      const r = await db.from("payments").select("id").eq("acceptance_id", p.acceptanceId).eq("kind", p.kind).neq("id", p.id).in("status", ["succeeded", "partially_refunded", "disputed", "refunded"]).limit(1);
      if (r.error) throw new Error(r.error.message);
      return (r.data ?? []).length > 0;
    },
    paymentBySession: async (sid) => {
      const r = must(await db.from("payments").select("*").eq("session_id", sid).maybeSingle()) as PayDb | null;
      return r ? fromPayDb(r) : null;
    },
    paymentByIntent: async (acct, pi) => {
      const r = must(await db.from("payments").select("*").eq("stripe_account", acct).eq("payment_intent_id", pi).maybeSingle()) as PayDb | null;
      return r ? fromPayDb(r) : null;
    },
    savePayment: async (p) => void must(await db.from("payments").update(toPayDb(p)).eq("id", p.id)),
  };
}

/* ---------- homeowner side ---------- */

export interface Shared {
  linkId: string;
  companyId: string;
  jobId: string;
  proposal: ProposalRow;
  acceptance: AcceptanceRow | null;
}

/** Resolve a share token to its job's latest proposal. Revoked or unknown tokens find nothing. */
export async function resolveShare(token: string): Promise<Shared | null> {
  if (!TOKEN_RE.test(token)) return null;
  const db = adminDb();
  const link = must(await db.from("share_links").select("id, company_id, job_id, revoked_at").eq("token_hash", hashToken(token)).maybeSingle()) as { id: string; company_id: string; job_id: string; revoked_at: string | null } | null;
  if (!link || link.revoked_at) return null;
  const acceptance = await activeAcceptance(link.job_id);
  // Once accepted, the homeowner always sees exactly the version they signed.
  const proposal = acceptance
    ? ((must(await db.from("proposals").select("*").eq("id", acceptance.proposal_id).single()) as ProposalRow))
    : await latestProposal(link.job_id);
  if (!proposal || proposal.company_id !== link.company_id || proposal.status === "withdrawn") return null;
  void db.from("share_links").update({ last_viewed_at: new Date().toISOString() }).eq("id", link.id).then(() => undefined);
  return { linkId: link.id, companyId: link.company_id, jobId: link.job_id, proposal, acceptance };
}

/** Everything the homeowner page shows, from a whitelist. No costs, no internal ids beyond the proposal's own. */
export async function publicView(sh: Shared, payments: { ready: boolean }) {
  const p = sh.proposal;
  const acc = sh.acceptance;
  const pays = acc ? await paymentsFor(acc.id) : [];
  const l = acc ? ledger({ totalCents: acc.total_cents, depositCents: acc.deposit_cents, balanceCents: acc.balance_cents, balanceRequested: !!acc.balance_requested_at }, pays) : null;
  return {
    proposal: { id: p.id, version: p.version, hash: p.snapshot_hash, ...p.snapshot },
    expired: !acc && new Date(p.expires_at).getTime() < Date.now(),
    acceptance: acc
      ? {
          tier: acc.tier,
          option: acc.option_snapshot,
          signerName: acc.signer_name,
          acceptedAt: acc.accepted_at,
          totalCents: acc.total_cents,
          depositCents: acc.deposit_cents,
          balanceCents: acc.balance_cents,
          balanceRequested: !!acc.balance_requested_at,
          version: p.version,
        }
      : null,
    ledger: l,
    receipts: pays.filter((x) => x.status === "succeeded" || x.status === "partially_refunded" || x.status === "refunded").map((x) => ({ kind: x.kind, amountCents: x.amountCents, refundedCents: x.refundedCents, status: x.status, receiptUrl: x.receiptUrl })),
    paymentsOnline: payments.ready,
  };
}
