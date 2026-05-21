import { describe, expect, it } from "vitest";

import {
  buildProductAcceptanceLiveCheckPlan,
  parseProductAcceptanceLiveCheckCliArgs,
} from "../../harness/scripts/runtime/product-acceptance-live-check";

describe("product acceptance live-check harness", () => {
  it("parses source, BGM and explicit real provider options", () => {
    expect(
      parseProductAcceptanceLiveCheckCliArgs([
        "--source-dir",
        "harness/scripts/runtime/output/source-a",
        "--output-dir",
        "harness/scripts/runtime/output/accept-a",
        "--bgm-id",
        "bgm_hist_ancient_china_solemn_001",
        "--dashscope-image-model",
        "wan2.6-t2i",
        "--dashscope-tts-model",
        "qwen3-tts-instruct-flash",
      ]),
    ).toMatchObject({
      sourceDir: "harness/scripts/runtime/output/source-a",
      outputDir: "harness/scripts/runtime/output/accept-a",
      bgmLibraryItemId: "bgm_hist_ancient_china_solemn_001",
      dashscope: {
        imageModel: "wan2.6-t2i",
        ttsModel: "qwen3-tts-instruct-flash",
      },
    });
  });

  it("builds an explicit live-check plan with subtitle requirements", () => {
    const plan = buildProductAcceptanceLiveCheckPlan({
      outputDir: "out",
      sourceDir: "source",
    });

    expect(plan.automated_gate).toBe(false);
    expect(plan.requires_real_env).toBe(true);
    expect(plan.provider_mode).toBe("dashscope");
    expect(plan.disabled_providers).toContain("dashscope_image_to_video");
    expect(plan.disabled_task_types).toContain("sfx_cue");
    expect(plan.required_artifacts).toContain("execution-asset-plan.json");
    expect(plan.required_checks).toContain(
      "render subtitle_cue_count must be greater than 0",
    );
  });
});
