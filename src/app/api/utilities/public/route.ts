import { jsonError, ProviderError } from "@/server/http";
import { publicUtilities } from "@/server/publicUtilities";

/** Mapped utilities near the job, from OpenStreetMap. A prompt to call 811, never a locate. */
export async function POST(req: Request) {
  try {
    const { lat, lon, radiusM } = (await req.json()) as { lat?: number; lon?: number; radiusM?: number };
    if (typeof lat !== "number" || typeof lon !== "number") throw new ProviderError("Missing the job location.", 400, "bad_request");
    const features = await publicUtilities({ lat, lon }, radiusM);
    return Response.json({ features, credit: "© OpenStreetMap contributors" });
  } catch (e) {
    return jsonError(e);
  }
}
