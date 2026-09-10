import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S2-2C 复审整改 P2-4：storyboard run-service 级快照派生测试。
 *
 * 验证 `runStoryboardGeneration` 从 `billingContext.resolved.resolved_capabilities`
 * 派生 snapshotCapabilities 并传给 gateway 构造（单一真相源）；无 billingContext
 * （免 quote 本地路径）→ 工厂收到 undefined。探针方案：mock provider 抛
 * S2-2C_SNAPSHOT_PROBE，run service 的 catch 分类返回失败响应——测试只断言
 * 工厂收到的参数，不依赖完整成功路径。
 */

const { factoryOptionsMock } = vi.hoisted(() => ({ factoryOptionsMock: vi.fn() }));

vi.mock("../../../backend/src/config/env.js", () => {
  const env = {
    nodeEnv: "test",

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
import { createLegacyProject as createProject } from "../projects/legacy-project.fixture.js";
import { saveScriptRecord } from "../../../backend/src/modules/script/script-record.repository.js";
import { saveTopicPackage } from "../../../backend/src/modules/topic/topic-package.repository.js";
import { runStoryboardGeneration } from "../../../backend/src/modules/storyboard/storyboard-run.service.js";
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

async function prepareProject() {
  const db = createDbClient();
  const project = await createProject(db, { name: "S2-2C Storyboard Run" });
  const topicPackage = await saveTopicPackage(db, {
    projectId: project.id,
    title: "Storyboard Topic",
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
    scriptText: "Opening pressure. The envoy answers in public. The ending leaves a cost.",
    openingSpan: "Opening pressure.",
    endingSpan: "The ending leaves a cost.",
    estimatedDurationSec: 82,
    beatTraceJson: [{ beat: "public answer", excerpt: "The envoy answers in public.", confidence: 0.95 }],
    quoteTraceJson: [],
    reviewStatus: "pass",
    validationResultJson: { stage: "script_local_validation", decision: "pass" },
    semanticReviewResultJson: { stage: "script_semantic_review", decision: "pass", patch_intent: null },
    executionStateJson: { patch_used: false, regenerate_used: false },
  });
  project.activeTopicPackageId = topicPackage.id;
  project.activeScriptRecordId = scriptRecord.id;
  project.status = "script_ready";
  return { db, project };
}

function buildBillingContext(db: ReturnType<typeof createDbClient>, project: { id: string; ownerId: string }) {
  const now = new Date();
  const snapshot = {
    id: "snap_sb_001",
    projectId: project.id,
    userId: project.ownerId,
    stage: "storyboard",
    operation: "storyboard.generate",
    runId: "run_sb_001",
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
    runId: "run_sb_001",
    operation: "storyboard.generate" as const,
    resolved: {
      resolved_capabilities: SNAPSHOT_CAPABILITIES,
    } as never,
  };
}

describe("storyboard run-service 快照派生（S2-2C 复审 P2-4）", () => {
  beforeEach(() => {
    factoryOptionsMock.mockReset();
  });

  it("billingContext 提供 → gateway 构造收到快照 capabilities（单一真相源）", async () => {
    const { db, project } = await prepareProject();
    const billingContext = buildBillingContext(db, project);
    const response = await runStoryboardGeneration({
      db,
      project,
      billingContext: billingContext as never,
    });
    // 探针错误被 run service 分类为失败响应（不依赖成功路径）
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(factoryOptionsMock).toHaveBeenCalledWith({
      snapshotCapabilities: SNAPSHOT_CAPABILITIES,
    });
  });

  it("无 billingContext（免 quote 本地路径）→ 工厂收到 undefined", async () => {
    const { db, project } = await prepareProject();
    const response = await runStoryboardGeneration({ db, project });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(factoryOptionsMock).toHaveBeenCalledWith(undefined);
  });
});
