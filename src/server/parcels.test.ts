import { describe, expect, it } from "vitest";
import { isUsable, pickParcel, ringAcres } from "./parcels";

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

describe("parcel guards", () => {
  const square = (lon: number, lat: number, sideM: number) => {
    const dLat = sideM / 110_540;
    const dLon = sideM / (111_320 * Math.cos((lat * Math.PI) / 180));
    return [{ lat, lon }, { lat, lon: lon + dLon }, { lat: lat + dLat, lon: lon + dLon }, { lat: lat + dLat, lon }];
  };
  it("measures acres", () => {
    expect(ringAcres(square(-111.54, 35.28, 100))).toBeCloseTo(2.471, 2);
  });
  it("rejects ranch sized parcels and placeholder APNs", () => {
    expect(isUsable({ apn: "30131018", ring: square(-111.54, 35.28, 100) })).toBe(true);
    expect(isUsable({ apn: "30131002", ring: square(-111.54, 35.28, 700) })).toBe(false);
    expect(isUsable({ apn: "90099999", ring: square(-111.54, 35.28, 30) })).toBe(false);
  });
});
