import { describe, expect, it } from "vitest";
import { pickParcel } from "./parcels";

const sq = (lat: number, lon: number) => [0, 1, 2, 3].map((i) => ({ lat: lat + (i > 1 ? 0.0002 : 0), lon: lon + (i % 3 ? 0.0002 : 0) }));

describe("pickParcel", () => {
  const cands = [
    { apn: "A", address: "175 W ASPEN AVE", ring: sq(35.1985, -111.6505), source: "t" },
    { apn: "B", address: "211 W ASPEN AVE", ring: sq(35.1987, -111.6518), source: "t" },
  ];
  it("matches the house number and street", () => {
    expect(pickParcel(cands, { lat: 35.1991, lon: -111.6510, houseNumber: "211", street: "ASPEN" }).apn).toBe("B");
  });
  it("falls back to the nearest", () => {
    expect(pickParcel(cands, { lat: 35.1985, lon: -111.6504, houseNumber: null, street: null }).apn).toBe("A");
  });
});
