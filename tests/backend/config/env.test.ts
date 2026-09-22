import { afterEach, describe, expect, it, vi } from "vitest";

const originalMode = process.env.ASSET_PLANNING_GENERATION_MODE;
const originalSheet = process.env.ASSET_CHARACTER_SHEET_ENABLED;

afterEach(() => {
  vi.resetModules();
  if (originalMode === undefined) delete process.env.ASSET_PLANNING_GENERATION_MODE;
  else process.env.ASSET_PLANNING_GENERATION_MODE = originalMode;
  if (originalSheet === undefined) delete process.env.ASSET_CHARACTER_SHEET_ENABLED;
  else process.env.ASSET_CHARACTER_SHEET_ENABLED = originalSheet;
});

describe("asset planning generation mode env", () => {
  it("defaults to intent compiler after the live gate passes", async () => {
    delete process.env.ASSET_PLANNING_GENERATION_MODE;
    const module = await import("../../../backend/src/config/env.js");
    expect(module.env.assetPlanningGenerationMode).toBe("intent_compiler");
  });

  it("keeps explicit legacy rollback and intent compiler selection available", async () => {
    process.env.ASSET_PLANNING_GENERATION_MODE = "legacy";
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

describe("character sheet switch env", () => {
  it("defaults to enabled after the live check gate and default model switch (2026-09-22)", async () => {
    delete process.env.ASSET_CHARACTER_SHEET_ENABLED;
    const module = await import("../../../backend/src/config/env.js");
    expect(module.env.assetPlanningCharacterSheet).toEqual({ enabled: true, minSegmentHits: 3 });
  });

  it("keeps explicit opt-out (rollback to text-anchor-only) available", async () => {
    process.env.ASSET_CHARACTER_SHEET_ENABLED = "false";
    const module = await import("../../../backend/src/config/env.js");
    expect(module.env.assetPlanningCharacterSheet.enabled).toBe(false);
  });

  it("rejects an unknown boolean instead of silently treating it as off", async () => {
    process.env.ASSET_CHARACTER_SHEET_ENABLED = "on";
    await expect(import("../../../backend/src/config/env.js")).rejects.toThrow(
      "ASSET_CHARACTER_SHEET_ENABLED",
    );
  });
});
