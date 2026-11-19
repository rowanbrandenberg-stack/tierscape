import type { Metadata } from "next";
import { PricingPage } from "@/components/pricing/PricingPage";

export const metadata: Metadata = {
  title: "Pricing",
  description: "TierScape plans for landscape contractors: measure, price, present options and hand your crew a build pack.",
};

export default function Pricing() {
  return <PricingPage />;
}
