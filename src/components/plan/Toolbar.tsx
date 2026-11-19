"use client";
import { useState } from "react";
import { cancelTool, startArea, startPlant } from "@/client/actions";
import { useEditor, type Tool } from "@/client/editor";
import { AREA_TYPES } from "@/lib/catalog";
import { pointByAngle, round1 } from "@/lib/geometry";
import { TIERS, type AreaType } from "@/lib/types";
import { RedoIcon, UndoIcon } from "../ui/Icons";
import s from "./Toolbar.module.css";

const SHAPES: { key: "outline" | "rect" | "circle"; name: string }[] = [
  { key: "outline", name: "Trace" },
  { key: "rect", name: "Box" },
  { key: "circle", name: "Circle" },
];

const HINTS: Partial<Record<Tool, [string, string, string]>> = {
  outline: ["Tap the first corner.", "Tap each corner in turn.", "Tap the first corner again, or press Finish."],
  lot: ["Tap each property corner in order.", "Tap the next property corner.", "Tap the first corner again, or press Finish."],
  utility: ["Tap along the marked line.", "Keep tapping along the line.", "Press Finish when the line is done."],
  rect: ["Tap one corner of the box.", "Now tap the opposite corner.", ""],
  circle: ["Tap the center.", "Now tap the outer edge.", ""],
  splitLot: ["Tap one end of the line between the two lots.", "Tap the other end of that line.", "Tap inside the part that is this job."],
  pickLot: ["Tap inside the right lot.", "Looking up that lot.", ""],
  camera: ["Tap where you stood to take the photo.", "Now tap the direction the camera faced.", ""],
};

const AREA_KEYS = Object.keys(AREA_TYPES) as AreaType[];

/** The one line of guidance shown on the map for whatever is happening now. */
export function planHint(): string {
  const ed = useEditor.getState();
  const n = ed.draft.length;
  if (ed.placingPlantId) {
    const p = ed.job?.plants.find((x) => x.id === ed.placingPlantId);
    return `Tap the map to drop ${p?.name ? p.name : "the plant"}. Tap Done when finished.`;
  }
  const h = HINTS[ed.tool];
  if (h) {
    const i = ed.tool === "splitLot" ? Math.min(2, n) : Math.min(2, n >= 3 || (ed.tool === "utility" && n >= 2) ? 2 : n ? 1 : 0);
    const prefix = ["outline", "rect", "circle"].includes(ed.tool) && !n ? `New ${AREA_TYPES[ed.drawType].label.toLowerCase()}. ` : "";
    return prefix + h[i];
  }
  if (ed.selection?.kind === "area") return "Drag a corner to reshape, or drag the area to move it.";
  if (ed.selection?.kind === "plant") return "Drag the plant to move it.";
  if (ed.selection) return "Drag a point to adjust it.";
  return "Pick what to add above, or tap something to change it. Drag to move around, pinch or scroll to zoom.";
}

export function Toolbar() {
  const ed = useEditor();
  const job = ed.job!;
  const n = ed.draft.length;
  const drawingArea = ed.tool === "outline" || ed.tool === "rect" || ed.tool === "circle";
  const multi = ed.tool === "outline" || ed.tool === "lot" || ed.tool === "utility";
  const [more, setMore] = useState(false);
  const [len, setLen] = useState("");
  const [deg, setDeg] = useState("90");
  const [from, setFrom] = useState<"right" | "left" | "horizontal">("right");

  function addByAngle() {
    const L = Number.parseFloat(len);
    if (!(L > 0) || !n) return;
    ed.set({ draft: [...ed.draft, round1(pointByAngle(ed.draft, L, Number.parseFloat(deg) || 0, from))] });
    setLen("");
  }

  return (
    <div className={s.bar}>
      <div className={s.row}>
        <div className={s.group}>
          <button className="icon-btn" onClick={ed.undo} disabled={!ed.past.length} aria-label="Undo" title="Undo (Ctrl Z)"><UndoIcon /></button>
          <button className="icon-btn" onClick={ed.redo} disabled={!ed.future.length} aria-label="Redo" title="Redo (Ctrl Shift Z)"><RedoIcon /></button>
        </div>
        <div className={s.group} role="group" aria-label="Add to the plan">
          <span className={`label ${s.groupLabel}`}>Add</span>
          {AREA_KEYS.map((k) => (
            <button key={k} className={s.add} aria-pressed={drawingArea && ed.drawType === k} onClick={() => startArea(k, drawingArea ? (ed.tool as "outline" | "rect" | "circle") : "outline")}>
              <span className={s.dot} style={{ background: AREA_TYPES[k].color }} />
              {AREA_TYPES[k].label}
            </button>
          ))}
          <button className={s.add} aria-pressed={!!ed.placingPlantId} onClick={() => (ed.placingPlantId ? cancelTool() : startPlant())}>
            <span className={s.dot} style={{ background: "#2f8f4a" }} />
            Plant
          </button>
        </div>
        {drawingArea && (
          <div className="seg" role="group" aria-label="Shape">
            {SHAPES.map((sh) => (
              <button key={sh.key} aria-pressed={ed.tool === sh.key} onClick={() => ed.set({ tool: sh.key, draft: [] })}>{sh.name}</button>
            ))}
          </div>
        )}
        <button className={s.moreBtn} aria-expanded={more} onClick={() => setMore((v) => !v)}>More {more ? "▴" : "▾"}</button>
      </div>

      {more && (
        <div className={s.more}>
          <label className={s.inline}>
            <span className="label">Snap lines to</span>
            <select className="select" value={ed.snapDeg} onChange={(e) => ed.set({ snapDeg: Number(e.target.value) })}>
              <option value={0}>Any angle</option>
              <option value={90}>90°</option>
              <option value={45}>45°</option>
              <option value={15}>15°</option>
            </select>
          </label>
          <div className={s.inline}>
            <span className="label">Show</span>
            <div className="seg" role="group" aria-label="Show the plan as">
              {TIERS.map((t) => (
                <button key={t.key} aria-pressed={job.tier === t.key} onClick={() => ed.commit((j) => void (j.tier = t.key))}>{t.name}</button>
              ))}
            </div>
          </div>
          {multi && n > 0 && (
            <div className={s.inline}>
              <span className="label">Exact next line</span>
              <input className="input num" style={{ width: 80 }} value={len} onChange={(e) => setLen(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addByAngle()} inputMode="decimal" placeholder="ft" aria-label="Length in feet" />
              <span className="small">at</span>
              <input className="input num" style={{ width: 64 }} value={deg} onChange={(e) => setDeg(e.target.value)} inputMode="decimal" aria-label="Angle" />
              <select className="select" style={{ width: "auto" }} value={from} onChange={(e) => setFrom(e.target.value as typeof from)} aria-label="Angle measured as">
                <option value="right">° right turn</option>
                <option value="left">° left turn</option>
                <option value="horizontal">° from east</option>
              </select>
              <button className="btn sm quiet" onClick={addByAngle}>Add point</button>
            </div>
          )}
          <p className="small muted">
            Keyboard: Ctrl or Cmd Z undo, add Shift to redo. Ctrl D duplicates. Delete removes. Esc stops drawing. Enter finishes a line. Plus and minus zoom, arrows move the map.
          </p>
        </div>
      )}
    </div>
  );
}
