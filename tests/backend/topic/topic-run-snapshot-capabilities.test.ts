import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S2-2C 复审整改 P2-4：topic run-service 级快照派生测试。
 *
 * 验证 `runTopicRecommendationWithStore` 把 `billingContext.resolved.
 * resolved_capabilities` 传入 `TopicRecommendationOptions`（gateway 构造
 * 直接消费 options.billingContext.resolved，单一真相源）；无 billingContext
 * → 工厂收到 undefined。探针方案：mock provider 抛 S2-2C_SNAPSHOT_PROBE。
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
import { runTopicRecommendationWithStore } from "../../../backend/src/modules/topic/topic-recommendation-flow.service.js";
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

const MINIMAL_SEED = {
  canonicalName: "晏子使楚",
  summary: "楚王当众压场，晏子必须当场顶回。",
  coreConflict: "楚王当众压场，晏子必须当场顶回。",
  strongScene: "楚王连续压场，晏子一句句顶回去。",
  sourceHint: "《晏子春秋》",
  recentUsageHint: "外交压场",
  canonicalQuotes: ["橘生淮南则为橘"],
};

function buildBillingContext(db: ReturnType<typeof createDbClient>, project: { id: string; ownerId: string }) {
  const now = new Date();
  const snapshot = {
    id: "snap_tp_001",
    projectId: project.id,
    userId: project.ownerId,
    stage: "topic",
    operation: "topic.generate",
    runId: "run_tp_001",
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
    runId: "run_tp_001",
    operation: "topic.generate" as const,
    resolved: {
      resolved_capabilities: SNAPSHOT_CAPABILITIES,
    } as never,
  };
}

describe("topic run-service 快照派生（S2-2C 复审 P2-4）", () => {
  beforeEach(() => {
    factoryOptionsMock.mockReset();
  });

  it("billingContext 提供 → gateway 构造收到快照 capabilities（单一真相源）", async () => {
    const db = createDbClient();
    const project = await createProject(db, { name: "S2-2C Topic Run" });
    const billingContext = buildBillingContext(db, project);
    await expect(
      runTopicRecommendationWithStore({
        db,
        project,
        topicCandidateStore: new Map(),
        seed: MINIMAL_SEED as never,
        billingContext: billingContext as never,
      }),
    ).rejects.toThrow("S2-2C_SNAPSHOT_PROBE");
    expect(factoryOptionsMock).toHaveBeenCalledWith({
      snapshotCapabilities: SNAPSHOT_CAPABILITIES,
    });
  });

  it("无 billingContext（免 quote 本地路径）→ 工厂收到 undefined", async () => {
    const db = createDbClient();
    const project = await createProject(db, { name: "S2-2C Topic Local" });
    await expect(
      runTopicRecommendationWithStore({
        db,
        project,
        topicCandidateStore: new Map(),
        seed: MINIMAL_SEED as never,
      }),
    ).rejects.toThrow("S2-2C_SNAPSHOT_PROBE");
    expect(factoryOptionsMock).toHaveBeenCalledWith(undefined);
  });
});
