"use client";
import { useState } from "react";
import { api, ApiError } from "@/client/api";
import { useEditor } from "@/client/editor";
import { useFeatures } from "@/client/useFeatures";
import { PLANT_KINDS, UTILITIES } from "@/lib/catalog";
import { newPlant } from "@/lib/jobs";
import { outsideLot, utilitiesNearPlant } from "@/lib/locate";
import type { Plant, PlantKind } from "@/lib/types";
import { Empty, Panel } from "../../ui/Panel";
import s from "./panels.module.css";

export function PlantsPanel() {
  const ed = useEditor();
  const features = useFeatures();
  const job = ed.job!;
  const location = job.site.matchedAddress ?? job.site.address;
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function estimate() {
    const need = job.plants.filter((p) => p.name && (!p.estimate || p.estimate.source === "sample" || p.estimate.location !== location));
    if (!need.length) return setMsg(`Every named plant already has an estimate for ${location}.`);
    setBusy(true);
    setMsg("Estimating sizes for this location");
    try {
      const { estimates } = await api.estimate(location, need.map((p) => ({ name: p.name, kind: p.kind })));
      let n = 0;
      ed.commit((j) =>
        need.forEach((p, i) => {
          const o = estimates[i];
          const target = j.plants.find((x) => x.id === p.id);
          if (target && o && o.height_ft > 0 && o.spread_ft > 0) {
            target.estimate = { heightFt: Math.round(o.height_ft * 10) / 10, spreadFt: Math.round(o.spread_ft * 10) / 10, note: String(o.note ?? "").slice(0, 160), location, source: "claude" };
            n++;
          }
        }),
      );
      setMsg(n ? `Sizes updated for ${location}.` : "No usable estimate came back. Try again.");
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Could not get estimates.");
    } finally {
      setBusy(false);
    }
  }

  function add() {
    const p = newPlant();
    ed.commit((j) => void j.plants.push(p));
    ed.set({ placingPlantId: p.id, tool: "select", draft: [], selection: null });
    setTimeout(() => document.getElementById(`pn-${p.id}`)?.focus(), 0);
  }

  return (
    <Panel title="Plants" id="plants-h" aside={<span className="num small">{job.plants.reduce((t, p) => t + p.spots.length, 0)} placed</span>}>
      {job.plants.length === 0 ? <Empty>Add any plant or variety and drop it where it goes.</Empty> : <div>{job.plants.map((p) => <PlantRow key={p.id} p={p} />)}</div>}
      <div className="row">
        <button className="btn sm" onClick={add}>Add a plant</button>
        {features?.claude.ok && (
          <button className="btn sm solid" onClick={estimate} disabled={busy}>Estimate growth here</button>
        )}
      </div>
      <p className="small muted" aria-live="polite">
        {msg ?? (features && !features.claude.ok ? "Growth estimates are not available on your plan yet." : "Each tier installs the same plants at a bigger container size.")}
      </p>
    </Panel>
  );
}

function PlantRow({ p }: { p: Plant }) {
  const ed = useEditor();
  const job = ed.job!;
  const placing = ed.placingPlantId === p.id;
  const near = new Set<string>();
  p.spots.forEach((q) => utilitiesNearPlant(job, p, q).forEach((t) => near.add(UTILITIES[t].name.toLowerCase())));
  const off = p.spots.filter((q) => outsideLot(job.lot, [q])).length;
  const location = job.site.matchedAddress ?? job.site.address;
  const est = p.estimate;
  return (
    <div className={s.item}>
      <div className={s.line}>
        <input
          id={`pn-${p.id}`}
          className={`input ${s.grow}`}
          defaultValue={p.name}
          placeholder="Any plant or variety"
          aria-label="Plant name"
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== p.name) ed.commit((j) => {
              const x = j.plants.find((y) => y.id === p.id)!;
              x.name = v;
              x.estimate = null;
            });
          }}
        />
        <select className="select" style={{ flex: "0 1 150px", width: "auto" }} value={p.kind} onChange={(e) => ed.commit((j) => void (j.plants.find((y) => y.id === p.id)!.kind = e.target.value as PlantKind))} aria-label="Size class">
          {(Object.keys(PLANT_KINDS) as PlantKind[]).map((k) => <option key={k} value={k}>{PLANT_KINDS[k]}</option>)}
        </select>
      </div>
      <div className={s.line}>
        <span className="num small" style={{ marginRight: "auto" }}>{p.spots.length} placed</span>
        <button className={`btn sm ${placing ? "solid" : "quiet"}`} onClick={() => ed.set({ placingPlantId: placing ? null : p.id, tool: "select", draft: [], selection: null })}>{placing ? "Done placing" : "Place on plan"}</button>
        <button className="btn sm quiet" disabled={!p.spots.length} onClick={() => ed.commit((j) => void j.plants.find((y) => y.id === p.id)!.spots.pop())}>Undo one</button>
        <button className="btn sm quiet" onClick={() => { ed.commit((j) => void (j.plants = j.plants.filter((y) => y.id !== p.id))); if (placing) ed.set({ placingPlantId: null }); }}>Remove</button>
      </div>
      <p className="small muted">
        {est && est.location === location
          ? `${est.source === "sample" ? "Sample estimate" : "Estimate"} for ${location} after 10 years: about ${est.heightFt} ft tall, ${est.spreadFt} ft wide. ${est.note}`
          : "No growth estimate for this location yet. Drawn at a generic size."}
      </p>
      {(near.size > 0 || off > 0) && (
        <p className="warn">
          {near.size > 0 && `Too close to the ${[...near].join(" and ")}. `}
          {off > 0 && `${off} placed past the property line.`}
        </p>
      )}
    </div>
  );
}
