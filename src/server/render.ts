import { config } from "./config";
import { ProviderError } from "./http";

/**
 * Photoreal after image from a site photo and the plan's prompt.
 * Uses the OpenAI image edit endpoint; swap here for another model.
 */
export async function renderAfter(photo: File, prompt: string): Promise<{ dataUrl: string }> {
  const { openaiKey, model } = config.render;
  if (!openaiKey) throw new ProviderError("Renders are not configured. Set OPENAI_API_KEY.", 501, "not_configured");
  const fd = new FormData();
  fd.set("model", model);
  fd.set("prompt", prompt);
  fd.set("image", photo, photo.name || "site.png");
  const r = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { authorization: `Bearer ${openaiKey}` }, body: fd });
  if (!r.ok) throw new ProviderError(`The image model answered ${r.status}`, 502);
  const j = (await r.json()) as { data?: { b64_json?: string }[] };
  const b64 = j.data?.[0]?.b64_json;
  if (!b64) throw new ProviderError("The image model returned no image.", 502);
  return { dataUrl: `data:image/png;base64,${b64}` };
}
