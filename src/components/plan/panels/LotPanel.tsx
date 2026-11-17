"use client";
import { useEditor } from "@/client/editor";
import { perimeter, polygonArea } from "@/lib/geometry";
import { Panel } from "../../ui/Panel";
import s from "./panels.module.css";

export function LotPanel() {
  const ed = useEditor();
  const job = ed.job!;
  const lot = job.lot;
  const parcel = job.site.parcel;
  const on = ed.selection?.kind === "lot";
  return (
    <Panel title="Property line" id="lot-h">
      {lot ? (
        <div className={s.item} style={{ paddingTop: 0 }}>
          <div className={s.line}>
            <span className="swatch" style={{ background: "#ffb020" }} />
            <span className={s.grow}>
              <span className="num">{Math.round(perimeter(lot))} ft</span> around · <span className="num">{(polygonArea(lot) / 43560).toFixed(2)}</span> acres
            </span>
            <button className="btn sm quiet" onClick={() => ed.set({ selection: on ? null : { kind: "lot" }, tool: "select", draft: [] })}>{on ? "Done" : "Adjust"}</button>
          </div>
          <p className="small muted">
            {parcel ? `From ${parcel.source}. ` : "Drawn by hand. "}Parcel maps are approximate; confirm the pins before building on the line.
          </p>
          <div className="row">
            {parcel && <button className="link" onClick={() => ed.commit((j) => void (j.lot = parcel.pts))}>Reset to the parcel map</button>}
            <button className="link" onClick={() => ed.commit((j) => void (j.lot = null))}>Remove</button>
          </div>
        </div>
      ) : (
        <div className="stack">
          <p className="small muted">{job.sample ? "No parcel data for the sample lot." : "No parcel line was found for this address."} Trace it from the pins or the plat.</p>
          <div>
            <button className="btn sm" onClick={() => ed.set({ tool: "lot", draft: [], selection: null, placingPlantId: null })}>Draw property line</button>
          </div>
        </div>
      )}
    </Panel>
  );
}
