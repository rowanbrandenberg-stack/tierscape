import { describe, expect, it } from "vitest";
import { toGeo, toPlan, tilesForExtent } from "./projection";

describe("projection", () => {
  const o = { lat: 35.199161, lon: -111.651075 };
  it("round trips", () => {
    const g = toGeo(o, [120, -80]);
    const q = toPlan(o, g);
    expect(q[0]).toBeCloseTo(120, 6);
    expect(q[1]).toBeCloseTo(-80, 6);
  });
  it("puts north up", () => {
    expect(toPlan(o, { lat: o.lat + 0.001, lon: o.lon })[1]).toBeLessThan(0);
  });
  it("covers the extent with tiles", () => {
    const t = tilesForExtent(o, { x: -100, y: -70, w: 200, h: 140 }, 19);
    expect(t.length).toBeGreaterThan(1);
    expect(Math.min(...t.map((x) => x.px))).toBeLessThanOrEqual(-100);
  });
});
