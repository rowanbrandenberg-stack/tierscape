import { jsonError, ProviderError } from "@/server/http";
import { parcelAt } from "@/server/parcels";

/** The parcel under a point, used when the address landed on the wrong lot. */
export async function POST(req: Request) {
  try {
    const { lat, lon } = (await req.json()) as { lat?: number; lon?: number };
    if (typeof lat !== "number" || typeof lon !== "number") throw new ProviderError("Missing the point to look up.", 400, "bad_request");
    const p = await parcelAt({ lat, lon });
    if (!p) throw new ProviderError("No parcel found there. Try clicking closer to the middle of the lot.", 404, "not_found");
    return Response.json({ parcel: p });
  } catch (e) {
    return jsonError(e);
  }
}
