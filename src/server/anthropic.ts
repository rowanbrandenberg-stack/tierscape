import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type * as z from "zod/v4";
import { parseJsonReply } from "@/lib/prompts";
import { config } from "./config";
import { ProviderError } from "./http";
import { accountsReady } from "./accounts";
import { companyAccess } from "./companyAccess";

/**
 * Claude over the official SDK. The key stays on the server. Every call
 * either returns validated output or throws a ProviderError with a message
 * that is safe to show; nothing here invents a result.
 */

type ImageBlock = { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string } };
type Block = { type: "text"; text: string } | ImageBlock;

let client: Anthropic | null = null;
function sdk(): Anthropic {
  if (!config.anthropic.key) throw new ProviderError("Claude is not set up. Add an Anthropic API key (ANTHROPIC_API_KEY) on the server. A Claude subscription does not include API access.", 501, "not_configured");
  // Two SDK retries cover 429, 5xx and dropped connections; the job row adds retries on top.
  client ??= new Anthropic({ apiKey: config.anthropic.key, maxRetries: 2, timeout: 240_000 });
  return client;
}

/** Turn SDK errors into messages a contractor can act on. */
function asProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new ProviderError("The Anthropic API key was refused. Check ANTHROPIC_API_KEY and that the account has API billing.", 502, "provider_auth");
  if (e instanceof Anthropic.RateLimitError) return new ProviderError("Claude is busy right now. Try again in a minute.", 503, "provider_busy");
  if (e instanceof Anthropic.BadRequestError) return new ProviderError("Claude could not read this request. Try a smaller or different photo.", 502, "provider_rejected");
  if (e instanceof Anthropic.NotFoundError) return new ProviderError(`The Claude model "${config.anthropic.model}" is not available to this API key. Check ANTHROPIC_MODEL.`, 502, "provider_model");
  if (e instanceof Anthropic.APIConnectionError) return new ProviderError("Could not reach Claude. Try again.", 503, "provider_unreachable");
  if (e instanceof Anthropic.APIError) return new ProviderError(`Claude answered ${e.status ?? "with an error"}. Try again.`, 502, "provider_error");
  return new ProviderError("Claude's answer could not be used. Try again.", 502, "provider_error");
}

export interface Structured<T> {
  value: T;
  model: string;
  usage: { input: number; output: number };
}

/**
 * One structured call: the reply must match the schema or this throws.
 * Uses the server-side refusal fallback so a safety decline on the main
 * model is retried on Anthropic's default fallback inside the same call.
 */
export async function claudeStructured<S extends z.ZodType>(o: { system: string; content: Block[]; schema: S; maxTokens?: number; effort?: "low" | "medium" | "high" }): Promise<Structured<z.infer<S>>> {
  const c = sdk();
  try {
    const r = await c.beta.messages.parse({
      model: config.anthropic.model,
      max_tokens: o.maxTokens ?? 16_000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: o.effort ?? "medium", format: betaZodOutputFormat(o.schema) },
      system: o.system,
      messages: [{ role: "user", content: o.content }],
    });
    if (r.stop_reason === "refusal") throw new ProviderError("Claude declined to draft this. Check the photo and request, then try again.", 422, "refused");
    if (r.stop_reason === "max_tokens") throw new ProviderError("The draft ran too long and was cut off. Try again with a shorter request.", 502, "truncated");
    if (r.parsed_output == null) throw new ProviderError("Claude's answer did not match the expected shape. Try again.", 502, "invalid_output");
    return { value: r.parsed_output as z.infer<S>, model: r.model, usage: { input: r.usage.input_tokens, output: r.usage.output_tokens } };
  } catch (e) {
    throw asProviderError(e);
  }
}

/** The older free form JSON calls (plant sizes, photo placement, utility clues). */
export async function claudeJson<T>(content: Block[], maxTokens = 1200): Promise<T> {
  const c = sdk();
  // These routes spend the server's key, so once accounts are live only a company with a plan or trial may call them.
  if (accountsReady().ok) {
    const { a } = await companyAccess();
    if (!a.canCreate) throw new ProviderError(a.notice ?? "Start the free trial or choose a plan to use AI assist.", 402, "no_plan");
  }
  let text = "";
  try {
    const r = await c.messages.create({ model: config.anthropic.model, max_tokens: Math.max(maxTokens, 4000), output_config: { effort: "low" }, messages: [{ role: "user", content }] });
    if (r.stop_reason === "refusal") throw new ProviderError("Claude declined this request.", 422, "refused");
    text = r.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
  } catch (e) {
    throw asProviderError(e);
  }
  try {
    return parseJsonReply<T>(text);
  } catch {
    throw new ProviderError("Claude's answer was not readable. Try again.", 502, "invalid_json");
  }
}

const MEDIA = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
export function bytesToBlock(bytes: Buffer, type: string): ImageBlock {
  const media_type = (MEDIA as readonly string[]).includes(type) ? (type as ImageBlock["source"]["media_type"]) : "image/jpeg";
  return { type: "image", source: { type: "base64", media_type, data: bytes.toString("base64") } };
}

export async function fileToBlock(f: File): Promise<Block> {
  return bytesToBlock(Buffer.from(await f.arrayBuffer()), f.type || "image/png");
}
