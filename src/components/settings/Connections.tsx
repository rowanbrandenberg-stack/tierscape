"use client";
import { useFeatures } from "@/client/useFeatures";
import s from "./settings.module.css";

const ROWS = [
  { key: "imagery", name: "Aerial imagery", on: "Loads automatically for every address.", manual: "" },
  { key: "regrid", name: "Parcel lines outside Arizona", on: "Nationwide parcel lines through Regrid.", manual: "" },
  {
    key: "claude",
    name: "AI assist",
    on: "Sizes plants for the location, places site photos, finds likely utilities and traces locator paint.",
    manual: "Manual test only. No AI service is connected: TierScape gives you the prompt and files, you run them in your own Claude account and paste the answer back.",
  },
  {
    key: "render",
    name: "Photo renders",
    on: "Each tier rendered from the homeowner's own photo.",
    manual: "Manual test only. No image service is connected: TierScape writes the render instructions, you run them with the site photo in your own ChatGPT account and upload the image back. Renders are not saved with the job.",
  },
  { key: "onecall", name: "Direct 811 submission", on: "Locate requests go straight to the one call center.", manual: "" },
] as const;

export function Connections() {
  const f = useFeatures();
  return (
    <section className={s.section} aria-labelledby="conn-h">
      <div className={s.aside}>
        <h2 id="conn-h" className="head">Connections</h2>
        <p className="small muted">What is turned on for your account. Address lookup and Arizona property lines are always on.</p>
      </div>
      <div className={s.content}>
        <ul className={s.conns}>
          {ROWS.map((r) => {
            const st = f?.[r.key];
            return (
              <li key={r.key}>
                <span className="swatch" style={{ background: st?.manual ? "#e0a400" : st?.ok ? "var(--ok)" : "var(--rule-strong)" }} />
                <span style={{ minWidth: 0 }}>
                  <strong>{r.name}</strong>
                  <span className="small muted" style={{ display: "block" }}>{!st ? "Checking" : st.manual ? r.manual : st.ok ? r.on : st.why}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
