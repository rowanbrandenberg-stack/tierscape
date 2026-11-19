"use client";
import { useState } from "react";
import { FEEDBACK, revisePrompt, type RerollStart } from "@/lib/renderFeedback";
import s from "./TiersView.module.css";

/**
 * Before another render, ask what was wrong with this one. The answers turn
 * into corrections, the contractor sees and can edit the new instructions,
 * and only then does it render.
 */
export function Reroll({
  tierName,
  base,
  earlier,
  previous,
  onRender,
  onCancel,
}: {
  tierName: string;
  base: string;
  earlier: string[];
  previous: string;
  onRender: (prompt: string, notes: string[], start: RerollStart) => void;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState("");
  const [start, setStart] = useState<RerollStart>("photo");
  const [draft, setDraft] = useState<{ prompt: string; notes: string[] } | null>(null);
  const toggle = (k: string) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const nothing = !picked.length && !other.trim();

  return (
    <section className={s.reroll} aria-label={`Fix the ${tierName} render`}>
      <div className={s.rerollTop}>
        <img src={previous} alt={`Last ${tierName} render`} />
        <div className="stack" style={{ "--gap": "10px", minWidth: 0 } as React.CSSProperties}>
          <div className="spread">
            <h3 className="head">What was off in this render?</h3>
            <button className="link" onClick={onCancel}>Cancel</button>
          </div>
          {!draft ? (
            <>
              <div className={s.chips} role="group" aria-label="Problems">
                {FEEDBACK.map((f) => (
                  <button key={f.key} className={s.chipBtn} aria-pressed={picked.includes(f.key)} onClick={() => toggle(f.key)}>{f.label}</button>
                ))}
              </div>
              <label className="label" htmlFor="reroll-other">Anything else</label>
              <textarea id="reroll-other" className="input" rows={2} value={other} onChange={(e) => setOther(e.target.value)} placeholder="Example: the pavers should be gray, and the maple goes left of the patio" />
              <div className="seg" role="group" aria-label="Start from">
                <button aria-pressed={start === "photo"} onClick={() => setStart("photo")}>Start over from the photo</button>
                <button aria-pressed={start === "render"} onClick={() => setStart("render")}>Fix this render</button>
              </div>
              <span className="small muted">{start === "photo" ? "Best when the house or layout came out wrong." : "Best for small fixes when most of it is right."}</span>
              {earlier.length > 0 && <span className="small muted">{earlier.length} {earlier.length === 1 ? "correction" : "corrections"} from earlier rounds stay in.</span>}
              <div className="row">
                <button className="btn sm solid" disabled={nothing && !earlier.length} onClick={() => setDraft(revisePrompt(base, picked, other, start, earlier))}>Update instructions</button>
              </div>
            </>
          ) : (
            <>
              <label className="label" htmlFor="reroll-prompt">New instructions. Edit anything before rendering.</label>
              <textarea id="reroll-prompt" className={`input ${s.rerollPrompt}`} rows={10} value={draft.prompt} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} />
              <div className="row">
                <button className="btn sm solid" onClick={() => onRender(draft.prompt, draft.notes, start)}>Render with these instructions</button>
                <button className="btn sm quiet" onClick={() => setDraft(null)}>Back</button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
