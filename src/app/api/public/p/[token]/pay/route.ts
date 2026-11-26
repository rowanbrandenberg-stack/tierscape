import { jsonError, ProviderError } from "@/server/http";
import { startPayment } from "@/server/publicRoutes";

/** Send the homeowner to Checkout. Only the kind of payment comes from the browser, never an amount. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const { kind } = (await req.json().catch(() => ({}))) as { kind?: string };
    if (kind !== "deposit" && kind !== "balance") throw new ProviderError("Choose the deposit or the balance.", 400, "bad_request");
    return Response.json(await startPayment(token, kind, new URL(req.url).origin));
  } catch (e) {
    return jsonError(e);
  }
}
