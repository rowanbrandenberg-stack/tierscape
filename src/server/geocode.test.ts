import { describe, expect, it } from "vitest";
import { tidyAddress } from "./geocode";

describe("tidyAddress", () => {
  it("formats a Census match for people", () => {
    expect(tidyAddress("211 W ASPEN AVE, FLAGSTAFF, AZ, 86001")).toBe("211 W Aspen Ave, Flagstaff, AZ 86001");
    expect(tidyAddress("400 E MAIN ST, SPRINGFIELD, IL, 62701")).toBe("400 E Main St, Springfield, IL 62701");
  });
});
