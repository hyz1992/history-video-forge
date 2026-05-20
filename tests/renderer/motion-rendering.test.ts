import { describe, expect, it } from "vitest";

import { makeMotionTransform } from "../../renderer/src/motion-rendering";

describe("motion rendering", () => {
  it("keeps hold clips still", () => {
    expect(
      makeMotionTransform({
        recipeType: "hold",
        progress: 0.5,
        parameters: {},
      }),
    ).toBe("scale(1) translate3d(0%, 0%, 0)");
  });

  it("applies slow push-in", () => {
    expect(
      makeMotionTransform({
        recipeType: "slow_push_in",
        progress: 1,
        parameters: {},
      }),
    ).toBe("scale(1.06) translate3d(0%, 0%, 0)");
  });

  it("applies pan directions", () => {
    expect(
      makeMotionTransform({
        recipeType: "pan_left",
        progress: 1,
        parameters: { distance_pct: 4 },
      }),
    ).toBe("scale(1.04) translate3d(-4%, 0%, 0)");
    expect(
      makeMotionTransform({
        recipeType: "pan_up",
        progress: 1,
        parameters: { distance_pct: 3 },
      }),
    ).toBe("scale(1.04) translate3d(0%, -3%, 0)");
  });
});
