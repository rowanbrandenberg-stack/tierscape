import { COLORS, SIZES, type Fill } from "@/lib/catalog";
import type { PaverSpec } from "@/lib/types";

/**
 * SVG pattern markup for each surface, drawn to real scale. `k` is plan units
 * per inch (the plan is in feet, so k = 1/12).
 */
const n = (v: number) => v.toFixed(3);

export function paverPattern(id: string, pv: PaverSpec, k: number): string {
  const Z = SIZES[pv.size];
  const c = COLORS[pv.color].hex;
  const W = Z.w;
  const H = Z.h;
  const R = (x: number, y: number, w: number, h: number) => `<rect x="${n(x * k)}" y="${n(y * k)}" width="${n(w * k)}" height="${n(h * k)}"/>`;
  let tw: number;
  let th: number;
  let b = "";
  if (pv.layout === "ashlar") {
    tw = th = 18;
    b = R(0, 0, 12, 12) + R(12, 0, 6, 12) + R(0, 12, 6, 6) + R(6, 12, 12, 6);
  } else if (pv.layout === "herring") {
    tw = th = 4 * H;
    for (let i = -1; i < 5; i++) for (const m of [-4, 0, 4]) b += R((i + m) * H, i * H, 2 * H, H) + R((i + 2 + m) * H, (i - 1) * H, H, 2 * H);
  } else if (pv.layout === "basket") {
    tw = th = 2 * W;
    b = R(0, 0, W, H) + R(0, H, W, H) + R(W, 0, H, W) + R(W + H, 0, H, W) + R(0, W, H, W) + R(H, W, H, W) + R(W, W, W, H) + R(W, W + H, W, H);
  } else if (pv.layout === "stack") {
    tw = W;
    th = H;
    b = R(0, 0, W, H);
  } else {
    tw = W;
    th = 2 * H;
    b = R(0, 0, W, H) + R(-W / 2, H, W, H) + R(W / 2, H, W, H);
  }
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${n(tw * k)}" height="${n(th * k)}"><rect width="${n(tw * k)}" height="${n(th * k)}" fill="${c}"/><g fill="${c}" stroke="rgba(0,0,0,.42)" stroke-width="${n(k * 0.5)}">${b}</g></pattern>`;
}

const dots = (id: string, bg: string, fg: string, u: number) =>
  `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${n(u)}" height="${n(u)}"><rect width="${n(u)}" height="${n(u)}" fill="${bg}"/><circle cx="${n(u * 0.25)}" cy="${n(u * 0.3)}" r="${n(u * 0.09)}" fill="${fg}"/><circle cx="${n(u * 0.72)}" cy="${n(u * 0.75)}" r="${n(u * 0.07)}" fill="${fg}"/></pattern>`;

/** `ft` = plan units per foot. */
export function fillPattern(id: string, fill: Fill, pv: PaverSpec, ft: number): string {
  const k = ft / 12;
  switch (fill) {
    case "paver":
      return paverPattern(id, pv, k);
    case "dg":
      return dots(id, "#d3ba90", "#b3966a", ft * 0.6);
    case "flag":
      return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${n(ft * 5)}" height="${n(ft * 5)}"><rect width="${n(ft * 5)}" height="${n(ft * 5)}" fill="#7d6750"/><g transform="scale(${n((ft * 5) / 24)})"><path d="M.5 .5H12L10.5 10L.5 11.5Z" fill="#d9b68c"/><path d="M13.5 .5H23.5V8.5L12 10Z" fill="#c99f77"/><path d="M.5 13L10 11.5L12.5 23.5H.5Z" fill="#e2c49e"/><path d="M11.5 11.5L23.5 10V23.5H14Z" fill="#c2956c"/></g></pattern>`;
    case "seed":
      return dots(id, "#9cb46a", "#b9c98a", ft * 0.8);
    case "sod":
      return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${n(ft * 4)}" height="${n(ft * 4)}"><rect width="${n(ft * 4)}" height="${n(ft * 4)}" fill="#5d9947"/><rect width="${n(ft * 2)}" height="${n(ft * 4)}" fill="#6fa955"/></pattern>`;
    case "cinder":
      return dots(id, "#8a3d2c", "#a85441", ft * 0.6);
    default:
      return dots(id, "#6a4a34", "#86634a", ft * 0.6);
  }
}
