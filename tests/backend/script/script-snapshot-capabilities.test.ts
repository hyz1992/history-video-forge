import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S2-2C 任务 5a：script 链快照接线测试（详细设计 §6.1 单一真相源）。
 *
 * 模式沿用 llm-paid-generation-gate.test.ts：
 * - vi.mock env → provider="openai"（非 stub，让 gateway 走工厂路径）。
 * - vi.mock 工厂 → 记录 options 参数（断言快照 capabilities 透传）。
 *
 * 覆盖：
 * - writer/reviewer gateway 工厂把 snapshotCapabilities 传给工厂（auto/fixed 一律）。
 * - runScriptGeneration 从 billingContext.resolved 派生快照 capabilities（只读引用）；
 *   无 billingContext（免 quote 本地路径）→ 工厂收到 undefined（env 路径不变）。
 */

const { factoryOptionsMock, hoistedDraft } = vi.hoisted(() => ({
  factoryOptionsMock: vi.fn(),
  // 合法 script draft（与 script-runtime-generate.test.ts 同构）；vi.hoisted
  // 保证 vi.mock 工厂（导入期执行）可引用，避免 TDZ。
  hoistedDraft: {
    script_text:
      "楚王第一次压晏子的时候，压的不是身高，而是齐国的面子。可晏子没有退，他知道今天只要退一次，后面每一次都会压上来。入楚受辱只是开始，真正厉害的是他把每次当众羞辱都原样顶了回去。到橘枳之喻落下来时，楚国想压人的场面已经反过来变成自己失手的场面。这件事真正狠的地方，不是晏子会说，而是他敢在众人面前一次不退。",
    estimated_duration_sec: 86,
    beat_trace: [
      { beat: "入楚受辱", excerpt: "入楚受辱只是开始", confidence: 0.95 },
      { beat: "橘枳之喻", excerpt: "到橘枳之喻落下来时", confidence: 0.96 },
    ],
    quote_trace: [
      { quote: "橘生淮南则为橘", usage_type: "exact", excerpt: "到橘枳之喻落下来时" },
    ],
    opening_span: "楚王第一次压晏子的时候，压的不是身高，而是齐国的面子。",
    ending_span: "这件事真正狠的地方，不是晏子会说，而是他敢在众人面前一次不退。",
  },
}));

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
      invokeStructuredPrompt: async () => hoistedDraft,
      invokeStrictStructured: async () => {
        throw new Error("reviewer down (mock)");
      },
    };
  },
  resolveTierProviderSnapshot: vi.fn(),
}));

import {
  createScriptWriterGateway,
  generateScriptDraft,
} from "../../../backend/src/modules/script/script-generation.service.js";
import { createSemanticReviewerGateway } from "../../../backend/src/modules/script/script-semantic-review.service.js";
import { runScriptGeneration } from "../../../backend/src/modules/script/script-run.service.js";
import { createDbClient } from "../../../backend/src/db/client.js";
import { createLegacyProject as createProject } from "../projects/legacy-project.fixture.js";
import {
  ScriptDraftPackage,
  type ResolvedCapabilityMap,
  type ResolvedGenerationConfigurationV1,
} from "../../../shared/src/index.js";

const runtimeDraft = ScriptDraftPackage.parse(hoistedDraft);

/** 快照冻结的 capabilities：llm.smart fixed 到候选模型、其余 auto（auto 同样冻结模型）。 */
const SNAPSHOT_CAPABILITIES: ResolvedCapabilityMap = {
  "llm.smart": {
    mode: "fixed",
    provider_model_id: "llm.smart.deepseek.deepseek-v4-pro",
    provider_key: "deepseek",
    model_id: "deepseek-v4-pro",
  },
  "llm.flash": {
    mode: "auto",
    provider_model_id: "llm.flash.zhipu.glm-4",
    provider_key: "zhipu",
    model_id: "glm-4",
  },
  "image.generate": { mode: "auto", provider_model_id: "img", provider_key: "dashscope", model_id: "wanx" },
  "video.image_to_video": { mode: "auto", provider_model_id: "vid", provider_key: "dashscope", model_id: "wan" },
  "tts.synthesize": { mode: "auto", provider_model_id: "tts", provider_key: "dashscope", model_id: "qwen" },
};

function buildResolved(): ResolvedGenerationConfigurationV1 {
  return {
    schema_version: "resolved_generation_configuration_v1",
    source_revisions: {
      source_user_preference_revision: null,
      project_configuration_revision: 1,
    },
    effective: {} as never,
    resolved_capabilities: SNAPSHOT_CAPABILITIES,
    segment_visual_routes: [],
    constraints_applied: [],
    resolution_trace: [],
    resolved_creative: {
      voice: { mode: "auto", voice_profile_id: null, kind: null, provider_name: null, target_model: null },
      art_style: { mode: "none", preset_id: null, preset_version: null, resolved_params: null },
      subtitle: { mode: "none", preset_id: null, preset_version: null, resolved_style: null, applied_overrides: {} },
    },
    configuration_hash: "fnv1a64:1111111111111111",
    catalog_hash: "fnv1a64:2222222222222222",
  };
}

describe("script 链快照接线（S2-2C）", () => {
  beforeEach(() => {
    factoryOptionsMock.mockReset();
  });

  it("createScriptWriterGateway 把 snapshotCapabilities 透传给工厂", () => {
    const gateway = createScriptWriterGateway(SNAPSHOT_CAPABILITIES);
    expect(gateway).toBeDefined();
    expect(factoryOptionsMock).toHaveBeenCalledWith({ snapshotCapabilities: SNAPSHOT_CAPABILITIES });
  });

  it("createScriptWriterGateway 无快照 → 工厂收到 undefined（env 路径不变）", () => {
    createScriptWriterGateway();
    expect(factoryOptionsMock).toHaveBeenCalledWith(undefined);
  });

  it("createSemanticReviewerGateway 把 snapshotCapabilities 透传给工厂（shadow reviewer 跟随 smart 槽位）", () => {
    createSemanticReviewerGateway(SNAPSHOT_CAPABILITIES);
    expect(factoryOptionsMock).toHaveBeenCalledWith({ snapshotCapabilities: SNAPSHOT_CAPABILITIES });
  });

  it("generateScriptDraft 快照参数透传：snapshotCapabilities → writer gateway → 工厂", async () => {
    await generateScriptDraft({
      bundle: { hard_lane: { must_include_beats: [] } } as never,
      snapshotCapabilities: SNAPSHOT_CAPABILITIES,
    });
    expect(factoryOptionsMock).toHaveBeenCalledWith({ snapshotCapabilities: SNAPSHOT_CAPABILITIES });
  });

  it("runScriptGeneration 从 billingContext.resolved 派生快照 capabilities（单一真相源）", async () => {
    const db = createDbClient();
    const project = await createProject(db, { name: "S2-2C script wiring" });
    const now = new Date();
    db.topicPackages.set("tp_s2c_001", {
      id: "tp_s2c_001",
      projectId: project.id,
      eventRegistryEntryId: "ev_001",
      canonicalName: "晏子使楚",
      title: "晏子使楚",
      selectedAngle: "外交压场型",
      familyLabel: "diplomacy",
      scopeLabel: "single_event",
      coreConflict: "楚王当众压场，晏子必须当场顶回。",
      strongScene: "楚王连续压场，晏子一句句顶回去。",
      stakes: "使节尊严与国格",
      packagingSeed: "一句话改变整个房间的气氛。",
      canonicalQuotesJson: [],
      canonicalQuoteIntentsJson: [],
      durationBandJson: { label: "medium" },
      narrativeTensionMapJson: {
        hook_claim: "楚王当众压场",
        pressure_escalation: "连续羞辱",
        mid_reveal: "晏子反击",
        peak_payoff: "全场噤声",
        ending_residue: "使节尊严立住",
      },
      mustIncludeBeatsJson: [],
      forbiddenExpansionsJson: [],
      riskHintsJson: [],
      sourceAnchorRefsJson: ["《晏子春秋》"],
      ambiguityNotesJson: [],
      createdAt: now,
    } as never);
    project.activeTopicPackageId = "tp_s2c_001";

    const snapshot = {
      id: "snap_s2c_001",
      projectId: project.id,
      userId: project.ownerId,
      stage: "script",
      operation: "script.generate",
      runId: "run_s2c_001",
      projectConfigurationRevision: 1,
      schemaVersion: "run_configuration_snapshot_v1",
      configurationHash: "fnv1a64:1111111111111111",
      resolvedConfigurationJson: buildResolved() as unknown as Record<string, unknown>,
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

    const billingContext = {
      db,
      snapshot: snapshot as never,
      runId: "run_s2c_001",
      operation: "script.generate" as const,
      resolved: buildResolved(),
    };

    const response = await runScriptGeneration({
      db,
      project,
      billingContext: billingContext as never,
      allowPatch: false,
      allowRegen: false,
    });

    expect(response.statusCode).toBe(200);
    // writer 与 reviewer 两条 gateway 构造都收到同一快照引用（单一真相源）
    expect(factoryOptionsMock).toHaveBeenCalledWith({ snapshotCapabilities: SNAPSHOT_CAPABILITIES });
  });

  it("runScriptGeneration 无 billingContext（免 quote 本地路径）→ 工厂收到 undefined", async () => {
    const db = createDbClient();
    const project = await createProject(db, { name: "S2-2C script local path" });
    const now = new Date();
    db.topicPackages.set("tp_s2c_002", {
      id: "tp_s2c_002",
      projectId: project.id,
      eventRegistryEntryId: "ev_002",
      canonicalName: "晏子使楚",
      title: "晏子使楚",
      selectedAngle: "外交压场型",
      familyLabel: "diplomacy",
      scopeLabel: "single_event",
      coreConflict: "楚王当众压场，晏子必须当场顶回。",
      strongScene: "楚王连续压场，晏子一句句顶回去。",
      stakes: "使节尊严与国格",
      packagingSeed: "一句话改变整个房间的气氛。",
      canonicalQuotesJson: [],
      canonicalQuoteIntentsJson: [],
      durationBandJson: { label: "medium" },
      narrativeTensionMapJson: {
        hook_claim: "楚王当众压场",
        pressure_escalation: "连续羞辱",
        mid_reveal: "晏子反击",
        peak_payoff: "全场噤声",
        ending_residue: "使节尊严立住",
      },
      mustIncludeBeatsJson: [],
      forbiddenExpansionsJson: [],
      riskHintsJson: [],
      sourceAnchorRefsJson: ["《晏子春秋》"],
      ambiguityNotesJson: [],
      createdAt: now,
    } as never);
    project.activeTopicPackageId = "tp_s2c_002";

    const response = await runScriptGeneration({
      db,
      project,
      allowPatch: false,
      allowRegen: false,
    });

    expect(response.statusCode).toBe(200);
    // 免 quote 本地路径：gateway 构造收到 undefined（env 路径，行为不变）
    for (const call of factoryOptionsMock.mock.calls) {
      expect(call[0]).toBeUndefined();
    }
  });
});
