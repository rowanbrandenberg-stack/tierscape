"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/client/api";
import { useJobs } from "@/client/jobsStore";
import { jobFromSite } from "@/lib/jobs";
import s from "./home.module.css";

export function NewJob() {
  const router = useRouter();
  const save = useJobs((x) => x.save);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { site, notes } = await api.site(address);
      const job = jobFromSite(site);
      if (notes.parcel) job.name = site.matchedAddress ?? address;
      save(job);
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <form className={s.form} onSubmit={start}>
      <label className="label" htmlFor="address">Job address</label>
      <div className={s.inputRow}>
        <input
          id="address"
          className="input big"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="211 W Aspen Ave, Flagstaff, AZ 86001"
          autoComplete="street-address"
          required
        />
        <button className="btn solid" disabled={busy || address.trim().length < 6}>
          {busy ? "Finding the lot" : "Plan this yard"} <span aria-hidden="true">→</span>
        </button>
      </div>
      {error ? <p className="warn" role="alert">{error}</p> : <p className="small muted">US addresses. Arizona lots get their property line automatically.</p>}
    </form>
  );
}
