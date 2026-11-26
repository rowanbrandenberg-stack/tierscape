import { adminDb } from "./supabase";
import { ProviderError } from "./http";

/**
 * Original yard photos and concept renders in a private Supabase Storage
 * bucket. Nothing is public: files are read back only through routes that
 * have checked the company session or a live share token.
 */
export const BUCKET = "job-assets";
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export interface AssetRow {
  id: string;
  company_id: string;
  job_id: string;
  kind: "photo" | "render";
  tier: string | null;
  storage_path: string;
  content_type: string;
  bytes: number;
}

/** Is this really an image of the type it claims? Checks the file's own magic bytes. */
export function sniff(b: Buffer): string | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length > 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export async function putAsset(o: { id: string; companyId: string; jobId: string; kind: AssetRow["kind"]; tier?: string | null; bytes: Buffer }): Promise<AssetRow> {
  const type = sniff(o.bytes);
  if (!type) throw new ProviderError("That file is not a JPEG, PNG or WebP image.", 415, "bad_type");
  if (o.bytes.length > MAX_PHOTO_BYTES) throw new ProviderError("The photo is larger than 10 MB.", 413, "too_large");
  const path = `${o.companyId}/${o.jobId}/${o.id}.${TYPES[type]}`;
  const db = adminDb();
  const up = await db.storage.from(BUCKET).upload(path, o.bytes, { contentType: type, upsert: false });
  if (up.error && !/exists/i.test(up.error.message)) throw new Error(up.error.message);
  const row: AssetRow = { id: o.id, company_id: o.companyId, job_id: o.jobId, kind: o.kind, tier: o.tier ?? null, storage_path: path, content_type: type, bytes: o.bytes.length };
  const ins = await db.from("job_assets").upsert(row);
  if (ins.error) throw new Error(ins.error.message);
  return row;
}

/** Load an asset only if it belongs to this company and job. */
export async function getAsset(id: string, companyId: string, jobId?: string): Promise<{ row: AssetRow; bytes: Buffer } | null> {
  const db = adminDb();
  let q = db.from("job_assets").select("*").eq("id", id).eq("company_id", companyId);
  if (jobId) q = q.eq("job_id", jobId);
  const r = await q.maybeSingle();
  if (r.error) throw new Error(r.error.message);
  if (!r.data) return null;
  const row = r.data as AssetRow;
  const dl = await db.storage.from(BUCKET).download(row.storage_path);
  if (dl.error || !dl.data) throw new Error(dl.error?.message ?? "Download failed");
  return { row, bytes: Buffer.from(await dl.data.arrayBuffer()) };
}

export function imageResponse(a: { row: AssetRow; bytes: Buffer }, cache: "private" | "share" = "private") {
  return new Response(new Uint8Array(a.bytes), {
    headers: {
      "content-type": a.row.content_type,
      "cache-control": cache === "private" ? "private, max-age=300" : "private, no-store",
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
    },
  });
}
