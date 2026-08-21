import { describe, expect, it } from "vitest";

import {
  assertS22CScopeConstraints,
  S2_2B_ConfigPatchRequest,
  S2_2C_ConfigPatchRequest,
  S2_2C_ProjectConfigPatchRequest,
  type CapabilitySlot,
  type GenerationConfigurationV1,
} from "../../shared/src/index.js";

/**
 * S2-2C PATCH 合同测试（详细设计 §4.1）：
 * - `capabilities` 段可选；缺省时由 controller 层决定保留语义（本层只保证形状）。
 * - 提供时五槽 strict 齐全；auto 与 fixed 均接受；形态非法拒绝。
 * - `assertS22CScopeConstraints` 开放 creative 与 capabilities（auto/fixed）。
 * - B 版符号语义不变（仍拒绝 capabilities）——C 版是新通道。
 */

const BASE_PATCH = {
  expected_revision: 3,
  video: { strategy: "prefer_remotion" as const, api_quality: "standard_720p" as const },
  budget: { currency: "CNY" as const, max_paid_cost_micros_per_run: null },
};

const ALL_AUTO: Record<CapabilitySlot, { mode: "auto" }> = {
  "llm.smart": { mode: "auto" },
  "llm.flash": { mode: "auto" },
  "image.generate": { mode: "auto" },
  "video.image_to_video": { mode: "auto" },
  "tts.synthesize": { mode: "auto" },
};

const FIXED_SMART = {
  ...ALL_AUTO,
  "llm.smart": { mode: "fixed" as const, provider_model_id: "llm.smart.deepseek.deepseek-v4-pro" },
};

function fullConfigWith(capabilities: Record<string, unknown>): GenerationConfigurationV1 {
  return {
    schema_version: "generation_configuration_v1",
    video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
    budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
    creative: {
      voice_profile_id: "voice_preset_cold_authority",
      art_style_preset_id: null,
      subtitle_style_preset_id: null,
      subtitle_style_overrides: {},
    },
    capabilities: capabilities as GenerationConfigurationV1["capabilities"],
  };
}

describe("S2_2C_ConfigPatchRequest（用户默认 PATCH）", () => {
  it("capabilities 可选：缺省解析成功（A/B 请求体兼容）", () => {
    const parsed = S2_2C_ConfigPatchRequest.parse(BASE_PATCH);
    expect(parsed.capabilities).toBeUndefined();
    expect(parsed.creative).toBeUndefined();
  });

  it("接受五槽全 auto 的 capabilities 段", () => {
    const parsed = S2_2C_ConfigPatchRequest.parse({
      ...BASE_PATCH,
      capabilities: ALL_AUTO,
    });
    expect(parsed.capabilities?.["llm.smart"]).toEqual({ mode: "auto" });
  });

  it("接受任槽 fixed（provider_model_id）", () => {
    const parsed = S2_2C_ConfigPatchRequest.parse({
      ...BASE_PATCH,
      capabilities: FIXED_SMART,
    });
    expect(parsed.capabilities?.["llm.smart"]).toEqual({
      mode: "fixed",
      provider_model_id: "llm.smart.deepseek.deepseek-v4-pro",
    });
  });

  it("提供时五槽必须齐备：缺任一槽拒绝", () => {
    const slots: CapabilitySlot[] = [
      "llm.smart",
      "llm.flash",
      "image.generate",
      "video.image_to_video",
      "tts.synthesize",
    ];
    for (const slot of slots) {
      const incomplete = { ...ALL_AUTO } as Record<string, unknown>;
      delete incomplete[slot];
      expect(
        S2_2C_ConfigPatchRequest.safeParse({
          ...BASE_PATCH,
          capabilities: incomplete,
        }).success,
      ).toBe(false);
    }
  });

  it("提供时拒绝未知槽位", () => {
    expect(
      S2_2C_ConfigPatchRequest.safeParse({
        ...BASE_PATCH,
        capabilities: { ...ALL_AUTO, "image.upscale": { mode: "auto" } },
      }).success,
    ).toBe(false);
  });

  it("fixed 缺 provider_model_id 拒绝", () => {
    expect(
      S2_2C_ConfigPatchRequest.safeParse({
        ...BASE_PATCH,
        capabilities: { ...ALL_AUTO, "llm.smart": { mode: "fixed" } },
      }).success,
    ).toBe(false);
  });

  it("fixed 空 provider_model_id 拒绝", () => {
    expect(
      S2_2C_ConfigPatchRequest.safeParse({
        ...BASE_PATCH,
        capabilities: { ...ALL_AUTO, "llm.smart": { mode: "fixed", provider_model_id: "" } },
      }).success,
    ).toBe(false);
  });

  it("fixed 多余字段拒绝（strict）", () => {
    expect(
      S2_2C_ConfigPatchRequest.safeParse({
        ...BASE_PATCH,
        capabilities: {
          ...ALL_AUTO,
          "llm.smart": { mode: "fixed", provider_model_id: "x", extra: true },
        },
      }).success,
    ).toBe(false);
  });

  it("auto 携带 provider_model_id 拒绝（strict）", () => {
    expect(
      S2_2C_ConfigPatchRequest.safeParse({
        ...BASE_PATCH,
        capabilities: { ...ALL_AUTO, "llm.smart": { mode: "auto", provider_model_id: "x" } },
      }).success,
    ).toBe(false);
  });

  it("未知顶层字段拒绝", () => {
    expect(
      S2_2C_ConfigPatchRequest.safeParse({ ...BASE_PATCH, capabilities: ALL_AUTO, extra: true })
        .success,
    ).toBe(false);
  });

  it("expected_revision 可 null（用户偏好首次创建）", () => {
    expect(
      S2_2C_ConfigPatchRequest.safeParse({ ...BASE_PATCH, expected_revision: null }).success,
    ).toBe(true);
  });

  it("与 creative 段共存：capabilities + creative 同时提供", () => {
    const parsed = S2_2C_ConfigPatchRequest.parse({
      ...BASE_PATCH,
      creative: {
        voice_profile_id: "voice_preset_cold_authority",
        art_style_preset_id: null,
        subtitle_style_preset_id: null,
      },
      capabilities: FIXED_SMART,
    });
    expect(parsed.creative?.voice_profile_id).toBe("voice_preset_cold_authority");
    expect(parsed.capabilities?.["llm.smart"]).toEqual({
      mode: "fixed",
      provider_model_id: "llm.smart.deepseek.deepseek-v4-pro",
    });
  });
});

describe("S2_2C_ProjectConfigPatchRequest（项目 PATCH）", () => {
  it("expected_revision 必须非负整数（不接受 null）", () => {
    expect(
      S2_2C_ProjectConfigPatchRequest.safeParse({
        ...BASE_PATCH,
        expected_revision: null,
        capabilities: ALL_AUTO,
      }).success,
    ).toBe(false);
  });

  it("capabilities 可选：缺省解析成功", () => {
    const parsed = S2_2C_ProjectConfigPatchRequest.parse({
      ...BASE_PATCH,
      expected_revision: 1,
    });
    expect(parsed.capabilities).toBeUndefined();
  });

  it("接受 fixed 段", () => {
    const parsed = S2_2C_ProjectConfigPatchRequest.parse({
      ...BASE_PATCH,
      expected_revision: 1,
      capabilities: FIXED_SMART,
    });
    expect(parsed.capabilities?.["llm.smart"]).toEqual({
      mode: "fixed",
      provider_model_id: "llm.smart.deepseek.deepseek-v4-pro",
    });
  });
});

describe("assertS22CScopeConstraints（C 版 scope 校验）", () => {
  it("五槽全 auto 通过", () => {
    const result = assertS22CScopeConstraints(fullConfigWith(ALL_AUTO));
    expect(result.ok).toBe(true);
  });

  it("任槽 fixed 通过（C 版开放 fixed）", () => {
    const result = assertS22CScopeConstraints(fullConfigWith(FIXED_SMART));
    expect(result.ok).toBe(true);
  });

  it("creative 非 null 通过（B 版语义保留）", () => {
    const result = assertS22CScopeConstraints(fullConfigWith(ALL_AUTO));
    expect(result.ok).toBe(true);
    expect(
      assertS22CScopeConstraints(fullConfigWith(ALL_AUTO)).ok,
    ).toBe(true);
  });
});

describe("B 版符号语义不变（C 版是新通道）", () => {
  it("S2_2B_ConfigPatchRequest 仍拒绝 capabilities 段", () => {
    expect(
      S2_2B_ConfigPatchRequest.safeParse({
        ...BASE_PATCH,
        capabilities: ALL_AUTO,
      }).success,
    ).toBe(false);
  });
});
