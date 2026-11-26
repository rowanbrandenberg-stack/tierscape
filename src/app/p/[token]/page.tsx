import type { Metadata } from "next";
import { PublicProposal } from "@/components/share/PublicProposal";

export const metadata: Metadata = { title: "Your proposal", robots: { index: false, follow: false }, referrer: "no-referrer" };

/** The homeowner's online proposal. Everything it shows comes from the server for this one link. */
export default async function OnlineProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicProposal token={token} />;
}
