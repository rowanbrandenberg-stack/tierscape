import type { Metadata } from "next";
import { HomeownerProposal } from "@/components/share/HomeownerProposal";

export const metadata: Metadata = { title: "Your proposal", robots: { index: false, follow: false } };

/** The homeowner's view of a proposal. Everything it shows travels in the link. */
export default function SharedProposalPage() {
  return <HomeownerProposal />;
}
