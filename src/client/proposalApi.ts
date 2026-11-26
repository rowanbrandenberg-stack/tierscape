"use client";
import type { ConceptOption, PhotoConcept, RenderRef } from "@/lib/concept";
import type { Job, TierKey } from "@/lib/types";
import { ApiError } from "./api";

/** Browser side of photo drafting, publishing and payments. Every call goes to our own server. */

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init }).catch(() => null);
  if (!r) throw new ApiError("Could not reach Tierscape. Check your connection.", "network");
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError((j as { message?: string }).message ?? "Something went wrong.", (j as { error?: string }).error ?? "error");
  return j as T;
}
const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** Phone photos are large. Send at most 2048 px on the long side as JPEG, which also turns HEIC into something every model reads. */
export async function downscale(file: Blob, max = 2048): Promise<Blob> {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new ApiError("This photo could not be opened. Try a JPEG or PNG.", "bad_type");
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new ApiError("This photo could not be prepared.", "bad_type"))), "image/jpeg", 0.86));
}

export interface AiStatus {
  ready: boolean;
  blockers: { code: string; message: string }[];
  renders: { ok: true } | { ok: false; why: string };
  model: string | null;
}

export interface Gen<T = unknown> {
  id: string;
  kind: "draft" | "option" | "render";
  tier: TierKey | null;
  status: "queued" | "running" | "succeeded" | "failed";
  attempts: number;
  error: string | null;
  result: T | null;
}

export const requestKey = (kind: string) => `${kind}_${crypto.randomUUID()}`;

/** Wait for a durable AI job, reading its row until it finishes. */
export async function waitFor<T>(g: Gen<T>, onTick?: (g: Gen<T>) => void, timeoutMs = 7 * 60_000): Promise<Gen<T>> {
  const until = Date.now() + timeoutMs;
  let cur = g;
  while (cur.status === "queued" || cur.status === "running") {
    if (Date.now() > until) throw new ApiError("This is taking longer than expected. It keeps running; check back in a minute.", "slow");
    await new Promise((r) => setTimeout(r, 2500));
    cur = await call<Gen<T>>(`/api/ai/generations/${encodeURIComponent(cur.id)}`);
    onTick?.(cur);
  }
  return cur;
}

export const proposalApi = {
  aiStatus: () => call<AiStatus>("/api/ai/status"),
  uploadPhoto: (job: Job, photo: Blob) => {
    const fd = new FormData();
    fd.set("photo", new File([photo], "yard.jpg", { type: photo.type || "image/jpeg" }));
    fd.set("job", JSON.stringify({ ...job, photos: [] }));
    return call<{ photoId: string }>(`/api/jobs/${encodeURIComponent(job.id)}/photos`, { method: "POST", body: fd });
  },
  saveJob: (job: Job) => call<{ ok: true }>(`/api/jobs/${encodeURIComponent(job.id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(job) }),
  draft: (jobId: string, key: string, concept: PhotoConcept) => call<Gen<{ concept: PhotoConcept }>>("/api/ai/draft", post({ jobId, requestKey: key, concept })),
  option: (jobId: string, key: string, concept: PhotoConcept, tier: TierKey, instruction: string) => call<Gen<{ option: ConceptOption }>>("/api/ai/option", post({ jobId, requestKey: key, concept, tier, instruction })),
  render: (jobId: string, key: string, concept: PhotoConcept, tier: TierKey) => call<Gen<{ tier: TierKey; render: RenderRef }>>("/api/ai/render", post({ jobId, requestKey: key, concept, tier })),
  assetUrl: (jobId: string, assetId: string) => `/api/jobs/${encodeURIComponent(jobId)}/assets/${encodeURIComponent(assetId)}`,
  publish: (jobId: string) => call<{ proposal: { id: string; version: number; hash: string; createdAt: string }; token: string | null }>("/api/proposals/publish", post({ jobId })),
  link: (jobId: string, action: "rotate" | "revoke") => call<{ token: string | null }>("/api/proposals/link", post({ jobId, action })),
  status: (jobId: string) => call<ProposalStatus>(`/api/proposals/status?jobId=${encodeURIComponent(jobId)}`),
  requestBalance: (jobId: string) => call<{ ok: true }>("/api/proposals/balance", post({ jobId })),
  connect: () => call<PaymentsState>("/api/payments/connect"),
  onboard: () => call<{ url: string }>("/api/payments/connect", { method: "POST" }),
};

export interface PaymentsState {
  ready: boolean;
  accountId: string | null;
  livemode: boolean;
  feeBps: number;
  blockers: { code: string; message: string }[];
}

export interface ProposalStatus {
  synced: boolean;
  versions: { id: string; version: number; status: string; snapshot_hash: string; created_at: string; expires_at: string }[];
  acceptance: { id: string; tier: TierKey; signer_name: string; signer_email: string | null; total_cents: number; deposit_cents: number; balance_cents: number; accepted_at: string; balance_requested_at: string | null; proposal_id: string; option_snapshot: { name: string } } | null;
  payments: { id: string; kind: "deposit" | "balance"; amountCents: number; feeCents: number; status: string; refundedCents: number; note: string | null; receiptUrl: string | null }[];
  ledger: { deposit: { status: string; dueCents: number }; balance: { status: string; dueCents: number }; paidCents: number; refundedCents: number; outstandingCents: number } | null;
  changes: { id: string; name: string | null; message: string; status: string; created_at: string }[];
  link: { created_at: string; last_viewed_at: string | null } | null;
  paymentsState: PaymentsState;
}

/** The plain share token is shown once by the server, so this browser keeps it to copy again later. */
const LINKS = "tierscape.links";
export const savedLink = (jobId: string): string | null => {
  try {
    return (JSON.parse(localStorage.getItem(LINKS) ?? "{}") as Record<string, string>)[jobId] ?? null;
  } catch {
    return null;
  }
};
export const saveLink = (jobId: string, token: string | null) => {
  try {
    const all = JSON.parse(localStorage.getItem(LINKS) ?? "{}") as Record<string, string>;
    if (token) all[jobId] = token;
    else delete all[jobId];
    localStorage.setItem(LINKS, JSON.stringify(all));
  } catch {
    // Private mode: the contractor can always make a new link.
  }
};
