import { after } from "next/server";
import { confirmImages, refundImages, reserveImages, type Access } from "@/lib/billing/core";
import { adoptDraft, adoptOption, conceptRenderPrompt, DRAFT_SYSTEM, DraftSchema, emptyConcept, OptionSchema, optionPrompt, draftPrompt, TIER_ORDER, type DraftContext, type PhotoConcept } from "@/lib/concept";
import { ratesOf } from "@/lib/settings";
import type { Job, TierKey } from "@/lib/types";
import { companySettings, assertDraftable } from "./aiGate";
import { holdAiCall } from "./aiQuota";
import { bytesToBlock, claudeStructured } from "./anthropic";
import { getAsset, putAsset } from "./assets";
import { dbStore } from "./billingStore";
import { isOffice, type Session } from "./accounts";
import { claimGeneration, publicGen, runGeneration, type GenKind } from "./generations";
import { ProviderError } from "./http";
import { loadJob } from "./jobs";
import { editImage } from "./render";

type CompanySession = Session & { company: { id: string; name: string } };

const str = (v: unknown, n: number) => String(v ?? "").slice(0, n);
const nn = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
const isTier = (t: unknown): t is TierKey => TIER_ORDER.includes(t as TierKey);

/**
 * The concept as the client last saw it, cleaned. The server only trusts the
 * shape; content is the contractor's own and goes to the model as data.
 */
export function cleanConcept(raw: unknown, fallbackRequest = ""): PhotoConcept {
  const c = (raw ?? {}) as Partial<PhotoConcept>;
  const base = emptyConcept(str(c.request ?? fallbackRequest, 800));
  const m = (c.measurement ?? {}) as Partial<PhotoConcept["measurement"]>;
  return {
    ...base,
    ...(c as PhotoConcept),
    request: base.request,
    notes: str(c.notes, 3000),
    photoId: c.photoId ? str(c.photoId, 80) : null,
    questions: Array.isArray(c.questions) ? c.questions.slice(0, 8).map((q, i) => ({ id: str(q?.id || `q${i}`, 60), question: str(q?.question, 200), why: str(q?.why, 200), answer: str(q?.answer, 600) })) : [],
    measurement: { areaSqft: nn(m.areaSqft), edgeFt: nn(m.edgeFt), source: m.source === "contractor" || m.source === "plan" ? m.source : "photo_estimate", confirmed: !!m.confirmed, note: str(m.note, 200) },
    options: Array.isArray(c.options) ? c.options : [],
  };
}

async function context(companyId: string, job: Job, concept: PhotoConcept): Promise<{ ctx: DraftContext; rates: ReturnType<typeof ratesOf> }> {
  const st = await companySettings(companyId);
  const rates = ratesOf(st.pricing);
  return {
    rates,
    ctx: {
      request: concept.request,
      notes: concept.notes,
      location: job.site?.matchedAddress ?? job.site?.address ?? null,
      answers: concept.questions.filter((q) => q.answer.trim()).map((q) => ({ question: q.question, answer: q.answer })),
      measurement: concept.measurement,
      laborRate: st.pricing.laborRate,
      crewSize: st.pricing.crewSize,
      experience: st.profile.experience ?? "",
      rates,
    },
  };
}

async function photoFor(companyId: string, jobId: string, photoId: string | null) {
  if (!photoId) throw new ProviderError("Upload the yard photo first.", 400, "no_photo");
  const a = await getAsset(photoId, companyId, jobId);
  if (!a || a.row.kind !== "photo") throw new ProviderError("The yard photo was not found on this job. Upload it again.", 404, "no_photo");
  return a;
}

export interface StartBody {
  jobId: string;
  requestKey: string;
  tier?: string;
  instruction?: string;
  concept?: unknown;
}

/** Check the request, claim the row, and run the work after the response. */
export async function startGeneration(kind: GenKind, s: CompanySession, a: Access, body: StartBody) {
  if (!isOffice(s)) throw new ProviderError("Crew accounts cannot draft proposals.", 403, "forbidden");
  if (kind !== "render") assertDraftable(a);
  else if (!a.canCreate) throw new ProviderError(a.notice ?? "Choose a plan to make concept pictures.", 402, "no_plan");
  const jobId = str(body.jobId, 80);
  const job = await loadJob(s.company.id, jobId);
  if (!job) throw new ProviderError("Save the job to your account first.", 404, "no_job");
  const concept = cleanConcept(body.concept, job.concept?.request);
  const tier = kind === "draft" ? null : isTier(body.tier) ? body.tier : null;
  if (kind !== "draft" && !tier) throw new ProviderError("Pick an option.", 400, "bad_request");
  const photo = await photoFor(s.company.id, jobId, concept.photoId);

  // Drafts and option rewrites are Claude calls: hold one from today's cap before queuing, so a full cap answers 429 now.
  const hold = kind === "render" ? null : await holdAiCall(s.company.id, a);
  let claimed: Awaited<ReturnType<typeof claimGeneration>>;
  try {
    claimed = await claimGeneration({ companyId: s.company.id, jobId, kind, tier, requestKey: str(body.requestKey, 120) });
  } catch (e) {
    await hold?.refund();
    throw e;
  }
  const { row, run } = claimed;
  if (!run) {
    // A repeat click joined the run already going: it is not a second call.
    await hold?.refund();
    return publicGen(row);
  }

  const store = dbStore();
  const companyId = s.company.id;
  const theJob = job;
  const work = async (): Promise<{ result: unknown; model: string }> => {
    const { ctx, rates } = await context(companyId, theJob, concept);
    if (kind === "draft") {
      const out = await claudeStructured({ system: DRAFT_SYSTEM, content: [bytesToBlock(photo.bytes, photo.row.content_type), { type: "text", text: draftPrompt(ctx) }], schema: DraftSchema, maxTokens: 24_000 });
      return { result: { concept: adoptDraft(out.value, concept, rates, out.model) }, model: out.model };
    }
    if (kind === "option") {
      const out = await claudeStructured({ system: DRAFT_SYSTEM, content: [bytesToBlock(photo.bytes, photo.row.content_type), { type: "text", text: optionPrompt(ctx, concept, tier!, str(body.instruction, 800)) }], schema: OptionSchema, maxTokens: 12_000 });
      return { result: { option: { ...adoptOption(out.value, tier!, rates), source: "ai" } }, model: out.model };
    }
    // render: one image from the allowance, refunded if it fails.
    const option = concept.options.find((o) => o.tier === tier);
    if (!option?.visual?.change) throw new ProviderError("This option has no visual description yet. Draft it first.", 400, "no_visual");
    const usageKey = `render:${row.id}:${row.attempts}`;
    const res = await reserveImages(store, companyId, a, usageKey, 1);
    if (!res.ok) throw new ProviderError(res.reason, 402, "no_allowance");
    try {
      const img = await editImage(photo.bytes, photo.row.content_type, conceptRenderPrompt(option, concept.request), companyId);
      const asset = await putAsset({ id: `rd_${crypto.randomUUID()}`, companyId, jobId, kind: "render", tier, bytes: img.bytes });
      await confirmImages(store, usageKey);
      return { result: { tier, render: { assetId: asset.id, createdAt: new Date().toISOString(), model: img.model } }, model: img.model };
    } catch (e) {
      await refundImages(store, usageKey).catch(() => undefined);
      throw e;
    }
  };
  after(() =>
    runGeneration(row, async () => {
      if (!hold) return work();
      try {
        const out = await work();
        await hold.confirm();
        return out;
      } catch (e) {
        await hold.refund();
        throw e;
      }
    }),
  );
  return publicGen({ ...row, status: "queued" });
}
