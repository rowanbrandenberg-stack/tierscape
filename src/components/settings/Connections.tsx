"use client";
import { useFeatures } from "@/client/useFeatures";
import s from "./settings.module.css";

const ROWS = [
  { key: "imagery", name: "Aerial imagery", on: "Loads automatically for every address." },
  { key: "regrid", name: "Parcel lines outside Arizona", on: "Nationwide parcel lines through Regrid." },
  { key: "claude", name: "Growth estimates and photo matching", on: "Claude sizes plants for the location and places site photos on the plan." },
  { key: "render", name: "Photo renders", on: "Each tier rendered from the homeowner's own photo." },
  { key: "onecall", name: "Direct 811 submission", on: "Locate requests go straight to the one call center." },
] as const;

export function Connections() {
  const f = useFeatures();
  return (
    <section className={s.section} aria-labelledby="conn-h">
      <div className={s.aside}>
        <h2 id="conn-h" className="head">Connections</h2>
        <p className="small muted">Set on the server. Arizona parcel lines and address lookup are always on and free.</p>
      </div>
      <div className={s.content}>
        <ul className={s.conns}>
          {ROWS.map((r) => {
            const st = f?.[r.key];
            return (
              <li key={r.key}>
                <span className="swatch" style={{ background: st?.ok ? "var(--ok)" : "var(--rule-strong)" }} />
                <span style={{ minWidth: 0 }}>
                  <strong>{r.name}</strong>
                  <span className="small muted" style={{ display: "block" }}>{!st ? "Checking" : st.ok ? r.on : st.why}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
