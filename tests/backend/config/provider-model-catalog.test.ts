import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import type { ProviderModelCatalogRecord } from "../../../backend/src/db/client.js";
import { env } from "../../../backend/src/config/env.js";
import {
  buildPricingCatalogSeed,
  MEDIA_PRICING_VERSION,
  SEED_EFFECTIVE_AT,
} from "../../../backend/src/modules/generation-cost/pricing-catalog.seed.js";
import {
  applyProviderModelCatalogSeed,
  listProviderModelCatalog,
} from "../../../backend/src/modules/generation-cost/provider-model-catalog.repository.js";
import {
  evaluateGenerationCapabilityReadiness,
  type GenerationCapabilityReadinessInput,
} from "../../../backend/src/modules/generation-cost/generation-capability-readiness.js";
import {
  bootstrapGenerationCostCatalog,
  resolveGenerationCostBootstrapInput,
} from "../../../backend/src/modules/generation-cost/generation-cost-bootstrap.js";
import { listPublicGenerationCapabilities } from "../../../backend/src/modules/generation-config/generation-config.repository.js";

/**
 * S2-2A 任务 7：provider/model 目录 seed、repository 与 readiness 交叉校验测试。
 *
 * 合同来源：docs/plans/2026-08-12-s2-2a-configuration-cost-foundation-implementation-plan.md
 * 任务 7 步骤 1/步骤 2；详细设计 4.3 节（ProviderModelCatalog）。
 */

/** 与 seed 媒体模型一致的 adapter 支持矩阵（capability/provider/model 精确匹配）。 */
const DASHSCOPE_REGISTERED_MODELS = [
  { capability: "image.generate" as const, providerKey: "dashscope", modelId: "wan2.6-t2i" },
  { capability: "video.image_to_video" as const, providerKey: "dashscope", modelId: "wan2.7-i2v-2026-04-25" },
  { capability: "tts.synthesize" as const, providerKey: "dashscope", modelId: "qwen3-tts-instruct-flash" },
];

const REAL_TIER_INPUT = {
  llm: {
    mode: "resolved" as const,
    smart: { providerKey: "deepseek", modelId: "deepseek-v4-pro" },
    flash: { providerKey: "zhipu", modelId: "glm-4" },
  },
  media: {
    registeredModels: DASHSCOPE_REGISTERED_MODELS,
    credentialConfigured: true,
  },
  environment: { demoMode: false, testEnv: false },
};

const STUB_TIER_INPUT = {
  ...REAL_TIER_INPUT,
  llm: { mode: "stub" as const },
};

describe("pricing catalog seed", () => {
  it("provides DashScope catalog records for image, image-to-video and tts capabilities", () => {
    const seed = buildPricingCatalogSeed(REAL_TIER_INPUT);
    const byCapability = new Map(seed.map((e) => [e.capability, e]));

    const image = byCapability.get("image.generate");
    expect(image?.providerKey).toBe("dashscope");
    expect(image?.modelId).toBe("wan2.6-t2i");
    expect(image?.status).toBe("active");
    expect(image?.isDefault).toBe(true);

    const video = byCapability.get("video.image_to_video");
    expect(video?.providerKey).toBe("dashscope");
    expect(video?.modelId).toBe("wan2.7-i2v-2026-04-25");
    expect(video?.status).toBe("active");
    expect(video?.isDefault).toBe(true);

    const tts = byCapability.get("tts.synthesize");
    expect(tts?.providerKey).toBe("dashscope");
    expect(tts?.modelId).toBe("qwen3-tts-instruct-flash");
    expect(tts?.status).toBe("active");
    expect(tts?.isDefault).toBe(true);
  });

  it("maps llm.smart and llm.flash to the resolved real tier provider/model", () => {
    const seed = buildPricingCatalogSeed(REAL_TIER_INPUT);
    const byCapability = new Map(seed.map((e) => [e.capability, e]));

    expect(byCapability.get("llm.smart")?.providerKey).toBe("deepseek");
    expect(byCapability.get("llm.smart")?.modelId).toBe("deepseek-v4-pro");
    expect(byCapability.get("llm.flash")?.providerKey).toBe("zhipu");
    expect(byCapability.get("llm.flash")?.modelId).toBe("glm-4");
    // LLM seed 目录不从 providers.json 自动派生连接信息，只映射 provider/model 与价格元数据。
    const smart = byCapability.get("llm.smart");
    expect(JSON.stringify(smart)).not.toContain("baseUrl");
    expect(JSON.stringify(smart)).not.toContain("apiKey");
    expect(JSON.stringify(smart)).not.toContain("LLM_PROVIDER_");
  });

  it("maps stub llm tiers to zero external cost", () => {
    const seed = buildPricingCatalogSeed(STUB_TIER_INPUT);
    const byCapability = new Map(seed.map((e) => [e.capability, e]));
    for (const slot of ["llm.smart", "llm.flash"] as const) {
      const entry = byCapability.get(slot)!;
      expect(entry.providerKey).toBe("stub");
      expect(entry.pricingJson).toMatchObject({
        unit_type: "token",
        currency: "CNY",
        free: true,
        input_price_micros_per_million_tokens: "0",
        output_price_micros_per_million_tokens: "0",
      });
    }
  });

  it("reuses the smart provider/model for flash when flash tier is not separately configured", () => {
    const seed = buildPricingCatalogSeed({
      llm: {
        mode: "resolved" as const,
        smart: { providerKey: "deepseek", modelId: "deepseek-v4-pro" },
        flash: { reusesSmart: true },
      },
    });
    const byCapability = new Map(seed.map((e) => [e.capability, e]));
    expect(byCapability.get("llm.flash")?.providerKey).toBe("deepseek");
    expect(byCapability.get("llm.flash")?.modelId).toBe("deepseek-v4-pro");
  });

  it("keeps api video quality (720p/1080p) separate from remotion render resolution", () => {
    const seed = buildPricingCatalogSeed(REAL_TIER_INPUT);
    const video = seed.find((e) => e.capability === "video.image_to_video")!;
    // 目录只声明 API 视频质量档位，不出现 Remotion 成片分辨率语义（720P/1080P 像素串）。
    const caps = JSON.stringify(video.parameterCapabilitiesJson);
    expect(caps).toContain("standard_720p");
    expect(caps).toContain("high_1080p");
    expect(caps).not.toContain("720P");
    expect(caps).not.toContain("1080P");
    const pricing = video.pricingJson as {
      price_micros_per_second_by_quality: Record<string, string>;
    };
    expect(Object.keys(pricing.price_micros_per_second_by_quality).sort()).toEqual([
      "high_1080p",
      "standard_720p",
    ]);
  });

  it("carries pricing version, effective time and source notes without secrets or env var names", () => {
    const seed = buildPricingCatalogSeed(REAL_TIER_INPUT);
    expect(MEDIA_PRICING_VERSION).toMatch(/^dashscope-media-\d{4}-\d{2}-\d{2}$/);
    expect(SEED_EFFECTIVE_AT).toMatch(/^\d{4}-\d{2}-\d{2}/);
    for (const entry of seed) {
      expect(entry.pricingVersion.length).toBeGreaterThan(0);
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toContain("API_KEY");
      expect(serialized).not.toContain("apiKeyEnv");
      expect(serialized).not.toMatch(/sk-[a-zA-Z0-9]/);
    }
    // 每个价格条目都要有来源备注（价格必须可解释）。
    const mediaEntry = seed.find((e) => e.capability === "image.generate")!;
    expect(mediaEntry.pricingJson).toHaveProperty("source_note");
  });

  it("marks exactly one active default entry per capability", () => {
    const seed = buildPricingCatalogSeed(REAL_TIER_INPUT);
    const capabilities = new Set(seed.map((e) => e.capability));
    expect(capabilities.size).toBe(5);
    for (const capability of capabilities) {
      const activeDefaults = seed.filter(
        (e) => e.capability === capability && e.status === "active" && e.isDefault,
      );
      expect(activeDefaults.length, `capability ${capability}`).toBe(1);
    }
  });

  it("exposes media credential presence via env without leaking the credential", () => {
    // env.generation.mediaCredentialConfigured 是"unconfigured 环境"判定的单一 env 来源；
    // 具体值取决于运行环境，这里只锁定字段存在与类型，以及快照不含凭据值。
    expect(typeof env.generation.mediaCredentialConfigured).toBe("boolean");
    expect(JSON.stringify(env.generation)).not.toMatch(/sk-[a-zA-Z0-9]+/);
    expect(JSON.stringify(env.generation)).not.toContain("ALIYUN_DASHSCOPE_API_KEY=");
  });
});

/** 任务 2 迁移种下的占位行（dashscope LLM + 空 pricing），seed 应用后必须被禁用。 */
function makeStaleMigrationRow(): ProviderModelCatalogRecord {
  const now = new Date();
  return {
    id: "llm.smart.dashscope.qwen-max",
    capability: "llm.smart",
    providerKey: "dashscope",
    modelId: "qwen-max",
    modelVersion: null,
    displayName: "通义千问 Max（智能）",
    qualityTier: "high",
    speedTier: "slow",
    parameterCapabilitiesJson: {},
    pricingVersion: "dashscope-llm-2026-08-12",
    pricingJson: {},
    status: "active",
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };
}

describe("provider model catalog repository", () => {

  it("applies the seed and disables stale rows that are not part of the seed", async () => {
    const db = createDbClient();
    const stale = makeStaleMigrationRow();
    db.providerModelCatalog.set(stale.id, stale);

    const seed = buildPricingCatalogSeed(REAL_TIER_INPUT);
    const result = await applyProviderModelCatalogSeed(db, seed);

    expect(result.appliedCount).toBe(seed.length);
    expect(result.disabledStaleIds).toEqual([stale.id]);

    const entries = listProviderModelCatalog(db);
    const staleAfter = entries.find((e) => e.id === stale.id);
    expect(staleAfter?.status).toBe("disabled");
    expect(staleAfter?.isDefault).toBe(false);
    // seed 行全部 active。
    for (const entry of entries.filter((e) => seed.some((s) => s.id === e.id))) {
      expect(entry.status).toBe("active");
    }
  });

  it("is idempotent when the same seed is applied twice", async () => {
    const db = createDbClient();
    const seed = buildPricingCatalogSeed(REAL_TIER_INPUT);
    await applyProviderModelCatalogSeed(db, seed);
    const second = await applyProviderModelCatalogSeed(db, seed);
    expect(second.disabledStaleIds).toEqual([]);
    expect(listProviderModelCatalog(db).length).toBe(seed.length);
  });

  it("persists through the first-aggregate writer before updating the in-memory map", async () => {
    const db = createDbClient();
    const persisted: string[] = [];
    db.firstAggregateWriter = {
      ownerId: "test",
      async saveProviderModelCatalogEntry(record: ProviderModelCatalogRecord) {
        persisted.push(record.id);
      },
    } as never;
    const seed = buildPricingCatalogSeed(REAL_TIER_INPUT);
    await applyProviderModelCatalogSeed(db, seed);
    expect(persisted.length).toBe(seed.length);
    expect(listProviderModelCatalog(db).length).toBe(seed.length);
  });

  it("propagates writer failures and does not update memory for the failed entry", async () => {
    // 对抗（diff_reviewer I-4）：writer 失败必须向上传播，且失败条目不得先入内存。
    const db = createDbClient();
    const seed = buildPricingCatalogSeed(REAL_TIER_INPUT);
    const failingId = seed[0]!.id;
    db.firstAggregateWriter = {
      ownerId: "test",
      async saveProviderModelCatalogEntry(record: ProviderModelCatalogRecord) {
        if (record.id === failingId) {
          throw new Error("simulated writer failure");
        }
      },
    } as never;
    await expect(applyProviderModelCatalogSeed(db, seed)).rejects.toThrow(
      "simulated writer failure",
    );
    expect(db.providerModelCatalog.has(failingId)).toBe(false);
  });
});

describe("generation capability readiness", () => {
  function readinessInput(
    overrides: Partial<GenerationCapabilityReadinessInput> & {
      catalog: ProviderModelCatalogRecord[];
    },
  ): GenerationCapabilityReadinessInput {
    return { ...REAL_TIER_INPUT, ...overrides };
  }

  it("passes for a fully configured real environment", () => {
    const seed = buildPricingCatalogSeed(REAL_TIER_INPUT);
    const result = evaluateGenerationCapabilityReadiness(
      readinessInput({ catalog: seed }),
    );
    expect(result.ok).toBe(true);
    for (const entry of seed) {
      const item = result.items[entry.id];
      expect(item?.quotable, entry.id).toBe(true);
      expect(item?.realDispatchAllowed, entry.id).toBe(true);
    }
  });

  it("fails when a capability has zero active default entries", () => {
    const seed = buildPricingCatalogSeed(REAL_TIER_INPUT).map((e) =>
      e.capability === "llm.smart" ? { ...e, isDefault: false } : e,
    );
    const result = evaluateGenerationCapabilityReadiness(
      readinessInput({ catalog: seed }),
    );
    expect(result.ok).toBe(false);
    const capabilityIssue = result.issues.find(
      (i) => i.capability === "llm.smart" && i.code === "catalog_missing_active_default",
    );
    expect(capabilityIssue).toBeDefined();
    // 零默认项时该 capability 的项不得报价。
    for (const entry of seed.filter((e) => e.capability === "llm.smart")) {
      expect(result.items[entry.id]?.quotable).toBe(false);
    }
  });

  it("fails when a capability has multiple active default entries", () => {
    const seed = buildPricingCatalogSeed(REAL_TIER_INPUT);
    const duplicate: typeof seed[number] = {
      ...seed.find((e) => e.capability === "llm.smart")!,
      id: "llm.smart.dashscope.qwen-max",
      providerKey: "dashscope",
      modelId: "qwen-max",
    };
    const result = evaluateGenerationCapabilityReadiness(
      readinessInput({ catalog: [...seed, duplicate] }),
    );
    expect(result.ok).toBe(false);
    expect(
      result.issues.find(
        (i) => i.capability === "llm.smart" && i.code === "catalog_multiple_active_defaults",
      ),
    ).toBeDefined();
  });

  it("marks llm entries inconsistent with the tier resolver as not quotable", () => {
    const seed = buildPricingCatalogSeed(REAL_TIER_INPUT);
    const result = evaluateGenerationCapabilityReadiness(
      readinessInput({
        catalog: seed,
        llm: {
          mode: "resolved",
          smart: { providerKey: "deepseek", modelId: "deepseek-v4-pro" },
          // 目录里 flash 是 zhipu:glm-4，tier 实际解析成了 deepseek:deepseek-v4-pro。
          flash: { providerKey: "deepseek", modelId: "deepseek-v4-pro" },
        },
      }),
    );
    expect(result.ok).toBe(false);
    const flashEntry = seed.find((e) => e.capability === "llm.flash")!;
    expect(result.items[flashEntry.id]?.quotable).toBe(false);
    expect(result.items[flashEntry.id]?.issues).toContain("llm_tier_mismatch");
  });

  it("marks llm capabilities not quotable when tier resolution fails (missing credentials)", () => {
    const seed = buildPricingCatalogSeed(REAL_TIER_INPUT);
    const result = evaluateGenerationCapabilityReadiness(
      readinessInput({
        catalog: seed,
        llm: { mode: "resolution_failed" },
      }),
    );
    expect(result.ok).toBe(false);
    for (const entry of seed.filter((e) => e.capability.startsWith("llm."))) {
      expect(result.items[entry.id]?.quotable).toBe(false);
      expect(result.items[entry.id]?.issues).toContain("llm_provider_unavailable");
    }
  });

  it("accepts stub llm entries as consistent zero-cost mapping in stub mode", () => {
    const seed = buildPricingCatalogSeed(STUB_TIER_INPUT);
    const result = evaluateGenerationCapabilityReadiness(
      readinessInput({ catalog: seed, llm: { mode: "stub" } }),
    );
    expect(result.ok).toBe(true);
  });

  it("marks media entries without a registered adapter as not quotable", () => {
    const seed = buildPricingCatalogSeed(REAL_TIER_INPUT);
    const result = evaluateGenerationCapabilityReadiness(
      readinessInput({
        catalog: seed,
        media: { registeredModels: [], credentialConfigured: true },
      }),
    );
    expect(result.ok).toBe(false);
    for (const entry of seed.filter((e) =>
      ["image.generate", "video.image_to_video", "tts.synthesize"].includes(e.capability),
    )) {
      expect(result.items[entry.id]?.quotable).toBe(false);
      expect(result.items[entry.id]?.issues).toContain("media_adapter_unregistered");
    }
  });

  it("marks media entries not quotable when credentials are unconfigured", () => {
    const seed = buildPricingCatalogSeed(REAL_TIER_INPUT);
    const result = evaluateGenerationCapabilityReadiness(
      readinessInput({
        catalog: seed,
        media: { registeredModels: DASHSCOPE_REGISTERED_MODELS, credentialConfigured: false },
      }),
    );
    expect(result.ok).toBe(false);
    for (const entry of seed.filter((e) => e.capability !== "llm.smart" && e.capability !== "llm.flash")) {
      expect(result.items[entry.id]?.quotable).toBe(false);
      expect(result.items[entry.id]?.issues).toContain("media_credential_unconfigured");
    }
  });

  it("forces video catalog entries non-dispatchable in demo, test and unconfigured environments", () => {
    const seed = buildPricingCatalogSeed(REAL_TIER_INPUT);

    const demoResult = evaluateGenerationCapabilityReadiness(
      readinessInput({
        catalog: seed,
        environment: { demoMode: true, testEnv: false },
      }),
    );
    const videoEntry = seed.find((e) => e.capability === "video.image_to_video")!;
    expect(demoResult.items[videoEntry.id]?.realDispatchAllowed).toBe(false);
    expect(demoResult.items[videoEntry.id]?.issues).toContain("real_video_dispatch_disabled");

    const testResult = evaluateGenerationCapabilityReadiness(
      readinessInput({
        catalog: seed,
        environment: { demoMode: false, testEnv: true },
      }),
    );
    expect(testResult.items[videoEntry.id]?.realDispatchAllowed).toBe(false);

    const unconfiguredResult = evaluateGenerationCapabilityReadiness(
      readinessInput({
        catalog: seed,
        media: { registeredModels: DASHSCOPE_REGISTERED_MODELS, credentialConfigured: false },
      }),
    );
    expect(unconfiguredResult.items[videoEntry.id]?.realDispatchAllowed).toBe(false);
    // 非 demo 的正常环境 + 已配置凭据：视频可真实派发。
    const normalResult = evaluateGenerationCapabilityReadiness(readinessInput({ catalog: seed }));
    expect(normalResult.items[videoEntry.id]?.realDispatchAllowed).toBe(true);
  });

  it("keeps readiness ok=true when only stale disabled rows exist alongside a healthy seed", () => {
    // 对抗（diff_reviewer I-2）：disabled 是目录合法状态（迁移占位行被 seed 禁用后仍在表内），
    // 不得让 Prisma 部署态 readiness 永久 ok=false；disabled 行本身保持不可报价。
    const seed = buildPricingCatalogSeed(REAL_TIER_INPUT);
    const stale = makeStaleMigrationRow();
    stale.status = "disabled";
    stale.isDefault = false;
    const result = evaluateGenerationCapabilityReadiness(
      readinessInput({ catalog: [...seed, stale] }),
    );
    expect(result.ok).toBe(true);
    expect(result.items[stale.id]?.quotable).toBe(false);
    expect(result.issues).toEqual([]);
  });

  it("marks media entries not quotable when the catalog modelId is not the actually configured model", () => {
    // codex P1-2 复现：目录视频模型改成不存在/被 env 覆盖为另一个模型时，
    // readiness 不得返回 ok=true（按 seed 模型报价、按另一模型调用）。
    const seed = buildPricingCatalogSeed(REAL_TIER_INPUT);
    const mismatchedSeed = seed.map((entry) =>
      entry.capability === "video.image_to_video"
        ? { ...entry, modelId: "does-not-exist" }
        : entry,
    );
    const result = evaluateGenerationCapabilityReadiness(
      readinessInput({ catalog: mismatchedSeed }),
    );
    expect(result.ok).toBe(false);
    const videoEntry = mismatchedSeed.find((e) => e.capability === "video.image_to_video")!;
    expect(result.items[videoEntry.id]?.quotable).toBe(false);
    expect(result.items[videoEntry.id]?.issues).toContain("media_model_not_registered");
  });

  it("accepts a catalog model that matches an env-overridden adapter configuration", () => {
    // 实际运行配置被 env 覆盖为其他模型时，seed 模型不一致 → 不可报价；
    // 把 seed 与矩阵一起换成覆盖后的模型则恢复一致。
    const overriddenModels = DASHSCOPE_REGISTERED_MODELS.map((m) =>
      m.capability === "image.generate" ? { ...m, modelId: "wan2.7-t2i" } : m,
    );
    const seed = buildPricingCatalogSeed(REAL_TIER_INPUT).map((entry) =>
      entry.capability === "image.generate" ? { ...entry, modelId: "wan2.7-t2i" } : entry,
    );
    const result = evaluateGenerationCapabilityReadiness(
      readinessInput({
        catalog: seed,
        media: { registeredModels: overriddenModels, credentialConfigured: true },
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("does not leak secrets or env var names in readiness output", () => {
    const seed = buildPricingCatalogSeed(REAL_TIER_INPUT);
    const result = evaluateGenerationCapabilityReadiness(
      readinessInput({
        catalog: seed,
        media: { registeredModels: [], credentialConfigured: false },
      }),
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("ALIYUN_DASHSCOPE_API_KEY");
    expect(serialized).not.toContain("LLM_PROVIDER_");
    expect(serialized).not.toContain("apiKeyEnv");
  });
});

describe("generation cost bootstrap", () => {
  it("applies the seed and keeps all entries active and quotable in a configured environment", async () => {
    const db = createDbClient();
    const result = await bootstrapGenerationCostCatalog(db, REAL_TIER_INPUT);
    expect(result.readiness.ok).toBe(true);
    expect(result.disabledProviderModelIds).toEqual([]);
    const entries = listProviderModelCatalog(db);
    expect(entries.length).toBe(5);
    for (const entry of entries) {
      expect(entry.status, entry.id).toBe("active");
    }
  });

  it("materializes non-quotable entries as disabled catalog rows so the public catalog hides them", async () => {
    const db = createDbClient();
    // demo 环境强制视频不可真实派发 → 视频目录行物化为 disabled，公开目录不再展示。
    const result = await bootstrapGenerationCostCatalog(db, {
      ...REAL_TIER_INPUT,
      environment: { demoMode: true, testEnv: false },
    });
    expect(result.readiness.ok).toBe(false);
    const videoEntry = listProviderModelCatalog(db).find(
      (e) => e.capability === "video.image_to_video",
    )!;
    expect(videoEntry.status).toBe("disabled");
    expect(
      listPublicGenerationCapabilities(db).find((e) => e.id === videoEntry.id),
    ).toBeUndefined();
    expect(listPublicGenerationCapabilities(db).length).toBe(4);
  });

  it("disables media rows when media credentials are unconfigured", async () => {
    const db = createDbClient();
    const result = await bootstrapGenerationCostCatalog(db, {
      ...REAL_TIER_INPUT,
      media: { registeredModels: [], credentialConfigured: false },
    });
    expect(result.readiness.ok).toBe(false);
    const mediaEntries = listProviderModelCatalog(db).filter((e) =>
      ["image.generate", "video.image_to_video", "tts.synthesize"].includes(e.capability),
    );
    for (const entry of mediaEntries) {
      expect(entry.status, entry.id).toBe("disabled");
    }
  });

  it("seeds no llm rows and reports missing defaults when tier resolution failed", async () => {
    const db = createDbClient();
    const result = await bootstrapGenerationCostCatalog(db, {
      ...REAL_TIER_INPUT,
      llm: { mode: "resolution_failed" },
    });
    expect(result.readiness.ok).toBe(false);
    expect(
      result.readiness.issues.filter((i) => i.code === "catalog_missing_active_default").length,
    ).toBe(2);
    expect(
      listProviderModelCatalog(db).filter((e) => e.capability.startsWith("llm.")),
    ).toHaveLength(0);
    // 媒体不受 LLM 解析失败影响。
    expect(
      listProviderModelCatalog(db).find((e) => e.capability === "image.generate")?.status,
    ).toBe("active");
  });

  it("is idempotent across restarts in the same environment", async () => {
    const db = createDbClient();
    await bootstrapGenerationCostCatalog(db, REAL_TIER_INPUT);
    const second = await bootstrapGenerationCostCatalog(db, REAL_TIER_INPUT);
    expect(second.disabledProviderModelIds).toEqual([]);
    expect(listProviderModelCatalog(db).length).toBe(5);
  });

  it("restores active catalog rows when the environment recovers (demo then non-demo restart)", async () => {
    // 物化 disabled 是环境态：demo 启动禁视频 → 恢复正常环境重启后，
    // seed 重新以 active upsert，视频目录项自动恢复。
    const db = createDbClient();
    await bootstrapGenerationCostCatalog(db, {
      ...REAL_TIER_INPUT,
      environment: { demoMode: true, testEnv: false },
    });
    const videoId = listProviderModelCatalog(db).find(
      (e) => e.capability === "video.image_to_video",
    )!.id;
    expect(db.providerModelCatalog.get(videoId)?.status).toBe("disabled");

    const recovered = await bootstrapGenerationCostCatalog(db, REAL_TIER_INPUT);
    expect(recovered.readiness.ok).toBe(true);
    expect(db.providerModelCatalog.get(videoId)?.status).toBe("active");
    expect(db.providerModelCatalog.get(videoId)?.isDefault).toBe(true);
  });
});

describe("resolve generation cost bootstrap input", () => {
  it("maps stub llm provider to stub seed input without touching tier or media config", () => {
    const input = resolveGenerationCostBootstrapInput({
      llmProvider: "stub",
      resolveTierSnapshot: () => {
        throw new Error("must not be called in stub mode");
      },
      mediaCredentialConfigured: false,
      readDashscopeMediaConfig: () => {
        throw new Error("must not be called without credentials");
      },
      demoMode: false,
      testEnv: false,
    });
    expect(input.llm).toEqual({ mode: "stub" });
    expect(input.media).toEqual({ registeredModels: [], credentialConfigured: false });
  });

  it("maps a resolved tier snapshot to resolved seed input with flash reuse", () => {
    const input = resolveGenerationCostBootstrapInput({
      llmProvider: "openai",
      resolveTierSnapshot: () =>
        ({
          smart: { tier: "smart", provider: "deepseek", model: "deepseek-v4-pro", baseUrl: "https://x", apiKey: "k" },
          flashReusesSmart: true,
        }) as never,
      mediaCredentialConfigured: true,
      readDashscopeMediaConfig: () =>
        ({
          imageModel: "wan2.6-t2i",
          imageToVideoModel: "wan2.7-i2v-2026-04-25",
          ttsModel: "qwen3-tts-instruct-flash",
        }) as never,
      demoMode: false,
      testEnv: false,
    });
    expect(input.llm).toEqual({
      mode: "resolved",
      smart: { providerKey: "deepseek", modelId: "deepseek-v4-pro" },
      flash: { reusesSmart: true },
    });
    expect(input.media.credentialConfigured).toBe(true);
    expect(input.media.registeredModels).toContainEqual({
      capability: "video.image_to_video",
      providerKey: "dashscope",
      modelId: "wan2.7-i2v-2026-04-25",
    });
  });

  it("maps tier snapshot failure to resolution_failed and unconfigured media to an empty matrix", () => {
    const input = resolveGenerationCostBootstrapInput({
      llmProvider: "openai",
      resolveTierSnapshot: () => {
        throw new Error("api key missing");
      },
      mediaCredentialConfigured: false,
      readDashscopeMediaConfig: () => {
        throw new Error("must not be called without credentials");
      },
      demoMode: false,
      testEnv: true,
    });
    expect(input.llm).toEqual({ mode: "resolution_failed" });
    expect(input.media.registeredModels).toEqual([]);
    expect(input.environment).toEqual({ demoMode: false, testEnv: true });
  });
});
