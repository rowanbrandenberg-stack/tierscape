import { claudeJson, fileToBlock } from "@/server/anthropic";
import { jsonError, ProviderError } from "@/server/http";

/**
 * Where was this photo taken? Claude compares a ground photo with the plan
 * (rendered with a lettered grid) and returns a position and a facing.
 */
export async function POST(req: Request) {
  try {
    const fd = await req.formData();
    const plan = fd.get("plan");
    const photo = fd.get("photo");
    if (!(plan instanceof File) || !(photo instanceof File)) throw new ProviderError("Send the plan image and the photo.", 400, "bad_request");
    const r = await claudeJson<{ x_pct: number; y_pct: number; facing_deg: number; confidence: string; reason: string }>([
      await fileToBlock(plan),
      await fileToBlock(photo),
      {
        type: "text",
        text:
          "Image 1 is a top down plan of one property with north at the top. A grid splits it into columns A to J from left to right and rows 1 to 10 from top to bottom. Colored outlines are planned work areas with labels.\n" +
          "Image 2 is a photo taken at ground level somewhere on this property.\n" +
          "Work out where the photographer stood and which way the camera pointed. Match what is in the photo to the plan: the house walls and roof line, fences, driveway, sidewalk and street, trees, sheds and any paving.\n" +
          'Reply with only JSON: {"x_pct": number, "y_pct": number, "facing_deg": number, "confidence": "high" or "medium" or "low", "reason": string}. x_pct runs 0 to 100 from the left edge, y_pct 0 to 100 from the top edge. facing_deg is the compass direction the camera points: 0 north, 90 east, 180 south, 270 west. Keep the reason under 25 words and use no hyphens or dashes.',
      },
    ]);
    const ok = [r.x_pct, r.y_pct, r.facing_deg].every((n) => Number.isFinite(Number(n)));
    if (!ok) throw new ProviderError("Could not place this photo. Mark the spot on the plan instead.", 422, "unplaced");
    return Response.json({ xPct: Number(r.x_pct), yPct: Number(r.y_pct), facingDeg: Number(r.facing_deg), confidence: r.confidence, reason: String(r.reason ?? "").slice(0, 200) });
  } catch (e) {
    return jsonError(e);
  }
}
