import { jsonError } from "@/server/http";
import { requestChanges } from "@/server/publicRoutes";

/** The homeowner asks for something different before deciding. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    return Response.json(await requestChanges(token, (await req.json().catch(() => ({}))) as Record<string, unknown>));
  } catch (e) {
    return jsonError(e);
  }
}
