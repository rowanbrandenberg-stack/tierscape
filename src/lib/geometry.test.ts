import { describe, expect, it } from "vitest";
import { polygonArea, perimeter, pointInPolygon, snapNext, snapCorner, pointByAngle, polylineNearPolygon, rectangle } from "./geometry";
import type { Pt } from "./types";

const sq: Pt[] = rectangle([0, 0], [10, 20]);

describe("geometry", () => {
  it("measures a rectangle", () => {
    expect(polygonArea(sq)).toBe(200);
    expect(perimeter(sq)).toBe(60);
  });
  it("tests points inside", () => {
    expect(pointInPolygon([5, 5], sq)).toBe(true);
    expect(pointInPolygon([15, 5], sq)).toBe(false);
  });
  it("snaps a near horizontal line flat at 90 degrees", () => {
    const q = snapNext([[0, 0]], [10, 0.8], 90);
    expect(q[1]).toBeCloseTo(0, 6);
    expect(q[0]).toBeGreaterThan(9.9);
  });
  it("squares a corner off a tilted wall", () => {
    const tilt = 0.3;
    const pts: Pt[] = [[0, 0], [10 * Math.cos(tilt), 10 * Math.sin(tilt)]];
    const q = snapNext(pts, [pts[1][0] - 2.2, pts[1][1] + 7.7], 90);
    const a1 = Math.atan2(pts[1][1], pts[1][0]);
    const a2 = Math.atan2(q[1] - pts[1][1], q[0] - pts[1][0]);
    expect(Math.abs(Math.cos(a2 - a1))).toBeLessThan(1e-9);
  });
  it("lands a dragged corner where both square edges cross", () => {
    const pts: Pt[] = [[0, 0], [20, 0], [21, 11], [0, 10]];
    const q = snapCorner(pts, 2, [20.6, 10.4], 90);
    expect(q[0]).toBeCloseTo(20, 6);
    expect(q[1]).toBeCloseTo(10, 6);
  });
  it("adds a point from length and right turn", () => {
    const q = pointByAngle([[0, 0], [10, 0]], 5, 90, "right");
    expect(q[0]).toBeCloseTo(10, 6);
    expect(q[1]).toBeCloseTo(5, 6);
  });
  it("finds a line near a polygon", () => {
    expect(polylineNearPolygon([[-5, 21.5], [15, 21.5]], sq, 2)).toBe(true);
    expect(polylineNearPolygon([[-5, 23], [15, 23]], sq, 2)).toBe(false);
  });
});
