import { reserveImages, confirmImages, refundImages } from "@/lib/billing/core";
import { dbStore } from "@/server/billingStore";
import { companyAccess } from "@/server/companyAccess";
import { jsonError, ProviderError } from "@/server/http";
import { renderAfter } from "@/server/render";

export const maxDuration = 200;

/**
 * Address planner renders. Signed in companies only, counted against the
 * plan's image allowance, so the server key cannot be spent by anyone else.
 */
export async function POST(req: Request) {
  let key: string | null = null;
  let store: ReturnType<typeof dbStore> | null = null;
  try {
    const { s, a } = await companyAccess();
    store = dbStore();
    const fd = await req.formData();
    const photo = fd.get("photo");
    const prompt = fd.get("prompt");
    if (!(photo instanceof File) || typeof prompt !== "string" || !prompt.trim()) throw new ProviderError("Send a site photo and a prompt.", 400, "bad_request");
    if (photo.size > 12 * 1024 * 1024) throw new ProviderError("The photo is larger than 12 MB.", 413, "too_large");
    key = `plan-render:${s.company.id}:${crypto.randomUUID()}`;
    const r = await reserveImages(store, s.company.id, a, key, 1);
    if (!r.ok) {
      key = null;
      throw new ProviderError(r.reason, 402, "no_allowance");
    }
    const out = await renderAfter(photo, prompt.slice(0, 30_000));
    await confirmImages(store, key);
    return Response.json(out);
  } catch (e) {
    if (key && store) await refundImages(store, key).catch(() => undefined);
    return jsonError(e);
  }
}
