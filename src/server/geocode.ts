import { config } from "./config";
import { getJson, ProviderError } from "./http";

/**
 * Address to a point on the map plus the county.
 *
 * 1. US Census Bureau geocoder. Free, no key, public domain. Its street ranges
 *    come from TIGER, which misses many newer and rural addresses (a lot of
 *    Flagstaff outside city limits), so it is only the first try.
 * 2. The same query with directions and suffixes spelled the Census way.
 * 3. Esri World Geocoder (rooftop points). Uses ARCGIS_API_KEY when set, or the
 *    anonymous endpoint while developing, the same rule as imagery and suggest.
 * 4. OpenStreetMap Nominatim, free with attribution and light use.
 *
 * Fallback hits have no county, so the county comes from the Census
 * coordinates lookup, which answers for any point in the US.
 */
export interface Geocoded {
  matchedAddress: string;
  lat: number;
  lon: number;
  state: string | null;
  county: string | null;
  countyFips: string | null;
  houseNumber: string | null;
  street: string | null;
  source: "census" | "esri" | "osm";
}

interface CensusCounty { BASENAME?: string; GEOID?: string }
interface CensusResponse {
  result?: {
    addressMatches?: {
      matchedAddress: string;
      coordinates: { x: number; y: number };
      addressComponents?: { state?: string; streetName?: string; preDirection?: string; fromAddress?: string };
      geographies?: { Counties?: CensusCounty[] };
    }[];
  };
}
interface CensusCoordsResponse { result?: { geographies?: { Counties?: (CensusCounty & { STATE?: string })[] } } }
interface EsriResponse {
  candidates?: { address: string; score: number; location: { x: number; y: number }; attributes?: { Addr_type?: string; RegionAbbr?: string; Subregion?: string } }[];
}
interface OsmResult { lat: string; lon: string; display_name: string; address?: { house_number?: string; road?: string; city?: string; town?: string; village?: string; hamlet?: string; county?: string; state?: string; "ISO3166-2-lvl4"?: string; postcode?: string } }

const isProd = process.env.NODE_ENV === "production";
const CENSUS = "https://geocoding.geo.census.gov/geocoder/geographies";
const CENSUS_Q = { benchmark: "Public_AR_Current", vintage: "Current_Current", layers: "Counties", format: "json" };

/** "211 W ASPEN AVE, FLAGSTAFF, AZ, 86001" to "211 W Aspen Ave, Flagstaff, AZ 86001". */
export function tidyAddress(raw: string): string {
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return raw;
  const zip = /^\d{5}(-\d{4})?$/.test(parts[parts.length - 1]) ? parts.pop()! : "";
  const state = parts.pop()!;
  const word = (w: string) => (/^(N|S|E|W|NE|NW|SE|SW)$/.test(w) || /\d/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase());
  return [...parts.map((p) => p.split(/\s+/).map(word).join(" ")), `${state}${zip ? ` ${zip}` : ""}`].join(", ");
}

const DIRS: Record<string, string> = { NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W", NORTHEAST: "NE", NORTHWEST: "NW", SOUTHEAST: "SE", SOUTHWEST: "SW" };
const SUFFIXES: Record<string, string> = {
  AVENUE: "AVE", STREET: "ST", ROAD: "RD", DRIVE: "DR", LANE: "LN", COURT: "CT", CIRCLE: "CIR", BOULEVARD: "BLVD",
  PLACE: "PL", TRAIL: "TRL", PARKWAY: "PKWY", HIGHWAY: "HWY", TERRACE: "TER", LOOP: "LOOP", WAY: "WAY",
};
const SUFFIX_ABBR = new Set(Object.values(SUFFIXES));

/** Spells directions and street types the short Census way: "4663 East Inwood Way" to "4663 E INWOOD WAY". */
export function normalizeAddress(address: string): string {
  return address
    .toUpperCase()
    .replace(/\./g, "")
    .split(/(,)/)
    .map((seg, i) => (i === 0 ? seg.split(/\s+/).map((w) => DIRS[w] ?? SUFFIXES[w] ?? w).join(" ") : seg))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** The bare street name parcels match on: "4663 East Inwood Way, Flagstaff" to "INWOOD". */
export function streetNameFrom(address: string): string | null {
  const words = normalizeAddress(address).split(",")[0].split(" ").filter(Boolean);
  if (words.length && /^\d/.test(words[0])) words.shift();
  if (words.length > 1 && Object.values(DIRS).includes(words[0])) words.shift();
  if (words.length > 1 && SUFFIX_ABBR.has(words[words.length - 1])) words.pop();
  return words.length ? words.join(" ") : null;
}

const houseNumberFrom = (address: string) => address.trim().match(/^(\d+)/)?.[1] ?? null;

async function census(address: string, original: string): Promise<Geocoded | null> {
  const u = new URL(`${CENSUS}/onelineaddress`);
  u.search = new URLSearchParams({ address, ...CENSUS_Q }).toString();
  const r = await getJson<CensusResponse>(u.toString());
  const m = r.result?.addressMatches?.[0];
  if (!m) return null;
  const county = m.geographies?.Counties?.[0];
  return {
    matchedAddress: tidyAddress(m.matchedAddress),
    lat: m.coordinates.y,
    lon: m.coordinates.x,
    state: m.addressComponents?.state ?? null,
    county: county?.BASENAME ?? null,
    countyFips: county?.GEOID ?? null,
    houseNumber: houseNumberFrom(original),
    street: m.addressComponents?.streetName ?? streetNameFrom(original),
    source: "census",
  };
}

/** Rooftop level hits only: a street or city centroid would load the wrong yard. */
const ESRI_OK = new Set(["PointAddress", "Subaddress", "StreetAddress", "StreetAddressExt"]);

async function esri(address: string): Promise<Omit<Geocoded, "county" | "countyFips"> | null> {
  const key = config.imagery.arcgisKey;
  if (!key && isProd) return null;
  const u = new URL(
    key
      ? "https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates"
      : "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates",
  );
  const q = new URLSearchParams({ f: "json", SingleLine: address, countryCode: "USA", maxLocations: "3", outFields: "Addr_type,RegionAbbr,Subregion" });
  if (key) q.set("token", key);
  u.search = q.toString();
  const r = await getJson<EsriResponse>(u.toString(), undefined, 8_000);
  const c = (r.candidates ?? []).find((x) => x.score >= 90 && ESRI_OK.has(x.attributes?.Addr_type ?? ""));
  if (!c) return null;
  return {
    matchedAddress: c.address.replace(/,\s*USA$/, "").replace(/,\s*([A-Z]{2}),\s*(\d{5})$/, ", $1 $2"),
    lat: c.location.y,
    lon: c.location.x,
    state: c.attributes?.RegionAbbr ?? null,
    houseNumber: houseNumberFrom(address),
    street: streetNameFrom(address),
    source: "esri",
  };
}

async function osm(address: string): Promise<Omit<Geocoded, "county" | "countyFips"> | null> {
  const u = new URL("https://nominatim.openstreetmap.org/search");
  u.search = new URLSearchParams({ q: address, format: "jsonv2", addressdetails: "1", countrycodes: "us", limit: "3" }).toString();
  const r = await getJson<OsmResult[]>(u.toString(), { headers: { "user-agent": "Tierscape/1.0 (https://github.com/rowanbrandenberg-stack/tierscape)" } }, 8_000);
  const want = houseNumberFrom(address);
  // Only accept a hit on the actual house, never a street or town match.
  const m = r.find((x) => x.address?.house_number && (!want || x.address.house_number === want));
  if (!m) return null;
  const a = m.address!;
  const city = a.city ?? a.town ?? a.village ?? a.hamlet;
  const st = a["ISO3166-2-lvl4"]?.replace(/^US-/, "") ?? null;
  return {
    matchedAddress: [`${a.house_number} ${a.road ?? ""}`.trim(), city, [st, a.postcode].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    lat: Number(m.lat),
    lon: Number(m.lon),
    state: st,
    houseNumber: want,
    street: streetNameFrom(address),
    source: "osm",
  };
}

async function countyAt(lat: number, lon: number): Promise<{ county: string | null; countyFips: string | null }> {
  try {
    const u = new URL(`${CENSUS}/coordinates`);
    u.search = new URLSearchParams({ x: String(lon), y: String(lat), ...CENSUS_Q }).toString();
    const r = await getJson<CensusCoordsResponse>(u.toString(), undefined, 8_000);
    const c = r.result?.geographies?.Counties?.[0];
    return { county: c?.BASENAME ?? null, countyFips: c?.GEOID ?? null };
  } catch {
    return { county: null, countyFips: null };
  }
}

/** Runs a provider, treating an outage like a miss so the next one still gets a turn. */
interface Tally { tries: number; errors: unknown[] }
async function attempt<T>(fn: () => Promise<T | null>, t: Tally): Promise<T | null> {
  t.tries++;
  try {
    return await fn();
  } catch (e) {
    t.errors.push(e);
    return null;
  }
}

export async function geocode(address: string): Promise<Geocoded> {
  if (!/^\s*\d/.test(address)) throw new ProviderError("Add the house number to the start of the address (for example 4663 E Inwood Way).", 400, "bad_request");
  const t: Tally = { tries: 0, errors: [] };
  const norm = normalizeAddress(address);

  const hit =
    (await attempt(() => census(address, address), t)) ??
    (norm !== address.toUpperCase() ? await attempt(() => census(norm, address), t) : null);
  if (hit) return hit;

  const other = (await attempt(() => esri(address), t)) ?? (await attempt(() => osm(address), t));
  if (other) return { ...other, ...(await countyAt(other.lat, other.lon)) };

  // Every lookup that ran failed outright (none just came back empty): say the service is down instead of blaming the address.
  if (t.errors.length && t.errors.length === t.tries) throw t.errors[0] instanceof ProviderError ? t.errors[0] : new ProviderError("Address lookup is down. Try again in a moment.");
  throw new ProviderError("No match for that address. Check the street, city and state, or pick one from the suggestions.", 404, "not_found");
}
