import { describe, expect, it, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Mock gateway that actually calls interactionLogWriter so trace files
// are written.  No real network calls.
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

describe("POST optimize trace writing", () => {
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

  it("returns 200, calls gateway with writer, writes trace files", { timeout: 15000 }, async () => {
    const { buildApp } = await import("../../../backend/src/app.js");
    const { createLlmGateway } = await import(
      "../../../backend/src/runtime/llm/llm-gateway.js"
    );

    const app = buildApp();

    // Setup mock gateway that actually writes trace files
    const mockInvoke = vi.fn().mockImplementation(async (opts: Record<string, unknown>) => {
      const writer = opts.interactionLogWriter as { write: (e: unknown) => Promise<void> } | undefined;
      if (writer) {
        await writer.write({
          generatedAt: new Date().toISOString(),
          provider: "mock",
          model: "mock",
          operationName: (opts.operationName as string) ?? "asset.prompt-optimizer",
          promptId: (opts.promptId as string) ?? "asset.prompt-optimizer",
          promptStage: "assets",
          promptLanguage: "zh-CN",
          promptFilePath: "/fake/prompt.md",
          systemPrompt: "test",
          input: opts.input,
          rawOutput: JSON.stringify({ optimized_prompt: "mock optimized", change_summary: ["mock change"] }),
          parsedOutput: { optimized_prompt: "mock optimized", change_summary: ["mock change"] },
          errorMessage: null,
        });
      }
      return {
        optimized_prompt: "优化后明代宫廷场景，低角度特写，威严光影",
        change_summary: ["增强光影质感", "加入低角度构图"],
        remaining_risks: [],
      };
    });
    (createLlmGateway as ReturnType<typeof vi.fn>).mockReturnValue({
      invokeStructuredPrompt: mockInvoke,
      invokeStrictStructured: vi.fn(),
    });

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

    expect(res.statusCode).toBe(200);

    // Verify trace.md was written with expected content
    const traceDir = join(tmpDir, "trace");
    expect(existsSync(traceDir)).toBe(true);
    const traceMd = readFileSync(join(traceDir, "trace.md"), "utf8");
    expect(traceMd).toContain("asset.prompt-optimizer");
    expect(traceMd).toContain("明代宫廷场景");
    expect(traceMd).toContain("增强光影");
    expect(traceMd).not.toContain("api_key");
    expect(traceMd).not.toContain("Authorization");
    expect(traceMd).not.toContain("Bearer");

    // Verify per-run interaction log
    const assetsRunsDir = join(traceDir, "assets-runs");
    const runDirs = readdirSync(assetsRunsDir);
    expect(runDirs.length).toBeGreaterThan(0);
    const runDir = join(assetsRunsDir, runDirs[0]!);
    const llmDir = join(runDir, "llm-interactions");
    expect(existsSync(llmDir)).toBe(true);
    const interactionFiles = readdirSync(llmDir);
    expect(interactionFiles.length).toBeGreaterThan(0);
    const interactionLog = readFileSync(join(llmDir, interactionFiles[0]!), "utf8");
    expect(interactionLog).toContain("asset.prompt-optimizer");
    expect(interactionLog).toContain("current_prompt");
    expect(interactionLog).toContain("user_feedback");
    expect(interactionLog).not.toContain("api_key");
    expect(interactionLog).not.toContain("Bearer");

    // Cleanup
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 400 when current_prompt is missing", async () => {
    const { buildApp } = await import("../../../backend/src/app.js");
    const app = buildApp();

    const projectId = "ot-002";
    const now = new Date();
    app.db.projects.set(projectId, {
      id: projectId, name: "OT2", status: "assets_ready",
      ownerId: "owner-1",
      activeTopicPackageId: null, activeScriptRecordId: null,
      activeStoryboardRecordId: null, activeAssetPlanRecordId: "ap_002",
      activeAssetManifestRecordId: null, activeComposeRecordId: null,
      activeRenderJobRecordId: null,
      latestTopicRunTraceJson: null, latestScriptRunTraceJson: null,
      latestStoryboardRunTraceJson: null, latestAssetPlanRunTraceJson: null,
      latestAssetsRunTraceJson: null, latestComposeRunTraceJson: null,
      latestRenderRunTraceJson: null,
      storageDisplayName: "OT2", storageShortId: "p_ot2",
      storageRootDir: mkdtempSync(join(tmpdir(), "svf2-ot2-")),
      storageRenameLocked: false,
      createdAt: now, updatedAt: now,
    });
    const tmpDir2 = app.db.projects.get(projectId)!.storageRootDir;
    tempDirs.push(tmpDir2);

    app.db.assetPlanRecords.set("ap_002", {
      id: "ap_002", projectId, topicPackageId: "tp_001", scriptRecordId: "scr_001", storyboardRecordId: "sb_001",
      planJson: {
        plan_version: "asset_plan_v1", art_bible: {}, visual_budget: {}, downgrade_policy: {},
        global_audio_strategy: {}, tts_plan: {},
        tasks: [{ task_id: "t2", task_type: "image_still", source_segment_id: null, prompt_draft: "test", parameters: {} }],
        dependencies: [], cost_summary: {}, global_production_notes: [],
      } as never,
      validationResultJson: { stage: "asset_planning_local_validation", decision: "ready", errors: [], warnings: [], metrics: {} },
      executionStateJson: {}, graphTraceSummaryJson: null, runtimeDiagnosticsJson: null, createdAt: now,
    });

    const res = await app.inject({ auth,
      method: "POST",
      url: `/api/projects/${projectId}/assets/tasks/t2/prompt/optimize`,
      payload: { user_feedback: "test" },
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as Record<string, unknown>).error).toBe("missing_current_prompt");
  });
});
