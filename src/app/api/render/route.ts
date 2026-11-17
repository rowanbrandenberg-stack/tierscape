import { jsonError, ProviderError } from "@/server/http";
import { renderAfter } from "@/server/render";

export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const fd = await req.formData();
    const photo = fd.get("photo");
    const prompt = fd.get("prompt");
    if (!(photo instanceof File) || typeof prompt !== "string" || !prompt.trim()) throw new ProviderError("Send a site photo and a prompt.", 400, "bad_request");
    return Response.json(await renderAfter(photo, prompt.slice(0, 30_000)));
  } catch (e) {
    return jsonError(e);
  }
}
