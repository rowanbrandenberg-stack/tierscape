import type { GeoPoint } from "@/lib/types";
import { config } from "./config";
import type { Geocoded } from "./geocode";
import { getJson } from "./http";

export interface GeoParcel {
  apn: string | null;
  address: string | null;
  ring: GeoPoint[];
  source: string;
}

/**
 * Arizona publishes every county's parcels in one free statewide layer
 * (AZGeo, State of Arizona). Parcel lines are approximate: they are for
 * planning, not a survey.
 */
const AZGEO = "https://azgeo.az.gov/arcgis/rest/services/TerraSystems/AZParcelFeatures/FeatureServer/0/query";

interface EsriFeatureSet {
  features?: { attributes: Record<string, string | null>; geometry?: { rings?: number[][][] } }[];
}

export type MatchedBy = "address" | "nearest" | "picked";

async function azQuery(lat: number, lon: number, distanceM: number, where = "1=1"): Promise<GeoParcel[]> {
  const u = new URL(AZGEO);
  u.search = new URLSearchParams({
    where,
    geometry: `${lon},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    distance: String(distanceM),
    units: "esriSRUnit_Meter",
    outFields: "AZ_APN,AZ_Address",
    returnGeometry: "true",
    outSR: "4326",
    geometryPrecision: "7",
    resultRecordCount: "50",
    f: "json",
  }).toString();
  const r = await getJson<EsriFeatureSet>(u.toString());
  return (r.features ?? [])
    .filter((f) => f.geometry?.rings?.[0]?.length)
    .map((f) => ({
      apn: f.attributes.AZ_APN ?? null,
      address: f.attributes.AZ_Address ?? null,
      ring: f.geometry!.rings![0].map(([lon, lat]) => ({ lat, lon })),
      source: "AZGeo statewide parcels",
    }));
}

const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/**
 * The Census point is interpolated along the street, so it often sits in
 * front of a neighbor. Look the lot up by its situs address first, within
 * a wide radius, and only fall back to the nearest lot when that fails.
 */
async function arizona(g: Geocoded): Promise<{ parcel: GeoParcel; by: MatchedBy } | null> {
  if (g.houseNumber && g.street) {
    const where = `UPPER(AZ_Address) LIKE '${clean(g.houseNumber)} %${clean(g.street)}%'`;
    const hits = await azQuery(g.lat, g.lon, 1500, where).catch(() => []);
    const exact = hits.filter((c) => addressMatches(c, g));
    if (exact.length) return { parcel: nearest(exact, g), by: "address" };
  }
  const cands = await azQuery(g.lat, g.lon, 80);
  if (!cands.length) return null;
  const hit = cands.find((c) => addressMatches(c, g));
  return hit ? { parcel: hit, by: "address" } : { parcel: nearest(cands, g), by: "nearest" };
}

function addressMatches(c: GeoParcel, g: Pick<Geocoded, "houseNumber" | "street">): boolean {
  if (!c.address || !g.houseNumber || !g.street) return false;
  const a = clean(c.address);
  return a.startsWith(`${g.houseNumber} `) && a.includes(clean(g.street));
}

function nearest(cands: GeoParcel[], g: Pick<Geocoded, "lat" | "lon">): GeoParcel {
  const d = (c: GeoParcel) => {
    const lat = c.ring.reduce((s, p) => s + p.lat, 0) / c.ring.length;
    const lon = c.ring.reduce((s, p) => s + p.lon, 0) / c.ring.length;
    return Math.hypot(lat - g.lat, (lon - g.lon) * Math.cos((g.lat * Math.PI) / 180));
  };
  return [...cands].sort((a, b) => d(a) - d(b))[0];
}

/** Point in polygon on lon/lat rings. */
function contains(ring: GeoPoint[], p: Pick<GeoPoint, "lat" | "lon">): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a.lat > p.lat !== b.lat > p.lat && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
}

/** The lot under a clicked point, for fixing a wrong match by hand. */
export async function parcelAt(p: GeoPoint): Promise<GeoParcel | null> {
  const az = await azQuery(p.lat, p.lon, 3).catch(() => [] as GeoParcel[]);
  const inAz = az.find((c) => contains(c.ring, p)) ?? (az.length ? nearest(az, p) : null);
  if (inAz) return inAz;
  const rg = await regrid({ lat: p.lat, lon: p.lon, houseNumber: null, street: null } as Geocoded).catch(() => null);
  return rg;
}

/** Prefer the parcel whose address matches; otherwise the one closest to the geocoded point. */
export function pickParcel(cands: GeoParcel[], g: Pick<Geocoded, "lat" | "lon" | "houseNumber" | "street">): GeoParcel {
  return cands.find((c) => addressMatches(c, g)) ?? nearest(cands, g);
}

/**
 * Regrid nationwide parcels. Check the request against Regrid's current API
 * docs before relying on it; it has not been exercised against a live key.
 */
async function regrid(g: Geocoded): Promise<GeoParcel | null> {
  if (!config.regridToken) return null;
  const u = new URL("https://app.regrid.com/api/v2/parcels/point");
  u.search = new URLSearchParams({ lat: String(g.lat), lon: String(g.lon), radius: "35", token: config.regridToken }).toString();
  type R = { parcels?: { features?: { properties?: { fields?: { parcelnumb?: string; address?: string } }; geometry?: { type: string; coordinates: number[][][] | number[][][][] } }[] } };
  const r = await getJson<R>(u.toString());
  const cands: GeoParcel[] = [];
  for (const f of r.parcels?.features ?? []) {
    const gm = f.geometry;
    if (!gm) continue;
    const ring = (gm.type === "MultiPolygon" ? (gm.coordinates as number[][][][])[0][0] : (gm.coordinates as number[][][])[0]).map(([lon, lat]) => ({ lat, lon }));
    cands.push({ apn: f.properties?.fields?.parcelnumb ?? null, address: f.properties?.fields?.address ?? null, ring, source: "Regrid" });
  }
  return cands.length ? pickParcel(cands, g) : null;
}

export async function findParcel(g: Geocoded): Promise<{ parcel: GeoParcel; by: MatchedBy } | null> {
  if (g.state === "AZ") {
    const p = await arizona(g).catch(() => null);
    if (p) return p;
  }
  const r = await regrid(g).catch(() => null);
  return r ? { parcel: r, by: addressMatches(r, g) ? "address" : "nearest" } : null;
}
