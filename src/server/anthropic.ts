import { config } from "./config";
import { ProviderError } from "./http";

type Block = { type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

/** One call to the Claude Messages API, returning the reply parsed as JSON. */
export async function claudeJson<T>(content: Block[], maxTokens = 1200): Promise<T> {
  const { key, model } = config.anthropic;
  if (!key || !model) throw new ProviderError("Claude is not configured. Set ANTHROPIC_API_KEY and ANTHROPIC_MODEL.", 501, "not_configured");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content }] }),
  });
  if (!r.ok) throw new ProviderError(`Claude answered ${r.status}`, 502);
  const j = (await r.json()) as { content?: { type: string; text?: string }[] };
  const text = (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  const raw = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text.slice(Math.min(...["{", "["].map((c) => (text.indexOf(c) < 0 ? Infinity : text.indexOf(c)))));
  try {
    return JSON.parse(raw.trim().replace(/[^}\]]*$/, "")) as T;
  } catch {
    throw new ProviderError("Claude's answer was not readable. Try again.", 502, "invalid_json");
  }
}

export async function fileToBlock(f: File): Promise<Block> {
  const data = Buffer.from(await f.arrayBuffer()).toString("base64");
  return { type: "image", source: { type: "base64", media_type: f.type || "image/png", data } };
}
