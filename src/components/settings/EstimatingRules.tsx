"use client";
import { useSettings } from "@/client/settingsStore";
import { DEFAULT_RATES, ITEM_KINDS, type RateRule } from "@/lib/estimate";
import { depositPctOf, ratesOf } from "@/lib/settings";
import s from "./settings.module.css";

const n = (v: string) => {
  const x = Number.parseFloat(v);
  return Number.isFinite(x) && x >= 0 ? x : 0;
};

/**
 * The contractor's own numbers that photo drafts must use: unit costs,
 * production rates and how they like to work. A draft cites these by key;
 * anything not in here comes back marked as a suggestion to check.
 */
export function EstimatingRules() {
  const { pricing, setPricing, profile, setProfile } = useSettings();
  const rates = ratesOf(pricing);
  const setRates = (fn: (r: RateRule[]) => RateRule[]) => setPricing((p) => void (p.rates = fn(ratesOf(p))));
  const edit = (key: string, patch: Partial<RateRule>) => setRates((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  return (
    <section className={s.section} aria-labelledby="rules-h">
      <div className={s.aside}>
        <h2 id="rules-h" className="head">Estimating rules</h2>
        <p className="small muted">Your costs and production rates for photo drafts. The draft uses these numbers whenever a line matches; anything else is marked as a suggestion for you to check. The starting values are samples: replace them with yours.</p>
      </div>
      <div className={s.content}>
        <div className="field">
          <label className="label" htmlFor="exp">How you work</label>
          <textarea id="exp" className="input" rows={4} maxLength={1500} value={profile.experience ?? ""} onChange={(e) => setProfile({ experience: e.target.value })} placeholder="We always put 4 in of compacted base under pavers. We do not pour concrete. Minimum job $1,200. We haul our own spoil." />
          <span className="small muted">Guides every draft. Never shown to clients.</span>
        </div>
        <div className="field" style={{ maxWidth: 260 }}>
          <label className="label" htmlFor="dep">Deposit at signing, %</label>
          <input id="dep" className={`input num ${s.numIn}`} type="number" min={0} max={100} step={5} value={depositPctOf(pricing)} onChange={(e) => setPricing((p) => void (p.depositPct = Math.min(100, n(e.target.value))))} />
          <span className="small muted">Used for split terms. The balance is due on completion.</span>
        </div>
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Rule</th><th>Kind</th><th className="r">Your cost</th><th>Unit</th><th className="r">Qty rule</th><th>Per</th><th className="r">Waste %</th><th /></tr></thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.key}>
                  <td><input className="input" value={r.label} aria-label="Rule name" onChange={(e) => edit(r.key, { label: e.target.value.slice(0, 120) })} /><span className="small muted">{r.key}</span></td>
                  <td><select className="select" value={r.kind} onChange={(e) => edit(r.key, { kind: e.target.value as RateRule["kind"] })}>{ITEM_KINDS.map((k) => <option key={k.key} value={k.key}>{k.name}</option>)}</select></td>
                  <td className="r">{r.kind === "labor" ? <span className="small muted">crew rate</span> : <input className={`input num ${s.numIn}`} type="number" min={0} step="any" defaultValue={r.unitCost} aria-label="Your cost per unit" onBlur={(e) => edit(r.key, { unitCost: n(e.target.value) })} />}</td>
                  <td><input className="input" style={{ width: 80 }} value={r.unit} aria-label="Unit" onChange={(e) => edit(r.key, { unit: e.target.value.slice(0, 24) })} /></td>
                  <td className="r"><input className={`input num ${s.numIn}`} type="number" min={0} step="any" defaultValue={r.rate ?? ""} placeholder="draft" aria-label="Quantity per sq ft, lin ft or job" onBlur={(e) => edit(r.key, { rate: e.target.value.trim() === "" ? null : n(e.target.value) })} /></td>
                  <td><select className="select" value={r.basis} onChange={(e) => edit(r.key, { basis: e.target.value as RateRule["basis"] })}><option value="area">sq ft</option><option value="edge">lin ft</option><option value="fixed">job</option></select></td>
                  <td className="r">{r.kind === "labor" ? "" : <input className={`input num ${s.numIn}`} type="number" min={0} max={100} defaultValue={r.wastePct} aria-label="Waste percent" onBlur={(e) => edit(r.key, { wastePct: Math.min(100, n(e.target.value)) })} />}</td>
                  <td><button className="link small" onClick={() => setRates((x) => x.filter((y) => y.key !== r.key))}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row">
          <button className="btn sm quiet" onClick={() => setRates((x) => [...x, { key: `custom_${Date.now().toString(36)}`, label: "New rule", kind: "material", unit: "each", unitCost: 0, rate: null, basis: "fixed", wastePct: 0 }])}>Add a rule</button>
          <button className="link small" onClick={() => setRates(() => structuredClone(DEFAULT_RATES))}>Reset to the samples</button>
        </div>
        <p className="small muted">Labor lines are person hours, priced at your crew cost. Leave a quantity rule blank to let the draft suggest how much this job needs.</p>
      </div>
    </section>
  );
}
