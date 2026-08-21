import { describe, expect, it, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// P1-1 整改后的合同测试：prompt optimize 端点未接入 quote 提交执行，真实
// provider 部署下一律 409 paid_generation_quote_required（旧无 quote LLM
// 路径按 fail-closed 合同不可达）；stub 部署的 200/400 行为由
// assets-api.test.ts（stub env）覆盖。
// ---------------------------------------------------------------------------

vi.mock("../../../backend/src/runtime/llm/llm-gateway.js", () => ({
  createLlmGateway: vi.fn(() => ({
    invokeStructuredPrompt: vi.fn(),
    invokeStrictStructured: vi.fn(),
  })),
}));

vi.mock("../../../backend/src/runtime/llm/tier-aware-provider-factory.js", () => ({
  createTierAwareProviderFromEnv: vi.fn(() => ({})),
}));

import { buildTestAuth } from "../auth/test-utils.js";

describe("POST optimize paid gate (外部审查 P1-1 整改)", () => {
  const auth = buildTestAuth({ userId: "owner-1" });
  let tempDirs: string[] = [];

  beforeAll(() => {
    process.env.LLM_PROVIDER = "glm";
    process.env.LLM_BASE_URL = "http://mock.test/v1";
    process.env.LLM_API_KEY = "test-key";
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    for (const dir of tempDirs) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("真实 provider 部署：prompt optimize 返回 409 paid_generation_quote_required，gateway 零调用，不写 trace", async () => {
    const { buildApp } = await import("../../../backend/src/app.js");
    const { createLlmGateway } = await import(
      "../../../backend/src/runtime/llm/llm-gateway.js"
    );

    const app = buildApp();

    const projectId = "ot-001";
    const taskId = "task_ot_001";
    const tmpDir = mkdtempSync(join(tmpdir(), "svf2-opt-"));
    tempDirs.push(tmpDir);
    const now = new Date();
    app.db.projects.set(projectId, {
      id: projectId, name: "Optimize Trace Test", status: "assets_ready",
      ownerId: "owner-1",
      activeTopicPackageId: null, activeScriptRecordId: null,
      activeStoryboardRecordId: "sb_001", activeAssetPlanRecordId: "ap_001",
      activeAssetManifestRecordId: null, activeComposeRecordId: null,
      activeRenderJobRecordId: null,
      latestTopicRunTraceJson: null, latestScriptRunTraceJson: null,
      latestStoryboardRunTraceJson: null, latestAssetPlanRunTraceJson: null,
      latestAssetsRunTraceJson: null, latestComposeRunTraceJson: null,
      latestRenderRunTraceJson: null,
      storageDisplayName: "Optimize Trace Test", storageShortId: "p_otrace",
      storageRootDir: tmpDir, storageRenameLocked: false,
      createdAt: now, updatedAt: now,
    });
    app.db.storyboardRecords.set("sb_001", {
      id: "sb_001", projectId, topicPackageId: "tp_001", scriptRecordId: "scr_001",
      planJson: { segments: [{ segment_id: "seg_001", script_excerpt: "口播文本", scene_description: "朝堂大殿", visual_intent: "威严", narrative_role: "opening" }] },
      validationResultJson: {}, executionStateJson: null, graphTraceSummaryJson: null, runtimeDiagnosticsJson: null, createdAt: now,
    });
    app.db.assetPlanRecords.set("ap_001", {
      id: "ap_001", projectId, topicPackageId: "tp_001", scriptRecordId: "scr_001", storyboardRecordId: "sb_001",
      planJson: {
        plan_version: "asset_plan_v1", art_bible: { era_style: "明代" },
        visual_budget: {}, downgrade_policy: {}, global_audio_strategy: {}, tts_plan: {},
        tasks: [{ task_id: taskId, task_type: "image_still", source_segment_id: "seg_001", prompt_draft: "明代宫廷场景", parameters: {} }],
        dependencies: [], cost_summary: {}, global_production_notes: [],
      } as never,
      validationResultJson: { stage: "asset_planning_local_validation", decision: "ready", errors: [], warnings: [], metrics: {} },
      executionStateJson: {}, graphTraceSummaryJson: null, runtimeDiagnosticsJson: null, createdAt: now,
    });

    const res = await app.inject({ auth,
      method: "POST",
      url: `/api/projects/${projectId}/assets/tasks/${taskId}/prompt/optimize`,
      payload: {
        current_prompt: "明代宫廷场景",
        user_feedback: "增强光影，低角度特写",
        task_type: "image_still",
        segment_id: "seg_001",
      },
    });

    expect(res.statusCode).toBe(409);
    expect((res.json() as Record<string, unknown>).error).toBe("paid_generation_quote_required");
    // 真实 LLM gateway 零调用，且不写 trace（旧无 quote LLM 路径不可达）
    expect(createLlmGateway).not.toHaveBeenCalled();
    expect(existsSync(join(tmpDir, "trace"))).toBe(false);
  });
});
