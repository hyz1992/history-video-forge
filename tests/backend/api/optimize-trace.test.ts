import { describe, expect, it, vi, beforeAll, afterEach } from "vitest";

const mockGatewayInvoke = vi.fn();

vi.mock("../../../backend/src/runtime/llm/llm-gateway.js", () => ({
  createLlmGateway: vi.fn(() => ({
    invokeStructuredPrompt: mockGatewayInvoke,
    invokeStrictStructured: vi.fn(),
  })),
}));

vi.mock("../../../backend/src/runtime/llm/openai-compatible-provider.js", () => ({
  createOpenAiCompatibleProvider: vi.fn(() => ({})),
}));

describe("POST optimize trace writing", () => {
  beforeAll(() => {
    process.env.LLM_PROVIDER = "glm";
    process.env.LLM_BASE_URL = "http://mock.test/v1";
    process.env.LLM_API_KEY = "test-key";
  });

  afterEach(() => {
    mockGatewayInvoke.mockReset();
  });

  function makeProjectData(overrides?: Partial<Record<string, unknown>>) {
    const now = new Date();
    return {
      id: overrides?.id as string ?? "proj-001",
      name: "Optimize Trace Test",
      status: "assets_ready",
      activeTopicPackageId: null, activeScriptRecordId: null,
      activeStoryboardRecordId: "sb_001", activeAssetPlanRecordId: "ap_001",
      activeAssetManifestRecordId: null, activeComposeRecordId: null,
      activeRenderJobRecordId: null,
      latestTopicRunTraceJson: null, latestScriptRunTraceJson: null,
      latestStoryboardRunTraceJson: null, latestAssetPlanRunTraceJson: null,
      latestAssetsRunTraceJson: null, latestComposeRunTraceJson: null,
      latestRenderRunTraceJson: null,
      storageDisplayName: "Optimize Trace Test", storageShortId: "p_otrace",
      storageRootDir: (overrides?.storageRootDir as string) ?? "storage/projects/optimize-trace-test",
      storageRenameLocked: false,
      createdAt: now, updatedAt: now,
    };
  }

  it("returns 200 with optimized_prompt via mock gateway (non-stub path verified)", async () => {
    const { buildApp } = await import("../../../backend/src/app.js");
    const app = buildApp();

    const projectId = "ot-001";
    const taskId = "task_ot_001";
    const now = new Date();
    app.db.projects.set(projectId, makeProjectData({ id: projectId }));
    app.db.storyboardRecords.set("sb_001", {
      id: "sb_001", projectId, topicPackageId: "tp_001", scriptRecordId: "scr_001",
      planJson: { segments: [{ segment_id: "seg_001", script_excerpt: "口播文本", scene_description: "朝堂", visual_intent: "威严", narrative_role: "opening" }] },
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

    mockGatewayInvoke.mockResolvedValueOnce({
      optimized_prompt: "优化后明代宫廷场景，低角度特写",
      change_summary: ["增强光影", "低角度构图"],
      remaining_risks: [],
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/assets/tasks/${taskId}/prompt/optimize`,
      payload: {
        current_prompt: "明代宫廷场景",
        user_feedback: "增强光影，低角度特写",
        task_type: "image_still",
        segment_id: "seg_001",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.optimized_prompt).toContain("低角度特写");
    expect(body.change_summary).toEqual(["增强光影", "低角度构图"]);

    // Verify the gateway was called with correct prompt ID and input
    expect(mockGatewayInvoke).toHaveBeenCalledTimes(1);
    const callArg = mockGatewayInvoke.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(callArg?.promptId).toBe("asset.prompt-optimizer");
    const callInput = (callArg?.input ?? {}) as Record<string, unknown>;
    expect(callInput.current_prompt).toBe("明代宫廷场景");
    expect(callInput.user_feedback).toBe("增强光影，低角度特写");
    expect(callInput.task_type).toBe("image_still");
    expect((callInput.segment as Record<string, unknown>)?.scene_description).toBe("朝堂");
    // ArtBible context should be passed
    expect((callInput.art_bible as Record<string, unknown>)?.era_style).toBe("明代");
    // Interaction log writer should be passed (enables trace.md)
    expect(callArg?.interactionLogWriter).toBeDefined();
  });

  it("returns 400 when current_prompt is missing (non-stub path)", async () => {
    const { buildApp } = await import("../../../backend/src/app.js");
    const app = buildApp();

    const projectId = "ot-002";
    app.db.projects.set(projectId, makeProjectData({ id: projectId }));
    app.db.assetPlanRecords.set("ap_001", {
      id: "ap_001", projectId, topicPackageId: "tp_001", scriptRecordId: "scr_001", storyboardRecordId: "sb_001",
      planJson: { plan_version: "asset_plan_v1", art_bible: {}, visual_budget: {}, downgrade_policy: {}, global_audio_strategy: {}, tts_plan: {}, tasks: [{ task_id: "t1", task_type: "image_still", source_segment_id: "seg_001", prompt_draft: "test", parameters: {} }], dependencies: [], cost_summary: {}, global_production_notes: [] } as never,
      validationResultJson: { stage: "asset_planning_local_validation", decision: "ready", errors: [], warnings: [], metrics: {} },
      executionStateJson: {}, graphTraceSummaryJson: null, runtimeDiagnosticsJson: null, createdAt: new Date(),
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/assets/tasks/t1/prompt/optimize`,
      payload: { user_feedback: "test" },
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as Record<string, unknown>).error).toBe("missing_current_prompt");
    // Gateway should NOT be called
    expect(mockGatewayInvoke).not.toHaveBeenCalled();
  });
});
