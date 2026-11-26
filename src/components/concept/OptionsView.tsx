"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ApiError } from "@/client/api";
import { useEditor } from "@/client/editor";
import { getPhoto } from "@/client/photoStore";
import { proposalApi, requestKey, waitFor, type AiStatus, type Gen } from "@/client/proposalApi";
import { useSettings } from "@/client/settingsStore";
import { TIER_LABEL, TIER_ORDER, type ConceptOption, type PhotoConcept } from "@/lib/concept";
import { estimate, ITEM_KINDS, sanitizeItem, type EstimateItem } from "@/lib/estimate";
import { breakdown, explainTotal, packageOf, priceAlternative, type Alternative, type PackageKey } from "@/lib/breakdown";
import { usdCents } from "@/lib/proposal";
import { money } from "@/lib/pricing";
import type { TierKey } from "@/lib/types";
import s from "./OptionsView.module.css";

type Pending = NonNullable<PhotoConcept["pending"]>[number];

const PKG: Record<PackageKey, string> = { prep: "Site prep", materials: "Materials", install: "Installation", haul: "Haul away" };
const SOURCE: Record<EstimateItem["costSource"], string> = { rate_book: "Your rate book", contractor: "Your number", ai_estimate: "Suggested, check it" };
const lines = (a: string[]) => a.join("\n");
const unlines = (t: string) => t.split("\n").map((x) => x.trimStart()).slice(0, 14);

/**
 * Photo-first jobs: draft three options from the photo, then let the
 * contractor check and change every scope, quantity and cost before anything
 * reaches the homeowner.
 */
export function OptionsView({ onNext }: { onNext: () => void }) {
  const ed = useEditor();
  const job = ed.job!;
  const c = job.concept!;
  const pricing = useSettings((x) => x.pricing);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [localPhoto, setLocalPhoto] = useState<string | null>(null);
  const [assetFailed, setAssetFailed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<string | null>(null);
  const resumed = useRef(false);

  const upd = useCallback((fn: (c: PhotoConcept) => void) => ed.commit((j) => void (j.concept && fn(j.concept))), [ed]);
  const live = (fn: (c: PhotoConcept) => void) => ed.mutate((j) => void (j.concept && fn(j.concept)));
  const setErr = (k: string, m: string | null) => setErrors((e) => { const n = { ...e }; if (m) n[k] = m; else delete n[k]; return n; });

  useEffect(() => {
    let url: string | null = null;
    getPhoto(`concept:${job.id}`).then((b) => b && setLocalPhoto((url = URL.createObjectURL(b)))).catch(() => undefined);
    proposalApi.aiStatus().then(setStatus).catch((e) => setStatusErr(e instanceof ApiError ? e.message : "Could not check the AI setup."));
    return () => void (url && URL.revokeObjectURL(url));
  }, [job.id]);

  /** Apply a finished job's result to the concept. */
  const finish = useCallback(
    (p: Pending, g: Gen) => {
      const slot = p.kind === "draft" ? "draft" : `${p.kind}:${p.tier}`;
      upd((cc) => void (cc.pending = (cc.pending ?? []).filter((x) => x.id !== p.id)));
      if (g.status !== "succeeded" || !g.result) return setErr(slot, g.error ?? "That did not work. Try again.");
      setErr(slot, null);
      const r = g.result as { concept?: PhotoConcept; option?: ConceptOption; tier?: TierKey; render?: ConceptOption["render"] };
      upd((cc) => {
        if (p.kind === "draft" && r.concept) {
          const keep = { photoId: cc.photoId, pending: cc.pending, request: cc.request, notes: cc.notes };
          // Concept pictures from an earlier draft no longer match the new scopes, so they are dropped.
          Object.assign(cc, r.concept, keep);
        } else if (p.kind === "option" && r.option) {
          cc.options = cc.options.map((o) => (o.tier === p.tier ? { ...r.option!, render: null } : o));
          cc.review = { scopes: false, preliminary: false };
        } else if (p.kind === "render" && r.render) {
          cc.options = cc.options.map((o) => (o.tier === p.tier ? { ...o, render: r.render! } : o));
        }
      });
    },
    [upd],
  );

  const follow = useCallback(
    async (p: Pending, first: Gen) => {
      try {
        finish(p, await waitFor(first));
      } catch (e) {
        setErr(p.kind === "draft" ? "draft" : `${p.kind}:${p.tier}`, e instanceof ApiError ? e.message : "Lost track of this. Reload the page to check on it.");
      }
    },
    [finish],
  );

  // A reload while something was running: pick it back up from the server.
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    for (const p of c.pending ?? []) void follow(p, { id: p.id, kind: p.kind, tier: p.tier, status: "running", attempts: 1, error: null, result: null });
  }, [c.pending, follow]);

  async function ensureUploaded(): Promise<PhotoConcept> {
    const cur = useEditor.getState().job!;
    if (cur.concept!.photoId) {
      await proposalApi.saveJob(cur);
      return cur.concept!;
    }
    const blob = await getPhoto(`concept:${cur.id}`).catch(() => undefined);
    if (!blob) throw new ApiError("The photo is not on this device. Start a new photo job from the home page.", "no_photo");
    setPhase("Saving the photo privately to your account");
    const { photoId } = await proposalApi.uploadPhoto(cur, blob);
    upd((cc) => void (cc.photoId = photoId));
    const after = useEditor.getState().job!;
    await proposalApi.saveJob(after);
    return after.concept!;
  }

  async function run(kind: Pending["kind"], tier: TierKey | null, instruction = "", reuse?: Pending) {
    const slot = kind === "draft" ? "draft" : `${kind}:${tier}`;
    setErr(slot, null);
    try {
      const concept = await ensureUploaded();
      setPhase(null);
      const key = reuse?.key ?? requestKey(kind);
      const g = kind === "draft" ? await proposalApi.draft(job.id, key, concept) : kind === "option" ? await proposalApi.option(job.id, key, concept, tier!, instruction) : await proposalApi.render(job.id, key, concept, tier!);
      const p: Pending = { id: g.id, kind, tier, key };
      if (g.status === "succeeded" || g.status === "failed") return finish(p, g);
      upd((cc) => void (cc.pending = [...(cc.pending ?? []).filter((x) => x.id !== g.id), p]));
      await follow(p, g);
    } catch (e) {
      setPhase(null);
      setErr(slot, e instanceof ApiError ? e.message : "That did not work. Try again.");
    }
  }

  const busy = (kind: Pending["kind"], tier: TierKey | null = null) => (c.pending ?? []).some((p) => p.kind === kind && (kind === "draft" || p.tier === tier));
  const drafting = busy("draft");
  const photoSrc = c.photoId && !assetFailed ? proposalApi.assetUrl(job.id, c.photoId) : localPhoto;
  const ready = !!status?.ready;
  const opts = TIER_ORDER.map((t) => c.options.find((o) => o.tier === t)).filter((o): o is ConceptOption => !!o);
  const results = opts.map((o) => estimate(o.items, c.measurement, pricing));
  const anyPrelim = results.some((r) => r.preliminary.length);
  const openQs = c.questions.filter((q) => !q.answer.trim());

  return (
    <div className={s.wrap}>
      <section className={s.top}>
        <figure className={s.photo}>
          {photoSrc ? <img src={photoSrc} alt="The client's yard today" onError={() => setAssetFailed(true)} /> : <span className="small muted">The photo is not on this device.</span>}
          <figcaption className="small muted">{c.photoId ? "Saved privately to your account." : "On this device only until the first draft."}</figcaption>
        </figure>
        <div className="stack" style={{ "--gap": "12px" } as React.CSSProperties}>
          <label className="label" htmlFor="c-req">Client request</label>
          <textarea id="c-req" className="input" rows={2} maxLength={600} value={c.request} onFocus={() => ed.checkpoint()} onChange={(e) => live((cc) => void (cc.request = e.target.value))} />
          <label className="label" htmlFor="c-notes">What you know about this job</label>
          <textarea id="c-notes" className="input" rows={3} maxLength={3000} value={c.notes} placeholder="Existing base, soil, access, budget, your own past price for this kind of work" onFocus={() => ed.checkpoint()} onChange={(e) => live((cc) => void (cc.notes = e.target.value))} />
          <SetupState status={status} error={statusErr} />
          <div className="row">
            <button className="btn solid" disabled={!ready || drafting || !c.request.trim()} onClick={() => run("draft", null)}>
              {drafting ? "Drafting three options" : opts.length ? "Draft all three again" : "Draft three options"}
            </button>
            {drafting && <span className="small muted" role="status">{phase ?? "Reading the photo and pricing from your rate book. This takes about a minute."}</span>}
          </div>
          {errors.draft && (
            <p className="warn" role="alert">
              {errors.draft} <button className="link" onClick={() => run("draft", null)}>Try again</button>
            </p>
          )}
        </div>
      </section>

      {(openQs.length > 0 || c.questions.some((q) => q.answer.trim())) && (
        <section className={s.block} aria-labelledby="qs">
          <h2 id="qs" className="head">Questions that change the price</h2>
          <p className="small muted">Answer what you know, then draft again. Leave the rest: the proposal states them as assumptions.</p>
          {c.questions.map((q) => (
            <div key={q.id} className={s.q}>
              <label htmlFor={`q-${q.id}`}><strong>{q.question}</strong>{q.why && <span className="small muted"> {q.why}</span>}</label>
              <input id={`q-${q.id}`} className="input" value={q.answer} maxLength={600} onFocus={() => ed.checkpoint()} onChange={(e) => live((cc) => void (cc.questions = cc.questions.map((x) => (x.id === q.id ? { ...x, answer: e.target.value } : x))))} />
            </div>
          ))}
        </section>
      )}

      {opts.length > 0 && (
        <>
          <section className={s.block} aria-labelledby="size">
            <h2 id="size" className="head">Size of the work</h2>
            <div className={s.measure}>
              <label>
                <span className="label">Work area, sq ft</span>
                <input className="input num" inputMode="decimal" value={c.measurement.areaSqft || ""} onFocus={() => ed.checkpoint()} onChange={(e) => live((cc) => void (cc.measurement = { ...cc.measurement, areaSqft: Math.max(0, Number(e.target.value) || 0), source: "contractor" }))} />
              </label>
              <label>
                <span className="label">Edge, lin ft</span>
                <input className="input num" inputMode="decimal" value={c.measurement.edgeFt || ""} onFocus={() => ed.checkpoint()} onChange={(e) => live((cc) => void (cc.measurement = { ...cc.measurement, edgeFt: Math.max(0, Number(e.target.value) || 0), source: "contractor" }))} />
              </label>
              <label className={s.tick}>
                <input type="checkbox" checked={c.measurement.confirmed} onChange={(e) => upd((cc) => void (cc.measurement = { ...cc.measurement, confirmed: e.target.checked, source: e.target.checked ? "contractor" : cc.measurement.source }))} />
                <span>I measured this on site</span>
              </label>
            </div>
            {c.sizeGuess && (
              <p className="small muted">
                Estimated from the photo: {c.sizeGuess.lowSqft} to {c.sizeGuess.highSqft} sq ft{c.sizeGuess.basis ? `, scaled from ${c.sizeGuess.basis}` : ""}. A photo estimate is not a measurement.
              </p>
            )}
          </section>

          {(c.observations.length > 0 || c.assumptions.length > 0) && (
            <section className={`${s.block} ${s.two}`}>
              <div>
                <h3 className="label">What the draft saw</h3>
                <ul className={s.plain}>{c.observations.map((o) => <li key={o.text}>{o.text} <span className="small muted">({o.basis === "visible" ? "in the photo" : "from your notes"})</span></li>)}</ul>
              </div>
              <div>
                <h3 className="label">Assumed, not known</h3>
                <ul className={s.plain}>{c.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
              </div>
            </section>
          )}

          <div className={s.options}>
            {opts.map((o, i) => (
              <OptionCard
                key={o.tier}
                jobId={job.id}
                option={o}
                result={results[i]}
                measurement={c.measurement}
                recommended={job.tier === o.tier}
                rendersOk={!!status?.renders.ok}
                rendersWhy={status && !status.renders.ok ? status.renders.why : null}
                busyRender={busy("render", o.tier)}
                busyRewrite={busy("option", o.tier)}
                error={errors[`option:${o.tier}`] ?? errors[`render:${o.tier}`] ?? null}
                onRecommend={() => ed.commit((j) => void (j.tier = o.tier))}
                onRender={() => run("render", o.tier)}
                onRewrite={(t) => run("option", o.tier, t)}
                checkpoint={() => ed.checkpoint()}
                live={(fn) => live((cc) => void (cc.options = cc.options.map((x) => (x.tier === o.tier ? fn(structuredClone(x)) : x))))}
                commit={(fn) => upd((cc) => void (cc.options = cc.options.map((x) => (x.tier === o.tier ? fn(structuredClone(x)) : x))))}
              />
            ))}
          </div>

          <section className={s.block} aria-labelledby="review">
            <h2 id="review" className="head">Before the client sees it</h2>
            <label className={s.tick}>
              <input type="checkbox" checked={c.review.scopes} onChange={(e) => upd((cc) => void (cc.review = { ...cc.review, scopes: e.target.checked }))} />
              <span>I read all three scopes, what each includes and leaves out, and the affordable option says plainly what preparation it skips.</span>
            </label>
            {anyPrelim && (
              <label className={s.tick}>
                <input type="checkbox" checked={c.review.preliminary} onChange={(e) => upd((cc) => void (cc.review = { ...cc.review, preliminary: e.target.checked }))} />
                <span>Some sizes or costs are still estimates. I am sending a preliminary price that says so, to be confirmed on site.</span>
              </label>
            )}
            <div className="row">
              <button className="btn solid" onClick={onNext}>Write the proposal <span aria-hidden="true">→</span></button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function SetupState({ status, error }: { status: AiStatus | null; error: string | null }) {
  if (error) return <p className="warn">{error}</p>;
  if (!status) return <p className="small muted">Checking what is set up…</p>;
  if (status.ready) return null;
  const signIn = status.blockers.some((b) => b.code === "signed_out");
  return (
    <div className={s.setup} role="note">
      <strong>Drafting is not available yet</strong>
      <ul>{status.blockers.map((b) => <li key={b.code}>{b.message}</li>)}</ul>
      {signIn && <Link className="btn sm" href="/signin">Sign in</Link>}
      {status.blockers.some((b) => b.code === "plan" || b.code === "plan_feature") && <Link className="btn sm quiet" href="/pricing">See plans</Link>}
    </div>
  );
}

interface CardProps {
  jobId: string;
  measurement: PhotoConcept["measurement"];
  option: ConceptOption;
  result: ReturnType<typeof estimate>;
  recommended: boolean;
  rendersOk: boolean;
  rendersWhy: string | null;
  busyRender: boolean;
  busyRewrite: boolean;
  error: string | null;
  onRecommend: () => void;
  onRender: () => void;
  onRewrite: (instruction: string) => void;
  checkpoint: () => void;
  live: (fn: (o: ConceptOption) => ConceptOption) => void;
  commit: (fn: (o: ConceptOption) => ConceptOption) => void;
}

function OptionCard(p: CardProps) {
  const { option: o, result: r } = p;
  const pricing = useSettings((x) => x.pricing);
  const pkgs = breakdown(o.items, p.measurement, pricing, Math.round(r.price * 100));
  const [instruction, setInstruction] = useState("");
  const [showLines, setShowLines] = useState(false);
  const edit = (fn: (o: ConceptOption) => void) => p.live((x) => { fn(x); x.source = "edited"; return x; });
  const editItem = (id: string, patch: Partial<EstimateItem>, costEdit = false) =>
    p.live((x) => {
      x.items = x.items.map((it) => (it.id === id ? sanitizeItem({ ...it, ...patch, ...(costEdit ? { costSource: "contractor" as const, reviewed: true } : {}) }) : it));
      x.source = "edited";
      return x;
    });
  const unchecked = o.items.filter((it) => !it.reviewed).length;
  const field = (label: string, key: "includes" | "excludes" | "limitations" | "benefits") => (
    <label className={s.field}>
      <span className="label">{label}</span>
      <textarea className="input" rows={Math.max(2, o[key].length)} value={lines(o[key])} onFocus={p.checkpoint} onChange={(e) => edit((x) => void (x[key] = unlines(e.target.value)))} onBlur={() => edit((x) => void (x[key] = x[key].map((t) => t.trim()).filter(Boolean)))} />
    </label>
  );

  return (
    <article className={s.card} data-on={p.recommended}>
      <div className={s.render}>
        {o.render ? <img src={proposalApi.assetUrl(p.jobId, o.render.assetId)} alt={`Concept image of the ${TIER_LABEL[o.tier]} option`} /> : <span className="small muted">{p.busyRender ? "Making the concept picture…" : "No concept picture yet"}</span>}
        {o.render && <span className={s.badge}>Concept image</span>}
      </div>
      <div className={s.cardBody}>
        <div className="spread">
          <span className="label">{TIER_LABEL[o.tier]}</span>
          <button className={p.recommended ? "chip" : "link small"} onClick={p.onRecommend} aria-pressed={p.recommended}>{p.recommended ? "Recommended" : "Recommend this"}</button>
        </div>
        <input className={`input ${s.name}`} value={o.name} maxLength={60} aria-label="Option name" onFocus={p.checkpoint} onChange={(e) => edit((x) => void (x.name = e.target.value))} />
        <div className={s.price}>
          <span className="num">{money(r.price)}</span>
          <span className="small muted">{r.days ? `About ${r.days} ${r.days === 1 ? "day" : "days"}, ${Math.round(r.hours)} crew hours` : ""}</span>
        </div>
        {r.preliminary.length > 0 && <p className={s.prelim}>Preliminary: {r.preliminary.join(" ")}</p>}
        <textarea className="input" rows={3} value={o.summary} maxLength={400} aria-label="Summary for the client" onFocus={p.checkpoint} onChange={(e) => edit((x) => void (x.summary = e.target.value))} />
        <label className={s.field}>
          <span className="label">How the preparation differs</span>
          <textarea className="input" rows={3} value={o.prepNote} maxLength={500} onFocus={p.checkpoint} onChange={(e) => edit((x) => void (x.prepNote = e.target.value))} />
        </label>
        {field("Includes", "includes")}
        {field("Leaves out", "excludes")}
        {field("Limitations", "limitations")}
        {field("Benefits", "benefits")}

        <dl className={s.figures}>
          <dt>Materials, rentals, disposal</dt><dd className="num">{money(r.costs)}</dd>
          <dt>Crew {Math.round(r.hours * 4) / 4} hr</dt><dd className="num">{money(r.labor)}</dd>
          {r.overhead > 0 && <><dt>Overhead</dt><dd className="num">{money(r.overhead)}</dd></>}
          <dt>Profit</dt><dd className="num">{money(r.profit)} <span className="small muted">{Math.round(r.marginPct)}%</span></dd>
        </dl>
        <button className="link small" onClick={() => setShowLines((v) => !v)} aria-expanded={showLines}>
          {showLines ? "Hide line items" : `Line items (${o.items.length})${unchecked ? `, ${unchecked} to check` : ""}`}
        </button>
        {showLines && (
          <div className="scroll-x">
            <table className={`table ${s.items}`}>
              <thead><tr><th>Line</th><th>Kind</th><th>Per</th><th className="r">Rate</th><th>Unit</th><th className="r">Cost/unit</th><th className="r">Waste %</th><th className="r">Qty</th><th className="r">Cost</th><th>Shown as</th><th>Checked</th><th /></tr></thead>
              <tbody>
                {o.items.map((it, k) => {
                  const row = r.items[k];
                  return (
                    <tr key={it.id} data-estimate={!it.reviewed}>
                      <td><input className="input" value={it.label} aria-label="Line name" onFocus={p.checkpoint} onChange={(e) => editItem(it.id, { label: e.target.value })} /><span className="small muted">{SOURCE[it.costSource]}</span></td>
                      <td><select className="select" value={it.kind} onChange={(e) => editItem(it.id, { kind: e.target.value as EstimateItem["kind"] }, true)}>{ITEM_KINDS.map((k) => <option key={k.key} value={k.key}>{k.name}</option>)}</select></td>
                      <td><select className="select" value={it.basis} onChange={(e) => editItem(it.id, { basis: e.target.value as EstimateItem["basis"] }, true)}><option value="area">sq ft</option><option value="edge">lin ft</option><option value="fixed">job</option></select></td>
                      <td className="r"><input className="input num" inputMode="decimal" defaultValue={it.rate} aria-label="Quantity rate" onFocus={p.checkpoint} onBlur={(e) => editItem(it.id, { rate: Number(e.target.value) || 0 }, true)} /></td>
                      <td><input className="input" value={it.unit} aria-label="Unit" onFocus={p.checkpoint} onChange={(e) => editItem(it.id, { unit: e.target.value })} /></td>
                      <td className="r">{it.kind === "labor" ? <span className="small muted">crew rate</span> : <input className="input num" inputMode="decimal" defaultValue={it.unitCost} aria-label="Cost per unit" onFocus={p.checkpoint} onBlur={(e) => editItem(it.id, { unitCost: Number(e.target.value) || 0 }, true)} />}</td>
                      <td className="r">{it.kind === "labor" ? "" : <input className="input num" inputMode="decimal" defaultValue={it.wastePct} aria-label="Waste percent" onFocus={p.checkpoint} onBlur={(e) => editItem(it.id, { wastePct: Number(e.target.value) || 0 }, true)} />}</td>
                      <td className="r num">{row ? +row.qty.toFixed(2) : ""}</td>
                      <td className="r num">{row ? money(row.cost) : ""}</td>
                      <td><select className="select" value={packageOf(it)} aria-label="Work package the client sees" onChange={(e) => editItem(it.id, { pkg: e.target.value as PackageKey })}>{(Object.keys(PKG) as PackageKey[]).map((k) => <option key={k} value={k}>{PKG[k]}</option>)}</select></td>
                      <td><input type="checkbox" checked={it.reviewed} aria-label="I checked this line" onChange={(e) => p.commit((x) => { x.items = x.items.map((y) => (y.id === it.id ? { ...y, reviewed: e.target.checked } : y)); return x; })} /></td>
                      <td><button className="link small" onClick={() => p.commit((x) => { x.items = x.items.filter((y) => y.id !== it.id); return x; })} aria-label={`Remove ${it.label}`}>Remove</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="row">
              <button className="btn sm quiet" onClick={() => p.commit((x) => { x.items = [...x.items, sanitizeItem({ id: `li_${o.tier}_${Date.now().toString(36)}`, label: "New line", kind: "material", basis: "fixed", rate: 1, unit: "each", unitCost: 0, wastePct: 0, costSource: "contractor", rateKey: null, reviewed: true })]; return x; })}>Add a line</button>
              {unchecked > 0 && <button className="btn sm quiet" onClick={() => p.commit((x) => { x.items = x.items.map((y) => ({ ...y, reviewed: true })); return x; })}>I checked all {unchecked}</button>}
            </div>
          </div>
        )}

        {pkgs.length > 0 && (
          <details className={s.clientView}>
            <summary className="small">How the client sees the total</summary>
            <p className="small">{explainTotal(pkgs)}</p>
            <dl className={s.figures}>
              {pkgs.map((l) => [<dt key={`${l.key}t`}>{l.label}</dt>, <dd key={`${l.key}d`} className="num">{usdCents(l.cents)}</dd>])}
            </dl>
            <p className="small muted">Customer prices with overhead and profit included. Your costs, wages and margin are never shown. Use the Shown as column to move a line.</p>
          </details>
        )}
        <Savings option={o} measurement={p.measurement} commit={p.commit} />

        <div className={s.actions}>
          <button className="btn sm quiet" disabled={!p.rendersOk || p.busyRender} onClick={p.onRender} title={p.rendersWhy ?? undefined}>
            {p.busyRender ? "Making picture" : o.render ? "New concept picture" : "Make concept picture"}
          </button>
          {!p.rendersOk && p.rendersWhy && <span className="small muted">{p.rendersWhy}</span>}
          <div className={s.rewrite}>
            <input className="input" value={instruction} onChange={(e) => setInstruction(e.target.value)} maxLength={800} placeholder="Change this option, e.g. use flagstone" aria-label={`How to change the ${TIER_LABEL[o.tier]} option`} />
            <button className="btn sm" disabled={p.busyRewrite} onClick={() => p.onRewrite(instruction)}>{p.busyRewrite ? "Rewriting" : "Rewrite"}</button>
          </div>
          {p.error && <p className="warn" role="alert">{p.error}</p>}
        </div>
      </div>
    </article>
  );
}

/**
 * Ways to save, set up by the contractor as real scope changes. Each one is
 * priced again with the job's own estimate, and only reviewed ones reach the
 * client. Nothing here invents a saving.
 */
function Savings({ option: o, measurement, commit }: { option: ConceptOption; measurement: PhotoConcept["measurement"]; commit: CardProps["commit"] }) {
  const pricing = useSettings((x) => x.pricing);
  const alts = o.alternatives ?? [];
  // Any edit to a change takes it off the client's view until it is reviewed again.
  const set = (id: string, patch: Partial<Alternative>) => commit((x) => { x.alternatives = (x.alternatives ?? []).map((a) => (a.id === id ? { ...a, ...patch, reviewed: patch.reviewed ?? false } : a)); return x; });
  const add = (kind: Alternative["kind"]) =>
    commit((x) => {
      const id = `alt_${Date.now().toString(36)}`;
      const first = x.items.find((i) => i.kind === "material");
      const a: Alternative =
        kind === "smaller_area"
          ? { id, kind, label: "A smaller area", areaSqft: Math.round(measurement.areaSqft * 0.7), edgeFt: Math.round(measurement.edgeFt * 0.85), reviewed: false }
          : kind === "swap"
            ? { id, kind, label: first ? `A different material instead of ${first.label}` : "A different material", swaps: first ? [{ itemId: first.id, label: first.label, unitCost: first.unitCost }] : [], reviewed: false }
            : { id, kind, label: "Do part of it later", later: [], reviewed: false };
      x.alternatives = [...(x.alternatives ?? []), a];
      return x;
    });
  return (
    <details className={s.clientView}>
      <summary className="small">Ways to save{alts.length ? ` (${alts.filter((a) => a.reviewed).length} shown to the client)` : ""}</summary>
      <p className="small muted">For when the client says it is too much. Each change is priced again from this option&apos;s lines. Tick it to show it.</p>
      {alts.map((a) => {
        const priced = priceAlternative(o.items, measurement, pricing, a);
        const sw = a.swaps?.[0];
        return (
          <div key={a.id} className={s.alt}>
            <input className="input" value={a.label} maxLength={160} aria-label="How the client sees this change" onChange={(e) => set(a.id, { label: e.target.value })} />
            {a.kind === "smaller_area" && (
              <div className="row">
                <label className="small">sq ft <input className="input num" style={{ width: 90 }} inputMode="decimal" defaultValue={a.areaSqft} onBlur={(e) => set(a.id, { areaSqft: Math.max(0, Number(e.target.value) || 0) })} /></label>
                <label className="small">lin ft <input className="input num" style={{ width: 90 }} inputMode="decimal" defaultValue={a.edgeFt} onBlur={(e) => set(a.id, { edgeFt: Math.max(0, Number(e.target.value) || 0) })} /></label>
              </div>
            )}
            {a.kind === "swap" && (
              <div className="row">
                <select className="select" value={sw?.itemId ?? ""} aria-label="Line to replace" onChange={(e) => { const it = o.items.find((i) => i.id === e.target.value); if (it) set(a.id, { swaps: [{ itemId: it.id, label: it.label, unitCost: it.unitCost }] }); }}>
                  {o.items.filter((i) => i.kind !== "labor").map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
                </select>
                <input className="input" style={{ width: 160 }} aria-label="Replacement material" value={sw?.label ?? ""} onChange={(e) => sw && set(a.id, { swaps: [{ ...sw, label: e.target.value }] })} />
                <label className="small">your cost per unit <input key={sw?.itemId} className="input num" style={{ width: 80 }} inputMode="decimal" defaultValue={sw?.unitCost} onBlur={(e) => sw && set(a.id, { swaps: [{ ...sw, unitCost: Math.max(0, Number(e.target.value) || 0) }] })} /></label>
              </div>
            )}
            {a.kind === "phase" && (
              <div className={s.phase}>
                {o.items.map((i) => (
                  <label key={i.id} className="small"><input type="checkbox" checked={(a.later ?? []).includes(i.id)} onChange={(e) => set(a.id, { later: e.target.checked ? [...(a.later ?? []), i.id] : (a.later ?? []).filter((x) => x !== i.id) })} /> {i.label}</label>
                ))}
              </div>
            )}
            <div className="spread">
              <span className="small">{priced ? `New price ${usdCents(priced.priceCents)}, saves ${usdCents(priced.savesCents)}` : "No saving with this change, so it will not be shown."}</span>
              <span className="row">
                <label className="small"><input type="checkbox" checked={a.reviewed} disabled={!priced} onChange={(e) => set(a.id, { reviewed: e.target.checked })} /> Show to client</label>
                <button className="link small" onClick={() => commit((x) => { x.alternatives = (x.alternatives ?? []).filter((y) => y.id !== a.id); return x; })}>Remove</button>
              </span>
            </div>
          </div>
        );
      })}
      <div className="row">
        <button className="btn sm quiet" onClick={() => add("smaller_area")}>Smaller area</button>
        <button className="btn sm quiet" onClick={() => add("swap")}>Different material</button>
        <button className="btn sm quiet" onClick={() => add("phase")}>Do part later</button>
      </div>
    </details>
  );
}
