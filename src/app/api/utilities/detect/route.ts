import { DETECT_PROMPT, normDetect } from "@/lib/prompts";
import { claudeJson, fileToBlock } from "@/server/anthropic";
import { aiGate } from "@/server/aiQuota";
import { jsonError, ProviderError } from "@/server/http";

/** Clues on the aerial that point to buried utilities, with probable service routes. Every result is a guess. */
export async function POST(req: Request) {
  try {
    const g = await aiGate();
    const fd = await req.formData();
    const plan = fd.get("plan");
    if (!(plan instanceof File)) throw new ProviderError("Send the plan image.", 400, "bad_request");
    return Response.json(normDetect(await g.run(async () => claudeJson([await fileToBlock(plan), { type: "text", text: DETECT_PROMPT }], 1800))));
  } catch (e) {
    return jsonError(e);
  }
}
