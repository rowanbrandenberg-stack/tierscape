import { extentAround } from "@/lib/jobs";
import { toPlan } from "@/lib/projection";
import type { Site } from "@/lib/types";
import { imageryReady } from "@/server/config";
import { geocode } from "@/server/geocode";
import { jsonError, ProviderError } from "@/server/http";
import { imageryLabel, PLAN_ZOOM } from "@/server/imagery";
import { findParcel } from "@/server/parcels";

/** Address in, a ready to plan site out: location, county, parcel outline in plan feet, imagery. */
export async function POST(req: Request) {
  try {
    const { address } = (await req.json()) as { address?: string };
    if (!address || address.trim().length < 6) throw new ProviderError("Enter a full street address.", 400, "bad_request");
    const g = await geocode(address.trim());
    const parcel = await findParcel(g);
    const origin = parcel
      ? { lat: parcel.ring.reduce((s, p) => s + p.lat, 0) / parcel.ring.length, lon: parcel.ring.reduce((s, p) => s + p.lon, 0) / parcel.ring.length }
      : { lat: g.lat, lon: g.lon };
    const pts = parcel ? parcel.ring.map((p) => toPlan(origin, p)) : null;
    if (pts && pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.01) pts.pop();
    const img = imageryReady();
    const site: Site = {
      address: address.trim(),
      matchedAddress: g.matchedAddress,
      state: g.state,
      county: g.county,
      origin,
      extent: extentAround(pts ?? [[-50, -35], [50, 35]], 30),
      parcel: pts ? { apn: parcel!.apn, address: parcel!.address, pts, source: parcel!.source } : null,
      imagery: img.ok ? { provider: imageryLabel(), zoom: PLAN_ZOOM } : null,
    };
    return Response.json({ site, notes: { parcel: parcel ? null : "No parcel line found for this address. Draw the property line by hand.", imagery: img.ok ? null : img.why } });
  } catch (e) {
    return jsonError(e);
  }
}
