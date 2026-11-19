"use client";
import { useState } from "react";
import { useEditor } from "@/client/editor";
import { useSettings } from "@/client/settingsStore";
import { beforeYouDig } from "@/lib/locate";
import { money, quote } from "@/lib/pricing";
import { TIERS } from "@/lib/types";
import s from "./BuildPack.module.css";

export function BuildPack() {
  const job = useEditor((x) => x.job!);
  const pricing = useSettings((x) => x.pricing);
  const q = quote(job, pricing, job.tier);
  const [copied, setCopied] = useState(false);
  const merged = new Map<string, { name: string; unit: string; qty: number; cost: number }>();
  q.groups.forEach((g) =>
    g.lines.filter((l) => !l.labor).forEach((l) => {
      const e = merged.get(l.name) ?? { name: l.name, unit: l.unit, qty: 0, cost: 0 };
      e.qty += l.qty;
      e.cost += l.cost;
      merged.set(l.name, e);
    }),
  );
  const rows = [...merged.values()];
  const list = rows.map((r) => `${+r.qty.toFixed(1)} ${r.unit}  ${r.name}`).join("\n");
  const tierName = TIERS.find((t) => t.key === job.tier)!.name;

  return (
    <div className={s.layout}>
      <section className="stack" style={{ "--gap": "16px" } as React.CSSProperties}>
        <div className="spread">
          <h2 className="title">Materials, {tierName}</h2>
          <button className="btn sm quiet" onClick={() => navigator.clipboard?.writeText(list).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => undefined)}>
            {copied ? "Copied" : "Copy list for the supplier"}
          </button>
        </div>
        <p className="small muted">Quantities include your waste allowance and extra for paver cuts.</p>
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Material</th><th className="r">Qty</th><th style={{ paddingLeft: 8 }}>Unit</th><th className="r">Your cost</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}><td>{r.name}</td><td className="r num">{+r.qty.toFixed(1)}</td><td style={{ paddingLeft: 8 }}>{r.unit}</td><td className="r num">{money(r.cost)}</td></tr>
              ))}
              <tr><td><strong>Materials total</strong></td><td /><td /><td className="r num"><strong>{money(q.materials)}</strong></td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <aside className="stack" style={{ "--gap": "28px" } as React.CSSProperties}>
        <section className="stack">
          <h3 className="label">Labor and margin</h3>
          <dl className={s.figures}>
            <dt>Person hours</dt><dd className="num">{Math.round(q.hours)} hr</dd>
            <dt>On site with a {pricing.crewSize} person crew</dt><dd className="num">{q.days} {q.days === 1 ? "day" : "days"}</dd>
            <dt>Crew cost at {money(pricing.laborRate)}/person hr</dt><dd className="num">{money(q.labor)}</dd>
            <dt>Materials and job costs</dt><dd className="num">{money(q.materials)}</dd>
            {q.overhead > 0 && <><dt>Overhead at {pricing.overheadPct}%</dt><dd className="num">{money(q.overhead)}</dd></>}
            <dt className={s.strong}>Price to homeowner</dt><dd className={`num ${s.strong}`}>{money(q.price)}</dd>
            <dt>{q.overhead > 0 ? "Profit after overhead" : "Gross profit"}</dt><dd className="num">{money(q.price - q.materials - q.labor - q.overhead)}{q.price > 0 && <span className="small muted"> · {Math.round(((q.price - q.materials - q.labor - q.overhead) / q.price) * 100)}% margin</span>}</dd>
          </dl>
        </section>
        <section className={`stack ${s.dig}`}>
          <h3 className="label">Before you dig</h3>
          <ol className={s.steps}>{beforeYouDig(job).map((x) => <li key={x}>{x}</li>)}</ol>
        </section>
        {q.groups.map((g) => (
          <section key={g.title} className="stack">
            <h3 className="label">{g.kind === "plants" ? `Plant installation · ${g.plantCount} plants` : g.kind === "extras" ? "Other job costs" : `${g.kind} · ${Math.round(g.sqft)} sq ft`}</h3>
            {g.kind === "extras" && <ul className={s.steps}>{g.lines.map((l) => <li key={l.name}>{l.name}: {+l.qty.toFixed(1)} {l.unit}</li>)}</ul>}
            <ol className={s.steps}>{g.steps.map((x) => <li key={x}>{x}</li>)}</ol>
          </section>
        ))}
      </aside>
    </div>
  );
}
