import { getAsset, imageResponse } from "@/server/assets";
import { jsonError, ProviderError } from "@/server/http";
import { shared } from "@/server/publicRoutes";
import type { TierKey } from "@/lib/types";

/**
 * The yard photo or one option's concept picture, only when the contractor
 * published it in the version this link shows.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; which: string }> }) {
  try {
    const { token, which } = await params;
    const sh = await shared(token);
    const assets = sh.proposal.internal?.assets;
    const id = which === "photo" ? (sh.proposal.snapshot.photo ? assets?.photo : null) : assets?.renders?.[which as TierKey];
    if (!id) throw new ProviderError("Not found.", 404, "not_found");
    const a = await getAsset(id, sh.companyId, sh.jobId);
    if (!a) throw new ProviderError("Not found.", 404, "not_found");
    return imageResponse(a, "share");
  } catch (e) {
    return jsonError(e);
  }
}
