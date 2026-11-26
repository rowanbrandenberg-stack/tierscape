import { normTrace, TRACE_PROMPT } from "@/lib/prompts";
import { claudeJson, fileToBlock } from "@/server/anthropic";
import { aiGate } from "@/server/aiQuota";
import { jsonError, ProviderError } from "@/server/http";

/** Trace locator paint and flags from a ground photo onto the plan. */
export async function POST(req: Request) {
  try {
    const g = await aiGate();
    const fd = await req.formData();
    const plan = fd.get("plan");
    const photo = fd.get("photo");
    if (!(plan instanceof File) || !(photo instanceof File)) throw new ProviderError("Send the plan image and the photo.", 400, "bad_request");
    return Response.json(normTrace(await g.run(async () => claudeJson([await fileToBlock(plan), await fileToBlock(photo), { type: "text", text: TRACE_PROMPT }], 1500))));
  } catch (e) {
    return jsonError(e);
  }
}
