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

export const imageryLabel = () => (config.imagery.provider === "nearmap" ? "Nearmap" : "Esri World Imagery");
