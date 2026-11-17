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
}

export interface Pricing {
  laborRate: number;
  markupPct: number;
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
    },
    pricing: {
      laborRate: 65,
      markupPct: 35,
      wastePct: 10,
      crewSize: 3,
      services: structuredClone(DEFAULT_SERVICES),
      tierMap: structuredClone(DEFAULT_TIER_MAP),
      borders: structuredClone(DEFAULT_BORDERS),
      plantSizes: structuredClone(DEFAULT_PLANT_SIZES),
    },
  };
}
