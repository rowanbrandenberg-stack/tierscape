"use client";
import { useEditor } from "@/client/editor";
import { useSettings } from "@/client/settingsStore";
import { uid } from "@/lib/jobs";
import { money } from "@/lib/pricing";
import { TIERS, type ExtraCost, type ExtraKind, type TierKey } from "@/lib/types";
import { Empty, Panel } from "../../ui/Panel";
import s from "./panels.module.css";

const KINDS: Record<ExtraKind, string> = {
  equipment: "Equipment rental",
  delivery: "Delivery",
  disposal: "Disposal or dump fee",
  excavation: "Excavation or grading",
  subcontract: "Subcontractor",
  labor: "Extra labor",
  material: "Other material",
  other: "Other",
};

/** Quick starts. Costs start at zero on purpose: a sample price must never end up in a real quote. */
const PRESETS: { label: string; kind: ExtraKind; description: string; qty: number; unit: string; show: boolean }[] = [
  { label: "Machine rental", kind: "equipment", description: "Machine rental", qty: 1, unit: "day", show: false },
  { label: "Delivery", kind: "delivery", description: "Material delivery", qty: 1, unit: "load", show: true },
  { label: "Dump fee", kind: "disposal", description: "Haul away and disposal", qty: 1, unit: "load", show: true },
  { label: "Haul trip", kind: "disposal", description: "Haul trip", qty: 1, unit: "trip", show: false },
  { label: "Excavation", kind: "excavation", description: "Excavation and grading", qty: 1, unit: "job", show: true },
  { label: "Subcontractor", kind: "subcontract", description: "Subcontracted work", qty: 1, unit: "job", show: true },
  { label: "Extra labor", kind: "labor", description: "Additional labor", qty: 4, unit: "person hr", show: false },
  { label: "Other", kind: "other", description: "", qty: 1, unit: "each", show: true },
];

/**
 * Everything a job costs that the area and plant services do not: rentals,
 * delivery, disposal, subcontractors, extra labor. Each line chooses which
 * options include it and whether the homeowner sees it by name.
 */
export function CostsPanel() {
  const ed = useEditor();
  const pricing = useSettings((x) => x.pricing);
  const job = ed.job!;
  const extras = job.extras ?? [];

  const add = (p: (typeof PRESETS)[number]) =>
    ed.commit((j) => {
      j.extras = [...(j.extras ?? []), { id: uid("cost"), description: p.description, kind: p.kind, qty: p.qty, unit: p.unit, cost: 0, tiers: TIERS.map((t) => t.key), showCustomer: p.show }];
    });
  const edit = (id: string, patch: Partial<ExtraCost>, commit = true) => (commit ? ed.commit : ed.mutate)((j) => {
    const e = (j.extras ?? []).find((x) => x.id === id);
    if (e) Object.assign(e, patch);
  });
  const toggleTier = (e: ExtraCost, t: TierKey) => edit(e.id, { tiers: e.tiers.includes(t) ? e.tiers.filter((x) => x !== t) : [...e.tiers, t] });
  const unpriced = extras.filter((e) => e.kind !== "labor" && e.qty > 0 && !(e.cost > 0));

  return (
    <Panel title="Other job costs" id="costs-h" aside={extras.length ? <span className="num small">{extras.length}</span> : undefined}>
      {extras.length === 0 ? (
        <Empty>Rentals, delivery, dump fees, haul trips, subcontractors and extra labor go here, so they end up in the price.</Empty>
      ) : (
        <div>
          {extras.map((e) => {
            const total = e.kind === "labor" ? e.qty * pricing.laborRate : e.qty * e.cost;
            return (
              <div key={e.id} className={s.item}>
                <div className={s.line}>
                  <input className={`input ${s.grow}`} value={e.description} placeholder="What is it" aria-label="Description" onChange={(ev) => edit(e.id, { description: ev.target.value }, false)} onBlur={() => ed.commit(() => undefined)} />
                  <select className="select" style={{ width: "auto" }} value={e.kind} aria-label="Type" onChange={(ev) => edit(e.id, { kind: ev.target.value as ExtraKind, ...(ev.target.value === "labor" ? { unit: "person hr" } : {}) })}>
                    {(Object.keys(KINDS) as ExtraKind[]).map((k) => <option key={k} value={k}>{KINDS[k]}</option>)}
                  </select>
                </div>
                <div className={s.line}>
                  <input className="input num" style={{ width: 76 }} inputMode="decimal" value={e.qty || ""} aria-label="Quantity" onChange={(ev) => edit(e.id, { qty: Math.max(0, Number.parseFloat(ev.target.value) || 0) }, false)} onBlur={() => ed.commit(() => undefined)} />
                  {e.kind === "labor" ? (
                    <span className="small">person hours at {money(pricing.laborRate)}/hr crew cost</span>
                  ) : (
                    <>
                      <input className="input" style={{ width: 84 }} value={e.unit} aria-label="Unit" onChange={(ev) => edit(e.id, { unit: ev.target.value }, false)} onBlur={() => ed.commit(() => undefined)} />
                      <span className="small">at $</span>
                      <input className={`input num ${!(e.cost > 0) ? s.needs : ""}`} style={{ width: 90 }} inputMode="decimal" value={e.cost || ""} placeholder="your cost" aria-label="Your cost per unit" onChange={(ev) => edit(e.id, { cost: Math.max(0, Number.parseFloat(ev.target.value) || 0) }, false)} onBlur={() => ed.commit(() => undefined)} />
                    </>
                  )}
                  <span className={`num small ${s.grow}`} style={{ textAlign: "right" }}>{money(total)} cost</span>
                </div>
                <div className={s.line}>
                  <span className="small">In</span>
                  <div className="seg" role="group" aria-label="Options that include it">
                    {TIERS.map((t) => (
                      <button key={t.key} aria-pressed={e.tiers.includes(t.key)} onClick={() => toggleTier(e, t.key)}>{t.name}</button>
                    ))}
                  </div>
                  <label className="small" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                    <input type="checkbox" checked={e.showCustomer} onChange={(ev) => edit(e.id, { showCustomer: ev.target.checked })} />
                    List on proposal
                  </label>
                  <button className="link" onClick={() => ed.commit((j) => void (j.extras = (j.extras ?? []).filter((x) => x.id !== e.id)))}>Remove</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {unpriced.length > 0 && <p className="warn">{unpriced.length === 1 ? "One cost has" : `${unpriced.length} costs have`} no price yet, so {unpriced.length === 1 ? "it is" : "they are"} not in the quote. Enter your cost.</p>}
      <div className={s.chips}>
        {PRESETS.map((p) => (
          <button key={p.label} className="btn sm quiet" onClick={() => add(p)}>+ {p.label}</button>
        ))}
      </div>
      <p className="small muted">
        Marked up like everything else{pricing.overheadPct ? `, after ${pricing.overheadPct}% overhead` : ""}. Unlisted costs are priced in without being itemized for the homeowner.
      </p>
    </Panel>
  );
}
