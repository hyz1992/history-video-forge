import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S2-2C 复审整改 P2-4：publish run-service 级快照派生测试。
 *
 * 验证 `runPublishGeneration` 把 `billingContext.resolved.resolved_capabilities`
 * 透传给 cover/description/title 三个 LLM 子服务（getPublishLlmGateway 快照
 * 路径不命中缓存，单一真相源）；无 billingContext → 工厂收到 undefined。
 * 探针方案：mock provider 抛 S2-2C_SNAPSHOT_PROBE——run service 对每个 LLM
 * 调用独立 catch（notes 记录，主流程继续），测试只断言工厂收到的参数。
 */

const { factoryOptionsMock } = vi.hoisted(() => ({ factoryOptionsMock: vi.fn() }));

vi.mock("../../../backend/src/config/env.js", () => {
  const env = {
    nodeEnv: "test",
    demoMode: false,
    promptAssetsDir: process.cwd().replace(/\\/g, "/") + "/prompts",
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

vi.mock("../../../backend/src/runtime/llm/tier-aware-provider-factory.js", () => ({
  createTierAwareProviderFromEnv: (options?: unknown) => {
    factoryOptionsMock(options);
    return {
      invokeStructuredPrompt: async () => {
        throw new Error("S2-2C_SNAPSHOT_PROBE");
      },
      invokeStrictStructured: async () => {
        throw new Error("S2-2C_SNAPSHOT_PROBE");
      },
    };
  },
  resolveTierProviderSnapshot: vi.fn(),
}));

import { createDbClient } from "../../../backend/src/db/client.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { saveScriptRecord } from "../../../backend/src/modules/script/script-record.repository.js";
import { saveTopicPackage } from "../../../backend/src/modules/topic/topic-package.repository.js";
import { runPublishGeneration } from "../../../backend/src/modules/publish/publish-run.service.js";
import type { ResolvedCapabilityMap } from "../../../shared/src/index.js";

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

async function preparePublishPipeline() {
  const db = createDbClient();
  const project = await createProject(db, { name: "S2-2C Publish Run" });
  const topicPackage = await saveTopicPackage(db, {
    projectId: project.id,
    title: "Publish Topic",
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

  const now = new Date();
  const manifestRecord = {
    id: "manifest_pub_001",
    projectId: project.id,
    topicPackageId: topicPackage.id,
    scriptRecordId: scriptRecord.id,
    storyboardRecordId: "sb_pub_001",
    assetPlanRecordId: "plan_pub_001",
    revision: 1,
    manifestJson: { art_bible: { era_style: "汉代", visual_tone: "纪实" } },
    validationResultJson: {},
    executionStateJson: null,
    graphTraceSummaryJson: null,
    runtimeDiagnosticsJson: null,
    createdAt: now,
    updatedAt: now,
  };
  db.assetManifestRecords.set(manifestRecord.id, manifestRecord as never);

  const renderJob = {
    id: "render_pub_001",
    projectId: project.id,
    composeRecordId: "compose_pub_001",
    assetManifestRecordId: manifestRecord.id,
    status: "completed",
    profileJson: {},
    outputArtifactJson: { artifact_id: "art_export_001", duration_sec: 40 },
    validationResultJson: { stage: "render_validation", decision: "pass", errors: [], warnings: [], metrics: {} },
    executionStateJson: null,
    graphTraceSummaryJson: null,
    runtimeDiagnosticsJson: null,
    createdAt: now,
    updatedAt: now,
  };
  db.renderJobRecords.set(renderJob.id, renderJob as never);

  project.activeTopicPackageId = topicPackage.id;
  project.activeScriptRecordId = scriptRecord.id;
  project.activeStoryboardRecordId = "sb_pub_001";
  project.activeAssetManifestRecordId = manifestRecord.id;
  project.activeRenderJobRecordId = renderJob.id;
  return { db, project };
}

function buildBillingContext(db: ReturnType<typeof createDbClient>, project: { id: string; ownerId: string }) {
  const now = new Date();
  const snapshot = {
    id: "snap_pub_001",
    projectId: project.id,
    userId: project.ownerId,
    stage: "publish",
    operation: "publish.generate",
    runId: "run_pub_001",
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
    runId: "run_pub_001",
    operation: "publish.generate" as const,
    resolved: {
      resolved_capabilities: SNAPSHOT_CAPABILITIES,
    } as never,
  };
}

describe("publish run-service 快照派生（S2-2C 复审 P2-4）", () => {
  beforeEach(() => {
    factoryOptionsMock.mockReset();
  });

  it("billingContext 提供 → 三个 LLM 子服务 gateway 都收到快照 capabilities", async () => {
    const { db, project } = await preparePublishPipeline();
    const billingContext = buildBillingContext(db, project);
    const response = await runPublishGeneration({
      db,
      project,
      billingContext: billingContext as never,
    });
    // LLM 探针错误被逐调用 catch（notes），主流程继续返回发布包（201 创建语义）
    expect(response.statusCode).toBe(201);
    // 精确断言：cover/description/title 三个 gateway 构造**恰好 3 次**，
    // 每次参数都是同一快照引用（快照路径不命中进程级缓存，逐调用构造）。
    expect(factoryOptionsMock).toHaveBeenCalledTimes(3);
    for (const call of factoryOptionsMock.mock.calls) {
      expect(call[0]).toEqual({ snapshotCapabilities: SNAPSHOT_CAPABILITIES });
    }
  });

  it("无 billingContext（免 quote 本地路径）→ 工厂收到 undefined", async () => {
    const { db, project } = await preparePublishPipeline();
    const response = await runPublishGeneration({ db, project });
    expect(response.statusCode).toBe(201);
    // 缺省路径命中进程级缓存：三个子 service 复用同一 gateway → 工厂恰好构造 1 次
    expect(factoryOptionsMock).toHaveBeenCalledTimes(1);
    expect(factoryOptionsMock).toHaveBeenCalledWith(undefined);
  });
});
