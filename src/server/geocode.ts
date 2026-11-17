import { getJson, ProviderError } from "./http";

/**
 * US Census Bureau geocoder. Free, no key, public domain results.
 * Returns the matched address, the point on the street and the county.
 * The point sits on the street centerline, so parcel lookup searches nearby.
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
}

interface CensusResponse {
  result?: {
    addressMatches?: {
      matchedAddress: string;
      coordinates: { x: number; y: number };
      addressComponents?: { state?: string; streetName?: string; preDirection?: string; fromAddress?: string };
      geographies?: { Counties?: { BASENAME?: string; GEOID?: string }[] };
    }[];
  };
}

/** "211 W ASPEN AVE, FLAGSTAFF, AZ, 86001" to "211 W Aspen Ave, Flagstaff, AZ 86001". */
export function tidyAddress(raw: string): string {
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return raw;
  const zip = /^\d{5}(-\d{4})?$/.test(parts[parts.length - 1]) ? parts.pop()! : "";
  const state = parts.pop()!;
  const word = (w: string) => (/^(N|S|E|W|NE|NW|SE|SW)$/.test(w) || /\d/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase());
  return [...parts.map((p) => p.split(/\s+/).map(word).join(" ")), `${state}${zip ? ` ${zip}` : ""}`].join(", ");
}

export async function geocode(address: string): Promise<Geocoded> {
  const u = new URL("https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress");
  u.search = new URLSearchParams({ address, benchmark: "Public_AR_Current", vintage: "Current_Current", layers: "Counties", format: "json" }).toString();
  const r = await getJson<CensusResponse>(u.toString());
  const m = r.result?.addressMatches?.[0];
  if (!m) throw new ProviderError("No match for that address. Check the street, city and state.", 404, "not_found");
  const county = m.geographies?.Counties?.[0];
  const house = address.trim().match(/^(\d+)/)?.[1] ?? null;
  return {
    matchedAddress: tidyAddress(m.matchedAddress),
    lat: m.coordinates.y,
    lon: m.coordinates.x,
    state: m.addressComponents?.state ?? null,
    county: county?.BASENAME ?? null,
    countyFips: county?.GEOID ?? null,
    houseNumber: house,
    street: m.addressComponents?.streetName ?? null,
  };
}
