import { describe, expect, it } from "vitest";

import {
  resolveImageModelPricingHint,
  resolveVideoModelPricingHint,
} from "../../../frontend/src/utils/pricing.js";
import type { PublicCapabilityEntryDto } from "../../../frontend/src/stores/generation-config.js";

function videoEntry(overrides: Partial<PublicCapabilityEntryDto>): PublicCapabilityEntryDto {
  return {
    id: "video.image_to_video.dashscope.cn-beijing.wan2.7-i2v-2026-04-25",
    capability: "video.image_to_video",
    provider_key: "dashscope",
    model_id: "wan2.7-i2v-2026-04-25",
    model_version: null,
    display_name: "万相图生视频（wan2.7-i2v）",
    quality_tier: "high",
    speed_tier: "slow",
    parameter_capabilities: {},
    pricing_version: "dashscope-media-cn-beijing-2026-08-17",
    pricing: {
      unit_type: "video_second",
      currency: "CNY",
      price_micros_per_second_by_quality: {
        standard_720p: "600000",
        high_1080p: "1000000",
      },
    },
    status: "active",
    is_default: true,
    availability: "enabled",
    ...overrides,
  };
}

describe("resolveImageModelPricingHint", () => {
  function imageEntry(overrides: Partial<PublicCapabilityEntryDto>): PublicCapabilityEntryDto {
    return {
      id: "image.generate.dashscope.cn-beijing.wan2.6-t2i",
      capability: "image.generate",
      provider_key: "dashscope",
      model_id: "wan2.6-t2i",
      model_version: null,
      display_name: "万相文生图（wan2.6-t2i）",
      quality_tier: "standard",
      speed_tier: "standard",
      parameter_capabilities: {},
      pricing_version: "dashscope-media-cn-beijing-2026-08-17",
      pricing: {
        unit_type: "image",
        currency: "CNY",
        price_micros_per_image: "200000",
      },
      status: "active",
      is_default: true,
      availability: "enabled",
      ...overrides,
    };
  }

  it("auto（null）解析到 is_default 图片模型（wan2.6-t2i ¥0.20/张）", () => {
    const entries = [
      imageEntry({
        id: "image.generate.dashscope.cn-beijing.other-t2i",
        model_id: "other-t2i",
        display_name: "其他文生图（other-t2i）",
        is_default: false,
        pricing: { price_micros_per_image: "100000" },
      }),
      imageEntry({}),
    ];
    expect(resolveImageModelPricingHint(entries, null)).toEqual({
      unitPrice: 0.2,
      displayName: "万相文生图（wan2.6-t2i）",
      modelId: "wan2.6-t2i",
    });
  });

  it("fixed 指向其他图片模型条目 id 时解析到该模型单价", () => {
    const entries = [
      imageEntry({
        id: "image.generate.dashscope.cn-beijing.other-t2i",
        model_id: "other-t2i",
        display_name: "其他文生图（other-t2i）",
        is_default: false,
        pricing: { price_micros_per_image: "100000" },
      }),
      imageEntry({}),
    ];
    expect(
      resolveImageModelPricingHint(entries, "image.generate.dashscope.cn-beijing.other-t2i"),
    ).toEqual({
      unitPrice: 0.1,
      displayName: "其他文生图（other-t2i）",
      modelId: "other-t2i",
    });
  });

  it("unpriced 或无可用条目返回 null", () => {
    const unpriced = [
      imageEntry({ pricing: { unit_type: "image", currency: "CNY", unpriced: true } }),
    ];
    expect(resolveImageModelPricingHint(unpriced, null)).toBeNull();
    expect(resolveImageModelPricingHint([], null)).toBeNull();
  });
});

describe("resolveVideoModelPricingHint", () => {
  it("auto（currentEntryId=null）解析到 is_default 条目（wan2.7 ¥0.60/秒）", () => {
    const entries = [
      videoEntry({
        id: "video.image_to_video.dashscope.cn-beijing.wan2.6-i2v-flash",
        model_id: "wan2.6-i2v-flash",
        display_name: "万相图生视频轻量版（wan2.6-i2v-flash，有声）",
        is_default: false,
        pricing: {
          price_micros_per_second_by_quality: {
            standard_720p: "300000",
            high_1080p: "500000",
          },
        },
      }),
      videoEntry({}),
    ];
    expect(resolveVideoModelPricingHint(entries, null)).toEqual({
      unitPricePerSec: 0.6,
      displayName: "万相图生视频（wan2.7-i2v）",
      modelId: "wan2.7-i2v-2026-04-25",
    });
  });

  it("fixed 指向 wan2.6-i2v-flash 条目 id 时解析到该模型（¥0.30/秒）并带显示名", () => {
    const entries = [
      videoEntry({
        id: "video.image_to_video.dashscope.cn-beijing.wan2.6-i2v-flash",
        model_id: "wan2.6-i2v-flash",
        display_name: "万相图生视频轻量版（wan2.6-i2v-flash，有声）",
        is_default: false,
        pricing: {
          price_micros_per_second_by_quality: {
            standard_720p: "300000",
            high_1080p: "500000",
          },
        },
      }),
      videoEntry({}),
    ];
    expect(
      resolveVideoModelPricingHint(
        entries,
        "video.image_to_video.dashscope.cn-beijing.wan2.6-i2v-flash",
      ),
    ).toEqual({
      unitPricePerSec: 0.3,
      displayName: "万相图生视频轻量版（wan2.6-i2v-flash，有声）",
      modelId: "wan2.6-i2v-flash",
    });
  });

  it("fixed 指向目录外的条目 id 时回退 is_default", () => {
    const entries = [videoEntry({})];
    expect(
      resolveVideoModelPricingHint(entries, "video.image_to_video.dashscope.cn-beijing.vanished"),
    ).toEqual({
      unitPricePerSec: 0.6,
      displayName: "万相图生视频（wan2.7-i2v）",
      modelId: "wan2.7-i2v-2026-04-25",
    });
  });

  it("指定 high_1080p 档取 1080P 价（wan2.6-flash ¥0.50/秒）", () => {
    const entries = [
      videoEntry({
        id: "video.image_to_video.dashscope.cn-beijing.wan2.6-i2v-flash",
        model_id: "wan2.6-i2v-flash",
        display_name: "万相图生视频轻量版（wan2.6-i2v-flash，有声）",
        is_default: false,
        pricing: {
          price_micros_per_second_by_quality: {
            standard_720p: "300000",
            high_1080p: "500000",
          },
        },
      }),
      videoEntry({}),
    ];
    expect(
      resolveVideoModelPricingHint(
        entries,
        "video.image_to_video.dashscope.cn-beijing.wan2.6-i2v-flash",
        "high_1080p",
      )?.unitPricePerSec,
    ).toBe(0.5);
  });

  it("指定档无价时回退 720P 档", () => {
    const entries = [
      videoEntry({
        is_default: true,
        pricing: {
          price_micros_per_second_by_quality: {
            standard_720p: "600000",
          },
        },
      }),
    ];
    expect(
      resolveVideoModelPricingHint(entries, null, "high_1080p")?.unitPricePerSec,
    ).toBe(0.6);
  });

  it("unpriced 条目返回 null（不得显示成具体金额）", () => {
    const entries = [
      videoEntry({
        id: "video.image_to_video.dashscope.cn-beijing.wan2.6-i2v-flash",
        model_id: "wan2.6-i2v-flash",
        is_default: false,
        pricing: { unit_type: "video_second", currency: "CNY", unpriced: true },
      }),
      videoEntry({}),
    ];
    expect(
      resolveVideoModelPricingHint(
        entries,
        "video.image_to_video.dashscope.cn-beijing.wan2.6-i2v-flash",
      ),
    ).toBeNull();
  });

  it("无 active/可用条目返回 null", () => {
    expect(resolveVideoModelPricingHint([], null)).toBeNull();
    expect(
      resolveVideoModelPricingHint([videoEntry({ availability: "disabled" })], null),
    ).toBeNull();
  });
});
