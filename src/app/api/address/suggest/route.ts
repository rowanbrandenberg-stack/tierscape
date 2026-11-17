import { suggestAddresses } from "@/server/suggest";

export const dynamic = "force-dynamic";

/**
 * Address suggestions while the user types. Always answers 200: if the
 * provider is down or not configured the list is empty and the form still
 * works by typing the full address.
 */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const q = (p.get("q") ?? "").trim().slice(0, 200);
  if (q.length < 3) return Response.json({ suggestions: [] });
  const lat = Number(p.get("lat"));
  const lon = Number(p.get("lon"));
  const near = p.has("lat") && p.has("lon") && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined;
  try {
    return Response.json({ suggestions: await suggestAddresses(q, near) });
  } catch {
    return Response.json({ suggestions: [] });
  }
}
