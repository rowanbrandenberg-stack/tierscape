"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError } from "@/client/api";
import { useJobs } from "@/client/jobsStore";
import { putPhoto } from "@/client/photoStore";
import { downscale } from "@/client/proposalApi";
import { photoJob } from "@/lib/jobs";
import s from "./home.module.css";

/** Photo first: the client's yard photo and what they asked for. Tierscape drafts the three options. */
export function NewPhotoJob() {
  const router = useRouter();
  const save = useJobs((x) => x.save);
  const [file, setFile] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [request, setRequest] = useState("");
  const [notes, setNotes] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  async function pick(f: File | undefined) {
    setError(null);
    if (!f) return;
    if (!f.type.startsWith("image/") && !/\.(heic|heif)$/i.test(f.name)) return setError("Pick a photo of the yard.");
    if (f.size > 40 * 1024 * 1024) return setError("That file is over 40 MB. Pick a smaller photo.");
    try {
      const b = await downscale(f);
      setFile(b);
      setPreview(URL.createObjectURL(b));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "This photo could not be opened.");
    }
  }

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !request.trim()) return;
    setBusy(true);
    try {
      const job = photoJob(request, address, notes);
      await putPhoto(`concept:${job.id}`, file);
      save(job);
      router.push(`/jobs/${job.id}`);
    } catch {
      setError("The photo could not be saved on this device. Try again.");
      setBusy(false);
    }
  }

  return (
    <form className={s.form} onSubmit={start}>
      <label className={s.drop}>
        <input type="file" accept="image/*" onChange={(e) => pick(e.target.files?.[0])} />
        {preview ? <img src={preview} alt="The client's yard" /> : <span><strong>Add the client&apos;s yard photo</strong><span className="small muted">Take one or pick from your phone</span></span>}
      </label>
      <label className="label" htmlFor="req">What did they ask for?</label>
      <textarea id="req" className="input" rows={2} value={request} onChange={(e) => setRequest(e.target.value)} placeholder="Can you fix this patio?" maxLength={600} required />
      <details>
        <summary className="small">Add what you already know (optional)</summary>
        <div className="stack" style={{ "--gap": "8px", marginTop: 8 } as React.CSSProperties}>
          <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={3000} placeholder="Existing play sand, no aggregate base. Client mentioned a budget around $3,000." aria-label="What you already know" />
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Job address" aria-label="Job address" maxLength={200} />
        </div>
      </details>
      <div className="row">
        <button className="btn solid" disabled={busy || !file || !request.trim()}>{busy ? "Starting" : "Draft three options"} <span aria-hidden="true">→</span></button>
      </div>
      {error ? <p className="warn" role="alert">{error}</p> : <p className="small muted">Tierscape drafts affordable, standard and premium options with concept pictures from the photo. You review every price before the client sees it.</p>}
    </form>
  );
}
