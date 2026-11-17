/**
 * Core data model. All plan coordinates are in feet on a local flat grid:
 * x grows east, y grows south (so it maps straight onto SVG), and the origin
 * is the job's reference point (usually the parcel center).
 */

export type Pt = [number, number];

export type TierKey = "basic" | "standard" | "premium";
export const TIERS: { key: TierKey; name: string }[] = [
  { key: "basic", name: "Basic" },
  { key: "standard", name: "Standard" },
  { key: "premium", name: "Ultra Premium" },
];

export type AreaType = "patio" | "lawn" | "bed";
export type PlantKind = "tree" | "shrub" | "perennial";
export type UtilityType = "gas" | "elec" | "comm" | "water" | "irr" | "sewer";
export type PaverLayout = "running" | "stack" | "basket" | "herring" | "ashlar";
export type PaverSize = "4x8" | "6x9" | "6x12" | "12x12" | "16x16" | "24x24";
export type PaverColor = "sand" | "char" | "terra" | "gray";
export type BorderKey = "none" | "steel" | "rock" | "paver" | "curb";

export interface PaverSpec {
  layout: PaverLayout;
  size: PaverSize;
  color: PaverColor;
}

export interface Area {
  id: string;
  type: AreaType;
  pts: Pt[];
  /** A measured square footage that overrides the traced one. 0 = use the trace. */
  manualSqft: number;
  paver: PaverSpec;
  border: BorderKey;
  /** Which edges get the border. Missing index = yes. */
  edges: boolean[];
}

export interface GrowthEstimate {
  heightFt: number;
  spreadFt: number;
  note: string;
  location: string;
  source: "sample" | "claude";
}

export interface Plant {
  id: string;
  name: string;
  kind: PlantKind;
  spots: Pt[];
  estimate: GrowthEstimate | null;
}

export interface UtilityLine {
  id: string;
  type: UtilityType;
  pts: Pt[];
}

export interface Camera {
  x: number;
  y: number;
  /** Direction the camera faces in plan radians. North is -PI/2. */
  angle: number;
}

export interface SitePhoto {
  id: string;
  name: string;
  /** Stored separately from history snapshots because it is large. */
  dataUrl: string | null;
  camera: Camera | null;
  placedBy: "sample" | "manual" | "claude" | null;
  note: string;
}

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface Parcel {
  apn: string | null;
  address: string | null;
  pts: Pt[];
  source: string;
}

export interface Site {
  address: string;
  matchedAddress: string | null;
  state: string | null;
  county: string | null;
  /** The geographic point the plan grid is centered on. Null for the sample job. */
  origin: GeoPoint | null;
  /** The visible extent of the plan in feet. */
  extent: { x: number; y: number; w: number; h: number };
  parcel: Parcel | null;
  imagery: { provider: string; zoom: number } | null;
}

export type LocateStatus = "not_requested" | "prepared" | "submitted" | "clear" | "expired";

export interface LocateTicket {
  status: LocateStatus;
  number: string;
  requestedOn: string; // yyyy-mm-dd
  provider: string | null;
  responses: { utility: string; status: string }[];
}

export type PaymentTerms = "split" | "bid";

export interface Job {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  site: Site;
  /** The property line. Starts as the parcel outline when one is found. */
  lot: Pt[] | null;
  areas: Area[];
  plants: Plant[];
  utilities: UtilityLine[];
  photos: SitePhoto[];
  activePhotoId: string | null;
  locate: LocateTicket;
  tier: TierKey;
  terms: PaymentTerms;
  signature: { name: string; date: string } | null;
  sample: boolean;
}
