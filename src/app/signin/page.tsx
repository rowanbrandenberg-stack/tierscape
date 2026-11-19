import type { Metadata } from "next";
import { SignIn } from "@/components/account/SignIn";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return <SignIn />;
}
