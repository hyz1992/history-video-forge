import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runNarrationFirstRuntimeSmoke, assertNoAsrAlignment } from "../../harness/scripts/runtime/narration-first-runtime-smoke.js";

describe("口播前置 fake runtime 冒烟", () => {
  it("确认文案→原生timing→确认口播→分镜→资产计划→fake图→compose→render 全链路同源且TTS恰一次", async () => {
    const result = await runNarrationFirstRuntimeSmoke();
    expect(result.passed).toBe(true);
    // TTS 只发生一次；资产重试与 legacy 流程不新增口播合成
    expect(result.narrationSynthesizeCalls).toBe(1);
    expect(result.narrationRecordId).toBeTruthy();
    expect(result.storyboardRecordId).toBeTruthy();
    expect(result.assetManifestRecordId).toBeTruthy();
    expect(result.composeRecordId).toBeTruthy();
    expect(result.renderJobRecordId).toBeTruthy();
    // ASR 零参与：字幕 timing 来源非 forced_alignment 的可失败断言（timingSource 为 schema 恒真值仅作旁证）
    expect(result.checks["asr_zero"]).toBe("subtitle_timing_not_forced_alignment");
    expect(result.checks["assets_provider"]).toBe("fake_image_only");
    expect(result.checks["narration_timing_source"]).toBe("provider_native");
    // 每镜/总长同源：2 秒整篇由段区间无缝覆盖
    expect(result.checks["narration_duration_ms"]).toBe("2000");
    expect(result.checks["manifest_narration_reference"]).toBe("matched");
    // 合成 v2 时间轴
    expect(result.checks["compose_timeline_version"]).toBe("compose_timeline_v2");
    // 字幕样式变更派生新 revision 且历史保留
    expect(result.subtitleRevisions).toHaveLength(2);
    expect(result.subtitleRevisions[0]).not.toBe(result.subtitleRevisions[1]);
    // legacy 并存
    expect(result.checks["legacy_coexistence"]).toBe("v1_plan_ok");
    expect(result.legacyStoryboardRecordId).toBeTruthy();
    const reportPath = join(result.outputDir, "narration-first-runtime-smoke.json");
    expect(existsSync(reportPath)).toBe(true);
    expect(JSON.parse(readFileSync(reportPath, "utf8")).passed).toBe(true);
  }, 120000);

  it("字幕 artifact 为 forced_alignment 时断言可失败（ASR 对齐信号）", () => {
    expect(assertNoAsrAlignment([{ artifact_type: "subtitle_track", metadata: { timing_source: "provider_timestamp" } }])).toBe(true);
    expect(assertNoAsrAlignment([{ artifact_type: "subtitle_track", metadata: { timing_source: "forced_alignment" } }])).toBe(false);
    expect(assertNoAsrAlignment([{ artifact_type: "image", metadata: { timing_source: "forced_alignment" } }])).toBe(true);
    expect(assertNoAsrAlignment(null)).toBe(true);
  });
  it("带真实供应商凭据的环境拒绝运行（fail-closed）", async () => {
    vi.stubEnv("ALIYUN_DASHSCOPE_API_KEY", "test-key");
    await expect(runNarrationFirstRuntimeSmoke()).rejects.toThrow("narration_smoke_refuses_real_dashscope_credentials");
    vi.unstubAllEnvs();
    vi.stubEnv("LLM_PROVIDER", "openai");
    await expect(runNarrationFirstRuntimeSmoke()).rejects.toThrow("narration_smoke_refuses_real_llm_credentials");
    vi.unstubAllEnvs();
    vi.stubEnv("LLM_PROVIDER", "deepseek");
    await expect(runNarrationFirstRuntimeSmoke()).rejects.toThrow("narration_smoke_refuses_real_llm_credentials");
    vi.unstubAllEnvs();
  });
});
