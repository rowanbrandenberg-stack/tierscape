"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor, type Tool } from "@/client/editor";
import { useSettings } from "@/client/settingsStore";
import { FOV } from "@/lib/camera";
import { GENERIC_SIZE, UTILITIES } from "@/lib/catalog";
import { areaSqft, centroid, circle, dist, edgeOn, pointInPolygon, rectangle, round1, snapCorner, snapNext } from "@/lib/geometry";
import { addArea, finishDraft, pickLotAt } from "@/client/actions";
import { serviceFor } from "@/lib/pricing";
import { tilesForExtent } from "@/lib/projection";
import type { Pt } from "@/lib/types";
import { fillPattern } from "./patterns";
import { SampleLot } from "./SampleLot";
import s from "./PlanCanvas.module.css";

type Drag =
  | { kind: "corner"; target: "area" | "lot" | "utility"; id?: string; index: number; moved: boolean }
  | { kind: "area"; id: string; start: Pt; orig: Pt[]; moved: boolean }
  | { kind: "plant"; id: string; index: number; start: Pt; moved: boolean }
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number; moved: boolean };

const MULTI: Tool[] = ["outline", "lot", "utility"];

export function PlanCanvas() {
  const ed = useEditor();
  const pricing = useSettings((x) => x.pricing);
  const job = ed.job!;
  const view = ed.view ?? job.site.extent;
  const svgRef = useRef<SVGSVGElement>(null);
  const [pxWidth, setPxWidth] = useState(800);
  const [hover, setHover] = useState<Pt | null>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setPxWidth(e.contentRect.width || 800));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const setColor = (on: boolean) => {
    ed.set({ colorAerial: on });
    try {
      localStorage.setItem("tierscape.aerialColor", on ? "1" : "0");
    } catch {}
  };
  useEffect(() => {
    try {
      const v = localStorage.getItem("tierscape.aerialColor");
      if (v !== null) useEditor.setState({ colorAerial: v === "1" });
    } catch {}
  }, []);

  /** Plan feet per screen pixel, so strokes, handles and labels keep a steady size at any zoom. */
  const u = view.w / pxWidth;

  const toPlan = useCallback((e: { clientX: number; clientY: number }): Pt => {
    const svg = svgRef.current!;
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const q = p.matrixTransform(svg.getScreenCTM()!.inverse());
    return [q.x, q.y];
  }, []);

  const { tool, draft, selection, placingPlantId } = ed;
  const editing = tool === "select" && !placingPlantId;

  /* ---------- defs: fills drawn to scale ---------- */
  const defs = useMemo(
    () =>
      job.areas
        .map((a) => {
          const svc = serviceFor(pricing, a.type, job.tier);
          return fillPattern(`fill-${a.id}`, svc.fill, a.paver, 1) + `<clipPath id="clip-${a.id}"><polygon points="${a.pts.join(" ")}"/></clipPath>`;
        })
        .join(""),
    [job.areas, job.tier, pricing],
  );

  /* ---------- pointer handling ---------- */
  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const t = (e.target as Element).closest("[data-hit]") as HTMLElement | null;
    const hit = t?.dataset.hit;
    const q = toPlan(e);
    if (editing && hit) {
      const [kind, id, idx] = hit.split(":");
      if (kind === "corner-area" || kind === "corner-lot" || kind === "corner-utility") {
        ed.checkpoint();
        drag.current = { kind: "corner", target: kind.slice(7) as "area" | "lot" | "utility", id, index: Number(idx), moved: false };
      } else if (kind === "plant") {
        ed.set({ selection: { kind: "plant", id, index: Number(idx) } });
        ed.checkpoint();
        drag.current = { kind: "plant", id, index: Number(idx), start: q, moved: false };
      } else if (kind === "area" && selection?.kind === "area" && selection.id === id) {
        ed.checkpoint();
        drag.current = { kind: "area", id, start: q, orig: job.areas.find((a) => a.id === id)!.pts.map((p) => [...p] as Pt), moved: false };
      }
      if (drag.current) {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
    }
    if (editing && view.w < job.site.extent.w * 1.49) {
      drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const q = toPlan(e);
    const d = drag.current;
    if (!d) {
      if (tool !== "select" || placingPlantId) setHover(q);
      return;
    }
    if (d.kind === "pan") {
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      d.moved = true;
      setView({ ...view, x: d.vx - dx * u, y: d.vy - dy * u });
      return;
    }
    d.moved = true;
    if (d.kind === "corner") {
      ed.mutate((j) => {
        const pts = d.target === "area" ? j.areas.find((a) => a.id === d.id)!.pts : d.target === "lot" ? j.lot! : j.utilities.find((x) => x.id === d.id)!.pts;
        pts[d.index] = round1(snapCorner(pts, d.index, q, ed.snapDeg, d.target === "utility"));
      });
    } else if (d.kind === "area") {
      const dx = q[0] - d.start[0];
      const dy = q[1] - d.start[1];
      ed.mutate((j) => {
        j.areas.find((a) => a.id === d.id)!.pts = d.orig.map(([x, y]) => round1([x + dx, y + dy]));
      });
    } else if (d.kind === "plant") {
      ed.mutate((j) => {
        j.plants.find((p) => p.id === d.id)!.spots[d.index] = round1(q);
      });
    }
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) {
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
    } else if (d.kind !== "pan") {
      // A press with no movement: drop the checkpoint we took for nothing.
      useEditor.setState((st) => ({ past: st.past.slice(0, -1) }));
    }
  }

  function onClick(e: React.MouseEvent) {
    if (suppressClick.current) return;
    const q = toPlan(e);
    const near = (a: Pt | undefined) => !!a && dist(a, q) < 10 * u;
    if (placingPlantId) {
      ed.commit((j) => void j.plants.find((p) => p.id === placingPlantId)?.spots.push(round1(q)));
      return;
    }
    if (tool === "pickLot") {
      if (!draft.length) void pickLotAt(q);
      return;
    }
    if (tool === "select") {
      const t = (e.target as Element).closest("[data-hit]") as HTMLElement | null;
      const [kind, id, idx] = (t?.dataset.hit ?? "").split(":");
      if (kind === "plant") return ed.set({ selection: { kind: "plant", id, index: Number(idx) } });
      if (kind === "lot") return ed.set({ selection: { kind: "lot" } });
      if (kind === "utility") return ed.set({ selection: { kind: "utility", id } });
      const a = [...job.areas].reverse().find((x) => pointInPolygon(q, x.pts));
      return ed.set({ selection: a ? { kind: "area", id: a.id } : null });
    }
    if (MULTI.includes(tool)) {
      if (tool !== "utility" && draft.length >= 3 && near(draft[0])) return finishDraft();
      if (tool === "utility" && draft.length >= 2 && near(draft[draft.length - 1])) return finishDraft();
      return ed.set({ draft: [...draft, round1(snapNext(draft, q, ed.snapDeg))] });
    }
    if (tool === "rect") {
      if (!draft.length) return ed.set({ draft: [q] });
      if (Math.abs(q[0] - draft[0][0]) > 1 && Math.abs(q[1] - draft[0][1]) > 1) addArea(rectangle(draft[0], q));
      return;
    }
    if (tool === "circle") {
      if (!draft.length) return ed.set({ draft: [q] });
      const r = dist(draft[0], q);
      if (r > 1) addArea(circle(draft[0], r));
      return;
    }
    if (tool === "camera") {
      if (!draft.length) return ed.set({ draft: [q] });
      const o = draft[0];
      if (dist(o, q) < 1) return;
      const angle = Math.atan2(q[1] - o[1], q[0] - o[0]);
      ed.commit((j) => {
        const ph = j.photos.find((p) => p.id === j.activePhotoId);
        if (ph) Object.assign(ph, { camera: { x: o[0], y: o[1], angle }, placedBy: "manual", note: "" });
      });
      ed.set({ tool: "select", draft: [] });
    }
  }

  /* ---------- zoom ---------- */
  const ext = job.site.extent;
  const setView = useCallback(
    (v: { x: number; y: number; w: number; h?: number }) => {
      const w = Math.min(ext.w * 1.5, Math.max(12, v.w));
      const h = (w * ext.h) / ext.w;
      const pad = ext.w * 0.25;
      const x = Math.min(ext.x + ext.w + pad - w, Math.max(ext.x - pad, v.x));
      const y = Math.min(ext.y + ext.h + pad - h, Math.max(ext.y - pad, v.y));
      ed.set({ view: { x, y, w, h } });
    },
    [ext, ed],
  );
  const zoomAt = useCallback(
    (f: number, c?: Pt) => {
      const [cx, cy] = c ?? [view.x + view.w / 2, view.y + view.h / 2];
      const nw = Math.min(ext.w * 1.5, Math.max(12, view.w / f));
      const r = nw / view.w;
      setView({ x: cx - (cx - view.x) * r, y: cy - (cy - view.y) * r, w: nw });
    },
    [view, ext, setView],
  );
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, toPlan(e));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [zoomAt, toPlan]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.ctrlKey || e.metaKey) return;
      if (e.key === "+" || e.key === "=") zoomAt(1.4);
      else if (e.key === "-" || e.key === "_") zoomAt(1 / 1.4);
      else if (e.key === "0") ed.set({ view: { ...ext } });
      else if (e.key.startsWith("Arrow") && view.w < ext.w * 1.49) {
        e.preventDefault();
        const d = view.w * 0.15;
        setView({ ...view, x: view.x + (e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0), y: view.y + (e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0) });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomAt, view, ext, setView, ed]);

  /* ---------- drawing ---------- */
  const label = (x: number, y: number, text: string, color = "#fff", size = 11) => (
    <text x={x} y={y} textAnchor="middle" fontFamily="Inter Tight, Arial, sans-serif" fontWeight={600} fontSize={size * u} fill={color} stroke="#111" strokeWidth={3 * u} paintOrder="stroke" pointerEvents="none">
      {text}
    </text>
  );

  const tiles = job.site.origin && job.site.imagery ? tilesForExtent(job.site.origin, { x: ext.x - ext.w * 0.25, y: ext.y - ext.w * 0.25, w: ext.w * 1.5, h: ext.h + ext.w * 0.5 }, job.site.imagery.zoom) : [];
  const photo = job.photos.find((p) => p.id === job.activePhotoId);
  const preview = hover && draft.length && tool !== "select" ? (MULTI.includes(tool) ? snapNext(draft, hover, ed.snapDeg) : hover) : null;

  return (
    <div className={s.frame}>
      <svg
        ref={svgRef}
        className={s.svg}
        data-mode={tool !== "select" || placingPlantId ? "draw" : view.w < ext.w * 1.49 ? "pan" : "select"}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        role="img"
        aria-label="Plan of the property"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onClick={onClick}
        onDoubleClick={() => MULTI.includes(tool) && finishDraft()}
      >
        <defs dangerouslySetInnerHTML={{ __html: `<filter id="gray"><feColorMatrix type="saturate" values="0"/></filter><filter id="muted"><feColorMatrix type="saturate" values=".85"/><feComponentTransfer><feFuncR type="linear" slope=".82"/><feFuncG type="linear" slope=".82"/><feFuncB type="linear" slope=".82"/></feComponentTransfer></filter>${defs}` }} />

        {/* base layer: real imagery, the sample drawing, or plain ground */}
        <g filter={ed.colorAerial ? "url(#muted)" : "url(#gray)"}>
          <rect x={ext.x - ext.w} y={ext.y - ext.h} width={ext.w * 3} height={ext.h * 3} fill="#9a9a90" />
          {tiles.map((t) => (
            <image key={`${t.z}/${t.x}/${t.y}`} href={`/api/imagery/${t.z}/${t.x}/${t.y}`} x={t.px} y={t.py} width={t.w + 0.05} height={t.h + 0.05} preserveAspectRatio="none" />
          ))}
          {job.sample && <SampleLot />}
        </g>

        {/* outside the property line goes dark */}
        {job.lot && job.lot.length > 2 && (
          <path
            d={`M${ext.x - ext.w * 2} ${ext.y - ext.h * 2}H${ext.x + ext.w * 3}V${ext.y + ext.h * 3}H${ext.x - ext.w * 2}Z M${job.lot.map((p) => p.join(" ")).join("L")}Z`}
            fill="#0a0d0b"
            fillOpacity={0.42}
            fillRule="evenodd"
            pointerEvents="none"
          />
        )}

        {/* areas */}
        {job.areas.map((a) => {
          const on = selection?.kind === "area" && selection.id === a.id;
          const c = centroid(a.pts);
          const B = a.type === "lawn" && a.border !== "none" ? pricing.borders[a.border] : null;
          return (
            <g key={a.id}>
              <polygon points={a.pts.join(" ")} fill={`url(#fill-${a.id})`} data-hit={`area:${a.id}`} className={on && editing ? s.movable : undefined} />
              {B &&
                a.pts.map((p, i) =>
                  edgeOn(a, i) ? (
                    <path key={i} d={`M${p[0]} ${p[1]}L${a.pts[(i + 1) % a.pts.length].join(" ")}`} stroke={B.color} strokeWidth={B.width * 2} clipPath={`url(#clip-${a.id})`} pointerEvents="none" />
                  ) : null,
                )}
              <polygon points={a.pts.join(" ")} fill="none" stroke={on ? "#ff3d7f" : "#fff"} strokeWidth={(on ? 2.5 : 1.5) * u} strokeDasharray={on ? undefined : `${6 * u} ${3 * u}`} pointerEvents="none" />
              {label(c[0], c[1] + 4 * u, `${Math.round(areaSqft(a))} sq ft`, "#fff", 12)}
              {on && editing && a.type === "lawn" && B && a.pts.length <= 12 && a.pts.map((p, i) => <g key={`n${i}`}>{label((p[0] + a.pts[(i + 1) % a.pts.length][0]) / 2, (p[1] + a.pts[(i + 1) % a.pts.length][1]) / 2 + 4 * u, String(i + 1), "#ffe14d")}</g>)}
            </g>
          );
        })}

        {/* property line */}
        {job.lot && job.lot.length > 2 && (
          <g>
            <polygon points={job.lot.join(" ")} fill="none" stroke="#ffb020" strokeWidth={(selection?.kind === "lot" ? 3.5 : 2.5) * u} strokeDasharray={`${10 * u} ${4 * u} ${2 * u} ${4 * u}`} pointerEvents="none" />
            {editing && <polygon points={job.lot.join(" ")} fill="none" stroke="transparent" strokeWidth={12 * u} data-hit="lot" style={{ cursor: "pointer", pointerEvents: "stroke" }} />}
            {job.lot.map((p, i) => {
              const q = job.lot![(i + 1) % job.lot!.length];
              const L = dist(p, q);
              return L / u > 50 ? <g key={i}>{label((p[0] + q[0]) / 2, (p[1] + q[1]) / 2 - 5 * u, `${L.toFixed(1)} ft`, "#ffd27a", 10.5)}</g> : null;
            })}
          </g>
        )}

        {/* utility marks with the hand dig band */}
        {job.utilities.map((ut) => {
          const U = UTILITIES[ut.type];
          const on = selection?.kind === "utility" && selection.id === ut.id;
          const m = Math.floor((ut.pts.length - 1) / 2);
          const mid: Pt = [(ut.pts[m][0] + ut.pts[m + 1][0]) / 2, (ut.pts[m][1] + ut.pts[m + 1][1]) / 2];
          return (
            <g key={ut.id}>
              <polyline points={ut.pts.join(" ")} fill="none" stroke={U.color} strokeOpacity={0.28} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
              <polyline points={ut.pts.join(" ")} fill="none" stroke={U.color} strokeWidth={(on ? 4 : 3) * u} strokeDasharray={`${8 * u} ${4 * u}`} pointerEvents="none" />
              {editing && <polyline points={ut.pts.join(" ")} fill="none" stroke="transparent" strokeWidth={12 * u} data-hit={`utility:${ut.id}`} style={{ cursor: "pointer", pointerEvents: "stroke" }} />}
              {label(mid[0], mid[1] - 7 * u, U.short, U.color, 10.5)}
            </g>
          );
        })}

        {/* where the active photo was taken */}
        {photo?.camera && tool !== "camera" && (() => {
          const c = photo.camera;
          const R = 70;
          const l: Pt = [c.x + R * Math.cos(c.angle - FOV / 2), c.y + R * Math.sin(c.angle - FOV / 2)];
          const r: Pt = [c.x + R * Math.cos(c.angle + FOV / 2), c.y + R * Math.sin(c.angle + FOV / 2)];
          return (
            <g pointerEvents="none">
              <path d={`M${c.x} ${c.y}L${l.join(" ")}A${R} ${R} 0 0 1 ${r.join(" ")}Z`} fill="#8fe3ff" fillOpacity={0.16} stroke="#8fe3ff" strokeWidth={1.5 * u} strokeDasharray={`${4 * u} ${3 * u}`} />
              <circle cx={c.x} cy={c.y} r={7 * u} fill="#0b6f8f" stroke="#fff" strokeWidth={2 * u} />
              {label(c.x, c.y + 19 * u, "PHOTO", "#8fe3ff", 10)}
            </g>
          );
        })()}

        {/* plants: circles show mature spread to scale */}
        {job.plants.map((p) => {
          const spread = p.estimate?.spreadFt ?? GENERIC_SIZE[p.kind][1];
          return p.spots.map((q, i) => {
            const on = selection?.kind === "plant" && selection.id === p.id && selection.index === i;
            return (
              <g key={`${p.id}${i}`}>
                <circle cx={q[0]} cy={q[1]} r={Math.max(0.6, spread / 2)} fill="#2f8f4a" fillOpacity={0.55} stroke={on ? "#ff3d7f" : "#fff"} strokeWidth={(on ? 2.5 : 1.2) * u} strokeDasharray={p.estimate || on ? undefined : `${3 * u} ${3 * u}`} pointerEvents="none" />
                <circle cx={q[0]} cy={q[1]} r={2 * u} fill="#fff" pointerEvents="none" />
                {editing && <circle cx={q[0]} cy={q[1]} r={Math.max(spread / 2, 8 * u)} fill="transparent" data-hit={`plant:${p.id}:${i}`} className={s.movable} />}
                {i === 0 && p.name && label(q[0], q[1] + spread / 2 + 12 * u, p.name, "#fff", 10.5)}
              </g>
            );
          });
        })}

        {/* handles for the selected shape */}
        {editing &&
          (() => {
            const pts =
              selection?.kind === "area" ? job.areas.find((a) => a.id === selection.id)?.pts : selection?.kind === "lot" ? job.lot : selection?.kind === "utility" ? job.utilities.find((x) => x.id === selection.id)?.pts : null;
            if (!pts || !selection) return null;
            const kind = selection.kind === "area" ? `corner-area:${selection.id}` : selection.kind === "lot" ? "corner-lot:" : `corner-utility:${(selection as { id: string }).id}`;
            const color = selection.kind === "lot" ? "#ffb020" : "#fff";
            return pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={6 * u} fill={color} stroke="#ff3d7f" strokeWidth={2.2 * u} data-hit={`${kind}:${i}`} className={s.handle} />);
          })()}

        {/* the shape being drawn and its live measurement */}
        {draft.length > 0 && (
          <g pointerEvents="none">
            {draft.length > 1 && <polyline points={draft.join(" ")} fill="none" stroke={tool === "lot" ? "#ffb020" : tool === "utility" ? UTILITIES[ed.utilityType].color : "#ff3d7f"} strokeWidth={2.5 * u} />}
            {draft.map((q, i) => (
              <circle key={i} cx={q[0]} cy={q[1]} r={(i === 0 ? 6 : 4) * u} fill={i === 0 ? "#fff" : "#ff3d7f"} stroke="#ff3d7f" strokeWidth={2 * u} />
            ))}
            {preview && (() => {
              const l = draft[draft.length - 1];
              const dx = preview[0] - l[0];
              const dy = preview[1] - l[1];
              const st = { fill: "none", stroke: "#ff3d7f", strokeWidth: 2 * u, strokeDasharray: `${5 * u} ${4 * u}` };
              let shape: React.ReactNode;
              let text: string;
              if (tool === "rect") {
                shape = <rect x={Math.min(l[0], preview[0])} y={Math.min(l[1], preview[1])} width={Math.abs(dx)} height={Math.abs(dy)} {...st} />;
                text = `${Math.abs(dx).toFixed(1)} x ${Math.abs(dy).toFixed(1)} ft`;
              } else if (tool === "circle") {
                shape = <circle cx={l[0]} cy={l[1]} r={Math.hypot(dx, dy)} {...st} />;
                text = `${Math.hypot(dx, dy).toFixed(1)} ft radius`;
              } else {
                shape = <path d={`M${l[0]} ${l[1]}L${preview[0]} ${preview[1]}`} {...st} />;
                const deg = Math.round(((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360) % 360;
                text = tool === "camera" ? "facing" : `${Math.hypot(dx, dy).toFixed(1)} ft · ${deg}°`;
              }
              return (
                <>
                  {shape}
                  {label(preview[0] + 12 * u, preview[1] - 10 * u, text, "#fff", 12)}
                </>
              );
            })()}
          </g>
        )}
      </svg>

      <div className={s.overlay}>
        <span className={s.tag}>{job.sample ? "Sample lot" : job.site.imagery ? `${job.site.imagery.provider}` : "No imagery"}{ed.colorAerial ? "" : " · Gray means untouched"}</span>
        <div className={s.zoom}>
          <button className={s.zbtn} onClick={() => zoomAt(1.4)} aria-label="Zoom in" disabled={view.w <= 12.5}>+</button>
          <button className={s.zbtn} onClick={() => zoomAt(1 / 1.4)} aria-label="Zoom out">−</button>
          <button className={`${s.zbtn} ${s.fit}`} onClick={() => ed.set({ view: { ...ext } })} aria-label="Fit the lot">Fit</button>
          <button className={`${s.zbtn} ${s.fit}`} onClick={() => setColor(!ed.colorAerial)} aria-pressed={ed.colorAerial} aria-label={ed.colorAerial ? "Show the aerial in gray" : "Show the aerial in color"} title={ed.colorAerial ? "Gray" : "Color"}>
            {ed.colorAerial ? "Gray" : "Color"}
          </button>
        </div>
        <ScaleBar u={u} />
      </div>
    </div>
  );
}

function ScaleBar({ u }: { u: number }) {
  const choices = [5, 10, 20, 25, 50, 100, 200];
  const ft = choices.find((c) => c / u >= 70) ?? 200;
  return (
    <div className={s.scale} aria-label={`Scale bar, ${ft} feet`}>
      <span className={s.north}>N ↑</span>
      <span>
        <span className={s.bar} style={{ width: ft / u }} />
        <span className={s.barLabel}>{ft} ft</span>
      </span>
    </div>
  );
}

export function isMultiTool(t: Tool) {
  return MULTI.includes(t);
}

