"use client";
import { useEditor } from "@/client/editor";
import { addArea } from "@/client/actions";
import { useSettings } from "@/client/settingsStore";
import { AREA_TYPES, COLORS, LAYOUTS, SIZES, UTILITIES } from "@/lib/catalog";
import { areaPerimeter, areaSqft, borderedLength, edgeLength, edgeOn, tracedSqft } from "@/lib/geometry";
import { outsideLot, utilitiesNearArea } from "@/lib/locate";
import { serviceFor } from "@/lib/pricing";
import type { Area, AreaType, BorderKey, PaverColor, PaverLayout, PaverSize } from "@/lib/types";
import { TIERS } from "@/lib/types";
import { Empty, Panel } from "../../ui/Panel";
import { paverPattern } from "../patterns";
import s from "./panels.module.css";

export function AreasPanel() {
  const ed = useEditor();
  const job = ed.job!;
  const total = job.areas.reduce((t, a) => t + areaSqft(a), 0);
  return (
    <Panel title="Areas" id="areas-h" aside={<span className="num small">{Math.round(total).toLocaleString()} sq ft</span>}>
      {job.areas.length === 0 ? (
        <Empty>Pick Outline, Rectangle or Circle and draw on the plan.</Empty>
      ) : (
        <div>
          {job.areas.map((a) => (
            <AreaRow key={a.id} a={a} />
          ))}
        </div>
      )}
    </Panel>
  );
}

function AreaRow({ a }: { a: Area }) {
  const ed = useEditor();
  const job = ed.job!;
  const open = ed.selection?.kind === "area" && ed.selection.id === a.id;
  const near = utilitiesNearArea(job, a);
  const off = outsideLot(job.lot, a.pts);
  const update = (fn: (x: Area) => void) => ed.commit((j) => fn(j.areas.find((x) => x.id === a.id)!));
  return (
    <div className={s.item}>
      <div className={s.line}>
        <span className="swatch" style={{ background: AREA_TYPES[a.type].color }} />
        <select className="select" style={{ flex: "1 1 120px", width: "auto" }} value={a.type} onChange={(e) => update((x) => void (x.type = e.target.value as AreaType))} aria-label="Area type">
          {(Object.keys(AREA_TYPES) as AreaType[]).map((k) => (
            <option key={k} value={k}>{AREA_TYPES[k].label}</option>
          ))}
        </select>
        <span className={s.figure}>
          {Math.round(areaSqft(a)).toLocaleString()} sq ft
          <br />
          <span className="muted">{Math.round(areaPerimeter(a))} ft edge</span>
        </span>
        <button className="btn sm quiet" aria-expanded={open} onClick={() => ed.set({ selection: open ? null : { kind: "area", id: a.id }, tool: "select", draft: [] })}>
          {open ? "Close" : "Options"}
        </button>
      </div>
      {(near.length > 0 || off) && (
        <p className="warn">
          {near.length > 0 && `${near.map((t) => UTILITIES[t].name).join(" and ")} within 2 ft. Hand dig there. `}
          {off && "Goes past the property line."}
        </p>
      )}
      {open && <AreaDetail a={a} update={update} />}
    </div>
  );
}

function AreaDetail({ a, update }: { a: Area; update: (fn: (x: Area) => void) => void }) {
  const ed = useEditor();
  const pricing = useSettings((x) => x.pricing);
  const job = ed.job!;
  const svc = serviceFor(pricing, a.type, job.tier);
  const paverTiers = TIERS.filter((t) => serviceFor(pricing, "patio", t.key).fill === "paver").map((t) => t.name);
  const layout = LAYOUTS[a.paver.layout];
  return (
    <div className={s.detail}>
      <p className="small"><strong>{TIERS.find((t) => t.key === job.tier)!.name}</strong> uses {svc.title.toLowerCase()}.</p>
      <div className="field">
        <label className="label" htmlFor={`m-${a.id}`}>My own measurement, sq ft</label>
        <input id={`m-${a.id}`} className="input num" inputMode="decimal" defaultValue={a.manualSqft || ""} placeholder={`${Math.round(tracedSqft(a))} traced`} onBlur={(e) => update((x) => void (x.manualSqft = Math.max(0, Number.parseFloat(e.target.value) || 0)))} />
      </div>

      {a.type === "patio" && (
        <>
          <div className={s.grid2}>
            <div className="field">
              <label className="label" htmlFor={`l-${a.id}`}>Paver layout</label>
              <select id={`l-${a.id}`} className="select" value={a.paver.layout} onChange={(e) => update((x) => {
                x.paver.layout = e.target.value as PaverLayout;
                const z = SIZES[x.paver.size];
                if (LAYOUTS[x.paver.layout].needsTwoToOne && z.w !== 2 * z.h) x.paver.size = "4x8";
              })}>
                {(Object.keys(LAYOUTS) as PaverLayout[]).map((k) => <option key={k} value={k}>{LAYOUTS[k].name}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor={`z-${a.id}`}>Paver size, in</label>
              <select id={`z-${a.id}`} className="select" value={a.paver.layout === "ashlar" ? "mixed" : a.paver.size} disabled={a.paver.layout === "ashlar"} onChange={(e) => update((x) => void (x.paver.size = e.target.value as PaverSize))}>
                {a.paver.layout === "ashlar" ? <option value="mixed">Mixed sizes</option> : (Object.keys(SIZES) as PaverSize[]).map((k) => (
                  <option key={k} value={k} disabled={!!layout.needsTwoToOne && SIZES[k].w !== 2 * SIZES[k].h}>{k.replace("x", " x ")}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor={`c-${a.id}`}>Paver color</label>
              <select id={`c-${a.id}`} className="select" value={a.paver.color} onChange={(e) => update((x) => void (x.paver.color = e.target.value as PaverColor))}>
                {(Object.keys(COLORS) as PaverColor[]).map((k) => <option key={k} value={k}>{COLORS[k].name}</option>)}
              </select>
            </div>
            <div className="field">
              <span className="label">About 6 ft across</span>
              <div className={s.swatch}>
                <svg viewBox="0 0 220 64" role="img" aria-label="Paver pattern preview" dangerouslySetInnerHTML={{ __html: `<defs>${paverPattern(`sw-${a.id}`, a.paver, 3)}</defs><rect width="220" height="64" fill="url(#sw-${a.id})"/>` }} />
              </div>
            </div>
          </div>
          <p className="small muted">{paverTiers.length ? `Pavers are in the ${paverTiers.join(" and ")} tier.` : "No tier uses pavers right now."} {layout.name} adds {layout.waste}% for cuts.</p>
        </>
      )}

      {a.type === "lawn" && (
        <>
          <div className="field">
            <label className="label" htmlFor={`b-${a.id}`}>Border</label>
            <select id={`b-${a.id}`} className="select" value={a.border} onChange={(e) => update((x) => void (x.border = e.target.value as BorderKey))}>
              <option value="none">No border</option>
              {(Object.keys(pricing.borders) as Exclude<BorderKey, "none">[]).map((k) => <option key={k} value={k}>{pricing.borders[k].name}</option>)}
            </select>
          </div>
          {a.border !== "none" && (
            <>
              {a.pts.length <= 12 && (
                <div className="field">
                  <span className="label">Edges that get the border</span>
                  <div className={s.chips}>
                    {a.pts.map((_, i) => (
                      <button key={i} className={s.chipBtn} aria-pressed={edgeOn(a, i)} onClick={() => update((x) => void (x.edges = x.pts.map((__, k) => (k === i ? !edgeOn(x, k) : edgeOn(x, k)))))}>
                        Edge {i + 1} · {Math.round(edgeLength(a, i))} ft
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <p className="small muted"><span className="num">{Math.round(borderedLength(a))}</span> ft of border. Edge numbers show on the plan.</p>
            </>
          )}
        </>
      )}

      {a.type === "bed" && <p className="small muted">Mulch and planting mix follow the tier. Add specific plants below.</p>}

      <div className="row">
        <button className="btn sm quiet" onClick={() => addArea(a.pts.map(([x, y]) => [x + 4, y + 4]), a.type)}>Duplicate</button>
        <button className="btn sm quiet" onClick={() => { ed.commit((j) => void (j.areas = j.areas.filter((x) => x.id !== a.id))); ed.set({ selection: null }); }}>Remove</button>
      </div>
    </div>
  );
}
