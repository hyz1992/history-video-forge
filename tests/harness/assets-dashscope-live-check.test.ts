import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildAssetsDashscopeLiveCheckPlan,
  runAssetsDashscopeLiveCheck,
} from "../../harness/scripts/runtime/assets-dashscope-live-check";

describe("assets dashscope live check", () => {
  it("keeps DashScope assets live check explicit and outside automated gates", () => {
    const plan = buildAssetsDashscopeLiveCheckPlan({
      outputDir: "harness/scripts/runtime/output/assets-dashscope-live-check",
    });

    expect(plan).toMatchObject({
      mode: "assets_dashscope_live_check",
      automated_gate: false,
      requires_real_env: true,
      provider_mode: "dashscope",
      output_dir: "harness/scripts/runtime/output/assets-dashscope-live-check",
    });
    expect(plan.required_env_keys).toEqual(
      expect.arrayContaining([
        "ALIYUN_DASHSCOPE_API_KEY",
        "ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL",
        "ALIYUN_DASHSCOPE_TTS_MODEL",
      ]),
    );
    expect(plan.required_env_keys).not.toContain("ALIYUN_DASHSCOPE_MODEL");
    expect(plan.required_env_keys).not.toContain("TTS_MODEL");
    expect(plan.required_artifacts).toEqual(
      expect.arrayContaining([
        "live-check-plan.json",
        "live-check-summary.json",
        "trace.md",
      ]),
    );
    expect(plan.required_checks).toEqual(
      expect.arrayContaining([
        expect.stringContaining("不输出 API key"),
        expect.stringContaining("显式运行"),
      ]),
    );
  });

  it("writes a redacted summary with provider evidence", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-assets-dashscope-live-check-"));

    const result = await runAssetsDashscopeLiveCheck(
      { outputDir },
      {
        requireRealEnv: false,
        env: {
          ALIYUN_DASHSCOPE_API_KEY: "test-secret-key",
          ALIYUN_DASHSCOPE_BASE_URL: "https://dashscope.test",
          ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL: "wan2.6-t2i",
          ALIYUN_DASHSCOPE_TTS_MODEL: "qwen3-tts-instruct-flash",
        },
        sampleRunner: async () => ({
          statusCode: 200,
          localValidationDecision: "ready_for_compose",
          providerNames: ["dashscope_tts", "dashscope_image"],
          artifactTypes: ["tts_chunk_audio", "tts_merged_audio", "subtitle_track", "image"],
          localValidationErrors: [],
          localValidationWarnings: ["optional bgm not configured"],
          outputDir: join(outputDir, "sample"),
          manifestRecordId: "asset_manifest_001",
          assetRunTracePhase: "assets",
        }),
      },
    );

    expect(result).toMatchObject({
      mode: "assets_dashscope_live_check",
      automated_gate: false,
      status: "live-check-completed",
      provider_names: ["dashscope_tts", "dashscope_image"],
      artifact_types: ["tts_chunk_audio", "tts_merged_audio", "subtitle_track", "image"],
      local_validation_decision: "ready_for_compose",
      local_validation_errors: [],
      local_validation_warnings: ["optional bgm not configured"],
    });
    expect(existsSync(join(outputDir, "live-check-plan.json"))).toBe(true);
    expect(existsSync(join(outputDir, "live-check-summary.json"))).toBe(true);
    expect(existsSync(join(outputDir, "trace.md"))).toBe(true);

    const summaryText = readFileSync(join(outputDir, "live-check-summary.json"), "utf8");
    const traceText = readFileSync(join(outputDir, "trace.md"), "utf8");
    expect(summaryText).toContain("dashscope_tts");
    expect(summaryText).toContain("dashscope_image");
    expect(summaryText).not.toContain("test-secret-key");
    expect(traceText).not.toContain("test-secret-key");
  });
});
