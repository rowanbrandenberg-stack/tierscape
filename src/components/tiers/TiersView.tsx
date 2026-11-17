"use client";
import { useState } from "react";
import { api, ApiError } from "@/client/api";
import { useEditor } from "@/client/editor";
import { useFeatures } from "@/client/useFeatures";
import { useSettings } from "@/client/settingsStore";
import { renderPrompt } from "@/lib/camera";
import { yardIllustration } from "@/lib/illustration";
import { money, quote } from "@/lib/pricing";
import { TIERS, type TierKey } from "@/lib/types";
import s from "./TiersView.module.css";

export function TiersView({ onNext }: { onNext: () => void }) {
  const ed = useEditor();
  const pricing = useSettings((x) => x.pricing);
  const features = useFeatures();
  const job = ed.job!;
  const [split, setSplit] = useState(50);
  const [renders, setRenders] = useState<Partial<Record<TierKey, string>>>({});
  const [busy, setBusy] = useState<TierKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const photo = job.photos.find((p) => p.id === job.activePhotoId);
  const prompt = renderPrompt(job, pricing, job.tier);
  const canRender = !!features?.render.ok && !!photo?.dataUrl;

  async function render(t: TierKey) {
    if (!photo?.dataUrl) return;
    setBusy(t);
    setError(null);
    try {
      const blob = await (await fetch(photo.dataUrl)).blob();
      const r = await api.render(blob, renderPrompt(job, pricing, t));
      setRenders((x) => ({ ...x, [t]: r.dataUrl }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The render failed. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const before = photo?.dataUrl ? <img src={photo.dataUrl} alt="The yard today" /> : <span dangerouslySetInnerHTML={{ __html: yardIllustration(job, pricing, "before") }} />;
  const after = (t: TierKey) => (renders[t] ? <img src={renders[t]} alt={`${t} tier render`} /> : <span dangerouslySetInnerHTML={{ __html: yardIllustration(job, pricing, t) }} />);

  return (
    <div className="stack" style={{ "--gap": "28px" } as React.CSSProperties}>
      <div className={s.intro}>
        <h2 className="title">Three ways to finish this yard.</h2>
        <p className="lede">Hand this screen to the homeowner. Drag across the picture to compare today with each finish, then tap the one they want.</p>
      </div>

      <div className={s.compare} style={{ "--x": `${split}%` } as React.CSSProperties}>
        <div className={s.layer}>{before}</div>
        <div className={`${s.layer} ${s.after}`}>{after(job.tier)}</div>
        <div className={s.divider} />
        <span className={`${s.tag} ${s.left}`}>Today</span>
        <span className={`${s.tag} ${s.right}`}>{TIERS.find((t) => t.key === job.tier)!.name}</span>
        <input className={s.range} type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} aria-label="Compare today with the finished yard" />
      </div>
      {!renders[job.tier] && (
        <p className="small muted">
          {canRender
            ? "These are sketches. Generate a render to see the homeowner's own photo finished."
            : photo?.dataUrl
              ? "These are sketches. Photo renders need an image model configured on the server."
              : "These are sketches. Add a site photo on the Plan tab to render the real yard."}
        </p>
      )}

      <div className={s.tiers}>
        {TIERS.map((t) => {
          const q = quote(job, pricing, t.key);
          const on = job.tier === t.key;
          return (
            <article key={t.key} className={s.tier} data-on={on}>
              <button className={s.pick} onClick={() => ed.commit((j) => void (j.tier = t.key))} aria-pressed={on}>
                <div className={s.img}>{after(t.key)}</div>
                <div className={s.body}>
                  <div className="spread">
                    <h3 className="head">{t.name}</h3>
                    {on && <span className="chip">Selected</span>}
                  </div>
                  <div className={s.price}>{money(q.price)}</div>
                  <ul className={s.scope}>{q.groups.map((g) => <li key={g.title}>{g.title}</li>)}</ul>
                  <p className="small muted">About {q.days} {q.days === 1 ? "day" : "days"} on site</p>
                </div>
              </button>
              {canRender && (
                <div className={s.foot}>
                  <button className="btn sm quiet" onClick={() => render(t.key)} disabled={!!busy}>{busy === t.key ? "Rendering" : renders[t.key] ? "Render again" : "Render from photo"}</button>
                </div>
              )}
            </article>
          );
        })}
      </div>
      {error && <p className="warn" role="alert">{error}</p>}

      <details className={s.prompt}>
        <summary>
          <span className="label">Render instructions for the {TIERS.find((t) => t.key === job.tier)!.name} tier</span>
        </summary>
        <pre>{prompt}</pre>
        <button className="btn sm quiet" onClick={() => navigator.clipboard?.writeText(prompt).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => undefined)}>
          {copied ? "Copied" : "Copy"}
        </button>
      </details>

      <div>
        <button className="btn solid" onClick={onNext}>Write the proposal <span aria-hidden="true">→</span></button>
      </div>
    </div>
  );
}
