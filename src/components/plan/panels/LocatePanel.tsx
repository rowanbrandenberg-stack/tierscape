"use client";
import { useState } from "react";
import { api, ApiError } from "@/client/api";
import { useEditor } from "@/client/editor";
import { useSettings } from "@/client/settingsStore";
import { useFeatures } from "@/client/useFeatures";
import { findLikelyUtilities, traceMarksFromPhoto } from "@/client/utilities";
import { PRIVATE_LINES, UTILITIES } from "@/lib/catalog";
import { perimeter } from "@/lib/geometry";
import { buildLocateRequest, rulesFor, ticketDates } from "@/lib/locate";
import type { LocateStatus, PrivateLineAnswer, UtilityType } from "@/lib/types";
import { Panel } from "../../ui/Panel";
import s from "./panels.module.css";

const STATUS: Record<LocateStatus, { text: string; bg: string; fg: string }> = {
  not_requested: { text: "Not requested", bg: "transparent", fg: "var(--ink)" },
  prepared: { text: "Prepared, not submitted", bg: "#fff4d6", fg: "#7a5200" },
  submitted: { text: "Submitted", bg: "#e4f1ff", fg: "#0b4f8a" },
  clear: { text: "Clear to dig", bg: "#e3f4e6", fg: "#1d6b33" },
  expired: { text: "Expired, request again", bg: "#fde7e7", fg: "#9a1c1c" },
};

const fmt = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

/**
 * Underground utilities and the 811 request. The traced dig areas are the
 * white lining, so the request is built from the plan itself.
 */
export function LocatePanel() {
  const ed = useEditor();
  const profile = useSettings((x) => x.profile);
  const job = ed.job!;
  const rules = rulesFor(job.site.state);
  const [prepared, setPrepared] = useState<{ center: string; website: string | null; checklist: string[]; file: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [start, setStart] = useState("");
  const features = useFeatures();
  const [finding, setFinding] = useState(false);
  const [findMsg, setFindMsg] = useState<string | null>(null);
  const [tracing, setTracing] = useState(false);
  const [traceMsg, setTraceMsg] = useState<string | null>(null);
  const likely = job.likely ?? [];
  const photo = job.photos.find((p) => p.id === job.activePhotoId) ?? null;
  const claudeOk = !!features?.claude.ok;

  async function find() {
    setFinding(true);
    setFindMsg(null);
    const r = await findLikelyUtilities({ aerial: claudeOk });
    setFinding(false);
    setFindMsg(
      (r.found ? `Found ${r.found} likely ${r.found === 1 ? "utility" : "utilities"}.` : "Nothing obvious turned up. That does not mean the yard is clear.") +
        (r.errors.length ? ` ${r.errors.join(" ")}` : "") +
        (!claudeOk ? " Reading clues off the aerial needs AI assist." : ""),
    );
  }

  async function trace() {
    if (!photo?.dataUrl) return;
    setTracing(true);
    setTraceMsg(null);
    try {
      const blob = await (await fetch(photo.dataUrl)).blob();
      const r = await traceMarksFromPhoto(blob, photo.camera);
      setTraceMsg(r.added ? `Traced ${r.added} marked ${r.added === 1 ? "line" : "lines"}. Check them against the paint and drag points to fix. ${r.note}` : r.note || "No locator marks found in this photo.");
    } catch (e) {
      setTraceMsg(e instanceof ApiError ? e.message : "Could not trace this photo.");
    } finally {
      setTracing(false);
    }
  }

  const setPrivate = (k: (typeof PRIVATE_LINES)[number]["key"], v: PrivateLineAnswer) => ed.commit((j) => void (j.privateLines = { ...(j.privateLines ?? {}), [k]: v }));
  const privateYes = PRIVATE_LINES.filter((p) => job.privateLines?.[p.key] === "yes");

  async function request() {
    setError(null);
    const req = buildLocateRequest(job, { company: profile.company, phone: profile.phone, email: profile.email, license: profile.license }, start || null);
    if (!req) return setError("The sample job has no real location. Start a job from an address to request a locate.");
    if (!req.digArea.features.length) return setError("Draw the dig areas first. They become the marked dig zone on the ticket.");
    setBusy(true);
    try {
      const r = await api.requestLocate(req);
      if (r.mode === "submitted") {
        ed.commit((j) => void (j.locate = { ...j.locate, status: "submitted", number: r.ticket, requestedOn: new Date().toISOString().slice(0, 10), provider: r.provider }));
      } else {
        const file = URL.createObjectURL(new Blob([JSON.stringify(req.digArea, null, 2)], { type: "application/geo+json" }));
        setPrepared({ ...r, file });
        ed.commit((j) => void (j.locate.status = j.locate.number ? j.locate.status : "prepared"));
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not prepare the request.");
    } finally {
      setBusy(false);
    }
  }

  const dates = rules && job.locate.requestedOn ? ticketDates(rules, job.locate.requestedOn) : null;

  return (
    <Panel title="Utilities and 811" id="locate-h">
      <div className={s.callout}>
        <strong>Likely utilities</strong>
        <span>A head start from public maps and the aerial, so you know what to expect when the paint goes down. These are guesses. Nothing here is located until 811 marks it.</span>
        <div className="row">
          <button className="btn sm" onClick={find} disabled={finding || (!job.site.origin && !claudeOk)}>{finding ? "Looking" : likely.length ? "Look again" : "Find likely utilities"}</button>
          {likely.length > 0 && <button className="link" onClick={() => ed.commit((j) => void (j.likely = []))}>Clear</button>}
        </div>
        {findMsg && <span className="small muted" role="status">{findMsg}</span>}
      </div>
      {likely.length > 0 && (
        <div>
          {likely.map((l) => (
            <div key={l.id} className={s.item}>
              <div className={s.line}>
                <span className="swatch" style={{ background: "transparent", border: `2px dashed ${UTILITIES[l.type].color}` }} />
                <span className={s.grow}>
                  {l.label} <span className="small muted">· {l.source === "public" ? "public map" : "seen on aerial"}{l.overhead ? " · overhead" : ""}</span>
                </span>
                <button className="link" onClick={() => ed.commit((j) => void (j.likely = (j.likely ?? []).filter((x) => x.id !== l.id)))}>Dismiss</button>
              </div>
            </div>
          ))}
          <p className="small muted">
            Dashed and not located. {likely.some((l) => l.source === "public") && <>Public data © OpenStreetMap contributors. </>}
            Check large gas and hazardous pipelines on the{" "}
            <a className="link" href="https://www.npms.phmsa.dot.gov/AboutPublicViewer.aspx" target="_blank" rel="noreferrer">national pipeline map ↗</a>.
          </p>
        </div>
      )}

      <div className="stack" style={{ "--gap": "6px" } as React.CSSProperties}>
        <span className="label">Private lines 811 will not mark</span>
        <p className="small muted">Utilities only mark up to the meter. Ask the homeowner about these before anyone digs.</p>
        {PRIVATE_LINES.map((p) => (
          <div key={p.key} className={s.line}>
            <span className="swatch" style={{ background: UTILITIES[p.type].color }} />
            <span className={s.grow}>{p.name}</span>
            <div className="seg" role="group" aria-label={p.name}>
              {(["yes", "no", "unsure"] as const).map((v) => (
                <button key={v} aria-pressed={job.privateLines?.[p.key] === v} onClick={() => setPrivate(p.key, v)}>{v === "yes" ? "Yes" : v === "no" ? "No" : "Not sure"}</button>
              ))}
            </div>
          </div>
        ))}
        {privateYes.length > 0 && <p className="small">Mark these by hand or hire a private locator. Then trace them with Mark a line.</p>}
      </div>

      <span className="label">Marked lines</span>
      <div className={s.line}>
        <select className="select" style={{ flex: "1 1 160px", width: "auto" }} value={ed.utilityType} onChange={(e) => ed.set({ utilityType: e.target.value as UtilityType })} aria-label="Utility type">
          {(Object.keys(UTILITIES) as UtilityType[]).map((k) => (
            <option key={k} value={k}>{UTILITIES[k].name}</option>
          ))}
        </select>
        <button className="btn sm" onClick={() => ed.set({ tool: "utility", draft: [], selection: null, placingPlantId: null })}>Mark a line</button>
      </div>
      {job.utilities.length > 0 && (
        <div>
          {job.utilities.map((u) => (
            <div key={u.id} className={s.item}>
              <div className={s.line}>
                <span className="swatch" style={{ background: UTILITIES[u.type].color }} />
                <span className={s.grow}>{UTILITIES[u.type].name} · <span className="num">{Math.round(perimeter(u.pts, false))} ft</span>{u.source === "photo" && <span className="small muted"> · traced from photo</span>}</span>
                <button className="link" onClick={() => ed.set({ selection: { kind: "utility", id: u.id }, tool: "select" })}>Adjust</button>
                <button className="link" onClick={() => ed.commit((j) => void (j.utilities = j.utilities.filter((x) => x.id !== u.id)))}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="small muted">Each mark shows a 2 ft hand dig band on both sides. Areas and plants inside it get flagged.</p>
      <div className="row">
        <button className="btn sm quiet" onClick={trace} disabled={tracing || !photo?.dataUrl || !claudeOk} title={!claudeOk ? "Needs AI assist" : !photo ? "Add a site photo of the paint first" : undefined}>
          {tracing ? "Tracing" : "Trace paint from a photo"}
        </button>
        <span className="small muted">{!photo ? "Add a photo of the paint and flags under Site photos." : photo.camera ? `Uses ${photo.name}.` : `Uses ${photo.name}. Place it on the plan first for a better trace.`}</span>
      </div>
      {traceMsg && <p className="small muted" role="status">{traceMsg}</p>}

      <div className="stack" style={{ "--gap": "10px" } as React.CSSProperties}>
        <div className={s.line}>
          <span className="label">811 request</span>
          <span className={s.grow} />
          <span className="small" role="status" style={{ padding: "2px 10px", borderRadius: 999, border: "1px solid var(--rule-strong)", background: STATUS[job.locate.status].bg, color: STATUS[job.locate.status].fg }}>
            {STATUS[job.locate.status].text}{job.locate.number && job.locate.status !== "prepared" ? ` · ${job.locate.number}` : ""}
          </span>
        </div>
        <div className={s.grid2}>
          <div className="field">
            <label className="label" htmlFor="loc-start">Planned dig date</label>
            <input id="loc-start" type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="field" style={{ justifyContent: "flex-end" }}>
            <button className="btn sm solid" style={{ alignSelf: "flex-start" }} onClick={request} disabled={busy}>{busy ? "Preparing" : job.locate.number ? "Request again" : "Request locate"} <span aria-hidden="true">→</span></button>
          </div>
        </div>
        {error && <p className="warn" role="alert">{error}</p>}
        {prepared && (
          <div className={s.callout}>
            <strong>Prepared, not submitted.</strong>
            <span>Tierscape filled everything in, but nothing has gone to {prepared.center} yet. Submit it there, then enter the ticket number below:</span>
            <ol>{prepared.checklist.map((c) => <li key={c}>{c}</li>)}</ol>
            <div className="row">
              <a className="btn sm" href={prepared.file} download={`dig-area-${job.id}.geojson`}>Download dig area</a>
              {prepared.website && <a className="btn sm quiet" href={prepared.website} target="_blank" rel="noreferrer">Open {prepared.center} ↗</a>}
            </div>
          </div>
        )}
        <div className={s.grid2}>
          <div className="field">
            <label className="label" htmlFor="loc-num">Ticket number</label>
            <input id="loc-num" className="input num" value={job.locate.number} placeholder="Not requested" onChange={(e) => ed.mutate((j) => void (j.locate.number = e.target.value.trim()))} onBlur={() => ed.commit((j) => void (j.locate.status = j.locate.number ? "submitted" : j.locate.status))} />
          </div>
          <div className="field">
            <label className="label" htmlFor="loc-date">Requested on</label>
            <input id="loc-date" type="date" className="input" value={job.locate.requestedOn} onChange={(e) => ed.commit((j) => void (j.locate.requestedOn = e.target.value))} />
          </div>
        </div>
        <p className="small muted">
          {dates
            ? `Clear to dig from about ${fmt(dates.clear)} once every utility has responded. Marks stay valid through about ${fmt(dates.expires)}. Holidays push these later.`
            : rules
              ? `${rules.center} needs ${rules.noticeWorkingDays} full working days notice before digging.`
              : "Notice periods vary by state. Check with your 811 center."}
        </p>
      </div>
    </Panel>
  );
}
