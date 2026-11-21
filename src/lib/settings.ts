import { DEFAULT_BORDERS, DEFAULT_PLANT_SIZES, DEFAULT_SERVICES, DEFAULT_TIER_MAP, type Border, type PlantSizeRow, type Service, type TierMap } from "./catalog";
import type { BorderKey, PlantKind, TierKey } from "./types";

export interface Profile {
  company: string;
  license: string;
  licenseLine: string;
  phone: string;
  email: string;
  website: string;
  brandColor: string;
  accentColor: string;
  /** Data URL of the uploaded logo. */
  logo: string | null;
  /** The warranty the homeowner agrees to. Reviewed before any proposal is shared. */
  warranty: string;
  /** Starting values the contractor looked at and kept on purpose, by readiness key, with the value they kept. */
  reviewed?: Partial<Record<string, string>>;
}

export const DEFAULT_WARRANTY =
  "Plants are guaranteed for one growing season when watered as instructed. Workmanship on patios, edging and irrigation is guaranteed for one year. Damage from weather, animals or neglect is not covered.";

/** Profile values still at the sample defaults, which must never reach a homeowner. */
export function profileProblems(p: Profile): string[] {
  const d = defaultSettings().profile;
  const out: string[] = [];
  if (!p.company.trim() || p.company === d.company) out.push("Set your company name.");
  if (!p.license.trim() || p.license === d.license) out.push("Set your contractor license number.");
  if (!p.email.trim() || p.email === d.email) out.push("Set an email so the homeowner can accept.");
  if (!p.phone.trim() || p.phone === d.phone) out.push("Set your phone number.");
  if (!p.warranty?.trim()) out.push("Write your warranty terms.");
  return out;
}

export interface Pricing {
  laborRate: number;
  markupPct: number;
  /** Added to built up job costs before margin: trucks, insurance, office, fuel. */
  overheadPct: number;
  wastePct: number;
  crewSize: number;
  services: Service[];
  tierMap: TierMap;
  borders: Record<Exclude<BorderKey, "none">, Border>;
  plantSizes: Record<PlantKind, Record<TierKey, PlantSizeRow>>;
}

export interface Settings {
  profile: Profile;
  pricing: Pricing;
}

export function defaultSettings(): Settings {
  return {
    profile: {
      company: "Your Landscape Co",
      license: "ROC 000000",
      licenseLine: "Licensed, bonded and insured",
      phone: "(928) 555 0100",
      email: "office@yourlandscape.example",
      website: "",
      brandColor: "#1d4a35",
      accentColor: "#b8662e",
      logo: null,
      warranty: DEFAULT_WARRANTY,
    },
    pricing: {
      laborRate: 65,
      markupPct: 35,
      overheadPct: 0,
      wastePct: 10,
      crewSize: 3,
      services: structuredClone(DEFAULT_SERVICES),
      tierMap: structuredClone(DEFAULT_TIER_MAP),
      borders: structuredClone(DEFAULT_BORDERS),
      plantSizes: structuredClone(DEFAULT_PLANT_SIZES),
    },
  };
}
