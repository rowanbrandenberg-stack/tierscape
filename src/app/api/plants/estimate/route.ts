import { claudeJson } from "@/server/anthropic";
import { jsonError, ProviderError } from "@/server/http";

/** Ten year size of each named plant in this job's location: same plant, different climate, different size. */
export async function POST(req: Request) {
  try {
    const { location, plants } = (await req.json()) as { location?: string; plants?: { name: string; kind: string }[] };
    if (!location || !plants?.length) throw new ProviderError("Send a location and at least one plant.", 400, "bad_request");
    const list = plants.slice(0, 40).map((p, i) => `${i + 1}. ${p.name.slice(0, 80)} (${p.kind})`).join("\n");
    const out = await claudeJson<{ name: string; height_ft: number; spread_ft: number; note: string }[]>([
      {
        type: "text",
        text:
          `You are a horticulture reference for a landscape contractor. Job location: ${location}.\n` +
          "For each plant below, estimate its realistic size 10 years after planting in that specific location. Account for elevation, growing season length, winter lows, summer heat, rainfall and typical soil there, so the same plant can come out a different size in a different place. If a plant is unlikely to survive there, say so in the note.\n" +
          'Reply with only a JSON array, one object per plant in the same order: {"name": string, "height_ft": number, "spread_ft": number, "note": string}. Keep each note under 20 words and use no hyphens or dashes.\n\nPlants:\n' +
          list,
      },
    ]);
    return Response.json({ estimates: Array.isArray(out) ? out : [] });
  } catch (e) {
    return jsonError(e);
  }
}
