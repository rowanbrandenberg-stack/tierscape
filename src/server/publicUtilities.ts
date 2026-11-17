import type { GeoPoint, UtilityType } from "@/lib/types";
import { getJson } from "./http";

/**
 * Mapped infrastructure near a point, from OpenStreetMap (ODbL, credit
 * "© OpenStreetMap contributors"). It covers power lines, poles,
 * transformers, mapped pipelines, hydrants and manholes. It never shows
 * service lines into a yard, so it only ever suggests calling 811.
 */
export interface PublicFeature {
  type: UtilityType;
  label: string;
  pts: GeoPoint[];
  overhead: boolean;
}

const OVERPASS = "https://overpass-api.de/api/interpreter";

interface OsmEl {
  type: "node" | "way";
  lat?: number;
  lon?: number;
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

function classify(t: Record<string, string>): { type: UtilityType; label: string; overhead: boolean } | null {
  const p = t.power;
  if (p === "line" || p === "minor_line") return { type: "elec", label: p === "line" ? "Overhead transmission line" : "Overhead power line", overhead: true };
  if (p === "cable") return { type: "elec", label: "Buried power cable", overhead: false };
  if (p === "pole" || p === "tower") return { type: "elec", label: p === "tower" ? "Transmission tower" : "Power pole (guy anchors and buried drops nearby)", overhead: false };
  if (p === "transformer") return { type: "elec", label: "Transformer", overhead: false };
  if (p === "substation") return { type: "elec", label: "Substation", overhead: false };
  if (t.man_made === "pipeline" || t.pipeline) {
    const s = (t.substance ?? t.type ?? "").toLowerCase();
    if (/gas|methane|propane/.test(s)) return { type: "gas", label: "Mapped gas pipeline", overhead: false };
    if (/sew|waste/.test(s)) return { type: "sewer", label: "Mapped sewer main", overhead: false };
    if (/water/.test(s)) return { type: "water", label: "Mapped water main", overhead: false };
    return { type: "gas", label: "Mapped pipeline (contents unknown)", overhead: false };
  }
  if (t.emergency === "fire_hydrant") return { type: "water", label: "Fire hydrant (water main nearby)", overhead: false };
  if (t.man_made === "manhole" || t.manhole) {
    const m = (t.manhole ?? "").toLowerCase();
    if (/telecom/.test(m)) return { type: "comm", label: "Telecom manhole", overhead: false };
    if (/gas/.test(m)) return { type: "gas", label: "Gas manhole", overhead: false };
    if (/water/.test(m)) return { type: "water", label: "Water manhole", overhead: false };
    return { type: "sewer", label: "Manhole (sewer or storm)", overhead: false };
  }
  if (t.telecom || t.man_made === "street_cabinet") return { type: "comm", label: "Telecom cabinet or pedestal", overhead: false };
  return null;
}

export async function publicUtilities(at: GeoPoint, radiusM = 150): Promise<PublicFeature[]> {
  const r = Math.max(30, Math.min(400, Math.round(radiusM)));
  const a = `(around:${r},${at.lat},${at.lon})`;
  const q = `[out:json][timeout:20];(
way["power"~"^(line|minor_line|cable)$"]${a};
node["power"~"^(pole|tower|transformer)$"]${a};
nwr["power"="substation"]${a};
way["man_made"="pipeline"]${a};
node["emergency"="fire_hydrant"]${a};
node["man_made"~"^(manhole|street_cabinet)$"]${a};
node["telecom"]${a};
);out geom 400;`;
  const res = await getJson<{ elements?: OsmEl[] }>(OVERPASS, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "Tierscape (landscape planning)" },
    body: new URLSearchParams({ data: q }).toString(),
  }, 25_000);
  const out: PublicFeature[] = [];
  for (const el of res.elements ?? []) {
    const c = classify(el.tags ?? {});
    if (!c) continue;
    const pts = el.type === "node" && el.lat != null && el.lon != null ? [{ lat: el.lat, lon: el.lon }] : (el.geometry ?? []).map((g) => ({ lat: g.lat, lon: g.lon }));
    if (pts.length) out.push({ ...c, pts });
  }
  return out;
}
