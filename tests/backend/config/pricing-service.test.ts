import { describe, expect, it } from "vitest";

import type { ProviderModelCatalogRecord } from "../../../backend/src/db/client.js";
import { buildPricingCatalogSeed } from "../../../backend/src/modules/generation-cost/pricing-catalog.seed.js";
import {
  OPERATION_TOKEN_BUDGETS,
  priceGenerationWorkload,
  type PriceGenerationWorkloadInput,
  type PricingWorkloadItem,
} from "../../../backend/src/modules/generation-cost/pricing.service.js";
import type { CapabilitySlot } from "../../../shared/src/index.js";

/**
 * S2-2A 任务 7：纯计价服务测试。
 *
 * 合同来源：实施计划任务 7 步骤 1/步骤 3；详细设计 4.5（pricingHash）、
 * 8.4（authorizationCostMicros 上界语义）。
 */

function makeCatalogEntry(
  overrides: Partial<ProviderModelCatalogRecord> & Pick<ProviderModelCatalogRecord, "id" | "capability">,
): ProviderModelCatalogRecord {
  const now = new Date();
  return {
    providerKey: "test-provider",
    modelId: "test-model",
    modelVersion: null,
    displayName: "测试模型",
    qualityTier: null,
    speedTier: null,
    parameterCapabilitiesJson: {},
    pricingVersion: "test-pricing-2026-08-17",
    pricingJson: {},
    status: "active",
    isDefault: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** 有公开价格的 LLM fixture：¥2/M input、¥8/M output（微元整数）。 */
function pricedLlmEntry(id = "llm.smart.test.priced"): ProviderModelCatalogRecord {
  return makeCatalogEntry({
    id,
    capability: "llm.smart",
    pricingJson: {
      unit_type: "token",
      currency: "CNY",
      input_price_micros_per_million_tokens: "2000000",
      output_price_micros_per_million_tokens: "8000000",
      source_note: "测试 fixture：公开定价页快照",
    },
  });
}

function unpricedLlmEntry(id = "llm.smart.test.unpriced"): ProviderModelCatalogRecord {
  return makeCatalogEntry({
    id,
    capability: "llm.smart",
    providerKey: "deepseek",
    modelId: "deepseek-v4-pro",
    pricingJson: {
      unit_type: "token",
      currency: "CNY",
      unpriced: true,
      source_note: "无已核实公开价：按 unbounded 处理",
    },
  });
}

function imageEntry(): ProviderModelCatalogRecord {
  return makeCatalogEntry({
    id: "image.generate.dashscope.test",
    capability: "image.generate",
    pricingJson: {
      unit_type: "image",
      currency: "CNY",
      price_micros_per_image: "200000",
      source_note: "测试 fixture",
    },
  });
}

function videoEntry(): ProviderModelCatalogRecord {
  return makeCatalogEntry({
    id: "video.image_to_video.dashscope.test",
    capability: "video.image_to_video",
    parameterCapabilitiesJson: {
      api_video_qualities: ["standard_720p", "high_1080p"],
      min_duration_seconds_per_task: 2,
      max_duration_seconds_per_task: 15,
    },
    pricingJson: {
      unit_type: "video_second",
      currency: "CNY",
      price_micros_per_second_by_quality: {
        standard_720p: "600000",
        high_1080p: "1000000",
      },
      source_note: "测试 fixture",
    },
  });
}

function ttsEntry(): ProviderModelCatalogRecord {
  return makeCatalogEntry({
    id: "tts.synthesize.dashscope.test",
    capability: "tts.synthesize",
    pricingJson: {
      unit_type: "tts_character",
      currency: "CNY",
      price_micros_per_10k_characters: "800000",
      source_note: "测试 fixture",
    },
  });
}

function requestEntry(): ProviderModelCatalogRecord {
  return makeCatalogEntry({
    id: "request.capability.test",
    capability: "image.generate",
    pricingJson: {
      unit_type: "request",
      currency: "CNY",
      price_micros_per_request: "1000",
      source_note: "测试 fixture",
    },
  });
}

function price(input: PriceGenerationWorkloadInput) {
  return priceGenerationWorkload(input);
}

describe("pricing service unit pricing", () => {
  it("prices llm tokens with input/output rates and an operation-token-budget authorization bound", () => {
    const budget = OPERATION_TOKEN_BUDGETS["topic.generate"];
    expect(budget).toBeDefined();

    const result = price({
      catalog: [pricedLlmEntry()],
      workload: [
        {
          capability: "llm.smart",
          provider_model_id: "llm.smart.test.priced",
          unit_type: "token",
          operation: "topic.generate",
          estimated_input_tokens: 12000,
          estimated_output_tokens: 6000,
        },
      ],
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.estimated_cost_micros).toBe("72000"); // 12000*2 + 6000*8
    expect(result.value.authorization_cost_micros).toBe(
      String(
        (budget.max_input_tokens * 2000000 + budget.max_output_tokens * 8000000) / 1_000_000,
      ),
    );
    expect(result.value.contains_unbounded_item).toBe(false);
    expect(result.value.items[0]).toMatchObject({
      provider_model_id: "llm.smart.test.priced",
      unit_type: "token",
      unbounded: false,
    });
  });

  it("never returns a zero authorization bound for llm items with unknown output tokens", () => {
    const result = price({
      catalog: [pricedLlmEntry()],
      workload: [
        {
          capability: "llm.smart",
          provider_model_id: "llm.smart.test.priced",
          unit_type: "token",
          operation: "script.generate",
          // 输出 token 未知（0）：估算可以为 0，但授权上界必须用 operation token budget。
          estimated_input_tokens: 0,
          estimated_output_tokens: 0,
        },
      ],
    });
    if (!result.ok) throw new Error(result.error.message);
    const budget = OPERATION_TOKEN_BUDGETS["script.generate"];
    expect(result.value.authorization_cost_micros).toBe(
      String(
        (budget.max_input_tokens * 2000000 + budget.max_output_tokens * 8000000) / 1_000_000,
      ),
    );
    expect(Number(result.value.authorization_cost_micros)).toBeGreaterThan(0);
  });

  it("defines a token budget for every standard generation operation", () => {
    const operations = [
      "topic.generate",
      "script.generate",
      "storyboard.generate",
      "asset_plan.generate",
      "assets.generate",
      "publish.generate",
    ] as const;
    for (const operation of operations) {
      const budget = OPERATION_TOKEN_BUDGETS[operation];
      expect(budget, operation).toBeDefined();
      expect(budget.max_input_tokens).toBeGreaterThan(0);
      expect(budget.max_output_tokens).toBeGreaterThan(0);
    }
  });

  it("prices image items per image with estimate equal to the authorization bound", () => {
    const result = price({
      catalog: [imageEntry()],
      workload: [
        {
          capability: "image.generate",
          provider_model_id: "image.generate.dashscope.test",
          unit_type: "image",
          operation: "assets.generate",
          image_count: 5,
        },
      ],
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.estimated_cost_micros).toBe("1000000");
    expect(result.value.authorization_cost_micros).toBe("1000000");
  });

  it("prices video seconds per api quality and separates 720p from 1080p", () => {
    const base = {
      capability: "video.image_to_video" as const,
      provider_model_id: "video.image_to_video.dashscope.test",
      unit_type: "video_second" as const,
      operation: "assets.generate" as const,
      video_task_count: 3,
      estimated_seconds_total: 12,
    };
    const q720 = price({
      catalog: [videoEntry()],
      workload: [{ ...base, parameters: { api_quality: "standard_720p" } }],
    });
    if (!q720.ok) throw new Error(q720.error.message);
    expect(q720.value.estimated_cost_micros).toBe("7200000"); // 12s × 600000
    expect(q720.value.authorization_cost_micros).toBe("27000000"); // 3 tasks × 15s × 600000

    const q1080 = price({
      catalog: [videoEntry()],
      workload: [{ ...base, parameters: { api_quality: "high_1080p" } }],
    });
    if (!q1080.ok) throw new Error(q1080.error.message);
    expect(q1080.value.estimated_cost_micros).toBe("12000000"); // 12s × 1000000
    expect(q1080.value.authorization_cost_micros).toBe("45000000"); // 3 × 15s × 1000000
  });

  it("rejects remotion-style resolution strings instead of guessing api quality", () => {
    const result = price({
      catalog: [videoEntry()],
      workload: [
        {
          capability: "video.image_to_video",
          provider_model_id: "video.image_to_video.dashscope.test",
          unit_type: "video_second",
          operation: "assets.generate",
          video_task_count: 1,
          parameters: { api_quality: "1080P" as never },
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("pricing_quality_not_supported");
  });

  it("rejects api quality values the catalog entry does not declare", () => {
    const result = price({
      catalog: [
        makeCatalogEntry({
          id: "video.image_to_video.limited",
          capability: "video.image_to_video",
          parameterCapabilitiesJson: {
            api_video_qualities: ["standard_720p"],
            max_duration_seconds_per_task: 15,
          },
          pricingJson: {
            unit_type: "video_second",
            currency: "CNY",
            price_micros_per_second_by_quality: { standard_720p: "600000" },
          },
        }),
      ],
      workload: [
        {
          capability: "video.image_to_video",
          provider_model_id: "video.image_to_video.limited",
          unit_type: "video_second",
          operation: "assets.generate",
          video_task_count: 1,
          parameters: { api_quality: "high_1080p" },
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("pricing_quality_not_supported");
  });

  it("prices tts characters deterministically", () => {
    const result = price({
      catalog: [ttsEntry()],
      workload: [
        {
          capability: "tts.synthesize",
          provider_model_id: "tts.synthesize.dashscope.test",
          unit_type: "tts_character",
          operation: "assets.generate",
          character_count: 1200,
        },
      ],
    });
    if (!result.ok) throw new Error(result.error.message);
    // 1200 字 × ¥0.80/万字 = 96000 微元。
    expect(result.value.estimated_cost_micros).toBe("96000");
    expect(result.value.authorization_cost_micros).toBe("96000");
  });

  it("prices request-unit items", () => {
    const result = price({
      catalog: [requestEntry()],
      workload: [
        {
          capability: "image.generate",
          provider_model_id: "request.capability.test",
          unit_type: "request",
          operation: "assets.generate",
          request_count: 7,
        },
      ],
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.estimated_cost_micros).toBe("7000");
    expect(result.value.authorization_cost_micros).toBe("7000");
  });

  it("keeps the authorization bound >= estimate when estimated tokens exceed the operation budget", () => {
    // 对抗（diff_reviewer I-1）：估算 token 超出 budget 时，授权上界不得低于估算，
    // 否则预算门禁按更小的授权值放行，形成低估漏洞。
    const result = price({
      catalog: [pricedLlmEntry()],
      workload: [
        {
          capability: "llm.smart",
          provider_model_id: "llm.smart.test.priced",
          unit_type: "token",
          operation: "topic.generate", // budget 80000/40000
          estimated_input_tokens: 400000,
          estimated_output_tokens: 200000,
        },
      ],
    });
    if (!result.ok) throw new Error(result.error.message);
    const estimated = Number(result.value.estimated_cost_micros!);
    const authorization = Number(result.value.authorization_cost_micros!);
    expect(authorization).toBeGreaterThanOrEqual(estimated);
    expect(authorization).toBe(estimated); // 超预算时授权取较大值（=估算）
  });

  it("keeps the authorization bound >= estimate when estimated video seconds exceed the per-task cap total", () => {
    const result = price({
      catalog: [videoEntry()],
      workload: [
        {
          capability: "video.image_to_video",
          provider_model_id: "video.image_to_video.dashscope.test",
          unit_type: "video_second",
          operation: "assets.generate",
          video_task_count: 3, // 上限 3 × 15s = 45s
          estimated_seconds_total: 100, // 输入与任务上限不一致
          parameters: { api_quality: "standard_720p" },
        },
      ],
    });
    if (!result.ok) throw new Error(result.error.message);
    const estimated = Number(result.value.estimated_cost_micros!);
    const authorization = Number(result.value.authorization_cost_micros!);
    expect(authorization).toBeGreaterThanOrEqual(estimated);
  });

  it("rounds fractional estimated video seconds up instead of down", () => {
    const result = price({
      catalog: [videoEntry()],
      workload: [
        {
          capability: "video.image_to_video",
          provider_model_id: "video.image_to_video.dashscope.test",
          unit_type: "video_second",
          operation: "assets.generate",
          video_task_count: 1,
          estimated_seconds_total: 2.4,
          parameters: { api_quality: "standard_720p" },
        },
      ],
    });
    if (!result.ok) throw new Error(result.error.message);
    // 2.4s 向上取整为 3s × 600000，不低估。
    expect(result.value.estimated_cost_micros).toBe("1800000");
  });

  it("treats a non-safe-integer per-task duration cap as unbounded instead of throwing", () => {
    // codex P1-3 复现：max_duration_seconds_per_task=15.5 曾让 BigInt(15.5) 抛 RangeError，
    // 绕过结构化错误合同；现在非正安全整数上限一律视为无可信上限 → unbounded。
    for (const badCap of [15.5, 1e21, Number.POSITIVE_INFINITY, 0, -3]) {
      const entry = makeCatalogEntry({
        id: "video.image_to_video.badcap",
        capability: "video.image_to_video",
        parameterCapabilitiesJson: {
          api_video_qualities: ["standard_720p"],
          max_duration_seconds_per_task: badCap,
        },
        pricingJson: {
          unit_type: "video_second",
          currency: "CNY",
          price_micros_per_second_by_quality: { standard_720p: "600000" },
          source_note: "脏数据 fixture",
        },
      });
      const result = price({
        catalog: [entry],
        workload: [
          {
            capability: "video.image_to_video",
            provider_model_id: "video.image_to_video.badcap",
            unit_type: "video_second",
            operation: "assets.generate",
            video_task_count: 1,
            estimated_seconds_total: 5,
            parameters: { api_quality: "standard_720p" },
          },
        ],
      });
      expect(result.ok, `cap=${badCap}`).toBe(true);
      if (!result.ok) continue;
      expect(result.value.contains_unbounded_item, `cap=${badCap}`).toBe(true);
      expect(result.value.authorization_cost_micros).toBeNull();
    }
  });

  it("rejects estimated video seconds outside the safe integer range with a structured error", () => {
    const result = price({
      catalog: [videoEntry()],
      workload: [
        {
          capability: "video.image_to_video",
          provider_model_id: "video.image_to_video.dashscope.test",
          unit_type: "video_second",
          operation: "assets.generate",
          video_task_count: 1,
          estimated_seconds_total: 1e300,
          parameters: { api_quality: "standard_720p" },
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("pricing_invalid_workload");
  });

  it("returns zero totals for an empty workload instead of null", () => {
    // 空 workload 是零费用报价；null 金额保留给 unbounded 语义。
    const result = price({ catalog: [imageEntry()], workload: [] });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.estimated_cost_micros).toBe("0");
    expect(result.value.authorization_cost_micros).toBe("0");
    expect(result.value.contains_unbounded_item).toBe(false);
  });

  it("treats negative price strings as unparseable (unbounded), never negative cost", () => {
    const entry = makeCatalogEntry({
      id: "image.generate.negative",
      capability: "image.generate",
      pricingJson: {
        unit_type: "image",
        currency: "CNY",
        price_micros_per_image: "-200000",
        source_note: "脏数据 fixture",
      },
    });
    const result = price({
      catalog: [entry],
      workload: [
        {
          capability: "image.generate",
          provider_model_id: "image.generate.negative",
          unit_type: "image",
          operation: "assets.generate",
          image_count: 1,
        },
      ],
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.contains_unbounded_item).toBe(true);
    expect(result.value.items[0]?.estimated_cost_micros).toBeNull();
  });

  it("falls back to zero price for free video entries on declared qualities only", () => {
    const freeVideo = makeCatalogEntry({
      id: "video.image_to_video.free.test",
      capability: "video.image_to_video",
      parameterCapabilitiesJson: {
        api_video_qualities: ["standard_720p", "high_1080p"],
        max_duration_seconds_per_task: 15,
      },
      pricingJson: {
        unit_type: "video_second",
        currency: "CNY",
        free: true,
        source_note: "free fixture（无价格 map）",
      },
    });
    const base = {
      capability: "video.image_to_video" as const,
      provider_model_id: "video.image_to_video.free.test",
      unit_type: "video_second" as const,
      operation: "assets.generate" as const,
      video_task_count: 2,
      estimated_seconds_total: 10,
    };
    const declared = price({
      catalog: [freeVideo],
      workload: [{ ...base, parameters: { api_quality: "standard_720p" } }],
    });
    if (!declared.ok) throw new Error(declared.error.message);
    expect(declared.value.estimated_cost_micros).toBe("0");
    expect(declared.value.authorization_cost_micros).toBe("0");
    expect(declared.value.contains_unbounded_item).toBe(false);

    // free 不授予未声明档位（Remotion 风格字符串仍拒绝）。
    const undeclared = price({
      catalog: [freeVideo],
      workload: [{ ...base, parameters: { api_quality: "1080P" } }],
    });
    expect(undeclared.ok).toBe(false);
  });

  it("prices stub/free catalog entries as exact zero without marking them unbounded", () => {
    const seed = buildPricingCatalogSeed({ llm: { mode: "stub" } });
    const result = price({
      catalog: seed,
      workload: [
        {
          capability: "llm.smart",
          provider_model_id: seed.find((e) => e.capability === "llm.smart")!.id,
          unit_type: "token",
          operation: "topic.generate",
          estimated_input_tokens: 1000,
          estimated_output_tokens: 500,
        },
      ],
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.estimated_cost_micros).toBe("0");
    expect(result.value.authorization_cost_micros).toBe("0");
    expect(result.value.contains_unbounded_item).toBe(false);
  });
});

describe("pricing service unbounded semantics", () => {
  it("marks items without a trusted upper bound as unbounded instead of zero", () => {
    const result = price({
      catalog: [unpricedLlmEntry()],
      workload: [
        {
          capability: "llm.smart",
          provider_model_id: "llm.smart.test.unpriced",
          unit_type: "token",
          operation: "topic.generate",
          estimated_input_tokens: 10000,
          estimated_output_tokens: 5000,
        },
      ],
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.contains_unbounded_item).toBe(true);
    const item = result.value.items[0];
    expect(item?.unbounded).toBe(true);
    // unbounded 不能被预算检查当作零：估算与授权都是 null，不是 "0"。
    expect(item?.estimated_cost_micros).toBeNull();
    expect(item?.authorization_cost_micros).toBeNull();
    expect(result.value.estimated_cost_micros).toBeNull();
    expect(result.value.authorization_cost_micros).toBeNull();
  });

  it("keeps bounded items priced when another item is unbounded", () => {
    const result = price({
      catalog: [unpricedLlmEntry(), imageEntry()],
      workload: [
        {
          capability: "llm.smart",
          provider_model_id: "llm.smart.test.unpriced",
          unit_type: "token",
          operation: "topic.generate",
          estimated_input_tokens: 10000,
          estimated_output_tokens: 5000,
        },
        {
          capability: "image.generate",
          provider_model_id: "image.generate.dashscope.test",
          unit_type: "image",
          operation: "assets.generate",
          image_count: 2,
        },
      ],
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.contains_unbounded_item).toBe(true);
    expect(result.value.authorization_cost_micros).toBeNull();
    const imageItem = result.value.items.find(
      (i) => i.provider_model_id === "image.generate.dashscope.test",
    );
    expect(imageItem?.estimated_cost_micros).toBe("400000");
    expect(imageItem?.unbounded).toBe(false);
  });
});

describe("pricing service input hardening", () => {
  it("rejects client-supplied unit prices", () => {
    const attempts: Array<Record<string, unknown>> = [
      { unit_price_micros: "1" },
      { price_micros: 1 },
      { unit_price: 0.2 },
      { pricing: { price_micros_per_image: "1" } },
    ];
    for (const extra of attempts) {
      const result = price({
        catalog: [imageEntry()],
        workload: [
          {
            capability: "image.generate",
            provider_model_id: "image.generate.dashscope.test",
            unit_type: "image",
            operation: "assets.generate",
            image_count: 1,
            ...extra,
          } as PricingWorkloadItem,
        ],
      });
      expect(result.ok, JSON.stringify(extra)).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe("pricing_invalid_workload");
    }
  });

  it("rejects workload items referencing unknown catalog entries", () => {
    const result = price({
      catalog: [imageEntry()],
      workload: [
        {
          capability: "image.generate",
          provider_model_id: "image.generate.missing",
          unit_type: "image",
          operation: "assets.generate",
          image_count: 1,
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("pricing_catalog_entry_not_found");
  });

  it("rejects disabled catalog entries", () => {
    const disabled = { ...imageEntry(), status: "disabled" as const };
    const result = price({
      catalog: [disabled],
      workload: [
        {
          capability: "image.generate",
          provider_model_id: "image.generate.dashscope.test",
          unit_type: "image",
          operation: "assets.generate",
          image_count: 1,
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("pricing_catalog_entry_not_quotable");
  });

  it("rejects entries blocked by readiness cross-validation", () => {
    const result = price({
      catalog: [imageEntry()],
      blockedProviderModelIds: ["image.generate.dashscope.test"],
      workload: [
        {
          capability: "image.generate",
          provider_model_id: "image.generate.dashscope.test",
          unit_type: "image",
          operation: "assets.generate",
          image_count: 1,
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("pricing_catalog_entry_not_quotable");
  });

  it("rejects unit type mismatches between workload and catalog pricing", () => {
    const result = price({
      catalog: [imageEntry()],
      workload: [
        {
          capability: "image.generate",
          provider_model_id: "image.generate.dashscope.test",
          unit_type: "tts_character",
          operation: "assets.generate",
          character_count: 100,
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("pricing_unit_type_mismatch");
  });

  it("rejects workload capability that does not match the catalog entry capability", () => {
    const result = price({
      catalog: [imageEntry()],
      workload: [
        {
          capability: "llm.flash",
          provider_model_id: "image.generate.dashscope.test",
          unit_type: "image",
          operation: "assets.generate",
          image_count: 1,
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("pricing_capability_mismatch");
  });

  it("rejects malformed catalog entries with a structured error instead of throwing", () => {
    // 对抗（diff_reviewer I-3）：active 条目缺 pricingJson 等脏数据必须落结构化错误，
    // 不得以裸 TypeError 崩溃。
    const malformed = {
      id: "image.generate.malformed",
      capability: "image.generate",
      providerKey: "dashscope",
      modelId: "broken",
      status: "active",
      isDefault: false,
      pricingVersion: "v",
      // 故意缺 pricingJson / parameterCapabilitiesJson
    };
    const result = price({
      catalog: [malformed as never],
      workload: [
        {
          capability: "image.generate",
          provider_model_id: "image.generate.malformed",
          unit_type: "image",
          operation: "assets.generate",
          image_count: 1,
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("pricing_invalid_workload");
  });
});

describe("pricing hash and versions", () => {
  const llmWorkload: PricingWorkloadItem = {
    capability: "llm.smart",
    provider_model_id: "llm.smart.test.priced",
    unit_type: "token",
    operation: "topic.generate",
    estimated_input_tokens: 1000,
    estimated_output_tokens: 500,
  };

  it("returns a sha256 pricing hash over normalized pricing content", () => {
    const result = price({ catalog: [pricedLlmEntry()], workload: [llmWorkload] });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.pricing_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.value.pricing_versions).toEqual(["test-pricing-2026-08-17"]);
  });

  it("is deterministic for identical pricing content regardless of catalog order", () => {
    const other = pricedLlmEntry("llm.flash.test.priced2");
    other.capability = "llm.flash" as CapabilitySlot;
    const a = price({ catalog: [pricedLlmEntry(), other], workload: [llmWorkload] });
    const b = price({ catalog: [other, pricedLlmEntry()], workload: [llmWorkload] });
    if (!a.ok || !b.ok) throw new Error("pricing failed");
    expect(a.value.pricing_hash).toBe(b.value.pricing_hash);
  });

  it("changes the hash when a used price changes", () => {
    const changed = pricedLlmEntry();
    (changed.pricingJson as Record<string, unknown>).input_price_micros_per_million_tokens =
      "3000000";
    const a = price({ catalog: [pricedLlmEntry()], workload: [llmWorkload] });
    const b = price({ catalog: [changed], workload: [llmWorkload] });
    if (!a.ok || !b.ok) throw new Error("pricing failed");
    expect(a.value.pricing_hash).not.toBe(b.value.pricing_hash);
  });

  it("collects unique pricing versions sorted lexicographically", () => {
    const entryA = pricedLlmEntry(); // test-pricing-2026-08-17
    const entryB = imageEntry(); // test-pricing-2026-08-17 (same version)
    const entryC = {
      ...ttsEntry(),
      pricingVersion: "test-pricing-2026-01-01",
    };
    const result = price({
      catalog: [entryA, entryB, entryC],
      workload: [
        llmWorkload,
        {
          capability: "image.generate",
          provider_model_id: "image.generate.dashscope.test",
          unit_type: "image",
          operation: "assets.generate",
          image_count: 1,
        },
        {
          capability: "tts.synthesize",
          provider_model_id: "tts.synthesize.dashscope.test",
          unit_type: "tts_character",
          operation: "assets.generate",
          character_count: 10,
        },
      ],
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.pricing_versions).toEqual([
      "test-pricing-2026-01-01",
      "test-pricing-2026-08-17",
    ]);
  });
});
