import type { Area, Pt } from "./types";

/** Shoelace area of a closed polygon. */
export function polygonArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

export function perimeter(p: Pt[], closed = true): number {
  let d = 0;
  const n = closed ? p.length : p.length - 1;
  for (let i = 0; i < n; i++) d += dist(p[i], p[(i + 1) % p.length]);
  return d;
}

export const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function centroid(p: Pt[]): Pt {
  return [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
}

export function pointInPolygon(q: Pt, p: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i];
    const [xj, yj] = p[j];
    if (yi > q[1] !== yj > q[1] && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export function segmentDistance(q: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l)) : 0;
  return Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy);
}

/** Distance from a point to a polygon. Zero when inside. */
export function polygonDistance(q: Pt, p: Pt[]): number {
  if (pointInPolygon(q, p)) return 0;
  return Math.min(...p.map((a, i) => segmentDistance(q, a, p[(i + 1) % p.length])));
}

export function polylineDistance(q: Pt, line: Pt[]): number {
  let d = Infinity;
  for (let i = 1; i < line.length; i++) d = Math.min(d, segmentDistance(q, line[i - 1], line[i]));
  return d;
}

/** True when any part of the polyline comes within `r` feet of the polygon. */
export function polylineNearPolygon(line: Pt[], poly: Pt[], r: number): boolean {
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const n = Math.max(2, Math.ceil(dist(a, b) / 0.5));
    for (let k = 0; k <= n; k++) {
      const q: Pt = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
      if (polygonDistance(q, poly) <= r) return true;
    }
  }
  return false;
}

/* ---------- areas ---------- */

export const tracedSqft = (a: Area) => polygonArea(a.pts);
export const areaSqft = (a: Area) => (a.manualSqft > 0 ? a.manualSqft : tracedSqft(a));

/** Scale factor applied to lengths when a typed measurement overrides the trace. */
export function measureFactor(a: Area): number {
  const t = tracedSqft(a);
  return t > 0 ? Math.sqrt(areaSqft(a) / t) : 1;
}

export const areaPerimeter = (a: Area) => perimeter(a.pts) * measureFactor(a);
export const edgeOn = (a: Area, i: number) => a.edges[i] !== false;
export const edgeLength = (a: Area, i: number) => dist(a.pts[i], a.pts[(i + 1) % a.pts.length]) * measureFactor(a);
export function borderedLength(a: Area): number {
  return a.pts.reduce((s, _, i) => s + (edgeOn(a, i) ? edgeLength(a, i) : 0), 0);
}

/* ---------- snapping ---------- */

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Snap the next point of a line being drawn so the new segment lands on the
 * nearest allowed angle, measured both from the plan axes and from the
 * previous segment (so square corners work on a building that sits at a tilt).
 */
export function snapNext(pts: Pt[], q: Pt, stepDeg: number): Pt {
  if (!stepDeg || !pts.length) return q;
  const l = pts[pts.length - 1];
  const len = dist(l, q);
  if (len < 0.01) return q;
  const ang = Math.atan2(q[1] - l[1], q[0] - l[0]);
  const base = pts.length > 1 ? Math.atan2(l[1] - pts[pts.length - 2][1], l[0] - pts[pts.length - 2][0]) : 0;
  const step = (stepDeg * Math.PI) / 180;
  let best = ang;
  let bd = Infinity;
  for (const b of [0, base])
    for (let k = -24; k <= 24; k++) {
      const c = b + k * step;
      const df = Math.abs(wrap(ang - c));
      if (df < bd) {
        bd = df;
        best = c;
      }
    }
  const d = len * Math.cos(bd);
  return [l[0] + d * Math.cos(best), l[1] + d * Math.sin(best)];
}

/**
 * Snap a dragged corner. Each neighboring edge locks to an allowed angle when
 * it comes within `tolDeg`; when both lock, the corner lands where they cross.
 */
export function snapCorner(pts: Pt[], i: number, q: Pt, stepDeg: number, open = false, tolDeg = 7): Pt {
  const n = pts.length;
  if (!stepDeg || n < (open ? 2 : 3)) return q;
  const step = (stepDeg * Math.PI) / 180;
  const tol = (tolDeg * Math.PI) / 180;
  const locks: { A: Pt; c: number }[] = [];
  const neighbors: [number, number][] = [];
  if (!open || i > 0) neighbors.push([(i + n - 1) % n, (i + n - 2) % n]);
  if (!open || i < n - 1) neighbors.push([(i + 1) % n, (i + 2) % n]);
  for (const [j, jj] of neighbors) {
    const A = pts[j];
    const F = pts[jj];
    const ang = Math.atan2(q[1] - A[1], q[0] - A[0]);
    const bases = [0];
    if (jj !== i && !(open && (jj < 0 || jj >= n))) bases.push(Math.atan2(A[1] - F[1], A[0] - F[0]));
    let best: number | null = null;
    let bd = tol;
    for (const b of bases)
      for (let k = -24; k <= 24; k++) {
        const c = b + k * step;
        const df = Math.abs(wrap(ang - c));
        if (df < bd) {
          bd = df;
          best = c;
        }
      }
    if (best !== null) locks.push({ A, c: best });
  }
  const project = ({ A, c }: { A: Pt; c: number }): Pt => {
    const d = (q[0] - A[0]) * Math.cos(c) + (q[1] - A[1]) * Math.sin(c);
    return [A[0] + d * Math.cos(c), A[1] + d * Math.sin(c)];
  };
  if (locks.length === 2) {
    const [u, v] = locks;
    const den = Math.sin(v.c - u.c);
    if (Math.abs(den) > 0.05) {
      const t = ((v.A[0] - u.A[0]) * Math.sin(v.c) - (v.A[1] - u.A[1]) * Math.cos(v.c)) / den;
      return [u.A[0] + t * Math.cos(u.c), u.A[1] + t * Math.sin(u.c)];
    }
    return project(u);
  }
  if (locks.length === 1) return project(locks[0]);
  return q;
}

/** Point reached by a line of `len` feet at `deg` degrees, as a turn from the last segment or from east. */
export function pointByAngle(pts: Pt[], len: number, deg: number, from: "right" | "left" | "horizontal"): Pt {
  const l = pts[pts.length - 1];
  const base = pts.length > 1 ? Math.atan2(l[1] - pts[pts.length - 2][1], l[0] - pts[pts.length - 2][0]) : 0;
  const r = (deg * Math.PI) / 180;
  const f = pts.length > 1 ? from : "horizontal";
  const dir = f === "horizontal" ? -r : f === "left" ? base - r : base + r;
  return [l[0] + len * Math.cos(dir), l[1] + len * Math.sin(dir)];
}

export const rectangle = (a: Pt, b: Pt): Pt[] => [
  [a[0], a[1]],
  [b[0], a[1]],
  [b[0], b[1]],
  [a[0], b[1]],
];

export const circle = (c: Pt, r: number, n = 24): Pt[] =>
  Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos((i * 2 * Math.PI) / n), c[1] + r * Math.sin((i * 2 * Math.PI) / n)] as Pt);

export const round1 = (p: Pt): Pt => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
