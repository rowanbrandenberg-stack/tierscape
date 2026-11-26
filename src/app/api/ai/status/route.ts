import { aiReadiness } from "@/server/aiGate";
import { jsonError } from "@/server/http";

export const dynamic = "force-dynamic";

/** Exactly what photo drafting needs that is missing, for the setup screen. */
export async function GET() {
  try {
    return Response.json(await aiReadiness());
  } catch (e) {
    return jsonError(e);
  }
}
