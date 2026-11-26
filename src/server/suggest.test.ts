import { describe, expect, it } from "vitest";
import { keepHouseNumber, tidySuggestion } from "./suggest";

describe("tidySuggestion", () => {
  it("matches the address format the rest of the app uses", () => {
    expect(tidySuggestion("211 W Aspen Ave, Flagstaff, AZ, 86001, USA")).toBe("211 W Aspen Ave, Flagstaff, AZ 86001");
    expect(tidySuggestion("11600 N Onika Ln, Flagstaff, AZ, 86004-1234, USA")).toBe("11600 N Onika Ln, Flagstaff, AZ 86004-1234");
  });

  it("leaves text without a state and ZIP alone", () => {
    expect(tidySuggestion("Aspen Ave, Flagstaff, AZ, USA")).toBe("Aspen Ave, Flagstaff, AZ");
  });
});

describe("keepHouseNumber", () => {
  it("puts the typed house number back on a street only suggestion", () => {
    expect(keepHouseNumber("4663 E Inwood", "E Inwood Way, Flagstaff, AZ 86004")).toBe("4663 E Inwood Way, Flagstaff, AZ 86004");
  });
  it("leaves full addresses and number free typing alone", () => {
    expect(keepHouseNumber("4663 E Inwood", "4663 E Inwood Way, Flagstaff, AZ 86004")).toBe("4663 E Inwood Way, Flagstaff, AZ 86004");
    expect(keepHouseNumber("Inwood", "E Inwood Way, Flagstaff, AZ 86004")).toBe("E Inwood Way, Flagstaff, AZ 86004");
  });
});
