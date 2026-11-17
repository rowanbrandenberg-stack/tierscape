import type { LocateRequest } from "@/lib/locate";
import { jsonError, ProviderError } from "@/server/http";
import { requestLocate } from "@/server/onecall";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as LocateRequest;
    if (!body?.digArea?.features?.length) throw new ProviderError("Draw at least one dig area before requesting a locate.", 400, "bad_request");
    return Response.json(await requestLocate(body));
  } catch (e) {
    return jsonError(e);
  }
}
