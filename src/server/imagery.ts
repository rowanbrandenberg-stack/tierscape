import { config } from "./config";

/** Zoom used for plans. 19 is about 0.25 m per pixel; providers fall back gracefully. */
export const PLAN_ZOOM = 19;

export function tileUrl(z: number, x: number, y: number): string {
  const c = config.imagery;
  if (c.provider === "nearmap") {
    // Nearmap Tile API. Confirm the path and tracing rights in your Nearmap agreement.
    return `https://api.nearmap.com/tiles/v3/Vert/${z}/${x}/${y}.jpg?apikey=${encodeURIComponent(c.nearmapKey)}`;
  }
  const token = c.arcgisKey ? `?token=${encodeURIComponent(c.arcgisKey)}` : "";
  return `https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}${token}`;
}

/** Sharper zoom levels the plan asks for when you zoom in, where the provider has them. */
export const DETAIL_MAX_ZOOM = 21;

/**
 * Esri only has 20 and 21 in places with high resolution imagery, and serves a
 * "map data not yet available" picture elsewhere. Its tile map says which
 * tiles really exist, so missing ones can fall back to the zoom 19 base.
 */
export async function hasDetailTile(z: number, x: number, y: number): Promise<boolean> {
  if (z <= PLAN_ZOOM || config.imagery.provider === "nearmap") return true;
  const token = config.imagery.arcgisKey ? `&token=${encodeURIComponent(config.imagery.arcgisKey)}` : "";
  const url = `https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tilemap/${z}/${y}/${x}/1/1?f=json${token}`;
  try {
    const r = await fetch(url, { next: { revalidate: 60 * 60 * 24 * 30 } });
    if (!r.ok) return true;
    const j = (await r.json()) as { valid?: boolean; data?: number[] };
    if (j.valid === false) return false;
    return Array.isArray(j.data) ? j.data[0] === 1 : true;
  } catch {
    return true;
  }
}

export const imageryLabel = () => (config.imagery.provider === "nearmap" ? "Nearmap" : "Esri World Imagery");
