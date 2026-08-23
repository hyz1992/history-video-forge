import { beforeEach, describe, expect, it, vi } from "vitest";

const generateStoryboardPlanMock = vi.hoisted(() => vi.fn());

vi.mock("../../../backend/src/modules/storyboard/storyboard-generation.service.js", () => ({
  generateStoryboardPlan: generateStoryboardPlanMock,
}));

import { buildApp } from "../../../backend/src/app.js";
import { seedGenerationCatalog } from "../helpers/seed-generation-catalog.js";
import { buildTestAuth } from "../auth/test-utils.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { getProjectSnapshot } from "../../../backend/src/modules/projects/project-snapshot.service.js";
import { saveScriptRecord } from "../../../backend/src/modules/script/script-record.repository.js";
import { saveTopicPackage } from "../../../backend/src/modules/topic/topic-package.repository.js";

function makeValidPlan(input: {
  sourceScriptRecordId: string;
  sourceTopicPackageId: string;
  scriptText: string;
  durationSec: number;
}) {
  return {
    plan_version: "storyboard_v1",
    source_script_record_id: input.sourceScriptRecordId,
    source_topic_package_id: input.sourceTopicPackageId,
    estimated_total_duration_sec: input.durationSec,
    segments: [
      {
        segment_id: "sb_001",
        order: 0,
        script_excerpt: input.scriptText,
        start_hint_sec: 0,
        end_hint_sec: input.durationSec,
        narrative_role: "opening",
        visual_intent: "Show the public pressure turning into a visible answer.",
        scene_description: "A tense public hall holds on the envoy's answer.",
        visual_elements: ["envoy", "public hall"],
        framing_hint: "medium",
        content_type: "live_action",
        motion_hint: "push_in",
        editing_hint: "single",
        on_screen_text: [],
        linked_beats: ["public answer"],
        linked_quotes: [],
        risk_notes: [],
        // S2-2A 任务 4：四档适配度必填
        api_video_suitability: "remotion_sufficient",
      },
    ],
    global_visual_notes: [],
  };
}

async function prepareActiveScript(app: ReturnType<typeof buildApp>) {
  const project = await createProject(app.db, {
    name: "Storyboard API Flow",
    ownerId: "owner-1",
  });
  const topicPackage = await saveTopicPackage(app.db, {
    projectId: project.id,
    title: "Storyboard Topic",
    selectedAngle: "A public answer reverses the pressure.",
    familyLabel: "diplomacy",
    scopeLabel: "single_event",
    coreConflict: "The envoy must answer in front of everyone.",
    strongScene: "The hall falls quiet after the answer.",
    packagingSeed: "One sentence changes the room.",
    canonicalQuotesJson: [],
    durationBandJson: {
      label: "medium",
    },
    narrativeTensionMapJson: {
      hook_claim: "A public pressure scene begins.",
      pressure_escalation: "The insult keeps rising.",
      mid_reveal: "The answer is guarding the state's face.",
      peak_payoff: "The reply reverses the pressure.",
      ending_residue: "Retreat would cost more than silence.",
    },
    mustIncludeBeatsJson: ["public answer"],
    forbiddenExpansionsJson: ["Do not invent later downstream stages."],
    riskHintsJson: ["Keep it as scene planning, not asset planning."],
    sourceAnchorRefsJson: ["source-a"],
  });
  const scriptText =
    "Opening pressure. The envoy answers in public. The ending leaves a cost.";
  const scriptRecord = await saveScriptRecord(app.db, {
    projectId: project.id,
    topicPackageId: topicPackage.id,
    scriptText,
    openingSpan: "Opening pressure.",
    endingSpan: "The ending leaves a cost.",
    estimatedDurationSec: 82,
    beatTraceJson: [
      {
        beat: "public answer",
        excerpt: "The envoy answers in public.",
        confidence: 0.95,
      },
    ],
    quoteTraceJson: [],
    reviewStatus: "pass",
    validationResultJson: {
      stage: "script_local_validation",
      decision: "pass",
    },
    semanticReviewResultJson: {
      stage: "script_semantic_review",
      decision: "pass",
      patch_intent: null,
    },
    executionStateJson: {
      patch_used: false,
      regenerate_used: false,
    },
  });

  project.activeTopicPackageId = topicPackage.id;
  project.activeScriptRecordId = scriptRecord.id;
  project.status = "script_ready";

  return {
    project,
    topicPackage,
    scriptRecord,
    scriptText,
  };
}

describe("storyboard api", () => {
  const auth = buildTestAuth({ userId: "owner-1" });

  beforeEach(() => {
    generateStoryboardPlanMock.mockReset();
  });

  it("returns 404 when the project does not exist", async () => {
    const app = buildApp();
    seedGenerationCatalog(app);

    const response = await app.inject({
      auth,
      method: "POST",
      url: "/api/projects/missing/storyboard/generate",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: "project_not_found",
    });
  });

  it("returns 409 when active script is missing", async () => {
    const app = buildApp();
    seedGenerationCatalog(app);
    const project = await createProject(app.db, {
      name: "Storyboard Missing Script",
      ownerId: "owner-1",
    });

    const response = await app.inject({
      auth,
      method: "POST",
      url: `/api/projects/${project.id}/storyboard/generate`,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: "active_script_record_missing",
    });
  });

  it("returns 404 when the active script record was deleted", async () => {
    const app = buildApp();
    seedGenerationCatalog(app);
    const project = await createProject(app.db, {
      name: "Storyboard Deleted Script",
      ownerId: "owner-1",
    });
    project.activeScriptRecordId = "script_missing";

    const response = await app.inject({
      auth,
      method: "POST",
      url: `/api/projects/${project.id}/storyboard/generate`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: "script_record_not_found",
    });
  });

  it("returns 404 when the script topic package was deleted", async () => {
    const app = buildApp();
    seedGenerationCatalog(app);
    const prepared = await prepareActiveScript(app);
    app.db.topicPackages.delete(prepared.topicPackage.id);

    const response = await app.inject({
      auth,
      method: "POST",
      url: `/api/projects/${prepared.project.id}/storyboard/generate`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: "topic_package_not_found",
    });
  });

  it("generates, validates, persists, and activates storyboard from active script", async () => {
    const app = buildApp();
    seedGenerationCatalog(app);
    const prepared = await prepareActiveScript(app);
    prepared.project.activeAssetPlanRecordId = "asset_plan_record_old";
    prepared.project.activeAssetManifestRecordId = "asset_manifest_record_old";
    prepared.project.activeComposeRecordId = "compose_record_old";
    prepared.project.activeRenderJobRecordId = "render_job_record_old";
    prepared.project.latestAssetPlanRunTraceJson = {
      phase: "asset_planning",
      run_id: "asset_plan_run_old",
      steps: [],
    };
    prepared.project.latestAssetsRunTraceJson = {
      phase: "assets",
      run_id: "assets_run_old",
      steps: [],
    };
    prepared.project.latestComposeRunTraceJson = {
      phase: "compose",
      run_id: "compose_run_old",
      steps: [],
    };
    prepared.project.latestRenderRunTraceJson = {
      phase: "render",
      run_id: "render_run_old",
      steps: [],
    };
    generateStoryboardPlanMock.mockResolvedValueOnce(
      makeValidPlan({
        sourceScriptRecordId: prepared.scriptRecord.id,
        sourceTopicPackageId: prepared.topicPackage.id,
        scriptText: prepared.scriptText,
        durationSec: prepared.scriptRecord.estimatedDurationSec,
      }),
    );

    const response = await app.inject({
      auth,
      method: "POST",
      url: `/api/projects/${prepared.project.id}/storyboard/generate`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      project_id: prepared.project.id,
      run_mode: "sync_runtime",
      source_script_record_id: prepared.scriptRecord.id,
      source_topic_package_id: prepared.topicPackage.id,
      storyboard_record_id: expect.any(String),
      plan: {
        source_script_record_id: prepared.scriptRecord.id,
        source_topic_package_id: prepared.topicPackage.id,
      },
      local_validation: {
        stage: "storyboard_local_validation",
        decision: "pass",
      },
      execution_state: {
        regenerate_used: false,
      },
    });
    expect(prepared.project.status).toBe("storyboard_ready");
    expect(prepared.project.activeStoryboardRecordId).toBe(body.storyboard_record_id);
    expect(prepared.project.activeAssetPlanRecordId).toBeNull();
    expect(prepared.project.latestAssetPlanRunTraceJson).toBeNull();
    expect(prepared.project.activeAssetManifestRecordId).toBeNull();
    expect(prepared.project.latestAssetsRunTraceJson).toBeNull();
    expect(prepared.project.activeComposeRecordId).toBeNull();
    expect(prepared.project.latestComposeRunTraceJson).toBeNull();
    expect(prepared.project.activeRenderJobRecordId).toBeNull();
    expect(prepared.project.latestRenderRunTraceJson).toBeNull();

    const snapshot = await getProjectSnapshot(app.db, prepared.project.id);
    expect(snapshot?.active_storyboard).toMatchObject({
      storyboard_record_id: body.storyboard_record_id,
      source_script_record_id: prepared.scriptRecord.id,
    });
    expect(snapshot?.active_asset_plan).toBeNull();
    expect(snapshot?.trace_summary.latest_asset_plan_run).toBeNull();
    expect(snapshot?.active_compose).toBeNull();
    expect(snapshot?.trace_summary.latest_compose_run).toBeNull();
    expect(snapshot?.active_render).toBeNull();
    expect(snapshot?.trace_summary.latest_render_run).toBeNull();
  });

  it("does not activate storyboard when local validation still fails after regen once", async () => {
    const app = buildApp();
    seedGenerationCatalog(app);
    const prepared = await prepareActiveScript(app);
    const invalidPlan = {
      ...makeValidPlan({
        sourceScriptRecordId: prepared.scriptRecord.id,
        sourceTopicPackageId: prepared.topicPackage.id,
        scriptText: prepared.scriptText,
        durationSec: prepared.scriptRecord.estimatedDurationSec,
      }),
      segments: [
        {
          ...makeValidPlan({
            sourceScriptRecordId: prepared.scriptRecord.id,
            sourceTopicPackageId: prepared.topicPackage.id,
            scriptText: prepared.scriptText,
            durationSec: prepared.scriptRecord.estimatedDurationSec,
          }).segments[0],
          script_excerpt: "This excerpt is not in the script.",
        },
      ],
    };
    generateStoryboardPlanMock.mockResolvedValue(invalidPlan);

    const response = await app.inject({
      auth,
      method: "POST",
      url: `/api/projects/${prepared.project.id}/storyboard/generate`,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: "storyboard_local_validation_failed",
      local_validation: {
        stage: "storyboard_local_validation",
        decision: "regen_once",
        errors: ["storyboard_excerpt_not_in_script"],
      },
    });
    expect(generateStoryboardPlanMock).toHaveBeenCalledTimes(2);
    expect(generateStoryboardPlanMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        regenerationContext: expect.objectContaining({
          reason: "storyboard_local_validation_regen_once",
        }),
      }),
    );
    expect(prepared.project.status).toBe("script_ready");
    expect(prepared.project.activeStoryboardRecordId).toBeNull();

    // P1-2: Verify no dirty placeholder — the generating record must be updated with failure state
    const allRecords = [...app.db.storyboardRecords.values()];
    const generatingRecords = allRecords.filter(
      (r) => (r.executionStateJson as Record<string, unknown> | null)?.generating === true,
    );
    expect(generatingRecords).toHaveLength(0);

    // The failed record should be persisted with generating=false and error info
    const failedRecords = allRecords.filter(
      (r) => {
        const es = r.executionStateJson as Record<string, unknown> | null;
        return es?.error === "storyboard_local_validation_failed";
      },
    );
    expect(failedRecords.length).toBeGreaterThanOrEqual(1);
    const failedEs = failedRecords[0].executionStateJson as Record<string, unknown>;
    expect(failedEs.generating).toBe(false);
  });

  it("does not activate storyboard on unexpected error and cleans up generating state", async () => {
    const app = buildApp();
    seedGenerationCatalog(app);
    const prepared = await prepareActiveScript(app);
    generateStoryboardPlanMock.mockRejectedValue(new Error("LLM timeout"));

    const response = await app.inject({
      auth,
      method: "POST",
      url: `/api/projects/${prepared.project.id}/storyboard/generate`,
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      error: "internal_server_error",
    });
    expect(prepared.project.status).toBe("script_ready");
    expect(prepared.project.activeStoryboardRecordId).toBeNull();

    // P1-2: All storyboard records must have generating=false
    const allRecords = [...app.db.storyboardRecords.values()];
    const generatingRecords = allRecords.filter(
      (r) => (r.executionStateJson as Record<string, unknown> | null)?.generating === true,
    );
    expect(generatingRecords).toHaveLength(0);
  });

  it("rolls back to storyboard_ready when validation fails and previous active storyboard exists", async () => {
    const app = buildApp();
    seedGenerationCatalog(app);
    const prepared = await prepareActiveScript(app);

    // Create a previous active storyboard by directly inserting into the in-memory DB
    const previousPlan = makeValidPlan({
      sourceScriptRecordId: prepared.scriptRecord.id,
      sourceTopicPackageId: prepared.topicPackage.id,
      scriptText: prepared.scriptText,
      durationSec: prepared.scriptRecord.estimatedDurationSec,
    });
    app.db.storyboardRecords.set("previous_sb", {
      id: "previous_sb",
      projectId: prepared.project.id,
      topicPackageId: prepared.topicPackage.id,
      scriptRecordId: prepared.scriptRecord.id,
      planJson: previousPlan,
      validationResultJson: { stage: "storyboard_local_validation", decision: "pass", errors: [], warnings: [], metrics: {} },
      executionStateJson: { generating: false, regenerate_used: false },
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
      createdAt: new Date(),
    });
    prepared.project.activeStoryboardRecordId = "previous_sb";
    prepared.project.status = "storyboard_ready";

    // Generate that will fail validation
    const invalidPlan = {
      ...makeValidPlan({
        sourceScriptRecordId: prepared.scriptRecord.id,
        sourceTopicPackageId: prepared.topicPackage.id,
        scriptText: prepared.scriptText,
        durationSec: prepared.scriptRecord.estimatedDurationSec,
      }),
      segments: [
        {
          ...makeValidPlan({
            sourceScriptRecordId: prepared.scriptRecord.id,
            sourceTopicPackageId: prepared.topicPackage.id,
            scriptText: prepared.scriptText,
            durationSec: prepared.scriptRecord.estimatedDurationSec,
          }).segments[0],
          script_excerpt: "Not in script text.",
        },
      ],
    };
    generateStoryboardPlanMock.mockResolvedValue(invalidPlan);

    const response = await app.inject({
      auth,
      method: "POST",
      url: `/api/projects/${prepared.project.id}/storyboard/generate`,
    });

    expect(response.statusCode).toBe(422);
    // Should roll back to previous active storyboard, not script_ready
    expect(prepared.project.status).toBe("storyboard_ready");
    expect(prepared.project.activeStoryboardRecordId).toBe("previous_sb");

    // P1-2: Previous active storyboard must not be damaged
    const prevRecord = app.db.storyboardRecords.get("previous_sb");
    expect(prevRecord).toBeDefined();
    const prevValidation = prevRecord!.validationResultJson as Record<string, unknown>;
    expect(prevValidation.decision).toBe("pass");

    // No generating=true records
    const generatingRecords = [...app.db.storyboardRecords.values()].filter(
      (r) => (r.executionStateJson as Record<string, unknown> | null)?.generating === true,
    );
    expect(generatingRecords).toHaveLength(0);
  });

  // S2-2A 任务 4：PATCH strategy 改为写独立 override（不修改 planJson）
  async function prepareActiveStoryboard(app: ReturnType<typeof buildApp>) {
    const prepared = await prepareActiveScript(app);
    const plan = makeValidPlan({
      sourceScriptRecordId: prepared.scriptRecord.id,
      sourceTopicPackageId: prepared.topicPackage.id,
      scriptText: prepared.scriptText,
      durationSec: prepared.scriptRecord.estimatedDurationSec,
    });
    generateStoryboardPlanMock.mockResolvedValueOnce(plan);
    const response = await app.inject({
      auth,
      method: "POST",
      url: `/api/projects/${prepared.project.id}/storyboard/generate`,
    });
    expect(response.statusCode).toBe(200);
    const storyboardRecordId = response.json().storyboard_record_id as string;
    return { prepared, storyboardRecordId };
  }

  it("PATCH strategy writes independent override with revision and does not mutate planJson", async () => {
    const app = buildApp();
    seedGenerationCatalog(app);
    const { prepared, storyboardRecordId } = await prepareActiveStoryboard(app);

    const response = await app.inject({
      auth,
      method: "PATCH",
      url: `/api/projects/${prepared.project.id}/storyboard/strategy`,
      payload: {
        segment_id: "sb_001",
        visual_strategy_override: "api_video",
        expected_revision: null,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      segment_id: "sb_001",
      revision: 1,
      strategy_override: "api_video",
    });
    expect(body.api_video_suitability).toBeDefined();
    expect(body.resolved_route).toBeDefined();

    // planJson 未被修改
    const record = app.db.storyboardRecords.get(storyboardRecordId)!;
    const segments = (record.planJson as { segments: Array<Record<string, unknown>> }).segments;
    expect(segments[0]).not.toHaveProperty("visual_strategy_override");
    expect(segments[0]).not.toHaveProperty("visual_strategy_preference");
    expect(segments[0]).toHaveProperty("api_video_suitability");
  });

  // P1：演示态禁用 API 视频时，PATCH 响应必须给出降级原因（reason_code →
  // unavailable_reason 统一映射），不能置空。
  it("PATCH strategy in demo mode returns unavailable_reason for provider-disabled downgrade", async () => {
    const app = buildApp();
    seedGenerationCatalog(app);
    // 注入演示态（env.demoMode=true → apiVideoProviderEnabled=false）
    (app.env as { demoMode: boolean }).demoMode = true;
    // seed 完整 catalog（resolver 需要每 capability 一个 active 默认项才能成功解析，
    // 从而走到 provider-disabled 降级而非 catalog 缺失错误）
    const now = new Date();
    const catalogSeed: Array<[string, string]> = [
      ["llm.smart", "dashscope.qwen-max"],
      ["llm.flash", "dashscope.qwen-flash"],
      ["image.generate", "dashscope.wanx-v1"],
      ["video.image_to_video", "dashscope.video-v1"],
      ["tts.synthesize", "dashscope.tts"],
    ];
    for (const [capability, id] of catalogSeed) {
      app.db.providerModelCatalog.set(id, {
        id,
        capability: capability as never,
        providerKey: "dashscope",
        modelId: id,
        modelVersion: null,
        displayName: id,
        qualityTier: null,
        speedTier: null,
        parameterCapabilitiesJson: {},
        pricingVersion: "v1",
        pricingJson: { bounded: true },
        status: "active",
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      });
    }
    const { prepared } = await prepareActiveStoryboard(app);

    const response = await app.inject({
      auth,
      method: "PATCH",
      url: `/api/projects/${prepared.project.id}/storyboard/strategy`,
      payload: {
        segment_id: "sb_001",
        visual_strategy_override: "api_video",
        expected_revision: null,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    // 用户覆盖选择 api_video，但演示态强制降级 Remotion
    expect(body.strategy_override).toBe("api_video");
    expect(body.resolved_route).toBe("remotion");
    expect(body.reason_code).toBe("api_video_provider_disabled");
    // 关键：降级原因必须可见，不能 null
    expect(body.unavailable_reason).not.toBeNull();
    expect(body.unavailable_reason).toContain("禁用真实视频 API");
  });

  it("PATCH strategy with stale revision returns 409 storyboard_segment_override_revision_conflict", async () => {
    const app = buildApp();
    seedGenerationCatalog(app);
    const { prepared } = await prepareActiveStoryboard(app);

    await app.inject({
      auth,
      method: "PATCH",
      url: `/api/projects/${prepared.project.id}/storyboard/strategy`,
      payload: {
        segment_id: "sb_001",
        visual_strategy_override: "api_video",
        expected_revision: null,
      },
    });
    const response = await app.inject({
      auth,
      method: "PATCH",
      url: `/api/projects/${prepared.project.id}/storyboard/strategy`,
      payload: {
        segment_id: "sb_001",
        visual_strategy_override: "remotion_motion",
        expected_revision: 99,
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("storyboard_segment_override_revision_conflict");
  });

  it("PATCH strategy with illegal override value returns 400", async () => {
    const app = buildApp();
    seedGenerationCatalog(app);
    const { prepared } = await prepareActiveStoryboard(app);

    const response = await app.inject({
      auth,
      method: "PATCH",
      url: `/api/projects/${prepared.project.id}/storyboard/strategy`,
      payload: {
        segment_id: "sb_001",
        visual_strategy_override: "inherit",
        expected_revision: null,
      },
    });
    expect(response.statusCode).toBe(400);
  });
});
