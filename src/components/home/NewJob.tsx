"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/client/api";
import { useJobs } from "@/client/jobsStore";
import { jobFromSite } from "@/lib/jobs";
import s from "./home.module.css";

export function NewJob() {
  const router = useRouter();
  const save = useJobs((x) => x.save);
  const jobs = useJobs((x) => x.jobs);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  /** Set when the text came from a suggestion, so picking one does not look it up again. */
  const picked = useRef<string | null>(null);

  /** Rank suggestions near the latest real job, which is usually the crew's service area. */
  const near = useMemo(() => {
    const latest = Object.values(jobs)
      .filter((j) => !j.sample && j.site?.origin)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    return latest ? latest.site.origin : null;
  }, [jobs]);

  useEffect(() => {
    const q = address.trim();
    if (q.length < 3 || picked.current === address) {
      setSuggestions([]);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      api
        .suggestAddress(q, near, ctl.signal)
        .then((r) => {
          setSuggestions(r.suggestions);
          setActive(-1);
          setOpen(r.suggestions.length > 0);
        })
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [address, near]);

  function pick(text: string) {
    picked.current = text;
    setAddress(text);
    setSuggestions([]);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      pick(suggestions[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setOpen(false);
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

  const listOpen = open && suggestions.length > 0;

  return (
    <form className={s.form} onSubmit={start}>
      <label className="label" htmlFor="address">Job address</label>
      <div className={s.inputRow}>
        <div className={s.combo}>
          <input
            id="address"
            className="input big"
            value={address}
            onChange={(e) => {
              picked.current = null;
              setAddress(e.target.value);
            }}
            onKeyDown={onKeyDown}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            onBlur={() => setOpen(false)}
            placeholder="211 W Aspen Ave, Flagstaff, AZ 86001"
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-expanded={listOpen}
            aria-controls="address-suggestions"
            aria-autocomplete="list"
            aria-activedescendant={listOpen && active >= 0 ? `address-option-${active}` : undefined}
            required
          />
          {listOpen ? (
            <ul id="address-suggestions" className={s.suggestions} role="listbox" aria-label="Matching addresses">
              {suggestions.map((text, i) => (
                <li
                  key={text}
                  id={`address-option-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? `${s.suggestion} ${s.suggestionActive}` : s.suggestion}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(text);
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  {text}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <button className="btn solid" disabled={busy || address.trim().length < 6}>
          {busy ? "Finding the lot" : "Plan this yard"} <span aria-hidden="true">→</span>
        </button>
      </div>
      {error ? (
        <p className="warn" role="alert">{error}</p>
      ) : (
        <p className="small muted">Start typing and pick the address from the list. US addresses. Arizona lots get their property line automatically.</p>
      )}
    </form>
  );
}
