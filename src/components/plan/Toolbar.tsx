"use client";
import { useState } from "react";
import { useEditor, type Tool } from "@/client/editor";
import { pointByAngle, round1 } from "@/lib/geometry";
import { TIERS } from "@/lib/types";
import { RedoIcon, UndoIcon } from "../ui/Icons";
import s from "./Toolbar.module.css";

const TOOLS: { key: Tool; name: string }[] = [
  { key: "select", name: "Select" },
  { key: "outline", name: "Outline" },
  { key: "rect", name: "Rectangle" },
  { key: "circle", name: "Circle" },
];

const HINTS: Partial<Record<Tool, [string, string, string]>> = {
  outline: ["Click the first corner of the area.", "Click the next corner, or type an exact length and angle below.", "Click the first point or Finish to close it."],
  lot: ["Click each property corner in order.", "Click the next property corner.", "Click the first corner or Finish to close the line."],
  utility: ["Click along the marked line.", "Keep clicking along the line.", "Click the last point again or Finish."],
  rect: ["Click one corner.", "Now click the opposite corner.", ""],
  circle: ["Click the center.", "Now click the outer edge.", ""],
  splitLot: ["Click one end of the line between the two lots.", "Click the other end of that line.", "Click inside the part that is this job."],
  pickLot: ["Click inside the right lot on the aerial.", "Looking up that lot.", ""],
  camera: ["Click where you stood to take the photo.", "Now click the direction the camera faced.", ""],
};

export function Toolbar({ onFinish }: { onFinish: () => void }) {
  const ed = useEditor();
  const job = ed.job!;
  const n = ed.draft.length;
  const multi = ed.tool === "outline" || ed.tool === "lot" || ed.tool === "utility";
  const [len, setLen] = useState("");
  const [deg, setDeg] = useState("90");
  const [from, setFrom] = useState<"right" | "left" | "horizontal">("right");

  const hint = ed.placingPlantId
    ? "Click the plan to drop each plant. Circles show the spread it reaches here."
    : HINTS[ed.tool]
      ? HINTS[ed.tool]![ed.tool === "splitLot" ? Math.min(2, n) : Math.min(2, n >= 3 || (ed.tool === "utility" && n >= 2) ? 2 : n ? 1 : 0)]
      : ed.selection?.kind === "area"
        ? "Drag a corner to reshape, or drag the area to move it."
        : ed.selection?.kind === "plant"
          ? "Drag the plant to move it. Delete removes it."
          : ed.selection
            ? "Drag a point to adjust it. Delete removes it."
            : "Click an area, plant or line to select it.";

  function addByAngle() {
    const L = Number.parseFloat(len);
    if (!(L > 0) || !n) return;
    ed.set({ draft: [...ed.draft, round1(pointByAngle(ed.draft, L, Number.parseFloat(deg) || 0, from))] });
    setLen("");
  }

  return (
    <div className={s.bar}>
      <div className="row" style={{ "--gap": "10px" } as React.CSSProperties}>
        <div className="row" style={{ "--gap": "4px" } as React.CSSProperties}>
          <button className="icon-btn" onClick={ed.undo} disabled={!ed.past.length && !n} aria-label="Undo" title="Undo (Ctrl Z)"><UndoIcon /></button>
          <button className="icon-btn" onClick={ed.redo} disabled={!ed.future.length} aria-label="Redo" title="Redo (Ctrl Shift Z)"><RedoIcon /></button>
        </div>
        <div className="seg" role="group" aria-label="Drawing tool">
          {TOOLS.map((t) => (
            <button key={t.key} aria-pressed={ed.tool === t.key && !ed.placingPlantId} onClick={() => ed.set({ tool: t.key, draft: [], placingPlantId: null, selection: t.key === "select" ? ed.selection : null })}>
              {t.name}
            </button>
          ))}
        </div>
        <label className={s.snap}>
          <span className="label">Snap</span>
          <select className="select" value={ed.snapDeg} onChange={(e) => ed.set({ snapDeg: Number(e.target.value) })} aria-label="Snap lines to">
            <option value={0}>Any angle</option>
            <option value={90}>90°</option>
            <option value={45}>45°</option>
            <option value={15}>15°</option>
          </select>
        </label>
        <div className={s.tierSwitch}>
          <span className="label">Show</span>
          <div className="seg" role="group" aria-label="Show the plan as">
            {TIERS.map((t) => (
              <button key={t.key} aria-pressed={job.tier === t.key} onClick={() => ed.commit((j) => void (j.tier = t.key))}>
                {t.name}
              </button>
            ))}
          </div>
        </div>
      </div>
      {multi && n > 0 && (
        <div className={s.angle}>
          <label className="small" htmlFor="ang-len">Next line</label>
          <input id="ang-len" className="input num" style={{ width: 84 }} value={len} onChange={(e) => setLen(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addByAngle()} inputMode="decimal" placeholder="ft" />
          <label className="small" htmlFor="ang-deg">at</label>
          <input id="ang-deg" className="input num" style={{ width: 70 }} value={deg} onChange={(e) => setDeg(e.target.value)} inputMode="decimal" />
          <select className="select" style={{ width: "auto" }} value={from} onChange={(e) => setFrom(e.target.value as typeof from)} aria-label="Angle measured as">
            <option value="right">° right turn</option>
            <option value="left">° left turn</option>
            <option value="horizontal">° from east</option>
          </select>
          <button className="btn sm quiet" onClick={addByAngle}>Add point</button>
          <button className="btn sm solid" onClick={onFinish} disabled={n < (ed.tool === "utility" ? 2 : 3)}>
            Finish {ed.tool === "lot" ? "property line" : ed.tool === "utility" ? "line" : "area"}
          </button>
        </div>
      )}
      <p className={s.hint} aria-live="polite">{hint}</p>
    </div>
  );
}
