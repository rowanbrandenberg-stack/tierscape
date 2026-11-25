import { config } from "./config";
import { getJson } from "./http";

/**
 * Address autocomplete from the Esri World Geocoding suggest endpoint, so a job
 * starts from a real address instead of a typo. Uses ARCGIS_API_KEY (the same
 * key as the imagery) when set. Without a key it falls back to Esri's anonymous
 * endpoint, allowed only while developing, the same rule as the imagery.
 * Suggestions are shown and never stored, which the terms allow.
 */
const isProd = process.env.NODE_ENV === "production";

export function suggestReady(): boolean {
  return Boolean(config.imagery.arcgisKey) || !isProd;
}

interface SuggestResponse {
  suggestions?: { text: string; isCollection?: boolean }[];
}

/** "211 W Aspen Ave, Flagstaff, AZ, 86001, USA" to "211 W Aspen Ave, Flagstaff, AZ 86001". */
export function tidySuggestion(text: string): string {
  return text.replace(/,\s*USA$/, "").replace(/,\s*([A-Z]{2}),\s*(\d{5}(-\d{4})?)$/, ", $1 $2");
}

/**
 * When the typed text starts with a house number but a suggestion is only the
 * street (common for newer or rural homes the geocoder lacks), keep the number
 * so picking it does not silently drop it: "E Inwood Way, ..." to "4663 E Inwood Way, ...".
 */
export function keepHouseNumber(typed: string, suggestion: string): string {
  const num = typed.trim().match(/^(\d+[A-Za-z]?)\s/)?.[1];
  if (!num || /^\d/.test(suggestion)) return suggestion;
  return `${num} ${suggestion}`;
}

export async function suggestAddresses(text: string, near?: { lat: number; lon: number }): Promise<string[]> {
  if (!suggestReady()) return [];
  const key = config.imagery.arcgisKey;
  const u = new URL(
    key
      ? "https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/suggest"
      : "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/suggest",
  );
  const q = new URLSearchParams({ f: "json", text, countryCode: "USA", category: "Address", maxSuggestions: "6" });
  if (near) q.set("location", `${near.lon},${near.lat}`);
  if (key) q.set("token", key);
  u.search = q.toString();
  const r = await getJson<SuggestResponse>(u.toString(), undefined, 5_000);
  const seen = new Set<string>();
  return (r.suggestions ?? [])
    .filter((s) => !s.isCollection)
    .map((s) => keepHouseNumber(text, tidySuggestion(s.text)))
    .filter((s) => (seen.has(s) ? false : (seen.add(s), true)));
}
