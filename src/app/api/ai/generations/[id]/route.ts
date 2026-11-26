import { companyAccess } from "@/server/companyAccess";
import { getGeneration, publicGen } from "@/server/generations";
import { jsonError, ProviderError } from "@/server/http";

export const dynamic = "force-dynamic";

/** Poll one AI job. Only the company that started it can read it. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { s } = await companyAccess();
    const g = await getGeneration(id, s.company.id);
    if (!g) throw new ProviderError("Not found.", 404, "not_found");
    return Response.json(publicGen(g));
  } catch (e) {
    return jsonError(e);
  }
}
