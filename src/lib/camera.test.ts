import { describe, expect, it } from "vitest";
import { compass, seen, renderPrompt } from "./camera";
import { sampleJob } from "./jobs";
import { defaultSettings } from "./settings";

describe("camera", () => {
  it("names directions", () => {
    expect(compass(-Math.PI / 2)).toBe("north");
    expect(compass(0)).toBe("east");
  });
  it("sees what is ahead", () => {
    const cam = { x: 0, y: 0, angle: -Math.PI / 2 };
    expect(seen(cam, [0, -30]).inView).toBe(true);
    expect(seen(cam, [0, 30]).inView).toBe(false);
    expect(seen(cam, [-8, -30]).side).toBe("left");
  });
  it("writes the camera into the render prompt", () => {
    const p = renderPrompt(sampleJob(), defaultSettings().pricing, "standard");
    expect(p).toContain("Where this photo was taken");
    expect(p).toContain("Japanese maple");
  });
});
