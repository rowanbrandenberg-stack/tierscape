import { defaultSettings, DEFAULT_WARRANTY, type Pricing, type Profile } from "./settings";

/**
 * Before a real proposal goes to a homeowner, the details that came with the
 * app have to be the contractor's own. Placeholders must be replaced (`fix`).
 * Defaults that might be right, such as the crew cost, must be looked at once
 * and kept on purpose (`review`). A kept default is remembered by its value,
 * so changing it back later asks again only if it moves to another default.
 */
export type ReadyKey = "company" | "license" | "contact" | "claim" | "crewCost" | "overhead" | "warranty";
export type ReadyState = "ok" | "fix" | "review";

export interface ReadyItem {
  key: ReadyKey;
  label: string;
  state: ReadyState;
  detail: string;
  /** Where to change it. */
  where: "profile" | "prices";
}

/** Value a kept default is remembered by. */
export function reviewValue(key: ReadyKey, profile: Profile, pricing: Pricing): string {
  switch (key) {
    case "claim":
      return profile.licenseLine;
    case "crewCost":
      return String(pricing.laborRate);
    case "overhead":
      return String(pricing.overheadPct ?? 0);
    case "warranty":
      return profile.warranty;
    default:
      return "";
  }
}

export function proposalReadiness(profile: Profile, pricing: Pricing): ReadyItem[] {
  const d = defaultSettings();
  const kept = profile.reviewed ?? {};
  const isKept = (k: ReadyKey) => kept[k] !== undefined && kept[k] === reviewValue(k, profile, pricing);
  const review = (k: ReadyKey, atDefault: boolean): ReadyState => (atDefault && !isKept(k) ? "review" : "ok");

  const company = !profile.company.trim() || profile.company === d.profile.company;
  const license = !profile.license.trim() || profile.license === d.profile.license;
  const contact = !profile.email.trim() || profile.email === d.profile.email || !profile.phone.trim() || profile.phone === d.profile.phone;
  const overhead = pricing.overheadPct ?? 0;

  return [
    { key: "company", where: "profile", label: "Company name", state: company ? "fix" : "ok", detail: company ? "Still the sample name." : profile.company },
    { key: "license", where: "profile", label: "License number", state: license ? "fix" : "ok", detail: license ? "Still the placeholder number." : profile.license },
    { key: "contact", where: "profile", label: "Phone and email", state: contact ? "fix" : "ok", detail: contact ? "Still the sample contact details. Acceptances are sent to this email." : `${profile.phone} · ${profile.email}` },
    {
      key: "claim",
      where: "profile",
      label: "License claim",
      state: review("claim", profile.licenseLine === d.profile.licenseLine),
      detail: `"${profile.licenseLine || "None"}" is printed on every proposal. Keep it only if it is true.`,
    },
    {
      key: "crewCost",
      where: "prices",
      label: "Crew cost",
      state: review("crewCost", pricing.laborRate === d.pricing.laborRate),
      detail: `$${pricing.laborRate} per person hour${pricing.laborRate === d.pricing.laborRate ? " is the starting value, not your cost" : ""}. Every labor line is built from it.`,
    },
    {
      key: "overhead",
      where: "prices",
      label: "Overhead",
      state: review("overhead", overhead === d.pricing.overheadPct),
      detail: overhead === 0 ? "0%: trucks, insurance, office and fuel are not in the price yet." : `${overhead}% added to job costs before margin.`,
    },
    {
      key: "warranty",
      where: "profile",
      label: "Warranty terms",
      state: !profile.warranty?.trim() ? "fix" : review("warranty", profile.warranty === DEFAULT_WARRANTY),
      detail: !profile.warranty?.trim() ? "Empty. The homeowner agrees to these terms." : profile.warranty === DEFAULT_WARRANTY ? "Still the starting text. The homeowner agrees to these terms." : "Your own terms.",
    },
  ];
}

export const readinessOpen = (items: ReadyItem[]) => items.filter((i) => i.state !== "ok");
export const readyToShare = (items: ReadyItem[]) => readinessOpen(items).length === 0;
