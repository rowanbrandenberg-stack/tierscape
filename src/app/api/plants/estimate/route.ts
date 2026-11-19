import { estimatePrompt, normEstimates } from "@/lib/prompts";
import { claudeJson } from "@/server/anthropic";
import { jsonError, ProviderError } from "@/server/http";

/** Ten year size of each named plant in this job's location: same plant, different climate, different size. */
export async function POST(req: Request) {
  try {
    const { location, plants } = (await req.json()) as { location?: string; plants?: { name: string; kind: string }[] };
    if (!location || !plants?.length) throw new ProviderError("Send a location and at least one plant.", 400, "bad_request");
    const out = await claudeJson<unknown>([{ type: "text", text: estimatePrompt(location, plants) }]);
    return Response.json({ estimates: normEstimates(out) });
  } catch (e) {
    return jsonError(e);
  }
}
