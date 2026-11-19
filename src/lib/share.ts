import type { Pt, TierKey, AreaType, PlantKind, GeoPoint, PaymentTerms } from "./types";
import { TIERS, type Job } from "./types";
import type { Pricing, Profile } from "./settings";
import { DEFAULT_WARRANTY } from "./settings";
import { AREA_TYPES } from "./catalog";
import { polygonArea } from "./geometry";
import { groupSize, quote } from "./pricing";

/**
 * What a homeowner sees: prices, scope and terms. Never costs, hours,
 * margins or the build pack. The whole snapshot travels in the link itself,
 * so nothing about the job is stored anywhere until accounts exist.
 */
export interface SharedProposal {
  v: 1;
  created: string;
  validDays: number;
  company: Pick<Profile, "company" | "license" | "licenseLine" | "phone" | "email" | "website" | "brandColor" | "accentColor" | "logo" | "warranty">;
  address: string;
  terms: PaymentTerms;
  recommended: TierKey;
  plan: {
    origin: GeoPoint | null;
    zoom: number | null;
    extent: { x: number; y: number; w: number; h: number };
    lot: Pt[] | null;
    areas: { type: AreaType; pts: Pt[] }[];
    plants: { kind: PlantKind; spots: Pt[] }[];
  };
  tiers: {
    key: TierKey;
    name: string;
    price: number;
    days: number;
    scope: { title: string; size: string }[];
    plants: { name: string; size: string; qty: number; note: string | null }[];
  }[];
}

const r1 = (p: Pt): Pt => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];

export function buildSharedProposal(job: Job, profile: Profile, pricing: Pricing, now = new Date()): SharedProposal {
  const logo = profile.logo && profile.logo.length < 60_000 ? profile.logo : null;
  return {
    v: 1,
    created: now.toISOString().slice(0, 10),
    validDays: 30,
    company: {
      company: profile.company,
      license: profile.license,
      licenseLine: profile.licenseLine,
      phone: profile.phone,
      email: profile.email,
      website: profile.website,
      brandColor: profile.brandColor,
      accentColor: profile.accentColor,
      logo,
      warranty: profile.warranty?.trim() || DEFAULT_WARRANTY,
    },
    address: job.site.matchedAddress ?? job.site.address,
    terms: job.terms,
    recommended: job.tier,
    plan: {
      origin: job.site.origin,
      zoom: job.site.imagery?.zoom ?? null,
      extent: job.site.extent,
      lot: job.lot ? job.lot.map(r1) : null,
      areas: job.areas.map((a) => ({ type: a.type, pts: a.pts.map(r1) })),
      plants: job.plants.filter((p) => p.spots.length).map((p) => ({ kind: p.kind, spots: p.spots.map(r1) })),
    },
    tiers: TIERS.map((t) => {
      const q = quote(job, pricing, t.key);
      return {
        key: t.key,
        name: t.name,
        price: q.price,
        days: q.days,
        scope: q.groups.map((g) => ({ title: g.title, size: groupSize(g) })),
        plants: job.plants
          .filter((p) => p.spots.length)
          .map((p) => ({
            name: p.name || "Unnamed plant",
            size: pricing.plantSizes[p.kind][t.key].size,
            qty: p.spots.length,
            note: p.estimate ? `About ${p.estimate.heightFt} ft tall and ${p.estimate.spreadFt} ft wide here after 10 years` : null,
          })),
      };
    }),
  };
}

/** Area labels for the homeowner plan. */
export const areaLabel = (type: AreaType) => AREA_TYPES[type].label;
export const sharedSqft = (pts: Pt[]) => polygonArea(pts);

/* ---------- packing the snapshot into a link ---------- */

const toB64url = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64url = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
};

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const res = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

export async function packProposal(p: SharedProposal): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(p));
  return `v1.${toB64url(await pipe(raw, new CompressionStream("deflate-raw")))}`;
}

export async function unpackProposal(token: string): Promise<SharedProposal> {
  const [ver, data] = token.split(".", 2);
  if (ver !== "v1" || !data) throw new Error("This proposal link is not complete.");
  const raw = await pipe(fromB64url(data), new DecompressionStream("deflate-raw"));
  const p = JSON.parse(new TextDecoder().decode(raw)) as SharedProposal;
  if (p.v !== 1 || !Array.isArray(p.tiers)) throw new Error("This proposal link is not complete.");
  return p;
}

/** Lines that change between two tiers, for "what you get by stepping up". */
export function scopeDiff(from: SharedProposal["tiers"][number], to: SharedProposal["tiers"][number]): string[] {
  const before = new Set(from.scope.map((s) => s.title));
  const out = to.scope.filter((s) => !before.has(s.title)).map((s) => s.title);
  const sizes = to.plants.filter((p, i) => from.plants[i] && from.plants[i].size !== p.size).map((p) => `${p.name} at ${p.size} instead of ${from.plants.find((x) => x.name === p.name)?.size}`);
  return [...out, ...sizes];
}
