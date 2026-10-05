import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * S2-2C 任务 7（详细设计 §7）：LLM 候选常量表 + seed 多候选 + readiness 分层。
 *
 * - 非 stub 部署下 llm.smart/llm.flash 各含默认条目（tier 解析模型，
 *   isDefault=true）+ 候选条目（另一模型，isDefault=false）；每槽恰好一个默认。
 * - 目录元数据合同（外部审查 P2）：同一模型跨槽位 displayName/qualityTier/
 *   speedTier 一致且来自候选声明；tier 解析模型不在候选表 → 回退槽位默认。
 * - 候选预解析失败（provider 未注册/凭据缺失）→ 不种入目录。
 * - readiness 分层：llm_tier_mismatch 只对默认条目；非默认条目校验候选集；
 *   目录被手工改动出候选集外 → issue（防漂移）。
 * - stub 部署不种候选；媒体 additionalModels 种入对应槽位（非默认）。
 */

import { createDbClient } from "../../../backend/src/db/client.js";
import type { ProviderModelCatalogRecord } from "../../../backend/src/db/client.js";
import {
  buildPricingCatalogSeed,
  DASHSCOPE_MEDIA_CANDIDATES_V1,
  type LlmTierSeedInput,
} from "../../../backend/src/modules/generation-cost/pricing-catalog.seed.js";
import {
  evaluateGenerationCapabilityReadiness,
  type GenerationCapabilityReadinessInput,
} from "../../../backend/src/modules/generation-cost/generation-capability-readiness.js";
import {
  resolveGenerationCostBootstrapInput,
} from "../../../backend/src/modules/generation-cost/generation-cost-bootstrap.js";
import { LLM_MODEL_CANDIDATES_V1 } from "../../../backend/src/modules/generation-cost/llm-model-catalog.js";
import { DEFAULT_GENERATION_CONFIGURATION } from "../../../shared/src/generation/generation-configuration.schema.js";
import { resolveGenerationConfiguration } from "../../../shared/src/generation/generation-configuration-resolver.js";

const RESOLVED_LLM: Extract<LlmTierSeedInput, { mode: "resolved" }> = {
  mode: "resolved",
  smart: { providerKey: "deepseek", modelId: "deepseek-v4-pro" },
  flash: { providerKey: "zhipu", modelId: "glm-4" },
};

const MEDIA_READY = {
  registeredModels: [
    { capability: "image.generate" as const, providerKey: "dashscope", modelId: "wan2.6-t2i" },
    { capability: "video.image_to_video" as const, providerKey: "dashscope", modelId: "wan2.7-i2v-2026-04-25" },
    // 内置媒体候选从 seed 常量派生（与生产 bootstrap 同源）；手写镜像会重现
    // "目录行被判 media_model_not_registered" 的漂移。
    ...DASHSCOPE_MEDIA_CANDIDATES_V1,
    { capability: "tts.synthesize" as const, providerKey: "dashscope", modelId: "qwen3-tts-instruct-flash" },
  ],
  credentialConfigured: true,
  deploymentScope: "cn-beijing" as const,
};

const NORMAL_ENVIRONMENT = { testEnv: false };

function readinessInput(
  overrides: Partial<GenerationCapabilityReadinessInput> & {
    catalog: ProviderModelCatalogRecord[];
  },
): GenerationCapabilityReadinessInput {
  return {
    llm: RESOLVED_LLM,
    media: MEDIA_READY,
    environment: NORMAL_ENVIRONMENT,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("LLM 候选表 seed（S2-2C §7.1）", () => {
  it("两槽提供 DeepSeek V4 Flash 与 GLM-5.3-Flash，fixed 选择解析到准确模型", () => {
    const seed = buildPricingCatalogSeed({
      llm: { ...RESOLVED_LLM, candidates: LLM_MODEL_CANDIDATES_V1 },
      media: { deploymentScope: "cn-beijing" },
    });
    const readiness = evaluateGenerationCapabilityReadiness(readinessInput({
      llmCandidates: LLM_MODEL_CANDIDATES_V1,
      catalog: seed,
    }));
    for (const slot of ["llm.smart", "llm.flash"] as const) {
      for (const [providerKey, modelId] of [
        ["deepseek", "deepseek-v4-flash"],
        ["zhipu", "glm-5.3-flash"],
      ]) {
        const id = `${slot}.${providerKey}.${modelId}`;
        const entry = seed.find((e) => e.id === id);
        expect(entry, id).toBeDefined();
        expect(readiness.items[id]?.realDispatchAllowed, id).toBe(true);
        const resolved = resolveGenerationConfiguration({
          projectConfiguration: {
            ...DEFAULT_GENERATION_CONFIGURATION,
            capabilities: {
              ...DEFAULT_GENERATION_CONFIGURATION.capabilities,
              [slot]: { mode: "fixed", provider_model_id: id },
            },
          },
          projectConfigurationRevision: 1,
          sourceUserPreferenceRevision: 1,
          systemConstraints: { apiVideoProviderEnabled: true },
          providerModelCatalog: seed.map((e) => ({
            provider_model_id: e.id, capability: e.capability,
            provider_key: e.providerKey, model_id: e.modelId,
            status: e.status, is_default: e.isDefault,
          })),
          operation: "assets.generate",
        });
        expect(resolved.ok, id).toBe(true);
        if (!resolved.ok) throw new Error(JSON.stringify(resolved.error));
        expect(resolved.value.resolved_capabilities[slot]).toMatchObject({
          provider_model_id: id, provider_key: providerKey, model_id: modelId,
        });
      }
    }
  });

  it("两槽 tier 使用 DeepSeek V4 Flash 时默认唯一、去重，auto 解析到 Flash", () => {
    const seed = buildPricingCatalogSeed({
      llm: {
        mode: "resolved",
        smart: { providerKey: "deepseek", modelId: "deepseek-v4-flash" },
        flash: { providerKey: "deepseek", modelId: "deepseek-v4-flash" },
        candidates: LLM_MODEL_CANDIDATES_V1,
      },
      media: { deploymentScope: "cn-beijing" },
    });
    const resolved = resolveGenerationConfiguration({
      projectConfiguration: DEFAULT_GENERATION_CONFIGURATION,
      projectConfigurationRevision: 1,
      sourceUserPreferenceRevision: null,
      systemConstraints: { apiVideoProviderEnabled: true },
      providerModelCatalog: seed.map((e) => ({
        provider_model_id: e.id, capability: e.capability,
        provider_key: e.providerKey, model_id: e.modelId,
        status: e.status, is_default: e.isDefault,
      })),
      operation: "assets.generate",
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.error));
    for (const slot of ["llm.smart", "llm.flash"] as const) {
      const entries = seed.filter((e) => e.capability === slot);
      expect(entries.filter((e) => e.isDefault)).toHaveLength(1);
      expect(entries.filter((e) => e.modelId === "deepseek-v4-flash")).toHaveLength(1);
      expect(resolved.value.resolved_capabilities[slot]).toMatchObject({
        provider_key: "deepseek", model_id: "deepseek-v4-flash",
      });
    }
  });

  it("非 stub 部署：每槽默认条目 + 候选条目（非默认，与默认重合去重），每槽恰好一个默认", () => {
    const seed = buildPricingCatalogSeed({
      llm: { ...RESOLVED_LLM, candidates: LLM_MODEL_CANDIDATES_V1 },
      media: { deploymentScope: "cn-beijing" },
    });
    for (const slot of ["llm.smart", "llm.flash"] as const) {
      const entries = seed.filter((e) => e.capability === slot && e.status === "active");
      const defaults = entries.filter((e) => e.isDefault);
      expect(defaults, slot).toHaveLength(1);
      const candidates = entries.filter((e) => !e.isDefault);
      expect(candidates.length, slot).toBeGreaterThanOrEqual(1);
      // 候选与默认不重复种入（同 provider:model 只出现一次）
      const keys = entries.map((e) => `${e.providerKey}:${e.modelId}`);
      expect(new Set(keys).size, slot).toBe(keys.length);
    }
    // 保留旧 tier 配置时默认不变，新增候选通过明确 modelId 定位。
    const smartDefault = seed.find((e) => e.capability === "llm.smart" && e.isDefault)!;
    expect(smartDefault.providerKey).toBe("deepseek");
    expect(smartDefault.modelId).toBe("deepseek-v4-pro");
    const smartCandidate = seed.find((e) => e.capability === "llm.smart" && e.modelId === "glm-5")!;
    expect(smartCandidate.providerKey).toBe("zhipu");
    expect(smartCandidate.modelId).toBe("glm-5");
    const flashDefault = seed.find((e) => e.capability === "llm.flash" && e.isDefault)!;
    expect(flashDefault.providerKey).toBe("zhipu");
    expect(flashDefault.modelId).toBe("glm-4");
    const flashCandidate = seed.find((e) => e.capability === "llm.flash" && !e.isDefault)!;
    expect(flashCandidate.providerKey).toBe("deepseek");
    expect(flashCandidate.modelId).toBe("deepseek-v4-flash");
    // 回归：flash 槽不得再出现 deepseek-v4-pro
    expect(
      seed.find((e) => e.capability === "llm.flash" && e.modelId === "deepseek-v4-pro"),
    ).toBeUndefined();
  });

  it("目录元数据合同：同一模型跨槽位 displayName/qualityTier/speedTier 一致且来自候选声明", () => {
    const seed = buildPricingCatalogSeed({
      llm: { ...RESOLVED_LLM, candidates: LLM_MODEL_CANDIDATES_V1 },
      media: { deploymentScope: "cn-beijing" },
    });
    // deepseek-v4-pro 是 smart 默认——元数据来自候选声明
    const smartDefault = seed.find(
      (e) => e.capability === "llm.smart" && e.isDefault && e.modelId === "deepseek-v4-pro",
    )!;
    expect(smartDefault.displayName).toBe("DeepSeek V4 Pro");
    expect(smartDefault.qualityTier).toBe("high");
    expect(smartDefault.speedTier).toBe("slow");
    // deepseek-v4-flash 是 flash 候选——元数据来自候选声明
    const flashCandidate = seed.find(
      (e) => e.capability === "llm.flash" && !e.isDefault && e.modelId === "deepseek-v4-flash",
    )!;
    expect(flashCandidate.displayName).toBe("DeepSeek V4 Flash");
    expect(flashCandidate.qualityTier).toBe("standard");
    expect(flashCandidate.speedTier).toBe("fast");
    // smart 候选 glm-5——元数据来自候选声明
    const smartCandidate = seed.find(
      (e) => e.capability === "llm.smart" && !e.isDefault && e.modelId === "glm-5",
    )!;
    expect(smartCandidate.displayName).toBe("智谱 GLM-5");
    expect(smartCandidate.qualityTier).toBe("standard");
    expect(smartCandidate.speedTier).toBe("fast");
    // glm-4 是 flash 默认——元数据来自候选声明；且 smart 槽不得再出现 glm-4
    const flashDefault = seed.find(
      (e) => e.capability === "llm.flash" && e.isDefault && e.modelId === "glm-4",
    )!;
    expect(flashDefault.displayName).toBe("智谱 GLM-4");
    expect(flashDefault.qualityTier).toBe("standard");
    expect(flashDefault.speedTier).toBe("fast");
    expect(
      seed.find((e) => e.capability === "llm.smart" && e.modelId === "glm-4"),
    ).toBeUndefined();
  });

  it("tier 解析模型不在候选表 → 回退槽位默认元数据（displayName=provider:model）", () => {
    const seed = buildPricingCatalogSeed({
      llm: {
        mode: "resolved",
        smart: { providerKey: "custom", modelId: "custom-model" },
        flash: { reusesSmart: true },
        candidates: LLM_MODEL_CANDIDATES_V1,
      },
      media: { deploymentScope: "cn-beijing" },
    });
    const smartDefault = seed.find((e) => e.capability === "llm.smart" && e.isDefault)!;
    expect(smartDefault.displayName).toBe("custom:custom-model");
    // 槽位默认兜底（现状语义）
    expect(smartDefault.qualityTier).toBe("high");
    expect(smartDefault.speedTier).toBe("slow");
    // 候选仍种入（非默认）
    const candidates = seed.filter(
      (e) => e.capability === "llm.smart" && !e.isDefault && e.status === "active",
    );
    expect(candidates.map((e) => `${e.providerKey}:${e.modelId}`).sort()).toEqual([
      "deepseek:deepseek-v4-flash",
      "deepseek:deepseek-v4-pro",
      "zhipu:glm-5",
      "zhipu:glm-5.3-flash",
    ]);
  });

  it("stub 部署：目录只有 stub 默认条目，无候选", () => {
    const seed = buildPricingCatalogSeed({
      llm: { mode: "stub", candidates: LLM_MODEL_CANDIDATES_V1 },
      media: { deploymentScope: "cn-beijing" },
    });
    const llmEntries = seed.filter((e) => e.capability.startsWith("llm."));
    expect(llmEntries).toHaveLength(2);
    expect(llmEntries.every((e) => e.providerKey === "stub" && e.modelId === "stub-model" && e.isDefault)).toBe(
      true,
    );
  });
});

describe("媒体 additionalModels（S2-2C §7.2）", () => {
  it("种入对应槽位（非默认），registeredModels 含候选时目录项 quotable", () => {
    const seed = buildPricingCatalogSeed({
      llm: { mode: "stub" },
      media: {
        deploymentScope: "cn-beijing",
        additionalModels: [
          { capability: "image.generate", providerKey: "dashscope", modelId: "wanx-candidate" },
        ],
      },
    });
    const candidate = seed.find(
      (e) => e.capability === "image.generate" && e.modelId === "wanx-candidate",
    )!;
    expect(candidate.modelId).toBe("wanx-candidate");
    expect(candidate.status).toBe("active");

    const result = evaluateGenerationCapabilityReadiness(
      readinessInput({
        llm: { mode: "stub" },
        media: {
          registeredModels: [
            ...MEDIA_READY.registeredModels,
            { capability: "image.generate", providerKey: "dashscope", modelId: "wanx-candidate" },
          ],
          credentialConfigured: true,
          deploymentScope: "cn-beijing",
        },
        catalog: seed,
      }),
    );
    expect(result.items[candidate.id]?.quotable).toBe(true);
  });
});

describe("候选预解析（S2-2C §7.1 bootstrap 层）", () => {
  it("预解析失败的候选（provider 未注册/凭据缺失）→ 不种入目录", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const input = resolveGenerationCostBootstrapInput({
      llmProvider: "openai",
      resolveTierSnapshot: () =>
        ({
          smart: { tier: "smart", provider: "deepseek", model: "deepseek-v4-pro", baseUrl: "https://x", apiKey: "k" },
          flashReusesSmart: true,
        }) as never,
      mediaCredentialConfigured: false,
      readDashscopeMediaConfig: () => {
        throw new Error("must not be called without credentials");
      },

      testEnv: false,
      llmCandidates: LLM_MODEL_CANDIDATES_V1,
      resolveCandidateModel: (candidate) =>
        candidate.providerKey === "deepseek" ? { ok: true } : { ok: false },
    });
    expect(input.llmCandidates).toEqual([LLM_MODEL_CANDIDATES_V1[0]!, LLM_MODEL_CANDIDATES_V1[1]!]);
  });

  it("stub 模式忽略候选（不预解析、不种入）", () => {
    const input = resolveGenerationCostBootstrapInput({
      llmProvider: "stub",
      resolveTierSnapshot: () => {
        throw new Error("must not be called in stub mode");
      },
      mediaCredentialConfigured: false,
      readDashscopeMediaConfig: () => {
        throw new Error("must not be called without credentials");
      },

      testEnv: false,
      llmCandidates: LLM_MODEL_CANDIDATES_V1,
      resolveCandidateModel: () => ({ ok: true }),
    });
    expect(input.llmCandidates).toBeUndefined();
  });
});

describe("readiness 分层校验（S2-2C §7.3）", () => {
  it("默认条目 tier 匹配 + 非默认条目在候选集 → 全部 quotable", () => {
    const seed = buildPricingCatalogSeed({
      llm: { ...RESOLVED_LLM, candidates: LLM_MODEL_CANDIDATES_V1 },
      media: { deploymentScope: "cn-beijing" },
    });
    const result = evaluateGenerationCapabilityReadiness(
      readinessInput({
        llmCandidates: LLM_MODEL_CANDIDATES_V1,
        catalog: seed,
      }),
    );
    const wsId = "tts.synthesize.dashscope.cn-beijing.qwen-audio-3.0-tts-plus";
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => [i.provider_model_id, i.code]).sort()).toEqual([
      [wsId, "media_execution_protocol_incompatible"], [wsId, "media_model_not_registered"],
    ]);
    expect(result.items[wsId]).toMatchObject({ quotable: false, realDispatchAllowed: false });
    for (const entry of seed) {
      if (entry.status === "active" && entry.id !== wsId) {
        expect(result.items[entry.id]?.quotable, entry.id).toBe(true);
      }
    }
  });

  it("llm_tier_mismatch 只对默认条目：默认与 tier 不一致被拒，非默认候选不受影响", () => {
    const seed = buildPricingCatalogSeed({
      llm: { ...RESOLVED_LLM, candidates: LLM_MODEL_CANDIDATES_V1 },
      media: { deploymentScope: "cn-beijing" },
    });
    // tier flash 实际解析为 deepseek:deepseek-v4-pro（目录默认是 zhipu:glm-4）
    const result = evaluateGenerationCapabilityReadiness(
      readinessInput({
        llm: {
          mode: "resolved",
          smart: { providerKey: "deepseek", modelId: "deepseek-v4-pro" },
          flash: { providerKey: "deepseek", modelId: "deepseek-v4-pro" },
        },
        llmCandidates: LLM_MODEL_CANDIDATES_V1,
        catalog: seed,
      }),
    );
    const flashDefault = seed.find((e) => e.capability === "llm.flash" && e.isDefault)!;
    expect(result.items[flashDefault.id]?.issues).toContain("llm_tier_mismatch");
    expect(result.items[flashDefault.id]?.quotable).toBe(false);
    // 非默认候选（flash 槽的 deepseek-v4-flash）不受 tier mismatch 影响
    const flashCandidate = seed.find(
      (e) => e.capability === "llm.flash" && !e.isDefault && e.modelId === "deepseek-v4-flash",
    )!;
    expect(flashCandidate).toBeDefined();
    expect(result.items[flashCandidate.id]?.issues).not.toContain("llm_tier_mismatch");
    expect(result.items[flashCandidate.id]?.quotable).toBe(true);
  });

  it("目录被手工改动出候选集外 → llm_candidate_not_declared（防漂移）", () => {
    const seed = buildPricingCatalogSeed({
      llm: { ...RESOLVED_LLM, candidates: LLM_MODEL_CANDIDATES_V1 },
      media: { deploymentScope: "cn-beijing" },
    });
    const tampered = seed.map((e) =>
      e.capability === "llm.flash" && !e.isDefault ? { ...e, modelId: "tampered-model" } : e,
    );
    const result = evaluateGenerationCapabilityReadiness(
      readinessInput({
        llmCandidates: LLM_MODEL_CANDIDATES_V1,
        catalog: tampered,
      }),
    );
    const entry = tampered.find((e) => e.capability === "llm.flash" && !e.isDefault)!;
    expect(result.items[entry.id]?.issues).toContain("llm_candidate_not_declared");
    expect(result.items[entry.id]?.quotable).toBe(false);
    // 默认条目不受影响
    const flashDefault = tampered.find((e) => e.capability === "llm.flash" && e.isDefault)!;
    expect(result.items[flashDefault.id]?.quotable).toBe(true);
  });

  it("candidates 缺省时非默认 LLM 条目按目录漂移拒绝（安全方向）", () => {
    const seed = buildPricingCatalogSeed({
      llm: { ...RESOLVED_LLM, candidates: LLM_MODEL_CANDIDATES_V1 },
      media: { deploymentScope: "cn-beijing" },
    });
    // 不传 llmCandidates（旧调用方）：非默认条目无候选声明可校验 → 拒绝
    const result = evaluateGenerationCapabilityReadiness(
      readinessInput({ catalog: seed }),
    );
    const candidate = seed.find((e) => e.capability === "llm.smart" && !e.isDefault)!;
    expect(result.items[candidate.id]?.issues).toContain("llm_candidate_not_declared");
    expect(result.items[candidate.id]?.quotable).toBe(false);
  });

  it("默认项唯一性/区域/凭据既有语义不变（回归锚点）", () => {
    // 零默认项：capability 级失败仍生效（含候选条目不可报价）
    const seed = buildPricingCatalogSeed({
      llm: { ...RESOLVED_LLM, candidates: LLM_MODEL_CANDIDATES_V1 },
      media: { deploymentScope: "cn-beijing" },
    });
    const noDefault = seed.map((e) =>
      e.capability === "llm.smart" && e.isDefault ? { ...e, isDefault: false } : e,
    );
    const result = evaluateGenerationCapabilityReadiness(
      readinessInput({
        llmCandidates: LLM_MODEL_CANDIDATES_V1,
        catalog: noDefault,
      }),
    );
    expect(
      result.issues.some(
        (i) => i.capability === "llm.smart" && i.code === "catalog_missing_active_default",
      ),
    ).toBe(true);
    for (const entry of noDefault.filter((e) => e.capability === "llm.smart")) {
      expect(result.items[entry.id]?.quotable).toBe(false);
    }

    // 媒体凭据未配置：媒体条目（含 additionalModels 候选）不可报价
    const mediaSeed = buildPricingCatalogSeed({
      llm: { mode: "stub" },
      media: {
        deploymentScope: "cn-beijing",
        additionalModels: [
          { capability: "image.generate", providerKey: "dashscope", modelId: "wanx-candidate" },
        ],
      },
    });
    const unconfigured = evaluateGenerationCapabilityReadiness(
      readinessInput({
        llm: { mode: "stub" },
        media: { registeredModels: [...MEDIA_READY.registeredModels], credentialConfigured: false, deploymentScope: "cn-beijing" },
        catalog: mediaSeed,
      }),
    );
    for (const entry of mediaSeed.filter(
      (e) => e.status === "active" && (e.capability === "image.generate" || e.capability === "video.image_to_video" || e.capability === "tts.synthesize"),
    )) {
      expect(unconfigured.items[entry.id]?.quotable).toBe(false);
      expect(unconfigured.items[entry.id]?.issues).toContain("media_credential_unconfigured");
    }
  });
});

describe("seed 输入缺省回归", () => {
  it("llm candidates 缺省 → 只种默认条目（现状行为不变）", () => {
    const db = createDbClient();
    void db;
    const seed = buildPricingCatalogSeed({
      llm: RESOLVED_LLM,
      media: { deploymentScope: "cn-beijing" },
    });
    const llmEntries = seed.filter((e) => e.capability.startsWith("llm."));
    expect(llmEntries).toHaveLength(2);
    expect(llmEntries.every((e) => e.isDefault)).toBe(true);
  });
});
