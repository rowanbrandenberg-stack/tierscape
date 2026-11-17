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

async function arizona(g: Geocoded): Promise<GeoParcel | null> {
  const u = new URL(AZGEO);
  u.search = new URLSearchParams({
    geometry: `${g.lon},${g.lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    distance: "35",
    units: "esriSRUnit_Meter",
    outFields: "AZ_APN,AZ_Address",
    returnGeometry: "true",
    outSR: "4326",
    geometryPrecision: "7",
    f: "json",
  }).toString();
  const r = await getJson<EsriFeatureSet>(u.toString());
  const cands = (r.features ?? [])
    .filter((f) => f.geometry?.rings?.[0]?.length)
    .map((f) => ({
      apn: f.attributes.AZ_APN ?? null,
      address: f.attributes.AZ_Address ?? null,
      ring: f.geometry!.rings![0].map(([lon, lat]) => ({ lat, lon })),
      source: "AZGeo statewide parcels",
    }));
  if (!cands.length) return null;
  return pickParcel(cands, g);
}

/** Prefer the parcel whose address matches; otherwise the one closest to the geocoded point. */
export function pickParcel(cands: GeoParcel[], g: Pick<Geocoded, "lat" | "lon" | "houseNumber" | "street">): GeoParcel {
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (g.houseNumber && g.street) {
    const hit = cands.find((c) => c.address && norm(c.address).startsWith(`${g.houseNumber} `) && norm(c.address).includes(norm(g.street!)));
    if (hit) return hit;
  }
  const d = (c: GeoParcel) => {
    const lat = c.ring.reduce((s, p) => s + p.lat, 0) / c.ring.length;
    const lon = c.ring.reduce((s, p) => s + p.lon, 0) / c.ring.length;
    return Math.hypot(lat - g.lat, (lon - g.lon) * Math.cos((g.lat * Math.PI) / 180));
  };
  return [...cands].sort((a, b) => d(a) - d(b))[0];
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

export async function findParcel(g: Geocoded): Promise<GeoParcel | null> {
  if (g.state === "AZ") {
    const p = await arizona(g).catch(() => null);
    if (p) return p;
  }
  return regrid(g).catch(() => null);
}
