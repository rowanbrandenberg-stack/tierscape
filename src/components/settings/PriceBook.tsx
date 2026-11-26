"use client";
import { useState } from "react";
import { useSettings } from "@/client/settingsStore";
import { AREA_TYPES, PLANT_KINDS } from "@/lib/catalog";
import { marginFromMarkup, markupFromMargin, money, unitPrice } from "@/lib/pricing";
import type { Pricing } from "@/lib/settings";
import { TIERS, type AreaType, type PlantKind } from "@/lib/types";
import s from "./settings.module.css";

const num = (v: string) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

function NumberInput({ value, onChange, step = "any", label }: { value: number; onChange: (n: number) => void; step?: string; label: string }) {
  return <input className={`input num ${s.numIn}`} type="number" min={0} step={step} defaultValue={value} aria-label={label} onChange={(e) => { const n = num(e.target.value); if (n !== null) onChange(n); }} />;
}

export function PriceBook() {
  const { pricing, setPricing } = useSettings();
  const [q, setQ] = useState("");
  const set = (fn: (p: Pricing) => void) => setPricing(fn);
  const match = (text: string) => !q.trim() || text.toLowerCase().includes(q.trim().toLowerCase());

  return (
    <section id="prices" className={s.section} aria-labelledby="prices-h">
      <div className={s.aside}>
        <h2 id="prices-h" className="head">Prices</h2>
        <p className="small muted">Set your basics, choose what each tier offers, then price each service the way you already quote it. Open a service only to see what is behind the number.</p>
      </div>
      <div className={s.content}>
        <div className={s.grid4}>
          <div className="field">
            <label className="label">Crew cost, $ per person hour</label>
            <NumberInput label="Crew cost per person hour" value={pricing.laborRate} onChange={(n) => set((p) => void (p.laborRate = n))} />
            <span className="small muted">What one worker costs you, with taxes and insurance. Sells at {money(pricing.laborRate * (1 + pricing.markupPct / 100))}/hr.</span>
          </div>
          <div className="field">
            <label className="label">Target margin, %</label>
            <NumberInput label="Target margin" value={Math.round(marginFromMarkup(pricing.markupPct) * 10) / 10} onChange={(n) => set((p) => void (p.markupPct = markupFromMargin(n)))} />
            <span className="small muted">Profit as a share of the price. That is a {Math.round(pricing.markupPct * 10) / 10}% markup on cost.</span>
          </div>
          <div className="field">
            <label className="label">Overhead, %</label>
            <NumberInput label="Overhead" value={pricing.overheadPct ?? 0} onChange={(n) => set((p) => void (p.overheadPct = Math.max(0, n)))} />
            <span className="small muted">Trucks, insurance, office and fuel, added to job costs before your margin.</span>
          </div>
          <div className="field"><label className="label">Waste allowance, %</label><NumberInput label="Waste allowance" value={pricing.wastePct} onChange={(n) => set((p) => void (p.wastePct = n))} /></div>
          <div className="field"><label className="label">Crew size</label><NumberInput label="Crew size" step="1" value={pricing.crewSize} onChange={(n) => set((p) => void (p.crewSize = Math.max(1, Math.round(n))))} /></div>
        </div>

        <div className="stack">
          <h3 className="label">What each tier offers</h3>
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th /> {TIERS.map((t) => <th key={t.key}>{t.name}</th>)}</tr></thead>
              <tbody>
                {(Object.keys(AREA_TYPES) as AreaType[]).map((type) => (
                  <tr key={type}>
                    <td><strong>{AREA_TYPES[type].label}</strong></td>
                    {TIERS.map((t) => (
                      <td key={t.key}>
                        <select className="select" style={{ minWidth: 170 }} value={pricing.tierMap[type][t.key]} onChange={(e) => set((p) => void (p.tierMap[type][t.key] = e.target.value))} aria-label={`${AREA_TYPES[type].label}, ${t.name}`}>
                          {pricing.services.filter((x) => x.areaType === type).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
                        </select>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="stack">
          <div className="spread">
            <h3 className="label">Price book</h3>
            <input className="input" style={{ maxWidth: 260 }} placeholder="Search services" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search services" />
          </div>
          <p className="small muted">Prices are per square foot, installed. Leave yours blank and it is built from your materials, crew cost and target margin.</p>
          <div className={s.book}>
            {pricing.services.filter((x) => match(`${x.title} ${AREA_TYPES[x.areaType].label}`)).map((svc, si) => {
              const idx = pricing.services.indexOf(svc);
              const own = svc.installedPrice > 0;
              return (
                <details key={svc.id} className={s.svc}>
                  <summary>
                    <span>{svc.title}<span className={s.ty}>{AREA_TYPES[svc.areaType].label}</span></span>
                    <span className="num">{own ? "" : "about "}${unitPrice(pricing, svc).toFixed(2)} / sq ft{own ? ", yours" : ""}</span>
                  </summary>
                  <div className={s.svcBody}>
                    <div className="field" style={{ maxWidth: 260 }}>
                      <label className="label" htmlFor={`own-${si}`}>My installed price, $ per sq ft</label>
                      <input id={`own-${si}`} className="input num" type="number" min={0} step={0.25} defaultValue={svc.installedPrice || ""} placeholder="Built from costs" onChange={(e) => set((p) => void (p.services[idx].installedPrice = num(e.target.value) ?? 0))} />
                    </div>
                    <div className="scroll-x">
                      <table className="table">
                        <thead><tr><th>What is behind it</th><th>Unit</th><th className="r">Your cost</th></tr></thead>
                        <tbody>
                          <tr><td>Labor hours per 100 sq ft</td><td>hr</td><td className="r"><NumberInput label="Labor hours" value={+(svc.laborPerSqft * 100).toFixed(2)} onChange={(n) => set((p) => void (p.services[idx].laborPerSqft = n / 100))} /></td></tr>
                          {svc.items.map((it, ii) => (
                            <tr key={it.name}><td>{it.name}</td><td>$ per {it.unit}</td><td className="r"><NumberInput label={it.name} value={it.cost} onChange={(n) => set((p) => void (p.services[idx].items[ii].cost = n))} /></td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </details>
              );
            })}
            {match("lawn borders edging rock paver curb") && (
              <details className={s.svc}>
                <summary><span>Lawn borders<span className={s.ty}>per linear foot</span></span><span className="num">{Object.keys(pricing.borders).length} options</span></summary>
                <div className={s.svcBody}>
                  <table className="table">
                    <thead><tr><th>Border</th><th className="r">Material, $ per ft</th><th className="r">Labor, hr per ft</th></tr></thead>
                    <tbody>
                      {(Object.keys(pricing.borders) as (keyof Pricing["borders"])[]).map((k) => (
                        <tr key={k}>
                          <td>{pricing.borders[k].name}</td>
                          <td className="r"><NumberInput label="Material" value={pricing.borders[k].costPerFt} onChange={(n) => set((p) => void (p.borders[k].costPerFt = n))} /></td>
                          <td className="r"><NumberInput label="Labor" value={pricing.borders[k].laborPerFt} onChange={(n) => set((p) => void (p.borders[k].laborPerFt = n))} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
            {match("plant installation trees shrubs perennials") && (
              <details className={s.svc}>
                <summary><span>Plant installation<span className={s.ty}>per plant, by tier</span></span><span className="num">9 sizes</span></summary>
                <div className={s.svcBody}>
                  <table className="table">
                    <thead><tr><th>Size</th><th className="r">Plant cost, $</th><th className="r">Install, hr each</th></tr></thead>
                    <tbody>
                      {(Object.keys(pricing.plantSizes) as PlantKind[]).flatMap((kind) =>
                        TIERS.map((t) => {
                          const row = pricing.plantSizes[kind][t.key];
                          return (
                            <tr key={`${kind}${t.key}`}>
                              <td>{PLANT_KINDS[kind]}, {row.size} <span className="muted small">{t.name}</span></td>
                              <td className="r"><NumberInput label="Plant cost" value={row.cost} onChange={(n) => set((p) => void (p.plantSizes[kind][t.key].cost = n))} /></td>
                              <td className="r"><NumberInput label="Install hours" value={row.hours} onChange={(n) => set((p) => void (p.plantSizes[kind][t.key].hours = n))} /></td>
                            </tr>
                          );
                        }),
                      )}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
