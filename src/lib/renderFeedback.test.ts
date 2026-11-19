import { describe, expect, it } from "vitest";
import { revisePrompt } from "./renderFeedback";

describe("render reroll", () => {
  it("adds picked problems and free text as corrections, and keeps earlier ones", () => {
    const r1 = revisePrompt("BASE", ["big"], "Move the maple closer to the patio", "photo");
    expect(r1.prompt.startsWith("BASE")).toBe(true);
    expect(r1.notes).toHaveLength(2);
    const r2 = revisePrompt("BASE", ["big", "house"], "", "render", r1.notes);
    expect(r2.notes).toHaveLength(3);
    expect(r2.prompt).toContain("previous attempt");
    expect(r2.prompt).toContain("Move the maple closer to the patio");
  });
});
