import { LOCATE_PROMPT, normLocate } from "@/lib/prompts";
import { claudeJson, fileToBlock } from "@/server/anthropic";
import { jsonError, ProviderError } from "@/server/http";

/** Where was this photo taken? Claude compares a ground photo with the gridded plan. */
export async function POST(req: Request) {
  try {
    const fd = await req.formData();
    const plan = fd.get("plan");
    const photo = fd.get("photo");
    if (!(plan instanceof File) || !(photo instanceof File)) throw new ProviderError("Send the plan image and the photo.", 400, "bad_request");
    const r = normLocate(await claudeJson([await fileToBlock(plan), await fileToBlock(photo), { type: "text", text: LOCATE_PROMPT }]));
    if (!r) throw new ProviderError("Could not place this photo. Mark the spot on the plan instead.", 422, "unplaced");
    return Response.json(r);
  } catch (e) {
    return jsonError(e);
  }
}
