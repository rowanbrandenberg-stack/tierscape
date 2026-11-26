import { config } from "./config";
import { ProviderError } from "./http";
import { adminDb } from "./supabase";

/**
 * AI work as durable rows. A click creates (or finds) a row keyed by the
 * client's request key; the work runs after the response and writes its
 * result or error back. Polling reads the row, so a closed tab, a retry or a
 * double click never runs a paid call twice or loses a finished one.
 */

export type GenKind = "draft" | "option" | "render";
export type GenStatus = "queued" | "running" | "succeeded" | "failed";

export interface GenRow {
  id: string;
  company_id: string;
  job_id: string;
  kind: GenKind;
  tier: string | null;
  request_key: string;
  status: GenStatus;
  attempts: number;
  model: string | null;
  result: unknown;
  error: string | null;
  usage_key: string | null;
  created_at: string;
  updated_at: string;
}

export const MAX_ATTEMPTS = 3;
/** A run that has not finished in this long died with its function. */
export const STALE_MS = 6 * 60_000;

export function isStale(row: Pick<GenRow, "status" | "updated_at">, now = Date.now()) {
  return (row.status === "running" || row.status === "queued") && now - new Date(row.updated_at).getTime() > STALE_MS;
}

/** What the browser may see. Errors are already safe messages. */
export const publicGen = (g: GenRow) => ({ id: g.id, kind: g.kind, tier: g.tier, status: g.status, attempts: g.attempts, error: g.error, result: g.status === "succeeded" ? g.result : null });

/**
 * Find or create the row for this request. Returns run=false when the same
 * request is already running or done, so the caller must not start work.
 */
export async function claimGeneration(o: { companyId: string; jobId: string; kind: GenKind; tier: string | null; requestKey: string }): Promise<{ row: GenRow; run: boolean }> {
  const db = adminDb();
  const key = o.requestKey.slice(0, 120);
  if (!/^[A-Za-z0-9_.:-]{8,120}$/.test(key)) throw new ProviderError("Bad request key.", 400, "bad_request");
  const found = await db.from("ai_generations").select("*").eq("company_id", o.companyId).eq("request_key", key).maybeSingle();
  if (found.error) throw new Error(found.error.message);
  let row = found.data as GenRow | null;
  if (row) {
    if (row.job_id !== o.jobId || row.kind !== o.kind) throw new ProviderError("That request key was used for something else.", 409, "conflict");
    if (row.status === "succeeded") return { row, run: false };
    if ((row.status === "running" || row.status === "queued") && !isStale(row)) return { row, run: false };
    if (row.attempts >= MAX_ATTEMPTS) {
      if (row.status !== "failed") row = await mark(row.id, { status: "failed", error: "This kept failing. Start a new one." });
      return { row, run: false };
    }
    // A failed or timed out attempt: try again on the same row, only if nobody else just did.
    const r = await db
      .from("ai_generations")
      .update({ status: "queued", error: null, attempts: row.attempts + 1, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("updated_at", row.updated_at)
      .select("*")
      .maybeSingle();
    if (r.error) throw new Error(r.error.message);
    return r.data ? { row: r.data as GenRow, run: true } : { row, run: false };
  }
  if (o.kind !== "render" && config.ai.draftsPerDay > 0) {
    const since = new Date(Date.now() - 864e5).toISOString();
    const c = await db.from("ai_generations").select("id", { count: "exact", head: true }).eq("company_id", o.companyId).in("kind", ["draft", "option"]).gte("created_at", since);
    if ((c.count ?? 0) >= config.ai.draftsPerDay) throw new ProviderError(`Your company has used today's ${config.ai.draftsPerDay} drafts. More open tomorrow.`, 429, "daily_limit");
  }
  const ins = await db
    .from("ai_generations")
    .insert({ id: `gen_${crypto.randomUUID()}`, company_id: o.companyId, job_id: o.jobId, kind: o.kind, tier: o.tier, request_key: key, status: "queued", attempts: 1 })
    .select("*")
    .single();
  if (ins.error?.code === "23505") return claimGeneration(o); // a double click raced us: use theirs
  if (ins.error) throw new Error(ins.error.message);
  return { row: ins.data as GenRow, run: true };
}

async function mark(id: string, patch: Partial<GenRow>): Promise<GenRow> {
  const r = await adminDb().from("ai_generations").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select("*").single();
  if (r.error) throw new Error(r.error.message);
  return r.data as GenRow;
}

/** Run the work and record what happened. Never throws. */
export async function runGeneration(row: GenRow, work: () => Promise<{ result: unknown; model: string }>) {
  try {
    await mark(row.id, { status: "running" });
    const out = await work();
    await mark(row.id, { status: "succeeded", result: out.result as GenRow["result"], model: out.model, error: null });
  } catch (e) {
    const msg = e instanceof ProviderError ? e.message : "Something went wrong on our side. Try again.";
    if (!(e instanceof ProviderError)) console.error("generation failed", row.kind, e instanceof Error ? e.message : e);
    await mark(row.id, { status: "failed", error: msg }).catch(() => undefined);
  }
}

export async function getGeneration(id: string, companyId: string): Promise<GenRow | null> {
  const r = await adminDb().from("ai_generations").select("*").eq("id", id).eq("company_id", companyId).maybeSingle();
  if (r.error) throw new Error(r.error.message);
  let row = r.data as GenRow | null;
  if (row && isStale(row)) row = await mark(row.id, { status: "failed", error: "This took too long and stopped. Try again." });
  return row;
}
