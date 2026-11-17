import type { AreaType, BorderKey, PaverColor, PaverLayout, PaverSize, PlantKind, TierKey, UtilityType } from "./types";

/**
 * Default price book. Every number here is a starting point a landscaper
 * overrides in Settings. Quantities are per square foot ("sqft"), per linear
 * foot of edge ("lf"), or once per job ("job").
 */

export type Fill = "dg" | "paver" | "flag" | "seed" | "sod" | "mulch" | "cinder";
export type Unit = "ton" | "cu yd" | "sq ft" | "lin ft" | "lb" | "bag" | "each";

export interface MaterialLine {
  name: string;
  unit: Unit;
  per: "sqft" | "lf" | "job";
  qty: number;
  cost: number;
  /** Bulk material that gets the waste allowance. */
  bulk?: boolean;
  /** The paver line, which takes layout, size and color from the area. */
  paver?: boolean;
}

export interface Service {
  id: string;
  areaType: AreaType;
  title: string;
  fill: Fill;
  /** Crew hours per square foot. */
  laborPerSqft: number;
  /** The landscaper's own installed price per sq ft. 0 = build from costs. */
  installedPrice: number;
  items: MaterialLine[];
  steps: string[];
}

export const AREA_TYPES: Record<AreaType, { label: string; color: string }> = {
  patio: { label: "Patio", color: "#e8823a" },
  lawn: { label: "Lawn", color: "#4cbf7c" },
  bed: { label: "Planting bed", color: "#d0558f" },
};

export const DEFAULT_SERVICES: Service[] = [
  {
    id: "patio-dg", areaType: "patio", title: "Decomposed granite patio with steel edging", fill: "dg", laborPerSqft: 0.06, installedPrice: 0,
    items: [
      { name: "Decomposed granite, 3 in deep", unit: "ton", per: "sqft", qty: 0.013, cost: 52, bulk: true },
      { name: "Weed barrier fabric", unit: "sq ft", per: "sqft", qty: 1, cost: 0.18, bulk: true },
      { name: "Steel edging", unit: "lin ft", per: "lf", qty: 1, cost: 4.5 },
    ],
    steps: ["Strip sod and grade so water runs away from the house", "Compact the subgrade", "Lay weed barrier and stake steel edging", "Spread granite in two lifts, wetting and compacting each"],
  },
  {
    id: "patio-paver", areaType: "patio", title: "Concrete paver patio on compacted base", fill: "paver", laborPerSqft: 0.16, installedPrice: 0,
    items: [
      { name: "Concrete pavers", unit: "sq ft", per: "sqft", qty: 1, cost: 5.25, bulk: true, paver: true },
      { name: "Road base, 4 in deep", unit: "ton", per: "sqft", qty: 0.0173, cost: 38, bulk: true },
      { name: "Bedding sand, 1 in deep", unit: "ton", per: "sqft", qty: 0.0043, cost: 45, bulk: true },
      { name: "Paver edge restraint", unit: "lin ft", per: "lf", qty: 1, cost: 2.2 },
      { name: "Polymeric sand", unit: "bag", per: "sqft", qty: 1 / 60, cost: 32 },
    ],
    steps: ["Excavate 7 in and grade for drainage", "Place road base in two lifts and plate compact", "Screed 1 in of bedding sand", "Lay pavers, cut edges and set edge restraint", "Sweep in polymeric sand, compact and mist"],
  },
  {
    id: "patio-flag", areaType: "patio", title: "Arizona flagstone patio with gas fire pit, seat wall and lighting", fill: "flag", laborPerSqft: 0.28, installedPrice: 0,
    items: [
      { name: "Arizona flagstone, 1.5 in thick", unit: "ton", per: "sqft", qty: 0.0105, cost: 420, bulk: true },
      { name: "Road base, 4 in deep", unit: "ton", per: "sqft", qty: 0.0173, cost: 38, bulk: true },
      { name: "Mortar and joint sand", unit: "bag", per: "sqft", qty: 1 / 40, cost: 14 },
      { name: "Seat wall block", unit: "lin ft", per: "lf", qty: 0.25, cost: 38 },
      { name: "Gas fire pit kit", unit: "each", per: "job", qty: 1, cost: 1850 },
      { name: "Low voltage path light", unit: "each", per: "sqft", qty: 1 / 60, cost: 95 },
      { name: "Lighting transformer", unit: "each", per: "job", qty: 1, cost: 240 },
    ],
    steps: ["Excavate, grade and trench for the gas line and lighting wire", "Place and compact road base", "Build the seat wall on a leveled footing", "Set and fit flagstone, then fill joints", "Install the fire pit kit and have the gas connection inspected", "Set path lights, connect the transformer and aim at dusk"],
  },
  {
    id: "lawn-seed", areaType: "lawn", title: "Seeded native grass lawn", fill: "seed", laborPerSqft: 0.015, installedPrice: 0,
    items: [
      { name: "Blue grama and fescue seed", unit: "lb", per: "sqft", qty: 0.005, cost: 9, bulk: true },
      { name: "Compost topdress", unit: "cu yd", per: "sqft", qty: 0.00154, cost: 48, bulk: true },
    ],
    steps: ["Rake out debris and loosen the top inch", "Broadcast seed in two passes", "Topdress with compost and roll", "Set a watering schedule with the homeowner"],
  },
  {
    id: "lawn-sod", areaType: "lawn", title: "Fresh sod over amended topsoil", fill: "sod", laborPerSqft: 0.035, installedPrice: 0,
    items: [
      { name: "Sod", unit: "sq ft", per: "sqft", qty: 1, cost: 0.85, bulk: true },
      { name: "Screened topsoil, 2 in deep", unit: "cu yd", per: "sqft", qty: 0.00617, cost: 42, bulk: true },
      { name: "Starter fertilizer", unit: "bag", per: "sqft", qty: 1 / 2500, cost: 28 },
    ],
    steps: ["Remove old turf and weeds", "Spread and grade topsoil", "Apply starter fertilizer", "Lay sod with staggered seams, roll and soak"],
  },
  {
    id: "lawn-sod-irr", areaType: "lawn", title: "Sod with automatic irrigation and smart controller", fill: "sod", laborPerSqft: 0.07, installedPrice: 0,
    items: [
      { name: "Sod", unit: "sq ft", per: "sqft", qty: 1, cost: 0.85, bulk: true },
      { name: "Screened topsoil, 2 in deep", unit: "cu yd", per: "sqft", qty: 0.00617, cost: 42, bulk: true },
      { name: "Rotor sprinkler head", unit: "each", per: "sqft", qty: 1 / 250, cost: 24 },
      { name: "Irrigation pipe", unit: "lin ft", per: "sqft", qty: 0.12, cost: 0.65, bulk: true },
      { name: "Zone valve", unit: "each", per: "sqft", qty: 1 / 1000, cost: 85 },
      { name: "Smart irrigation controller", unit: "each", per: "job", qty: 1, cost: 260 },
    ],
    steps: ["Remove old turf and weeds", "Trench and lay irrigation pipe, valves and heads", "Pressure test and set head coverage", "Spread and grade topsoil", "Lay sod, roll and soak", "Program the controller for the season"],
  },
  {
    id: "bed-mulch", areaType: "bed", title: "Mulched bed with starter shrubs", fill: "mulch", laborPerSqft: 0.04, installedPrice: 0,
    items: [
      { name: "Shredded bark mulch, 3 in deep", unit: "cu yd", per: "sqft", qty: 0.00926, cost: 42, bulk: true },
      { name: "Native shrubs, 1 gal", unit: "each", per: "sqft", qty: 1 / 25, cost: 14 },
      { name: "Weed barrier fabric", unit: "sq ft", per: "sqft", qty: 1, cost: 0.18, bulk: true },
    ],
    steps: ["Clear weeds and define the bed edge", "Lay weed barrier", "Plant shrubs and water in", "Spread mulch"],
  },
  {
    id: "bed-native-drip", areaType: "bed", title: "Native shrub and perennial bed with drip irrigation", fill: "mulch", laborPerSqft: 0.07, installedPrice: 0,
    items: [
      { name: "Native shrubs, 5 gal", unit: "each", per: "sqft", qty: 1 / 20, cost: 38 },
      { name: "Perennials, 1 gal", unit: "each", per: "sqft", qty: 1 / 12, cost: 12 },
      { name: "Shredded bark mulch, 3 in deep", unit: "cu yd", per: "sqft", qty: 0.00926, cost: 42, bulk: true },
      { name: "Drip line", unit: "lin ft", per: "sqft", qty: 0.3, cost: 0.55, bulk: true },
      { name: "Steel edging", unit: "lin ft", per: "lf", qty: 1, cost: 4.5 },
    ],
    steps: ["Clear, amend soil and set steel edging", "Lay out plants for the homeowner to approve", "Plant, then run drip line to each plant", "Mulch and test the drip zone"],
  },
  {
    id: "bed-layered", areaType: "bed", title: "Layered planting with boulders, cinder mulch and lighting", fill: "cinder", laborPerSqft: 0.11, installedPrice: 0,
    items: [
      { name: "Native shrubs, 5 gal", unit: "each", per: "sqft", qty: 1 / 15, cost: 38 },
      { name: "Perennials, 1 gal", unit: "each", per: "sqft", qty: 1 / 8, cost: 12 },
      { name: "Accent boulder", unit: "each", per: "sqft", qty: 1 / 60, cost: 140 },
      { name: "Red cinder mulch, 3 in deep", unit: "cu yd", per: "sqft", qty: 0.00926, cost: 58, bulk: true },
      { name: "Drip line", unit: "lin ft", per: "sqft", qty: 0.3, cost: 0.55, bulk: true },
      { name: "Low voltage accent light", unit: "each", per: "sqft", qty: 1 / 50, cost: 95 },
    ],
    steps: ["Clear, amend soil and shape gentle mounds", "Set boulders one third buried", "Plant shrubs, then perennials", "Run drip line and lighting wire", "Spread cinder mulch", "Aim accent lights at dusk"],
  },
];

export type TierMap = Record<AreaType, Record<TierKey, string>>;
export const DEFAULT_TIER_MAP: TierMap = {
  patio: { basic: "patio-dg", standard: "patio-paver", premium: "patio-flag" },
  lawn: { basic: "lawn-seed", standard: "lawn-sod", premium: "lawn-sod-irr" },
  bed: { basic: "bed-mulch", standard: "bed-native-drip", premium: "bed-layered" },
};

/* ---------- pavers ---------- */

/** waste = % added for cuts, labor = multiplier, needsTwoToOne = only works with 2:1 pavers. */
export const LAYOUTS: Record<PaverLayout, { name: string; waste: number; labor: number; needsTwoToOne?: boolean }> = {
  running: { name: "Running bond", waste: 5, labor: 1 },
  stack: { name: "Stack bond", waste: 5, labor: 0.95 },
  basket: { name: "Basketweave", waste: 7, labor: 1.05, needsTwoToOne: true },
  herring: { name: "Herringbone", waste: 12, labor: 1.2, needsTwoToOne: true },
  ashlar: { name: "Random ashlar", waste: 10, labor: 1.15 },
};

/** Paver face in inches. labor and material are multipliers on the base paver line. */
export const SIZES: Record<PaverSize, { w: number; h: number; labor: number; material: number }> = {
  "4x8": { w: 8, h: 4, labor: 1.1, material: 1 },
  "6x9": { w: 9, h: 6, labor: 1, material: 1 },
  "6x12": { w: 12, h: 6, labor: 1, material: 1.05 },
  "12x12": { w: 12, h: 12, labor: 0.9, material: 1.1 },
  "16x16": { w: 16, h: 16, labor: 0.9, material: 1.2 },
  "24x24": { w: 24, h: 24, labor: 1, material: 1.4 },
};

export const COLORS: Record<PaverColor, { name: string; hex: string }> = {
  sand: { name: "Sandstone", hex: "#c9b08a" },
  char: { name: "Charcoal", hex: "#5c5c61" },
  terra: { name: "Terracotta", hex: "#b5694a" },
  gray: { name: "Pewter gray", hex: "#a5a5a1" },
};

/* ---------- lawn borders ---------- */

export interface Border {
  name: string;
  costPerFt: number;
  laborPerFt: number;
  /** Band width in feet, for drawing. */
  width: number;
  color: string;
}

export const DEFAULT_BORDERS: Record<Exclude<BorderKey, "none">, Border> = {
  steel: { name: "Steel edging", costPerFt: 4.5, laborPerFt: 0.05, width: 0.4, color: "#2e2e2e" },
  rock: { name: "River rock band, 12 in wide", costPerFt: 3.2, laborPerFt: 0.08, width: 1, color: "#c9c1b3" },
  paver: { name: "Paver border course", costPerFt: 6.5, laborPerFt: 0.15, width: 0.7, color: "#8a6f5c" },
  curb: { name: "Concrete curb", costPerFt: 9, laborPerFt: 0.12, width: 0.5, color: "#dcdcd6" },
};

/* ---------- plants ---------- */

export const PLANT_KINDS: Record<PlantKind, string> = { tree: "Tree", shrub: "Shrub", perennial: "Perennial or grass" };

/** Installed container size, plant cost and install hours per plant, by tier. */
export type PlantSizeRow = { size: string; cost: number; hours: number };
export const DEFAULT_PLANT_SIZES: Record<PlantKind, Record<TierKey, PlantSizeRow>> = {
  tree: { basic: { size: "5 gal", cost: 48, hours: 1 }, standard: { size: "15 gal", cost: 165, hours: 2 }, premium: { size: "24 in box", cost: 420, hours: 4 } },
  shrub: { basic: { size: "1 gal", cost: 14, hours: 0.3 }, standard: { size: "5 gal", cost: 38, hours: 0.6 }, premium: { size: "15 gal", cost: 110, hours: 1.2 } },
  perennial: { basic: { size: "4 in pot", cost: 6, hours: 0.15 }, standard: { size: "1 gal", cost: 12, hours: 0.25 }, premium: { size: "2 gal", cost: 22, hours: 0.35 } },
};

/** Mature size used before a local estimate exists: height, spread in feet. */
export const GENERIC_SIZE: Record<PlantKind, [number, number]> = { tree: [15, 10], shrub: [4, 4], perennial: [1.5, 1.5] };

/* ---------- utilities, APWA uniform color code ---------- */

export const UTILITIES: Record<UtilityType, { name: string; short: string; color: string }> = {
  gas: { name: "Gas line", short: "GAS", color: "#f2c500" },
  elec: { name: "Electric line", short: "ELECTRIC", color: "#e5262b" },
  comm: { name: "Phone, cable or fiber", short: "COMM", color: "#f28c1c" },
  water: { name: "Water line", short: "WATER", color: "#1f6fd6" },
  irr: { name: "Irrigation or reclaimed water", short: "IRRIGATION", color: "#8a3fc7" },
  sewer: { name: "Sewer or storm drain", short: "SEWER", color: "#2c9a3c" },
};
