import { claudeJson, fileToBlock } from "@/server/anthropic";
import { jsonError, ProviderError } from "@/server/http";

const TYPES = ["gas", "elec", "comm", "water", "irr", "sewer"];

/**
 * Clues on the aerial that point to buried utilities: meters, pedestals,
 * transformers, valve boxes, cleanouts. Claude returns them with probable
 * service routes. Every result is a guess the landscaper confirms with 811.
 */
export async function POST(req: Request) {
  try {
    const fd = await req.formData();
    const plan = fd.get("plan");
    if (!(plan instanceof File)) throw new ProviderError("Send the plan image.", 400, "bad_request");
    const r = await claudeJson<{
      clues?: { type: string; x_pct: number; y_pct: number; label: string }[];
      routes?: { type: string; pts: [number, number][]; label: string }[];
    }>(
      [
        await fileToBlock(plan),
        {
          type: "text",
          text:
            "This is a top down aerial of one residential property with north at the top, under a lettered grid (columns A to J, rows 1 to 10). The dashed amber outline is the property line. Colored outlines are planned dig areas.\n" +
            "Find visible clues to underground utilities on or next to this lot: power poles, pad mount transformers, utility pedestals and boxes, gas and electric meters on the house wall, water meter boxes near the curb, fire hydrants, manholes, sewer cleanouts, valve covers, irrigation controllers or valve boxes, AC units, propane tanks, septic lids.\n" +
            "Then sketch the probable route of each service line from where it most likely enters the lot (street, alley or a pole or pedestal) to where it most likely meets the house. Services usually run in a fairly straight line from the street side to the meter. Only sketch a route when you can see or reasonably infer both ends.\n" +
            `Types: gas, elec, comm (phone, cable, fiber), water, irr (irrigation), sewer. Reply with only JSON: {"clues": [{"type": one of ${TYPES.join(", ")}, "x_pct": number, "y_pct": number, "label": string}], "routes": [{"type": string, "pts": [[x_pct, y_pct], ...], "label": string}]}. Percentages run 0 to 100 from the left and top edges. Labels under 8 words, plain words, no hyphens or dashes. Include at most 12 clues and 6 routes. Leave out anything you are not reasonably confident you can see.`,
        },
      ],
      1800,
    );
    const ok = (t: string) => TYPES.includes(t);
    const num = (n: unknown) => Number.isFinite(Number(n)) && Number(n) >= -5 && Number(n) <= 105;
    const clues = (r.clues ?? []).filter((c) => ok(c.type) && num(c.x_pct) && num(c.y_pct)).slice(0, 12).map((c) => ({ type: c.type, xPct: Number(c.x_pct), yPct: Number(c.y_pct), label: String(c.label ?? "").slice(0, 80) }));
    const routes = (r.routes ?? [])
      .filter((x) => ok(x.type) && Array.isArray(x.pts) && x.pts.length >= 2 && x.pts.every((p) => num(p?.[0]) && num(p?.[1])))
      .slice(0, 6)
      .map((x) => ({ type: x.type, pts: x.pts.map((p) => [Number(p[0]), Number(p[1])] as [number, number]), label: String(x.label ?? "").slice(0, 80) }));
    return Response.json({ clues, routes });
  } catch (e) {
    return jsonError(e);
  }
}
