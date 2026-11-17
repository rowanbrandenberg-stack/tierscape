import { imageryReady } from "@/server/config";
import { DETAIL_MAX_ZOOM, hasDetailTile, tileUrl } from "@/server/imagery";

/** Tile proxy, so provider keys never reach the browser and the provider can change in one place. */
export async function GET(_req: Request, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const p = await params;
  const [z, x, y] = [p.z, p.x, p.y].map((v) => Number.parseInt(v, 10));
  if (![z, x, y].every(Number.isFinite) || z < 1 || z > DETAIL_MAX_ZOOM) return new Response("Bad tile", { status: 400 });
  const ready = imageryReady();
  if (!ready.ok) return new Response(ready.why, { status: 501 });
  if (!(await hasDetailTile(z, x, y))) return new Response("No sharper imagery here", { status: 404, headers: { "cache-control": "public, max-age=604800" } });
  const r = await fetch(tileUrl(z, x, y), { next: { revalidate: 60 * 60 * 24 * 7 } }).catch(() => null);
  if (!r || !r.ok) return new Response("Tile unavailable", { status: 502 });
  return new Response(r.body, {
    headers: { "content-type": r.headers.get("content-type") ?? "image/jpeg", "cache-control": "public, max-age=604800, immutable" },
  });
}
