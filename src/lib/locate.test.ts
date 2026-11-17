import { describe, expect, it } from "vitest";
import { addWorkingDays, isoDay, rulesFor, ticketDates, utilitiesNearArea, buildLocateRequest, beforeYouDig } from "./locate";
import { sampleJob } from "./jobs";
import { defaultSettings } from "./settings";

describe("811", () => {
  it("skips weekends", () => {
    expect(isoDay(addWorkingDays("2026-11-13", 2))).toBe("2026-11-17"); // Friday plus 2 working days
  });
  it("knows Arizona", () => {
    const r = rulesFor("az")!;
    const d = ticketDates(r, "2026-11-16");
    expect(isoDay(d.clear)).toBe("2026-11-18");
    expect(isoDay(d.expires)).toBe("2026-12-09");
  });
  it("flags a gas line across the patio", () => {
    const job = sampleJob();
    job.utilities = [{ id: "u1", type: "gas", pts: [[30, 30], [100, 30]] }];
    expect(utilitiesNearArea(job, job.areas[0])).toEqual(["gas"]);
    expect(beforeYouDig(job).some((s) => s.includes("Gas line runs within 2 ft of the patio"))).toBe(true);
  });
  it("needs a real location to build a request", () => {
    const job = sampleJob();
    const ex = { company: "x", phone: "", email: "", license: "" };
    expect(buildLocateRequest(job, ex, null)).toBeNull();
    job.site.origin = { lat: 35.2, lon: -111.65 };
    const r = buildLocateRequest(job, ex, "2026-11-20")!;
    expect(r.digArea.features).toHaveLength(3);
    expect(r.digArea.features[0].geometry.coordinates[0][0][1]).toBeCloseTo(35.2, 2);
  });
  void defaultSettings;
});

describe("likely utilities in Before you dig", () => {
  it("never counts likely lines as marked, and lists private lines", () => {
    const job = sampleJob();
    job.likely = [{ id: "l1", type: "gas", pts: [[0, 0], [20, 0]], label: "Probable gas service", source: "aerial" }];
    job.privateLines = { sprinklers: "yes", septic: "no" };
    const list = beforeYouDig(job);
    expect(list.some((x) => x.startsWith("Likely but not located: gas line"))).toBe(true);
    expect(list.some((x) => x.includes("sprinkler or drip lines") && !x.includes("septic"))).toBe(true);
    expect(utilitiesNearArea(job, { ...job.areas[0], pts: [[0, -1], [5, -1], [5, 1], [0, 1]] })).toEqual([]);
  });
});
