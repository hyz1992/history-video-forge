import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S2-2C 复审整改 P2-4：asset-planning run-service 级快照派生测试（planner 透传）。
 *
 * `generateAssetPlan` 被 mock（记录 `input.snapshotCapabilities`）——直接验证
 * run service → generation service 的参数透传（run-service 派生单一真相源），
 * 工厂层由 gateway 级测试覆盖；`repairAssetPlanStructure` 的透传由
 * asset-plan-run-repair-snapshot.test.ts 覆盖（legacy regen_once 可达分支）。
 */

const { generateAssetPlanMock } = vi.hoisted(() => ({
  generateAssetPlanMock: vi.fn(),
}));

vi.mock("../../../backend/src/config/env.js", () => {
  const env = {
    nodeEnv: "test",
    demoMode: false,
    promptAssetsDir: process.cwd().replace(/\\/g, "/") + "/prompts",
    assetPlanningGenerationMode: "intent_compiler",
    llm: {
      provider: "openai",
      baseUrl: "https://llm.example.test/v1",
      apiKey: "test-key",
      model: "glm-4.5",
      structuredModel: "glm-4.5",
      timeoutMs: 45000,
    },
  };
  return {
    env,
    getValidatedRuntimeEnv: () => env,
  };
});

// 仅 mock generateAssetPlan：保留 generation service 其余导出
vi.mock(
  "../../../backend/src/modules/asset-planning/asset-planning-generation.service.js",
  async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../backend/src/modules/asset-planning/asset-planning-generation.service.js")>();
    return { ...actual, generateAssetPlan: generateAssetPlanMock };
  },
);

import { createDbClient } from "../../../backend/src/db/client.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { saveScriptRecord } from "../../../backend/src/modules/script/script-record.repository.js";
import { saveStoryboardRecord } from "../../../backend/src/modules/storyboard/storyboard-record.repository.js";
import { saveTopicPackage } from "../../../backend/src/modules/topic/topic-package.repository.js";
import { runAssetPlanningGeneration } from "../../../backend/src/modules/asset-planning/asset-planning-run.service.js";
import type { ResolvedCapabilityMap, StoryboardPlan } from "../../../shared/src/index.js";

const SNAPSHOT_CAPABILITIES: ResolvedCapabilityMap = {
  "llm.smart": {
    mode: "fixed",
    provider_model_id: "llm.smart.deepseek.deepseek-v4-pro",
    provider_key: "deepseek",
    model_id: "deepseek-v4-pro",
  },
  "llm.flash": { mode: "auto", provider_model_id: "f", provider_key: "zhipu", model_id: "glm-4" },
  "image.generate": { mode: "auto", provider_model_id: "img", provider_key: "dashscope", model_id: "wanx" },
  "video.image_to_video": { mode: "auto", provider_model_id: "vid", provider_key: "dashscope", model_id: "wan" },
  "tts.synthesize": { mode: "auto", provider_model_id: "tts", provider_key: "dashscope", model_id: "qwen" },
};

function makeStoryboardPlan(input: { scriptRecordId: string; topicPackageId: string }): StoryboardPlan {
  return {
    plan_version: "storyboard_v1",
    source_script_record_id: input.scriptRecordId,
    source_topic_package_id: input.topicPackageId,
    estimated_total_duration_sec: 40,
    segments: [
      {
        segment_id: "sb_001",
        order: 0,
        script_excerpt: "The envoy answers in public.",
        start_hint_sec: 0,
        end_hint_sec: 40,
        narrative_role: "opening",
        visual_intent: "Show the public pressure.",
        scene_description: "A tense public hall.",
        visual_elements: ["envoy"],
        framing_hint: "medium",
        content_type: "live_action",
        motion_hint: "static",
        editing_hint: "single",
        on_screen_text: [],
        linked_beats: ["public answer"],
        linked_quotes: [],
        risk_notes: [],
      },
    ],
    global_visual_notes: [],
  };
}

function seedGenerationCatalog(db: ReturnType<typeof createDbClient>) {
  const now = new Date();
  const catalogSeed: Array<[string, string]> = [
    ["llm.smart", "dashscope.qwen-max"],
    ["llm.flash", "dashscope.qwen-flash"],
    ["image.generate", "dashscope.wanx-v1"],
    ["video.image_to_video", "dashscope.video-v1"],
    ["tts.synthesize", "dashscope.tts"],
  ];
  for (const [capability, id] of catalogSeed) {
    db.providerModelCatalog.set(id, {
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
}

async function prepareActiveStoryboard() {
  const db = createDbClient();
  seedGenerationCatalog(db);
  const project = await createProject(db, { name: "Asset Plan Snapshot" });
  const topicPackage = await saveTopicPackage(db, {
    projectId: project.id,
    title: "Asset Plan Topic",
    selectedAngle: "A public answer reverses the pressure.",
    familyLabel: "diplomacy",
    scopeLabel: "single_event",
    coreConflict: "The envoy must answer in front of everyone.",
    strongScene: "The hall falls quiet after the answer.",
    packagingSeed: "One sentence changes the room.",
    canonicalQuotesJson: [],
    durationBandJson: { label: "medium" },
    narrativeTensionMapJson: {
      hook_claim: "A public pressure scene begins.",
      pressure_escalation: "The insult keeps rising.",
      mid_reveal: "The answer is guarding the state's face.",
      peak_payoff: "The reply reverses the pressure.",
      ending_residue: "Retreat would cost more than silence.",
    },
    mustIncludeBeatsJson: ["public answer"],
    forbiddenExpansionsJson: [],
    riskHintsJson: [],
    sourceAnchorRefsJson: ["source-a"],
  });
  const scriptRecord = await saveScriptRecord(db, {
    projectId: project.id,
    topicPackageId: topicPackage.id,
    scriptText: "The envoy answers in public.",
    openingSpan: "Opening pressure.",
    endingSpan: "The ending leaves a cost.",
    estimatedDurationSec: 40,
    beatTraceJson: [{ beat: "public answer", excerpt: "The envoy answers in public.", confidence: 0.95 }],
    quoteTraceJson: [],
    reviewStatus: "pass",
    validationResultJson: { stage: "script_local_validation", decision: "pass" },
    semanticReviewResultJson: { stage: "script_semantic_review", decision: "pass", patch_intent: null },
    executionStateJson: { patch_used: false, regenerate_used: false },
  });
  const storyboardPlan = makeStoryboardPlan({
    scriptRecordId: scriptRecord.id,
    topicPackageId: topicPackage.id,
  });
  const storyboardRecord = await saveStoryboardRecord(db, {
    projectId: project.id,
    topicPackageId: topicPackage.id,
    scriptRecordId: scriptRecord.id,
    planJson: storyboardPlan,
    validationResultJson: { stage: "storyboard_local_validation", decision: "pass" },
  });
  project.activeTopicPackageId = topicPackage.id;
  project.activeScriptRecordId = scriptRecord.id;
  project.activeStoryboardRecordId = storyboardRecord.id;
  project.status = "storyboard_ready";
  return { db, project };
}

function buildBillingContext(db: ReturnType<typeof createDbClient>, project: { id: string; ownerId: string }) {
  const now = new Date();
  const snapshot = {
    id: "snap_ap_001",
    projectId: project.id,
    userId: project.ownerId,
    stage: "asset_planning",
    operation: "asset_plan.generate",
    runId: "run_ap_001",
    projectConfigurationRevision: 1,
    schemaVersion: "run_configuration_snapshot_v1",
    configurationHash: "fnv1a64:1111111111111111",
    resolvedConfigurationJson: {
      schema_version: "resolved_generation_configuration_v1",
      resolved_capabilities: SNAPSHOT_CAPABILITIES,
    } as unknown as Record<string, unknown>,
    resolutionTraceJson: [],
    quoteId: null,
    quoteFingerprint: null,
    estimatedCostMicros: null,
    authorizationCostMicros: null,
    containsUnboundedItem: false,
    budgetLimitMicros: null,
    budgetOverrideAuthorized: false,
    pricingHash: null,
    pricingVersionSetJson: [],
    createdAt: now,
    updatedAt: now,
  };
  db.runConfigurationSnapshots.set(snapshot.id, snapshot as never);
  return {
    db,
    snapshot: snapshot as never,
    runId: "run_ap_001",
    operation: "asset_plan.generate" as const,
    resolved: {
      resolved_capabilities: SNAPSHOT_CAPABILITIES,
    } as never,
  };
}

describe("asset-planning run-service 快照派生：planner 透传（S2-2C 复审 P2-4）", () => {
  beforeEach(() => {
    generateAssetPlanMock.mockReset();
  });

  it("billingContext 提供 → generateAssetPlan 收到快照 capabilities（单一真相源）", async () => {
    generateAssetPlanMock.mockImplementation(async () => ({ plan_version: "asset_plan_v1" }));
    const { db, project } = await prepareActiveStoryboard();
    const billingContext = buildBillingContext(db, project);
    await runAssetPlanningGeneration({
      db,
      project,
      demoMode: false,
      billingContext: billingContext as never,
    });
    expect(generateAssetPlanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshotCapabilities: SNAPSHOT_CAPABILITIES,
      }),
    );
  });

  it("无 billingContext（免 quote 本地路径）→ generateAssetPlan 收到 undefined", async () => {
    generateAssetPlanMock.mockImplementation(async () => ({ plan_version: "asset_plan_v1" }));
    const { db, project } = await prepareActiveStoryboard();
    await runAssetPlanningGeneration({ db, project, demoMode: false });
    expect(generateAssetPlanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshotCapabilities: undefined,
      }),
    );
  });
});
