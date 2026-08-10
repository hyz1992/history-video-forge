import { afterEach, describe, expect, it, vi } from "vitest";

const originalMode = process.env.ASSET_PLANNING_GENERATION_MODE;

afterEach(() => {
  vi.resetModules();
  if (originalMode === undefined) delete process.env.ASSET_PLANNING_GENERATION_MODE;
  else process.env.ASSET_PLANNING_GENERATION_MODE = originalMode;
});

describe("asset planning generation mode env", () => {
  it("defaults to legacy and accepts the two production modes", async () => {
    delete process.env.ASSET_PLANNING_GENERATION_MODE;
    let module = await import("../../../backend/src/config/env.js");
    expect(module.env.assetPlanningGenerationMode).toBe("legacy");

    vi.resetModules();
    process.env.ASSET_PLANNING_GENERATION_MODE = "intent_compiler";
    module = await import("../../../backend/src/config/env.js");
    expect(module.env.assetPlanningGenerationMode).toBe("intent_compiler");
  });

  it("rejects an unknown mode instead of silently falling back", async () => {
    process.env.ASSET_PLANNING_GENERATION_MODE = "shadow";
    await expect(import("../../../backend/src/config/env.js")).rejects.toThrow(
      "ASSET_PLANNING_GENERATION_MODE",
    );
  });
});
