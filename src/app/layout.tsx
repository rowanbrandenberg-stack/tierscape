import type { Metadata, Viewport } from "next";
import "@fontsource/newsreader/300.css";
import "@fontsource/newsreader/300-italic.css";
import "@fontsource/inter-tight/400.css";
import "@fontsource/inter-tight/500.css";
import "@fontsource/inter-tight/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./globals.css";
import { AppHeader } from "@/components/shell/AppHeader";
import { ManualAiDialog } from "@/components/shell/ManualAiDialog";
import { CloudSync } from "@/client/CloudSync";

export const metadata: Metadata = {
  title: { default: "Tierscape", template: "%s · Tierscape" },
  description: "Plan a landscape job from an address. Measure, price three tiers, propose, build, and handle the 811 locate.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#f7f7f5" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppHeader />
        {children}
        <ManualAiDialog />
        <CloudSync />
      </body>
    </html>
  );
}
