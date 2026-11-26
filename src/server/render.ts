import { config } from "./config";
import { ProviderError } from "./http";

/**
 * Concept images from a site photo with the OpenAI image edit endpoint
 * (POST /v1/images/edits, multipart with image[]). The key stays on the server.
 */

const TIMEOUT_MS = 180_000;

export async function editImage(photo: Buffer, contentType: string, prompt: string, safetyId?: string): Promise<{ bytes: Buffer; model: string }> {
  const { openaiKey, model } = config.render;
  if (!openaiKey) throw new ProviderError("Concept pictures are not set up. Add an OpenAI API key (OPENAI_API_KEY) on the server.", 501, "not_configured");
  const fd = new FormData();
  fd.set("model", model);
  fd.set("prompt", prompt.slice(0, 32_000));
  fd.append("image[]", new Blob([new Uint8Array(photo)], { type: contentType || "image/jpeg" }), contentType.includes("png") ? "yard.png" : "yard.jpg");
  fd.set("n", "1");
  fd.set("size", "auto");
  fd.set("quality", "medium");
  fd.set("output_format", "jpeg");
  // Only gpt-image-1.5 takes input_fidelity; the newer models keep the source by default.
  if (model.startsWith("gpt-image-1.5")) fd.set("input_fidelity", "high");
  if (safetyId) fd.set("safety_identifier", safetyId.slice(0, 128));
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let r: Response;
  try {
    r = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { authorization: `Bearer ${openaiKey}` }, body: fd, signal: ctl.signal });
  } catch {
    throw new ProviderError("Could not reach the image model. Try again.", 503, "provider_unreachable");
  } finally {
    clearTimeout(t);
  }
  if (r.status === 401 || r.status === 403) throw new ProviderError("The OpenAI API key was refused. Check OPENAI_API_KEY.", 502, "provider_auth");
  if (r.status === 429) throw new ProviderError("The image model is busy or out of credit. Try again later.", 503, "provider_busy");
  if (r.status === 400) {
    const j = (await r.json().catch(() => ({}))) as { error?: { code?: string } };
    if (j.error?.code === "moderation_blocked") throw new ProviderError("The image model declined this photo.", 422, "refused");
    throw new ProviderError("The image model could not use this photo. Try a different one.", 502, "provider_rejected");
  }
  if (!r.ok) throw new ProviderError(`The image model answered ${r.status}. Try again.`, 502, "provider_error");
  const j = (await r.json()) as { data?: { b64_json?: string }[] };
  const b64 = j.data?.[0]?.b64_json;
  if (!b64) throw new ProviderError("The image model returned no image.", 502, "provider_error");
  return { bytes: Buffer.from(b64, "base64"), model };
}

/** The address planner's render step: the same endpoint, returned as a data URL. */
export async function renderAfter(photo: File, prompt: string): Promise<{ dataUrl: string }> {
  const { bytes } = await editImage(Buffer.from(await photo.arrayBuffer()), photo.type || "image/png", prompt);
  return { dataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}` };
}
