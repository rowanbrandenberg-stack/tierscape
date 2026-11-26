import { companyAccess } from "@/server/companyAccess";
import { startGeneration, type StartBody } from "@/server/drafting";
import { jsonError } from "@/server/http";

// The work runs after the response (see after() in drafting), within this limit.
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const { s, a } = await companyAccess();
    const body = (await req.json().catch(() => ({}))) as StartBody;
    return Response.json(await startGeneration("draft", s, a, body), { status: 202 });
  } catch (e) {
    return jsonError(e);
  }
}
