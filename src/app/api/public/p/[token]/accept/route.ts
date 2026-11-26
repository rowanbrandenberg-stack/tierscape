import { jsonError } from "@/server/http";
import { accept } from "@/server/publicRoutes";

/** Sign one option of the exact version on screen. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Response.json(await accept(token, body, req.headers.get("user-agent")));
  } catch (e) {
    return jsonError(e);
  }
}
