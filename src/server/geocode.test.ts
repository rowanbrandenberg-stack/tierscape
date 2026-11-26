import { afterEach, describe, expect, it, vi } from "vitest";
import { geocode, normalizeAddress, streetNameFrom, tidyAddress } from "./geocode";

describe("tidyAddress", () => {
  it("formats a Census match for people", () => {
    expect(tidyAddress("211 W ASPEN AVE, FLAGSTAFF, AZ, 86001")).toBe("211 W Aspen Ave, Flagstaff, AZ 86001");
    expect(tidyAddress("400 E MAIN ST, SPRINGFIELD, IL, 62701")).toBe("400 E Main St, Springfield, IL 62701");
  });
});

describe("normalizeAddress and streetNameFrom", () => {
  it("spells directions and suffixes the short way", () => {
    expect(normalizeAddress("4663 East Inwood Way, Flagstaff, AZ")).toBe("4663 E INWOOD WAY, FLAGSTAFF, AZ");
    expect(normalizeAddress("12 North Fort Valley Road")).toBe("12 N FORT VALLEY RD");
  });
  it("pulls the bare street name for parcel matching", () => {
    expect(streetNameFrom("4663 East Inwood Way, Flagstaff, AZ")).toBe("INWOOD");
    expect(streetNameFrom("12 N Fort Valley Rd")).toBe("FORT VALLEY");
    expect(streetNameFrom("211 W Aspen Ave")).toBe("ASPEN");
  });
});

type Route = (url: URL) => unknown;
function mockFetch(route: Route) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: string) => {
    const u = new URL(input);
    calls.push(u.host + u.pathname);
    const body = route(u);
    if (body instanceof Error) throw body;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return calls;
}
const census = { result: { addressMatches: [] } };
const coco = { result: { geographies: { Counties: [{ BASENAME: "Coconino", GEOID: "04005" }] } } };

afterEach(() => vi.unstubAllGlobals());

describe("geocode fallbacks", () => {
  it("falls back to Esri rooftop when Census has no match, then gets the county", async () => {
    const calls = mockFetch((u) => {
      if (u.pathname.endsWith("/onelineaddress")) return census;
      if (u.pathname.endsWith("/coordinates")) return coco;
      if (u.pathname.endsWith("/findAddressCandidates"))
        return { candidates: [{ address: "4663 E Inwood Way, Flagstaff, Arizona, 86004", score: 100, location: { x: -111.53, y: 35.25 }, attributes: { Addr_type: "PointAddress", RegionAbbr: "AZ" } }] };
      throw new Error("unexpected " + u);
    });
    const g = await geocode("4663 East Inwood Way, Flagstaff, AZ");
    expect(g.source).toBe("esri");
    expect(g.county).toBe("Coconino");
    expect(g.countyFips).toBe("04005");
    expect(g.houseNumber).toBe("4663");
    expect(g.street).toBe("INWOOD");
    expect(calls.filter((c) => c.endsWith("/onelineaddress"))).toHaveLength(2);
  });

  it("ignores Esri street level hits and uses OpenStreetMap", async () => {
    mockFetch((u) => {
      if (u.pathname.endsWith("/onelineaddress")) return census;
      if (u.pathname.endsWith("/coordinates")) return coco;
      if (u.pathname.endsWith("/findAddressCandidates"))
        return { candidates: [{ address: "E Inwood Way, Flagstaff", score: 95, location: { x: 0, y: 0 }, attributes: { Addr_type: "StreetName" } }] };
      if (u.host.includes("nominatim"))
        return [{ lat: "35.25", lon: "-111.53", display_name: "x", address: { house_number: "4663", road: "East Inwood Way", city: "Flagstaff", "ISO3166-2-lvl4": "US-AZ", postcode: "86004" } }];
      throw new Error("unexpected " + u);
    });
    const g = await geocode("4663 East Inwood Way, Flagstaff, AZ");
    expect(g.source).toBe("osm");
    expect(g.matchedAddress).toBe("4663 East Inwood Way, Flagstaff, AZ 86004");
    expect(g.county).toBe("Coconino");
  });

  it("keeps the Census result when it matches", async () => {
    const calls = mockFetch(() => ({
      result: { addressMatches: [{ matchedAddress: "211 W ASPEN AVE, FLAGSTAFF, AZ, 86001", coordinates: { x: -111.65, y: 35.2 }, addressComponents: { state: "AZ", streetName: "ASPEN" }, geographies: { Counties: [{ BASENAME: "Coconino", GEOID: "04005" }] } }] },
    }));
    const g = await geocode("211 W Aspen Ave, Flagstaff, AZ");
    expect(g.source).toBe("census");
    expect(calls).toHaveLength(1);
  });

  it("says no match when every provider answers empty", async () => {
    mockFetch((u) => (u.host.includes("nominatim") ? [] : u.pathname.endsWith("/findAddressCandidates") ? { candidates: [] } : census));
    await expect(geocode("1 Nowhere Rd, Flagstaff, AZ")).rejects.toMatchObject({ status: 404 });
  });

  it("asks for the house number when it is missing", async () => {
    await expect(geocode("E Inwood Way, Flagstaff, AZ 86004")).rejects.toMatchObject({ status: 400 });
  });

  it("says the lookup is down when every provider errors", async () => {
    mockFetch(() => new Error("offline"));
    await expect(geocode("1 Nowhere Rd, Flagstaff, AZ")).rejects.toMatchObject({ status: 502 });
  });
});
