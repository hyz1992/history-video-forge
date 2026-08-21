import { describe, expect, it } from "vitest";

import {
  DEFAULT_GENERATION_CONFIGURATION,
  type GenerationConfigurationV1,
  type ResolvedGenerationConfigurationV1,
} from "../../../shared/src/index.js";
import { resolveGenerationConfiguration } from "../../../shared/src/generation/generation-configuration-resolver.js";
import { extractArtStylePresetFromResolved } from "../../../backend/src/modules/asset-planning/creative-context.js";

/**
 * S2-2B 任务 4：画风 preset 快照冻结消费（详细设计 §7.1，外部审查 P1-3）。
 *
 * - 注册表只在解析阶段读取；版本变化使 configuration_hash 漂移（旧 quote 失效）。
 * - 执行端只消费快照冻结的 resolved_params（extractArtStylePresetFromResolved）。
 * - generateAssetPlan 消费冻结参数（而非注册表当前版本）的用例在
 *   asset-planning-generation.test.ts 内（复用既有 mock gateway 基建）。
 */

const baseConfig: GenerationConfigurationV1 = {
  ...DEFAULT_GENERATION_CONFIGURATION,
  creative: {
    ...DEFAULT_GENERATION_CONFIGURATION.creative,
    art_style_preset_id: "art_style_classical_ink",
  },
};

const catalog = [
  { provider_model_id: "d.q", capability: "llm.smart", provider_key: "dashscope", model_id: "q", status: "active", is_default: true },
  { provider_model_id: "d.f", capability: "llm.flash", provider_key: "dashscope", model_id: "f", status: "active", is_default: true },
  { provider_model_id: "d.i", capability: "image.generate", provider_key: "dashscope", model_id: "i", status: "active", is_default: true },
  { provider_model_id: "d.v", capability: "video.image_to_video", provider_key: "dashscope", model_id: "v", status: "active", is_default: true },
  { provider_model_id: "d.t", capability: "tts.synthesize", provider_key: "dashscope", model_id: "t", status: "active", is_default: true },
];

function registryV1() {
  return {
    art_style: [
      {
        preset_id: "art_style_classical_ink",
        preset_version: "v1",
        display_name: "古典水墨",
        description: "v1",
        resolved_params: {
          visual_tone_hint: "水墨工笔 v1",
          global_prompt_prefix: "水墨风格 v1",
          global_negative_prompts: ["油画质感 v1"],
          style_keywords: [],
          era_style_hint: null,
        },
      },
    ],
    subtitle: [],
  };
}

function registryV2() {
  return {
    art_style: [
      {
        preset_id: "art_style_classical_ink",
        preset_version: "v2",
        display_name: "古典水墨",
        description: "v2",
        resolved_params: {
          visual_tone_hint: "水墨工笔 v2（注册表已升级）",
          global_prompt_prefix: "水墨风格 v2",
          global_negative_prompts: ["油画质感 v2"],
          style_keywords: [],
          era_style_hint: null,
        },
      },
    ],
    subtitle: [],
  };
}

function resolveWith(registry: unknown): ResolvedGenerationConfigurationV1 {
  const result = resolveGenerationConfiguration({
    projectConfiguration: baseConfig,
    projectConfigurationRevision: 1,
    sourceUserPreferenceRevision: null,
    systemConstraints: { apiVideoProviderEnabled: true },
    providerModelCatalog: catalog,
    operation: "asset_plan.generate",
    voiceProfiles: [],
    creativePresets: registry,
  });
  if (!result.ok) throw new Error(`unexpected resolver failure: ${result.error.code}`);
  return result.value;
}

describe("注册表版本变化与快照冻结", () => {
  it("注册表 v1 与 v2 解析出不同 configuration_hash（旧 quote 漂移失效基础）", () => {
    const v1 = resolveWith(registryV1());
    const v2 = resolveWith(registryV2());
    expect(v1.resolved_creative.art_style.preset_version).toBe("v1");
    expect(v2.resolved_creative.art_style.preset_version).toBe("v2");
    expect(v1.configuration_hash).not.toBe(v2.configuration_hash);
  });

  it("同一注册表版本解析结果确定（相同 hash）", () => {
    expect(resolveWith(registryV1()).configuration_hash).toBe(
      resolveWith(registryV1()).configuration_hash,
    );
  });

  it("extractArtStylePresetFromResolved：fixed → 返回快照冻结的 id/version/params", () => {
    const resolved = resolveWith(registryV1());
    const extracted = extractArtStylePresetFromResolved(resolved);
    expect(extracted).toEqual({
      preset_id: "art_style_classical_ink",
      preset_version: "v1",
      resolved_params: {
        visual_tone_hint: "水墨工笔 v1",
        global_prompt_prefix: "水墨风格 v1",
        global_negative_prompts: ["油画质感 v1"],
        style_keywords: [],
        era_style_hint: null,
      },
    });
  });

  it("extractArtStylePresetFromResolved：配置未启用画风（null）→ null", () => {
    const result = resolveGenerationConfiguration({
      projectConfiguration: DEFAULT_GENERATION_CONFIGURATION,
      projectConfigurationRevision: 1,
      sourceUserPreferenceRevision: null,
      systemConstraints: { apiVideoProviderEnabled: true },
      providerModelCatalog: catalog,
      operation: "asset_plan.generate",
      voiceProfiles: [],
      creativePresets: registryV1(),
    });
    if (!result.ok) throw new Error(`unexpected resolver failure: ${result.error.code}`);
    expect(result.value.resolved_creative.art_style.mode).toBe("none");
    expect(extractArtStylePresetFromResolved(result.value)).toBeNull();
  });
});
