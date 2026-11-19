import { describe, expect, it } from "vitest";
import { normDetect, normEstimates, normLocate, normTrace, parseJsonReply } from "./prompts";

describe("pasted answers from Claude", () => {
  it("reads JSON wrapped in chatter or a code fence", () => {
    expect(parseJsonReply<{ a: number }>('Here you go:\n```json\n{"a": 1}\n```\nLet me know!')).toEqual({ a: 1 });
    expect(parseJsonReply<number[]>("Sure! [1, 2, 3] hope that helps")).toEqual([1, 2, 3]);
  });
  it("keeps only usable values", () => {
    expect(normEstimates([{ name: "Aspen", height_ft: 25, spread_ft: 10, note: "ok" }, { name: "x", height_ft: "?" }])).toHaveLength(1);
    expect(normLocate({ x_pct: 40, y_pct: 70, facing_deg: 0 })?.xPct).toBe(40);
    expect(normLocate({ x_pct: "here" })).toBeNull();
    expect(normDetect({ clues: [{ type: "gas", x_pct: 10, y_pct: 20, label: "Gas meter" }, { type: "lava", x_pct: 1, y_pct: 1, label: "" }] }).clues).toHaveLength(1);
    expect(normTrace({ marks: [{ color: "yellow", pts: [[1, 2], [3, 4]], confidence: "high" }] }).marks[0].type).toBe("gas");
  });
});
