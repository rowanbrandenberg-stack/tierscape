import type { GeoPoint, Pt } from "./types";

/**
 * Local flat projection around an origin. Accurate to a few inches across a
 * residential lot, which is far better than any aerial or parcel source.
 * x = feet east of the origin, y = feet south of the origin.
 */
const FT_PER_M = 3.280839895;
const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LON_EQ = 111_320;

export function toPlan(origin: GeoPoint, p: GeoPoint): Pt {
  const kx = M_PER_DEG_LON_EQ * Math.cos((origin.lat * Math.PI) / 180) * FT_PER_M;
  const ky = M_PER_DEG_LAT * FT_PER_M;
  return [(p.lon - origin.lon) * kx, -(p.lat - origin.lat) * ky];
}

export function toGeo(origin: GeoPoint, q: Pt): GeoPoint {
  const kx = M_PER_DEG_LON_EQ * Math.cos((origin.lat * Math.PI) / 180) * FT_PER_M;
  const ky = M_PER_DEG_LAT * FT_PER_M;
  return { lon: origin.lon + q[0] / kx, lat: origin.lat - q[1] / ky };
}

/* ---------- Web Mercator tiles ---------- */

export function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z;
}

export function latToTileY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

export function tileXToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

export function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export interface PlacedTile {
  z: number;
  x: number;
  y: number;
  /** Position and size in plan feet. */
  px: number;
  py: number;
  w: number;
  h: number;
}

/** Every tile at zoom `z` that covers the plan extent, placed in plan feet. */
export function tilesForExtent(origin: GeoPoint, extent: { x: number; y: number; w: number; h: number }, z: number): PlacedTile[] {
  const nw = toGeo(origin, [extent.x, extent.y]);
  const se = toGeo(origin, [extent.x + extent.w, extent.y + extent.h]);
  const x0 = Math.floor(lonToTileX(nw.lon, z));
  const x1 = Math.floor(lonToTileX(se.lon, z));
  const y0 = Math.floor(latToTileY(nw.lat, z));
  const y1 = Math.floor(latToTileY(se.lat, z));
  const out: PlacedTile[] = [];
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++) {
      const a = toPlan(origin, { lon: tileXToLon(x, z), lat: tileYToLat(y, z) });
      const b = toPlan(origin, { lon: tileXToLon(x + 1, z), lat: tileYToLat(y + 1, z) });
      out.push({ z, x, y, px: a[0], py: a[1], w: b[0] - a[0], h: b[1] - a[1] });
    }
  return out;
}
