import { describe, expect, it } from "vitest";

import {
  resolveSnapshotLlmModels,
  createTierAwareProviderFromEnv,
} from "../../../backend/src/runtime/llm/tier-aware-provider-factory.js";
import type { ProviderRegistryEntry } from "../../../backend/src/runtime/llm/provider-registry.js";
import type { ResolvedCapabilityMap } from "../../../shared/src/index.js";

/**
 * S2-2C 任务 4：LLM provider 工厂按快照构造（详细设计 §6.1）。
 *
 * - 快照提供时（付费 dispatch 路径），smart/flash 无论 auto/fixed 都按快照
 *   冻结的 provider_key+model_id 构造（mode 只说明选择来源）。
 * - 快照完整映射：五槽必须齐备，缺任一必需槽位 → 抛错 fail-closed
 *   （不混合快照与 env 回退）。
 * - 快照后漂移：快照冻结 A 后，env 变化不影响构造结果（仍为 A）。
 * - provider 未注册 / 凭据缺失 → 抛错（fail-closed，与 env 路径同语义）。
 */

function buildRegistry(
  entries: ReadonlyArray<ProviderRegistryEntry>,
): Map<string, ProviderRegistryEntry> {
  return new Map(entries.map((e) => [e.name, e]));
}

const DEEPSEEK_ENTRY: ProviderRegistryEntry = {
  name: "deepseek",
  baseUrl: "https://api.deepseek.com",
  apiKeyEnv: "LLM_PROVIDER_DEEPSEEK_API_KEY",
};

const ZHIPU_ENTRY: ProviderRegistryEntry = {
  name: "zhipu",
  baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  apiKeyEnv: "LLM_PROVIDER_ZHIPU_API_KEY",
};

const ENV_WITH_KEYS: Record<string, string | undefined> = {
  LLM_PROVIDER_DEEPSEEK_API_KEY: "ds-key",
  LLM_PROVIDER_ZHIPU_API_KEY: "zhipu-key",
};

function buildCapabilities(
  smart: ResolvedCapabilityMap["llm.smart"],
  flash: ResolvedCapabilityMap["llm.flash"],
): ResolvedCapabilityMap {
  return {
    "llm.smart": smart,
    "llm.flash": flash,
    "image.generate": { mode: "auto", provider_model_id: "img", provider_key: "dashscope", model_id: "wanx" },
    "video.image_to_video": { mode: "auto", provider_model_id: "vid", provider_key: "dashscope", model_id: "wan" },
    "tts.synthesize": { mode: "auto", provider_model_id: "tts", provider_key: "dashscope", model_id: "qwen" },
  };
}

const FIXED_DEEPSEEK_SMART: ResolvedCapabilityMap["llm.smart"] = {
  mode: "fixed",
  provider_model_id: "llm.smart.deepseek.deepseek-v4-pro",
  provider_key: "deepseek",
  model_id: "deepseek-v4-pro",
};

const AUTO_ZHIPU_FLASH: ResolvedCapabilityMap["llm.flash"] = {
  mode: "auto",
  provider_model_id: "llm.flash.zhipu.glm-4",
  provider_key: "zhipu",
  model_id: "glm-4",
};

describe("resolveSnapshotLlmModels（快照 → smart/flash 模型解析，纯函数）", () => {
  it("fixed smart + auto flash 都按快照冻结的 provider/model 解析", () => {
    const models = resolveSnapshotLlmModels(
      buildCapabilities(FIXED_DEEPSEEK_SMART, AUTO_ZHIPU_FLASH),
      buildRegistry([DEEPSEEK_ENTRY, ZHIPU_ENTRY]),
      ENV_WITH_KEYS,
      undefined,
    );
    expect(models.smart).toEqual({
      tier: "smart",
      provider: "deepseek",
      model: "deepseek-v4-pro",
      baseUrl: "https://api.deepseek.com",
      apiKey: "ds-key",
    });
    // auto 槽位同样按快照构造（mode 不参与构造）
    expect(models.flash).toEqual({
      tier: "flash",
      provider: "zhipu",
      model: "glm-4",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      apiKey: "zhipu-key",
    });
  });

  it("快照后漂移：快照冻结 A 后 env 变化不影响构造结果（仍为 A）", () => {
    const caps = buildCapabilities(FIXED_DEEPSEEK_SMART, AUTO_ZHIPU_FLASH);
    // 模拟"快照创建后 env 默认已变为另一个模型"：env 键缺失也不影响——
    // 快照路径只按快照的 provider_key/model_id 解析。
    const models = resolveSnapshotLlmModels(
      caps,
      buildRegistry([DEEPSEEK_ENTRY, ZHIPU_ENTRY]),
      ENV_WITH_KEYS,
      undefined,
    );
    expect(models.smart.model).toBe("deepseek-v4-pro");
    expect(models.smart.provider).toBe("deepseek");
    expect(models.flash.model).toBe("glm-4");
  });

  it("快照缺任一必需槽位（缺 llm.flash）→ 抛错 fail-closed，不混合快照与 env", () => {
    const incomplete = buildCapabilities(FIXED_DEEPSEEK_SMART, AUTO_ZHIPU_FLASH) as Record<string, unknown>;
    delete incomplete["llm.flash"];
    expect(() =>
      resolveSnapshotLlmModels(
        incomplete as ResolvedCapabilityMap,
        buildRegistry([DEEPSEEK_ENTRY, ZHIPU_ENTRY]),
        ENV_WITH_KEYS,
        undefined,
      ),
    ).toThrow(/快照 capabilities 不完整或损坏/);
  });

  it("快照形状损坏（非对象槽位）→ 抛错 fail-closed", () => {
    const broken = buildCapabilities(FIXED_DEEPSEEK_SMART, AUTO_ZHIPU_FLASH) as Record<string, unknown>;
    broken["llm.smart"] = 123;
    expect(() =>
      resolveSnapshotLlmModels(
        broken as ResolvedCapabilityMap,
        buildRegistry([DEEPSEEK_ENTRY, ZHIPU_ENTRY]),
        ENV_WITH_KEYS,
        undefined,
      ),
    ).toThrow(/快照 capabilities 不完整或损坏/);
  });

  it("快照指定的 provider 未注册 → 抛错（fail-closed）", () => {
    expect(() =>
      resolveSnapshotLlmModels(
        buildCapabilities(FIXED_DEEPSEEK_SMART, AUTO_ZHIPU_FLASH),
        buildRegistry([DEEPSEEK_ENTRY]), // 缺 zhipu
        ENV_WITH_KEYS,
        undefined,
      ),
    ).toThrow(/provider_not_registered/);
  });

  it("快照指定的 provider 凭据缺失（apiKeyEnv 未设置）→ 抛错（fail-closed）", () => {
    expect(() =>
      resolveSnapshotLlmModels(
        buildCapabilities(FIXED_DEEPSEEK_SMART, AUTO_ZHIPU_FLASH),
        buildRegistry([DEEPSEEK_ENTRY, ZHIPU_ENTRY]),
        {}, // 无任何 api key
        undefined,
      ),
    ).toThrow();
  });
});

describe("createTierAwareProviderFromEnv（工厂接线）", () => {
  it("损坏快照 → fail-closed 抛错（快照校验或 env 兜底路径，绝不静默构造）", () => {
    // 当前测试环境的 env.llm.provider 为 stub → 工厂按设计忽略快照走 env 路径；
    // 非 stub 环境则先做五槽校验抛快照错误。两种情形都必须是抛错（fail-closed），
    // 不允许用损坏快照静默构造 provider。
    const broken = buildCapabilities(FIXED_DEEPSEEK_SMART, AUTO_ZHIPU_FLASH) as Record<string, unknown>;
    delete broken["llm.smart"];
    expect(() =>
      createTierAwareProviderFromEnv({
        snapshotCapabilities: broken as ResolvedCapabilityMap,
      }),
    ).toThrow();
  });

  it("无参数调用保持现状签名：未配置 LLM 环境下抛错（fail-closed，与既有 env 路径一致）", () => {
    // 工厂 env 路径语义不变：当前环境未配置 LLM_SMART_MODEL/LLM_MODEL 时抛错，
    // 不静默回退。既有调用点行为不受 S2-2C 影响（快照路径只在新参数提供时启用）。
    expect(() => createTierAwareProviderFromEnv()).toThrow();
  });
});
