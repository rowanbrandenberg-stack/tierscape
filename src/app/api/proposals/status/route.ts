import { isOffice } from "@/server/accounts";
import { companyAccess } from "@/server/companyAccess";
import { paymentsState } from "@/server/connect";
import { jsonError, ProviderError } from "@/server/http";
import { ledger } from "@/lib/payments";
import { activeAcceptance, paymentsFor } from "@/server/proposals";
import { adminDb } from "@/server/supabase";

export const dynamic = "force-dynamic";

/** Versions, the signed agreement, payments and change requests for one job. Office only. */
export async function GET(req: Request) {
  try {
    const { s } = await companyAccess();
    if (!isOffice(s)) throw new ProviderError("Crew accounts do not see proposals.", 403, "forbidden");
    const jobId = new URL(req.url).searchParams.get("jobId") ?? "";
    const db = adminDb();
    const job = await db.from("jobs").select("company_id").eq("id", jobId).maybeSingle();
    if (!job.data || job.data.company_id !== s.company.id)
      return Response.json({ synced: false, versions: [], acceptance: null, payments: [], ledger: null, changes: [], link: null, paymentsState: await paymentsState(s.company.id) });
    const [versions, changes, links] = await Promise.all([
      db.from("proposals").select("id, version, status, snapshot_hash, created_at, expires_at").eq("job_id", jobId).order("version", { ascending: false }),
      db.from("change_requests").select("id, name, message, status, created_at, proposal_id").eq("job_id", jobId).order("created_at", { ascending: false }).limit(50),
      db.from("share_links").select("created_at, last_viewed_at").eq("job_id", jobId).is("revoked_at", null).limit(1).maybeSingle(),
    ]);
    const acc = await activeAcceptance(jobId);
    const pays = acc ? await paymentsFor(acc.id) : [];
    return Response.json({
      synced: true,
      versions: versions.data ?? [],
      acceptance: acc,
      payments: pays.map((p) => ({ id: p.id, kind: p.kind, amountCents: p.amountCents, feeCents: p.feeCents, status: p.status, refundedCents: p.refundedCents, note: p.note, receiptUrl: p.receiptUrl })),
      ledger: acc ? ledger({ totalCents: acc.total_cents, depositCents: acc.deposit_cents, balanceCents: acc.balance_cents, balanceRequested: !!acc.balance_requested_at }, pays) : null,
      changes: changes.data ?? [],
      link: links.data ?? null,
      paymentsState: await paymentsState(s.company.id),
    });
  } catch (e) {
    return jsonError(e);
  }
}
