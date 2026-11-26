import { paymentsState } from "@/server/connect";
import { jsonError } from "@/server/http";
import { publicView } from "@/server/proposals";
import { shared } from "@/server/publicRoutes";

export const dynamic = "force-dynamic";

/** The homeowner's proposal. Whitelisted fields only; see publicView. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const sh = await shared(token);
    const ps = await paymentsState(sh.companyId).catch(() => ({ ready: false }));
    return Response.json(await publicView(sh, { ready: ps.ready }), { headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } });
  } catch (e) {
    return jsonError(e);
  }
}
