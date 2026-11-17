import { claudeJson, fileToBlock } from "@/server/anthropic";
import { jsonError, ProviderError } from "@/server/http";

const COLORS: Record<string, string> = { yellow: "gas", red: "elec", orange: "comm", blue: "water", purple: "irr", green: "sewer" };

/**
 * Trace locator paint and flags from a ground photo onto the plan. The plan
 * image shows where the photo was taken and which way it faced.
 */
export async function POST(req: Request) {
  try {
    const fd = await req.formData();
    const plan = fd.get("plan");
    const photo = fd.get("photo");
    if (!(plan instanceof File) || !(photo instanceof File)) throw new ProviderError("Send the plan image and the photo.", 400, "bad_request");
    const r = await claudeJson<{ marks?: { color: string; pts: [number, number][]; confidence: string }[]; note?: string }>(
      [
        await fileToBlock(plan),
        await fileToBlock(photo),
        {
          type: "text",
          text:
            "Image 1 is a top down plan of one property with north at the top and a lettered grid (columns A to J, rows 1 to 10). The cyan wedge marked PHOTO shows where image 2 was taken and the direction the camera faced.\n" +
            "Image 2 is a ground photo after an 811 locate. Find every locator mark: spray paint lines, dashes and arrows, and small colored flags. Colors follow the APWA code: yellow gas, red electric, orange communications, blue water, purple irrigation or reclaimed, green sewer or storm.\n" +
            "For each run of marks, trace where it lies on the plan. Use the photo position and facing, plus landmarks such as the house, driveway, fence and trees, to place it. Follow dashes and arrows to extend the line across what the photo shows.\n" +
            'Reply with only JSON: {"marks": [{"color": "yellow" or "red" or "orange" or "blue" or "purple" or "green", "pts": [[x_pct, y_pct], ...], "confidence": "high" or "medium" or "low"}], "note": string}. Percentages run 0 to 100 from the left and top edges of image 1. Use at least two points per mark. Keep the note under 25 words with no hyphens or dashes. If you see no locator marks, return an empty list and say so in the note.',
        },
      ],
      1500,
    );
    const num = (n: unknown) => Number.isFinite(Number(n)) && Number(n) >= -5 && Number(n) <= 105;
    const marks = (r.marks ?? [])
      .filter((m) => COLORS[m.color] && Array.isArray(m.pts) && m.pts.length >= 2 && m.pts.every((p) => num(p?.[0]) && num(p?.[1])))
      .slice(0, 12)
      .map((m) => ({ type: COLORS[m.color], pts: m.pts.map((p) => [Number(p[0]), Number(p[1])] as [number, number]), confidence: m.confidence }));
    return Response.json({ marks, note: String(r.note ?? "").slice(0, 200) });
  } catch (e) {
    return jsonError(e);
  }
}
