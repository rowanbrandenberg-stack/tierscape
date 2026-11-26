import type { Area, Job, Plant, Pt, Site } from "./types";
import { emptyConcept } from "./concept";

export const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

export const newPaver = (): Area["paver"] => ({ layout: "running", size: "6x9", color: "sand" });

export function newArea(type: Area["type"], pts: Pt[]): Area {
  return { id: uid("area"), type, pts, manualSqft: 0, paver: newPaver(), border: "none", edges: [] };
}

export function newPlant(name = ""): Plant {
  return { id: uid("plant"), name, kind: "shrub", spots: [], estimate: null };
}

function base(site: Site, name: string): Job {
  const now = new Date().toISOString();
  return {
    id: uid("job"),
    name,
    createdAt: now,
    updatedAt: now,
    site,
    lot: site.parcel ? site.parcel.pts : null,
    areas: [],
    plants: [],
    utilities: [],
    photos: [],
    activePhotoId: null,
    locate: { status: "not_requested", number: "", requestedOn: "", provider: null, responses: [] },
    tier: "standard",
    terms: "split",
    signature: null,
    sample: false,
  };
}

/** A job for a real address, sized to show the whole parcel with some street around it. */
export function jobFromSite(site: Site): Job {
  return base(site, site.matchedAddress ?? site.address);
}

/**
 * A job that starts from a photo of the yard and the homeowner's request.
 * The address is optional; there is no plan until someone draws one.
 */
export function photoJob(request: string, address: string, notes = ""): Job {
  const a = address.trim();
  const job = base({ address: a, matchedAddress: null, state: null, county: null, origin: null, extent: { x: 0, y: 0, w: 160, h: 105 }, parcel: null, imagery: null }, a || request.trim().slice(0, 60) || "Photo job");
  job.kind = "photo";
  job.concept = { ...emptyConcept(request.trim()), notes: notes.trim() };
  return job;
}

/** Fits an extent around a set of points with a margin, at the plan's 3:2 shape. */
export function extentAround(pts: Pt[], marginFt = 30, minW = 140): Site["extent"] {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  let x0 = Math.min(...xs) - marginFt;
  let x1 = Math.max(...xs) + marginFt;
  let y0 = Math.min(...ys) - marginFt;
  let y1 = Math.max(...ys) + marginFt;
  let w = Math.max(minW, x1 - x0);
  let h = Math.max(w / 1.5, y1 - y0);
  w = Math.max(w, h * 1.5);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/* ---------- the sample job: a drawn lot in Flagstaff, in feet ---------- */

const s = (pts: [number, number][]): Pt[] => pts.map(([x, y]) => [x * 0.25, y * 0.25]);

export function sampleJob(): Job {
  const job = base(
    {
      address: "Sample backyard, Flagstaff, AZ",
      matchedAddress: null,
      state: "AZ",
      county: "Coconino",
      origin: null,
      extent: { x: 0, y: 0, w: 160, h: 105 },
      parcel: null,
      imagery: null,
    },
    "Sample backyard",
  );
  job.sample = true;
  job.areas = [
    { ...newArea("patio", s([[200, 70], [296, 70], [296, 140], [200, 140]])) },
    { ...newArea("lawn", s([[316, 30], [470, 26], [486, 128], [316, 134]])), border: "rock" },
    { ...newArea("bed", s([[60, 22], [300, 22], [300, 46], [60, 46]])) },
  ];
  job.plants = [
    { id: uid("plant"), name: "Japanese maple", kind: "tree", spots: s([[420, 62], [150, 96]]), estimate: { heightFt: 8, spreadFt: 6, note: "Slow at 7,000 ft. Wants wind shelter and afternoon shade; late frosts burn new leaves.", location: "Sample backyard, Flagstaff, AZ", source: "sample" } },
    { id: uid("plant"), name: "Apache plume", kind: "shrub", spots: s([[80, 34], [120, 34], [160, 34], [240, 34], [280, 34]]), estimate: { heightFt: 4, spreadFt: 4, note: "Native here and reaches full size on very little water.", location: "Sample backyard, Flagstaff, AZ", source: "sample" } },
    { id: uid("plant"), name: "Rocky Mountain penstemon", kind: "perennial", spots: s([[100, 41], [140, 41], [180, 39], [200, 33], [220, 41], [260, 41]]), estimate: { heightFt: 2, spreadFt: 1.5, note: "Native, blooms in early summer and reseeds freely.", location: "Sample backyard, Flagstaff, AZ", source: "sample" } },
  ];
  const ph = { id: uid("photo"), name: "Sample photo", dataUrl: null, camera: { x: 110, y: 75, angle: -Math.PI / 2 - 0.35 }, placedBy: "sample" as const, note: "" };
  job.photos = [ph];
  job.activePhotoId = ph.id;
  return job;
}
