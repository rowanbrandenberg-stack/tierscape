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
 * Arizona parcels come from two free sources. Neither is a survey.
 * ADWR keeps a per county copy (mostly November 2023) that has newer splits,
 * and AZGeo keeps a statewide layer that can still show a subdivision as the
 * original ranch parcel. Both are searched and the best address match wins.
 */
const AZGEO = "https://azgeo.az.gov/arcgis/rest/services/TerraSystems/AZParcelFeatures/FeatureServer/0/query";
const ADWR = "https://azwatermaps.azwater.gov/arcgis/rest/services/General/Parcels/MapServer";
const ADWR_LAYERS: Record<string, number> = {
  APACHE: 0, COCHISE: 1, COCONINO: 2, GILA: 3, GRAHAM: 4, GREENLEE: 5, "LA PAZ": 6, LAPAZ: 6,
  MARICOPA: 7, MOHAVE: 8, NAVAJO: 9, PIMA: 10, PINAL: 11, "SANTA CRUZ": 12, SANTACRUZ: 12, YAVAPAI: 13, YUMA: 14,
};
const SOURCES = { adwr: "Arizona county parcels (ADWR, 2023)", azgeo: "AZGeo statewide parcels" };

/** A home lot is rarely this big. Bigger means an old ranch parcel, a right of way or a catch all. */
const MAX_HOME_ACRES = 20;

interface EsriFeatureSet {
  features?: { attributes: Record<string, string | number | null>; geometry?: { rings?: number[][][] } }[];
}

export type MatchedBy = "address" | "nearest" | "picked";

const str = (v: unknown) => (v == null ? null : String(v).trim() || null);

/** Acres of a lon/lat ring, on a local flat grid. */
export function ringAcres(ring: GeoPoint[]): number {
  if (ring.length < 3) return 0;
  const lat0 = ring[0].lat;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110_540;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j].lon * kx + ring[i].lon * kx) * (ring[j].lat * ky - ring[i].lat * ky);
  }
  return Math.abs(a / 2) / 4046.856;
}

/** Junk records: placeholder APNs, empty shapes, and anything too big to be one home. */
export function isUsable(c: Pick<GeoParcel, "apn" | "ring">): boolean {
  if (!c.ring.length) return false;
  if (c.apn && /^9009999/.test(c.apn)) return false;
  return ringAcres(c.ring) <= MAX_HOME_ACRES;
}

async function esriQuery(url: string, fields: { apn: string; address: string }, source: string, lat: number, lon: number, distanceM: number, where = "1=1"): Promise<GeoParcel[]> {
  const u = new URL(url);
  u.search = new URLSearchParams({
    where,
    geometry: `${lon},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    distance: String(distanceM),
    units: "esriSRUnit_Meter",
    outFields: `${fields.apn},${fields.address}`,
    returnGeometry: "true",
    outSR: "4326",
    geometryPrecision: "7",
    resultRecordCount: "60",
    f: "json",
  }).toString();
  const r = await getJson<EsriFeatureSet>(u.toString());
  return (r.features ?? [])
    .filter((f) => f.geometry?.rings?.[0]?.length)
    .map((f) => ({
      apn: str(f.attributes[fields.apn]),
      address: str(f.attributes[fields.address]),
      ring: f.geometry!.rings![0].map(([lon, lat]) => ({ lat, lon })),
      source,
    }));
}

const azgeo = (lat: number, lon: number, d: number, where?: string) => esriQuery(AZGEO, { apn: "AZ_APN", address: "AZ_Address" }, SOURCES.azgeo, lat, lon, d, where);
const adwr = (county: string | null, lat: number, lon: number, d: number, where?: string) => {
  const id = county ? ADWR_LAYERS[county.toUpperCase().replace(/\s+COUNTY$/, "")] : undefined;
  if (id === undefined) return Promise.resolve([] as GeoParcel[]);
  return esriQuery(`${ADWR}/${id}/query`, { apn: "APN", address: "SITE_ADDRESS" }, SOURCES.adwr, lat, lon, d, where);
};

const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const smallest = (cands: GeoParcel[]) => [...cands].sort((a, b) => ringAcres(a.ring) - ringAcres(b.ring))[0];

/**
 * The Census point is interpolated along the street, so it often sits in
 * front of a neighbor. Find the lot by its situs address in both sources,
 * and take the smallest match, since a newer split is always smaller. Only
 * fall back to the lot under or nearest the point when no address matches,
 * and never hand back a lot too big to be one home.
 */
async function arizona(g: Geocoded): Promise<{ parcel: GeoParcel; by: MatchedBy } | null> {
  if (g.houseNumber && g.street) {
    const like = (field: string) => `UPPER(${field}) LIKE '${clean(g.houseNumber!)} %${clean(g.street!)}%'`;
    const [a, b] = await Promise.all([
      adwr(g.county, g.lat, g.lon, 3000, like("SITE_ADDRESS")).catch(() => []),
      azgeo(g.lat, g.lon, 3000, like("AZ_Address")).catch(() => []),
    ]);
    const exact = [...a, ...b].filter((c) => addressMatches(c, g) && isUsable(c));
    if (exact.length) return { parcel: smallest(exact), by: "address" };
  }
  const [a, b] = await Promise.all([adwr(g.county, g.lat, g.lon, 80).catch(() => []), azgeo(g.lat, g.lon, 80).catch(() => [])]);
  const cands = [...a, ...b].filter(isUsable);
  if (!cands.length) return null;
  const hit = cands.find((c) => addressMatches(c, g));
  if (hit) return { parcel: hit, by: "address" };
  const under = cands.filter((c) => contains(c.ring, g));
  return { parcel: under.length ? smallest(under) : nearest(cands, g), by: "nearest" };
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

/** Prefer the parcel whose address matches; otherwise the one closest to the geocoded point. */
export function pickParcel(cands: GeoParcel[], g: Pick<Geocoded, "lat" | "lon" | "houseNumber" | "street">): GeoParcel {
  return cands.find((c) => addressMatches(c, g)) ?? nearest(cands, g);
}

/** The lot under a clicked point, for fixing a wrong match by hand. Smallest wins across both sources. */
export async function parcelAt(p: GeoPoint, county: string | null = null): Promise<GeoParcel | null> {
  const [a, b] = await Promise.all([adwr(county, p.lat, p.lon, 2).catch(() => []), azgeo(p.lat, p.lon, 2).catch(() => [])]);
  const all = [...a, ...b].filter((c) => c.ring.length && !(c.apn && /^9009999/.test(c.apn)));
  const under = all.filter((c) => contains(c.ring, p));
  if (under.length) return smallest(under);
  if (all.length) return nearest(all, p);
  return regrid({ lat: p.lat, lon: p.lon, houseNumber: null, street: null } as Geocoded).catch(() => null);
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
