import type { LocateRequest } from "@/lib/locate";
import { rulesFor } from "@/lib/locate";
import { config } from "./config";
import { ProviderError } from "./http";

export type LocateResult =
  | { mode: "submitted"; ticket: string; provider: string }
  | { mode: "prepared"; center: string; website: string | null; checklist: string[] };

/**
 * Sends a locate request to the one call center, or prepares it for the
 * landscaper to submit. Direct submission needs an agreement with the center
 * (Arizona 811 runs Exactix); until then nothing is sent on anyone's behalf.
 */
export async function requestLocate(req: LocateRequest): Promise<LocateResult> {
  const rules = rulesFor(req.state);
  if (config.onecall.provider === "exactix") {
    if (!config.onecall.url || !config.onecall.key) throw new ProviderError("Set ONECALL_API_URL and ONECALL_API_KEY for the Exactix integration.", 501, "not_configured");
    // The request shape depends on the center's integration agreement. Map LocateRequest here once it is signed.
    throw new ProviderError("The Exactix integration is not wired yet. It needs the center's API spec.", 501, "not_configured");
  }
  return {
    mode: "prepared",
    center: rules?.center ?? "your state's 811 center",
    website: rules?.website ?? null,
    checklist: [
      `Open ${rules?.center ?? "your 811 center"} and start a new locate request.`,
      `Use the address ${req.address}${req.county ? `, ${req.county} County` : ""}.`,
      "Upload or draw the dig area from the downloaded file, which marks exactly where you will dig.",
      `Work type: ${req.workType}.`,
      "Enter the ticket number back in Tierscape so the job tracks it.",
    ],
  };
}
