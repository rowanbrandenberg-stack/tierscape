"use client";
import { useState } from "react";
import { api, ApiError } from "@/client/api";
import { useEditor } from "@/client/editor";
import { useSettings } from "@/client/settingsStore";
import { UTILITIES } from "@/lib/catalog";
import { perimeter } from "@/lib/geometry";
import { buildLocateRequest, rulesFor, ticketDates } from "@/lib/locate";
import type { UtilityType } from "@/lib/types";
import { Panel } from "../../ui/Panel";
import s from "./panels.module.css";

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
                <span className={s.grow}>{UTILITIES[u.type].name} · <span className="num">{Math.round(perimeter(u.pts, false))} ft</span></span>
                <button className="link" onClick={() => ed.set({ selection: { kind: "utility", id: u.id }, tool: "select" })}>Adjust</button>
                <button className="link" onClick={() => ed.commit((j) => void (j.utilities = j.utilities.filter((x) => x.id !== u.id)))}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="small muted">Each mark shows a 2 ft hand dig band on both sides. Areas and plants inside it get flagged.</p>

      <div className="stack" style={{ "--gap": "10px" } as React.CSSProperties}>
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
            <strong>Ready for {prepared.center}.</strong>
            <span>Direct submission is not connected yet, so Tierscape has everything filled in for you:</span>
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
