import type { Metadata } from "next";
import { AccountCenter } from "@/components/account/AccountCenter";

export const metadata: Metadata = { title: "Account" };

export default function Account() {
  return <AccountCenter />;
}
