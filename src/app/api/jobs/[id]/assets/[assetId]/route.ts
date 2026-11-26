import { getAsset, imageResponse } from "@/server/assets";
import { companyAccess } from "@/server/companyAccess";
import { jsonError, ProviderError } from "@/server/http";

/** A job's private photo or render, for members of the company that owns it. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    const { id, assetId } = await params;
    const { s } = await companyAccess();
    const a = await getAsset(assetId, s.company.id, id);
    if (!a) throw new ProviderError("Not found.", 404, "not_found");
    return imageResponse(a);
  } catch (e) {
    return jsonError(e);
  }
}
