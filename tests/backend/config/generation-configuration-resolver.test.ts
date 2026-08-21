import { describe, expect, it } from "vitest";

import {
  type ApiVideoSuitability,
  type GenerationConfigurationV1,
  type ResolvedVisualRoute,
  type VideoGenerationStrategy,
  DEFAULT_GENERATION_CONFIGURATION,
} from "../../../shared/src/index.js";
import {
  type ProviderModelCatalogEntry,
  type ResolveGenerationConfigurationInput,
  type ResolvedGenerationConfigurationV1,
  type SystemGenerationConstraints,
  resolveGenerationConfiguration,
} from "../../../shared/src/generation/generation-configuration-resolver.js";

/**
 * S2-2A 任务 1 步骤 3：解析器失败测试。
 *
 * 覆盖实施计划列出的完整测试矩阵与边界：
 * - 四档策略 × 四档适配度的视觉路线映射。
 * - 系统/管理员禁用真实视频 provider。
 * - 分镜覆盖优先于 run override 与项目配置，但不能绕过管理员禁用。
 * - 当前用户默认不直接参与既有项目解析（只作为冻结来源元数据）。
 * - 明确选择禁用模型返回结构化失败码，不静默换模型。
 * - auto 模式允许在启用目录中重解析，并输出实际 provider/model。
 */

const baseConfig: GenerationConfigurationV1 = {
  ...DEFAULT_GENERATION_CONFIGURATION,
};

/**
 * 一个完整的 active catalog，让矩阵/约束/覆盖类用例聚焦路线解析，
 * 不被 capability 解析失败干扰；capability 专属用例在下面单独控制 catalog。
 * 每个 capability 恰好一个 is_default=true active 项（auto 选择硬合同）。
 */
const fullActiveCatalog: ProviderModelCatalogEntry[] = [
  {
    provider_model_id: "dashscope.qwen-max",
    capability: "llm.smart",
    provider_key: "dashscope",
    model_id: "qwen-max",
    status: "active",
    is_default: true,
  },
  {
    provider_model_id: "dashscope.qwen-flash",
    capability: "llm.flash",
    provider_key: "dashscope",
    model_id: "qwen-flash",
    status: "active",
    is_default: true,
  },
  {
    provider_model_id: "dashscope.wanx",
    capability: "image.generate",
    provider_key: "dashscope",
    model_id: "wanx-v1",
    status: "active",
    is_default: true,
  },
  {
    provider_model_id: "dashscope.video",
    capability: "video.image_to_video",
    provider_key: "dashscope",
    model_id: "video-v1",
    status: "active",
    is_default: true,
  },
  {
    provider_model_id: "dashscope.tts",
    capability: "tts.synthesize",
    provider_key: "dashscope",
    model_id: "qwen3-tts",
    status: "active",
    is_default: true,
  },
];

function buildInput(
  overrides: Partial<ResolveGenerationConfigurationInput>,
): ResolveGenerationConfigurationInput {
  return {
    projectConfiguration: baseConfig,
    projectConfigurationRevision: 1,
    sourceUserPreferenceRevision: null,
    systemConstraints: {
      apiVideoProviderEnabled: true,
    },
    providerModelCatalog: fullActiveCatalog,
    operation: "assets.generate",
    ...overrides,
  };
}

function resolveSegmentRoute(
  resolved: ResolvedGenerationConfigurationV1,
  segmentId: string,
): ResolvedVisualRoute {
  const route = resolved.segment_visual_routes.find(
    (r) => r.segment_id === segmentId,
  );
  if (!route) {
    throw new Error(`segment ${segmentId} not resolved`);
  }
  return route.resolved_route;
}

describe("resolveGenerationConfiguration visual route matrix", () => {
  const strategies: VideoGenerationStrategy[] = [
    "all_api_video",
    "prefer_api_video",
    "prefer_remotion",
    "all_remotion",
  ];
  const suitabilities: ApiVideoSuitability[] = [
    "remotion_only",
    "remotion_sufficient",
    "api_video_beneficial",
    "api_video_strongly_recommended",
  ];

  // 期望矩阵：strategy × suitability → resolved route
  // 与实施计划步骤 3 表格一致。
  const expected: Record<
    VideoGenerationStrategy,
    Partial<Record<ApiVideoSuitability, ResolvedVisualRoute>>
  > = {
    all_api_video: {
      remotion_only: "remotion",
      remotion_sufficient: "api_video",
      api_video_beneficial: "api_video",
      api_video_strongly_recommended: "api_video",
    },
    prefer_api_video: {
      remotion_only: "remotion",
      remotion_sufficient: "remotion",
      api_video_beneficial: "api_video",
      api_video_strongly_recommended: "api_video",
    },
    prefer_remotion: {
      remotion_only: "remotion",
      remotion_sufficient: "remotion",
      api_video_beneficial: "remotion",
      api_video_strongly_recommended: "api_video",
    },
    all_remotion: {
      remotion_only: "remotion",
      remotion_sufficient: "remotion",
      api_video_beneficial: "remotion",
      api_video_strongly_recommended: "remotion",
    },
  };

  for (const strategy of strategies) {
    for (const suitability of suitabilities) {
      const want = expected[strategy][suitability]!;
      it(`maps strategy=${strategy} + suitability=${suitability} to ${want}`, () => {
        const input = buildInput({
          projectConfiguration: {
            ...baseConfig,
            video: { ...baseConfig.video, strategy },
          },
          segmentInputs: [
            { segment_id: "seg_1", api_video_suitability: suitability },
          ],
        });
        const resolved = resolveGenerationConfiguration(input);
        expect(resolved.ok).toBe(true);
        if (!resolved.ok) return;
        expect(resolveSegmentRoute(resolved.value, "seg_1")).toBe(want);
      });
    }
  }

  it("produces a stable canonical hash for identical inputs", () => {
    const input = buildInput({
      segmentInputs: [
        { segment_id: "seg_1", api_video_suitability: "api_video_beneficial" },
      ],
    });
    const a = resolveGenerationConfiguration(input);
    const b = resolveGenerationConfiguration(input);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.configuration_hash).toBe(b.value.configuration_hash);
    }
  });
});

describe("resolveGenerationConfiguration admin / system constraints", () => {
  it("forces every API-capable segment to remotion when apiVideoProviderEnabled=false", () => {
    const input = buildInput({
      projectConfiguration: {
        ...baseConfig,
        video: { ...baseConfig.video, strategy: "all_api_video" },
      },
      systemConstraints: { apiVideoProviderEnabled: false },
      segmentInputs: [
        { segment_id: "seg_1", api_video_suitability: "api_video_strongly_recommended" },
      ],
    });
    const resolved = resolveGenerationConfiguration(input);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolveSegmentRoute(resolved.value, "seg_1")).toBe("remotion");
    // 管理员禁用必须留下可追踪的 constraints_applied 记录。
    expect(
      resolved.value.constraints_applied.some(
        (c) => c.constraint === "api_video_provider_disabled",
      ),
    ).toBe(true);
  });

  it("all_remotion never produces api_video even when provider is enabled", () => {
    const input = buildInput({
      projectConfiguration: {
        ...baseConfig,
        video: { ...baseConfig.video, strategy: "all_remotion" },
      },
      segmentInputs: [
        { segment_id: "seg_1", api_video_suitability: "api_video_strongly_recommended" },
      ],
    });
    const resolved = resolveGenerationConfiguration(input);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolveSegmentRoute(resolved.value, "seg_1")).toBe("remotion");
  });
});

describe("resolveGenerationConfiguration segment override precedence", () => {
  it("segment override beats run override and project configuration", () => {
    const input = buildInput({
      projectConfiguration: {
        ...baseConfig,
        video: { ...baseConfig.video, strategy: "all_remotion" },
      },
      runOverrides: {
        video: { ...baseConfig.video, strategy: "all_remotion" },
      },
      segmentInputs: [
        { segment_id: "seg_1", api_video_suitability: "remotion_sufficient" },
      ],
      segmentOverrides: { seg_1: "api_video" },
    });
    const resolved = resolveGenerationConfiguration(input);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolveSegmentRoute(resolved.value, "seg_1")).toBe("api_video");
    expect(
      resolved.value.constraints_applied.some(
        (c) => c.constraint === "segment_override_applied",
      ),
    ).toBe(true);
  });

  it("segment override=null inherits project strategy resolution", () => {
    const input = buildInput({
      projectConfiguration: {
        ...baseConfig,
        video: { ...baseConfig.video, strategy: "prefer_remotion" },
      },
      segmentInputs: [
        { segment_id: "seg_1", api_video_suitability: "api_video_strongly_recommended" },
      ],
      segmentOverrides: { seg_1: null },
    });
    const resolved = resolveGenerationConfiguration(input);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolveSegmentRoute(resolved.value, "seg_1")).toBe("api_video");
  });

  it("segment override cannot bypass admin disable of the video provider", () => {
    const input = buildInput({
      projectConfiguration: {
        ...baseConfig,
        video: { ...baseConfig.video, strategy: "all_api_video" },
      },
      systemConstraints: { apiVideoProviderEnabled: false },
      segmentInputs: [
        { segment_id: "seg_1", api_video_suitability: "api_video_strongly_recommended" },
      ],
      segmentOverrides: { seg_1: "api_video" },
    });
    const resolved = resolveGenerationConfiguration(input);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolveSegmentRoute(resolved.value, "seg_1")).toBe("remotion");
  });

  it("run override of video strategy changes baseline resolution", () => {
    const input = buildInput({
      projectConfiguration: {
        ...baseConfig,
        video: { ...baseConfig.video, strategy: "prefer_remotion" },
      },
      runOverrides: {
        video: { ...baseConfig.video, strategy: "all_api_video" },
      },
      segmentInputs: [
        { segment_id: "seg_1", api_video_suitability: "remotion_sufficient" },
      ],
    });
    const resolved = resolveGenerationConfiguration(input);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    // all_api_video + remotion_sufficient -> api_video
    expect(resolveSegmentRoute(resolved.value, "seg_1")).toBe("api_video");
  });
});

describe("resolveGenerationConfiguration user preference isolation", () => {
  it("current user default does not participate in existing project resolution", () => {
    // resolver 不接受 currentUserPreference 输入；sourceUserPreferenceRevision
    // 只是冻结来源元数据，运行时禁止重新读取当前用户默认。
    const input = buildInput({
      projectConfiguration: {
        ...baseConfig,
        video: { ...baseConfig.video, strategy: "all_remotion" },
      },
      sourceUserPreferenceRevision: 7,
    });
    const resolved = resolveGenerationConfiguration(input);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.source_revisions.source_user_preference_revision).toBe(7);
    // effective 配置来自 project，与任何"当前用户默认"无关。
    expect(resolved.value.effective.video.strategy).toBe("all_remotion");
  });
});

describe("resolveGenerationConfiguration capability resolution", () => {
  const catalogWithDefaults: ProviderModelCatalogEntry[] = [
    {
      provider_model_id: "dashscope.qwen-max",
      capability: "llm.smart",
      provider_key: "dashscope",
      model_id: "qwen-max",
      status: "active",
      is_default: true,
    },
    {
      provider_model_id: "dashscope.qwen-flash",
      capability: "llm.flash",
      provider_key: "dashscope",
      model_id: "qwen-flash",
      status: "active",
      is_default: true,
    },
    {
      provider_model_id: "dashscope.wanx",
      capability: "image.generate",
      provider_key: "dashscope",
      model_id: "wanx-v1",
      status: "active",
      is_default: true,
    },
    {
      provider_model_id: "dashscope.video",
      capability: "video.image_to_video",
      provider_key: "dashscope",
      model_id: "video-v1",
      status: "active",
      is_default: true,
    },
    {
      provider_model_id: "dashscope.tts",
      capability: "tts.synthesize",
      provider_key: "dashscope",
      model_id: "qwen3-tts",
      status: "active",
      is_default: true,
    },
  ];

  it("auto mode resolves each slot to the active catalog default and records provider/model", () => {
    const input = buildInput({
      providerModelCatalog: catalogWithDefaults,
    });
    const resolved = resolveGenerationConfiguration(input);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.resolved_capabilities["llm.smart"]).toEqual({
      mode: "auto",
      provider_model_id: "dashscope.qwen-max",
      provider_key: "dashscope",
      model_id: "qwen-max",
    });
    expect(resolved.value.resolved_capabilities["image.generate"]).toEqual({
      mode: "auto",
      provider_model_id: "dashscope.wanx",
      provider_key: "dashscope",
      model_id: "wanx-v1",
    });
  });

  it("auto mode is re-resolvable when catalog changes and yields different provider/model", () => {
    const newCatalog = catalogWithDefaults.map((entry) =>
      entry.capability === "llm.smart"
        ? {
            ...entry,
            provider_model_id: "dashscope.qwen-max-v2",
            model_id: "qwen-max-v2",
          }
        : entry,
    );
    const input = buildInput({ providerModelCatalog: newCatalog });
    const resolved = resolveGenerationConfiguration(input);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.resolved_capabilities["llm.smart"]?.provider_model_id).toBe(
      "dashscope.qwen-max-v2",
    );
  });

  it("fixed selection of an active provider_model_id resolves to that exact model", () => {
    const input = buildInput({
      projectConfiguration: {
        ...baseConfig,
        capabilities: {
          ...baseConfig.capabilities,
          "llm.smart": { mode: "fixed", provider_model_id: "dashscope.qwen-max" },
        },
      },
      providerModelCatalog: catalogWithDefaults,
    });
    const resolved = resolveGenerationConfiguration(input);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.resolved_capabilities["llm.smart"]?.provider_model_id).toBe(
      "dashscope.qwen-max",
    );
    expect(resolved.value.resolved_capabilities["llm.smart"]?.mode).toBe("fixed");
  });

  it("fixed selection of a disabled provider_model_id returns structured failure, never silent fallback", () => {
    const disabledCatalog: ProviderModelCatalogEntry[] = catalogWithDefaults.map((entry) =>
      entry.provider_model_id === "dashscope.qwen-flash"
        ? { ...entry, status: "disabled" }
        : entry,
    );
    const input = buildInput({
      projectConfiguration: {
        ...baseConfig,
        capabilities: {
          ...baseConfig.capabilities,
          "llm.flash": { mode: "fixed", provider_model_id: "dashscope.qwen-flash" },
        },
      },
      providerModelCatalog: disabledCatalog,
    });
    const resolved = resolveGenerationConfiguration(input);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.error.code).toBe("generation_model_disabled");
    expect(resolved.error.capability).toBe("llm.flash");
  });

  it("fixed selection of an unknown provider_model_id returns structured failure", () => {
    const input = buildInput({
      projectConfiguration: {
        ...baseConfig,
        capabilities: {
          ...baseConfig.capabilities,
          "llm.smart": { mode: "fixed", provider_model_id: "does.not.exist" },
        },
      },
      providerModelCatalog: catalogWithDefaults,
    });
    const resolved = resolveGenerationConfiguration(input);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.error.code).toBe("generation_capability_unavailable");
    expect(resolved.error.capability).toBe("llm.smart");
  });

  it("auto mode with no active catalog entry returns structured failure", () => {
    const input = buildInput({
      projectConfiguration: {
        ...baseConfig,
        capabilities: {
          ...baseConfig.capabilities,
          "llm.smart": { mode: "auto" },
        },
      },
      providerModelCatalog: catalogWithDefaults.filter(
        (entry) => entry.capability !== "llm.smart",
      ),
    });
    const resolved = resolveGenerationConfiguration(input);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.error.code).toBe("generation_capability_unavailable");
    expect(resolved.error.capability).toBe("llm.smart");
  });
});

describe("resolveGenerationConfiguration deterministic outputs", () => {
  it("produces a stable catalog_hash from the catalog", () => {
    const a = resolveGenerationConfiguration(
      buildInput({ providerModelCatalog: fullActiveCatalog }),
    );
    const b = resolveGenerationConfiguration(
      buildInput({ providerModelCatalog: fullActiveCatalog }),
    );
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.catalog_hash).toBe(b.value.catalog_hash);
    }
  });

  it("different catalog produces a different catalog_hash", () => {
    const catalogB: ProviderModelCatalogEntry[] = fullActiveCatalog.map((entry) =>
      entry.provider_model_id === "dashscope.qwen-max"
        ? { ...entry, model_id: "qwen-max-v2" }
        : entry,
    );
    const a = resolveGenerationConfiguration(
      buildInput({ providerModelCatalog: fullActiveCatalog }),
    );
    const b = resolveGenerationConfiguration(
      buildInput({ providerModelCatalog: catalogB }),
    );
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.catalog_hash).not.toBe(b.value.catalog_hash);
    }
  });

  it("catalog_hash does NOT include price fields (pricing_hash is PricingService's job)", () => {
    // P1-1: catalog 输入合同不含任何价格字段（strict schema 拒绝 pricing_* 字段），
    // 所以 catalog_hash 只反映 catalog 结构，价格变化不会进入 resolver。
    // 这里验证：给 catalog 加一个价格字段会被 schema 拒绝（resolver 返回结构化错误），
    // 而不是被静默纳入 hash。
    const catalogWithPriceField = fullActiveCatalog.map((entry) => ({
      ...entry,
      // @ts-expect-error catalog schema is strict and rejects price fields
      price_per_unit_micros: "999",
    }));
    const resolved = resolveGenerationConfiguration(
      buildInput({ providerModelCatalog: catalogWithPriceField }),
    );
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.error.code).toBe("generation_configuration_invalid");
  });

  it("catalog_hash changes when model_id content changes", () => {
    // catalog_hash 反映 catalog 结构内容（model_id 是结构字段）。
    const catalogModified = fullActiveCatalog.map((entry) =>
      entry.provider_model_id === "dashscope.qwen-max"
        ? { ...entry, model_id: "qwen-max-v2" }
        : entry,
    );
    const a = resolveGenerationConfiguration(buildInput({ providerModelCatalog: fullActiveCatalog }));
    const b = resolveGenerationConfiguration(buildInput({ providerModelCatalog: catalogModified }));
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      // is_default 是 catalog 结构字段，会进入 canonical JSON，所以 hash 变化是正确的。
      expect(a.value.catalog_hash).not.toBe(b.value.catalog_hash);
    }
  });

  it("each segment route records a non-empty reason code", () => {
    const input = buildInput({
      projectConfiguration: {
        ...baseConfig,
        video: { ...baseConfig.video, strategy: "prefer_remotion" },
      },
      segmentInputs: [
        { segment_id: "seg_1", api_video_suitability: "remotion_only" },
        { segment_id: "seg_2", api_video_suitability: "api_video_strongly_recommended" },
      ],
    });
    const resolved = resolveGenerationConfiguration(input);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    for (const route of resolved.value.segment_visual_routes) {
      expect(route.reason_code.length).toBeGreaterThan(0);
    }
  });
});

describe("resolveGenerationConfiguration structured error on invalid input", () => {
  // P1-2a: 损坏的项目配置（capabilities 缺字段）必须返回结构化错误，而不是抛异常。
  it("returns generation_configuration_invalid when project config capabilities are broken", () => {
    const brokenConfig = {
      ...baseConfig,
      capabilities: { "llm.smart": { mode: "auto" } },
    } as unknown as GenerationConfigurationV1;
    let threw = false;
    let result: ReturnType<typeof resolveGenerationConfiguration> = { ok: true, value: undefined as never };
    try {
      result = resolveGenerationConfiguration(
        buildInput({ projectConfiguration: brokenConfig }),
      );
    } catch (e) {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("generation_configuration_invalid");
  });

  it("returns generation_configuration_invalid when systemConstraints is missing the flag", () => {
    const result = resolveGenerationConfiguration({
      ...buildInput({}),
      // @ts-expect-error intentionally broken input
      systemConstraints: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("generation_configuration_invalid");
  });

  it("returns generation_configuration_invalid when providerModelCatalog entry is malformed", () => {
    const result = resolveGenerationConfiguration(
      buildInput({
        providerModelCatalog: [
          // @ts-expect-error intentionally malformed (missing provider_key)
          { provider_model_id: "x", capability: "llm.smart", model_id: "m", status: "active" },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("generation_configuration_invalid");
  });

  // P1-2b: 非法分镜覆盖必须返回结构化错误，而不是被静默改成 null（继承）。
  it("returns generation_configuration_invalid for an illegal segment override value", () => {
    const result = resolveGenerationConfiguration(
      buildInput({
        segmentInputs: [
          { segment_id: "seg_1", api_video_suitability: "api_video_beneficial" },
        ],
        segmentOverrides: {
          // @ts-expect-error intentionally illegal override value
          seg_1: "GARBAGE",
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("generation_configuration_invalid");
  });

  it("accepts legal override values api_video / remotion_motion / null", () => {
    for (const override of ["api_video", "remotion_motion", null] as const) {
      const result = resolveGenerationConfiguration(
        buildInput({
          segmentInputs: [
            { segment_id: "seg_1", api_video_suitability: "api_video_beneficial" },
          ],
          segmentOverrides: { seg_1: override },
        }),
      );
      expect(result.ok).toBe(true);
    }
  });
});

describe("resolveGenerationConfiguration hash algorithm identity and boundaries", () => {
  // P2: 漂移检测 hash 前缀必须名实相符——当前是 FNV-1a64，必须标识为 fnv1a64，不能冒充 sha256。
  it("configuration_hash and catalog_hash use the fnv1a64 drift-detection prefix", () => {
    const resolved = resolveGenerationConfiguration(buildInput({}));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.configuration_hash.startsWith("fnv1a64:")).toBe(true);
    expect(resolved.value.catalog_hash.startsWith("fnv1a64:")).toBe(true);
    // FNV-1a64 输出固定 16 位十六进制
    expect(resolved.value.configuration_hash.slice("fnv1a64:".length)).toMatch(/^[0-9a-f]{16}$/);
    expect(resolved.value.catalog_hash.slice("fnv1a64:".length)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("resolver does not produce pricing_hash (pricing hash is PricingService's job, task 7)", () => {
    // P1-1: resolver 不再产出 pricing_hash。catalog_hash 只反映目录结构，不含价格。
    const resolved = resolveGenerationConfiguration(buildInput({}));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect((resolved.value as Record<string, unknown>).pricing_hash).toBeUndefined();
    expect("catalog_hash" in resolved.value).toBe(true);
  });

  it("drift hashes never claim sha256 strength they do not have", () => {
    const resolved = resolveGenerationConfiguration(buildInput({}));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    // sha256 hex 应为 64 位；漂移检测 hash 不应使用该前缀（授权指纹才用，由任务 8 产出）。
    expect(resolved.value.configuration_hash.startsWith("sha256:")).toBe(false);
    expect(resolved.value.catalog_hash.startsWith("sha256:")).toBe(false);
  });

  it("identical inputs produce identical hashes; different project revision produces different config hash", () => {
    const a = resolveGenerationConfiguration(buildInput({ projectConfigurationRevision: 1 }));
    const b = resolveGenerationConfiguration(buildInput({ projectConfigurationRevision: 1 }));
    const c = resolveGenerationConfiguration(buildInput({ projectConfigurationRevision: 2 }));
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (!(a.ok && b.ok && c.ok)) return;
    expect(a.value.configuration_hash).toBe(b.value.configuration_hash);
    expect(a.value.configuration_hash).not.toBe(c.value.configuration_hash);
  });
});

describe("resolveGenerationConfiguration auto default model selection", () => {
  // P1: auto 必须选择 is_default=true 的 active 项，而不是依赖数组顺序。
  it("auto selects the is_default=true entry regardless of array order", () => {
    const catalogReordered: ProviderModelCatalogEntry[] = [
      // 非 default 项排在前面
      { provider_model_id: "dashscope.qwen-max-v2", capability: "llm.smart", provider_key: "dashscope", model_id: "qwen-max-v2", status: "active", is_default: false },
      { provider_model_id: "dashscope.qwen-max", capability: "llm.smart", provider_key: "dashscope", model_id: "qwen-max", status: "active", is_default: true },
      ...fullActiveCatalog.filter((e) => e.capability !== "llm.smart"),
    ];
    const resolved = resolveGenerationConfiguration(
      buildInput({ providerModelCatalog: catalogReordered }),
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    // 即使 default 项在数组第二个，auto 仍选它
    expect(resolved.value.resolved_capabilities["llm.smart"].model_id).toBe("qwen-max");
  });

  // P1: 零默认项必须返回结构化错误，不再退回数组首项（彻底消除顺序依赖）。
  it("auto rejects a capability with zero active default entries", () => {
    const catalogNoDefault: ProviderModelCatalogEntry[] = fullActiveCatalog.map((e) => ({
      ...e,
      is_default: false,
    }));
    const resolved = resolveGenerationConfiguration(
      buildInput({ providerModelCatalog: catalogNoDefault }),
    );
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.error.code).toBe("generation_configuration_invalid");
    expect(resolved.error.capability).toBe("llm.smart");
  });

  it("auto rejects a catalog with multiple active default entries for one capability", () => {
    const catalogTwoDefaults: ProviderModelCatalogEntry[] = fullActiveCatalog.flatMap((e) =>
      e.capability === "llm.smart"
        ? [
            { ...e, is_default: true },
            { ...e, provider_model_id: "dashscope.qwen-max-v2", model_id: "qwen-max-v2", is_default: true },
          ]
        : [e],
    );
    const resolved = resolveGenerationConfiguration(
      buildInput({ providerModelCatalog: catalogTwoDefaults }),
    );
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.error.code).toBe("generation_configuration_invalid");
    expect(resolved.error.capability).toBe("llm.smart");
  });

  // P1: catalog_hash 必须对数组顺序不敏感（catalog 语义上是按 ID 标识的集合）。
  it("catalog_hash is stable regardless of catalog row order", () => {
    const reordered = [...fullActiveCatalog].reverse();
    const a = resolveGenerationConfiguration(buildInput({ providerModelCatalog: fullActiveCatalog }));
    const b = resolveGenerationConfiguration(buildInput({ providerModelCatalog: reordered }));
    expect(a.ok && b.ok).toBe(true);
    if (!(a.ok && b.ok)) return;
    // 解析出的默认模型相同
    expect(a.value.resolved_capabilities["llm.smart"].model_id).toBe(
      b.value.resolved_capabilities["llm.smart"].model_id,
    );
    // catalog_hash 也相同（规范化排序后计算）
    expect(a.value.catalog_hash).toBe(b.value.catalog_hash);
  });

  it("catalog_hash rejects duplicate provider_model_id entries", () => {
    const catalogDup: ProviderModelCatalogEntry[] = [
      ...fullActiveCatalog,
      { ...fullActiveCatalog[0]! },
    ];
    const resolved = resolveGenerationConfiguration(
      buildInput({ providerModelCatalog: catalogDup }),
    );
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.error.code).toBe("generation_configuration_invalid");
  });
});

describe("resolveGenerationConfiguration S2-2C multi-candidate catalog fixed selection", () => {
  // 同槽两个 active 条目：默认 + 非默认候选（目录多候选形态，S2-2C 详细设计 §7）。
  const multiCandidateCatalog: ProviderModelCatalogEntry[] = [
    ...fullActiveCatalog,
    {
      provider_model_id: "llm.smart.zhipu.glm-4",
      capability: "llm.smart",
      provider_key: "zhipu",
      model_id: "glm-4",
      status: "active",
      is_default: false,
    },
  ];

  it("fixed to a non-default active candidate resolves exactly to that model", () => {
    const input = buildInput({
      projectConfiguration: {
        ...baseConfig,
        capabilities: {
          ...baseConfig.capabilities,
          "llm.smart": {
            mode: "fixed",
            provider_model_id: "llm.smart.zhipu.glm-4",
          },
        },
      },
      providerModelCatalog: multiCandidateCatalog,
    });
    const resolved = resolveGenerationConfiguration(input);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.resolved_capabilities["llm.smart"]).toEqual({
      mode: "fixed",
      provider_model_id: "llm.smart.zhipu.glm-4",
      provider_key: "zhipu",
      model_id: "glm-4",
    });
  });

  it("auto still resolves the default entry when a non-default candidate exists", () => {
    const input = buildInput({
      providerModelCatalog: multiCandidateCatalog,
    });
    const resolved = resolveGenerationConfiguration(input);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.resolved_capabilities["llm.smart"]).toEqual({
      mode: "auto",
      provider_model_id: "dashscope.qwen-max",
      provider_key: "dashscope",
      model_id: "qwen-max",
    });
  });

  it("fixed to a provider_model_id belonging to another slot returns generation_capability_unavailable", () => {
    const input = buildInput({
      projectConfiguration: {
        ...baseConfig,
        capabilities: {
          ...baseConfig.capabilities,
          // 该 id 属于 llm.smart 槽位，但被配置到 llm.flash
          "llm.flash": {
            mode: "fixed",
            provider_model_id: "llm.smart.zhipu.glm-4",
          },
        },
      },
      providerModelCatalog: multiCandidateCatalog,
    });
    const resolved = resolveGenerationConfiguration(input);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.error.code).toBe("generation_capability_unavailable");
    expect(resolved.error.capability).toBe("llm.flash");
  });

  it("fixed target change alters configuration_hash (quote drift detection basis)", () => {
    const base = buildInput({ providerModelCatalog: multiCandidateCatalog });
    const fixedToDefault = resolveGenerationConfiguration({
      ...base,
      projectConfiguration: {
        ...baseConfig,
        capabilities: {
          ...baseConfig.capabilities,
          "llm.smart": {
            mode: "fixed",
            provider_model_id: "dashscope.qwen-max",
          },
        },
      },
    });
    const fixedToCandidate = resolveGenerationConfiguration({
      ...base,
      projectConfiguration: {
        ...baseConfig,
        capabilities: {
          ...baseConfig.capabilities,
          "llm.smart": {
            mode: "fixed",
            provider_model_id: "llm.smart.zhipu.glm-4",
          },
        },
      },
    });
    expect(fixedToDefault.ok && fixedToCandidate.ok).toBe(true);
    if (!fixedToDefault.ok || !fixedToCandidate.ok) return;
    expect(fixedToDefault.value.configuration_hash).not.toBe(
      fixedToCandidate.value.configuration_hash,
    );
  });

  it("catalog default change (A→B) alters configuration_hash for identical auto configuration", () => {
    const catalogWithDefaultB: ProviderModelCatalogEntry[] = fullActiveCatalog.map((entry) =>
      entry.capability === "llm.smart"
        ? {
            ...entry,
            provider_model_id: "dashscope.qwen-max-v2",
            model_id: "qwen-max-v2",
          }
        : entry,
    );
    const withDefaultA = resolveGenerationConfiguration(
      buildInput({ providerModelCatalog: fullActiveCatalog }),
    );
    const withDefaultB = resolveGenerationConfiguration(
      buildInput({ providerModelCatalog: catalogWithDefaultB }),
    );
    expect(withDefaultA.ok && withDefaultB.ok).toBe(true);
    if (!withDefaultA.ok || !withDefaultB.ok) return;
    expect(withDefaultA.value.configuration_hash).not.toBe(
      withDefaultB.value.configuration_hash,
    );
  });
});

describe("resolveGenerationConfiguration voice compatibility follows fixed tts provider", () => {
  const ttsCatalog: ProviderModelCatalogEntry[] = fullActiveCatalog.map((entry) =>
    entry.capability === "tts.synthesize" ? { ...entry, is_default: true } : entry,
  );

  function buildVoiceProfile(providerName: string) {
    return {
      voice_profile_id: "voice_test_profile",
      kind: "preset" as const,
      owner_id: null,
      visibility: "public" as const,
      name: "测试音色",
      description: "测试",
      design_prompt: "测试音色设计提示",
      preview_text: "历史长河，风起云涌。",
      provider_name: providerName,
      provider_voice_id: null,
      provider_status: "ready" as const,
      target_model: "qwen3-tts-instruct-flash",
      recommended_content_families: ["历史"],
      voice_traits: ["沉稳"],
      avoid_traits: ["轻浮"],
      gender_tone: "male",
      age_band: "adult",
      pitch: "low",
      pace: "slow",
      energy: 0.5,
      authority: 0.8,
      suspense: 0.3,
      warmth: 0.4,
      preview_audio_uri: null,
      usage_count: 0,
      last_used_at: null,
      quality_score: 0.8,
      created_at: "2026-08-21T00:00:00.000Z",
      updated_at: "2026-08-21T00:00:00.000Z",
    };
  }

  it("voice profile compatible with fixed dashscope tts resolves to fixed voice", () => {
    const input = buildInput({
      projectConfiguration: {
        ...baseConfig,
        creative: { ...baseConfig.creative, voice_profile_id: "voice_test_profile" },
        capabilities: {
          ...baseConfig.capabilities,
          "tts.synthesize": {
            mode: "fixed",
            provider_model_id: "dashscope.tts",
          },
        },
      },
      providerModelCatalog: ttsCatalog,
      voiceProfiles: [buildVoiceProfile("dashscope")],
    });
    const resolved = resolveGenerationConfiguration(input);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.resolved_capabilities["tts.synthesize"].mode).toBe("fixed");
    expect(resolved.value.resolved_creative.voice).toMatchObject({
      mode: "fixed",
      voice_profile_id: "voice_test_profile",
      provider_name: "dashscope",
    });
  });

  it("voice profile incompatible with fixed tts provider returns structured failure", () => {
    const catalogWithOpenaiTts: ProviderModelCatalogEntry[] = ttsCatalog.map((entry) =>
      entry.capability === "tts.synthesize"
        ? {
            provider_model_id: "tts.openai.gpt-tts",
            capability: "tts.synthesize" as const,
            provider_key: "openai",
            model_id: "gpt-tts",
            status: "active" as const,
            is_default: false,
          }
        : entry,
    );
    const input = buildInput({
      projectConfiguration: {
        ...baseConfig,
        creative: { ...baseConfig.creative, voice_profile_id: "voice_test_profile" },
        capabilities: {
          ...baseConfig.capabilities,
          "tts.synthesize": { mode: "fixed", provider_model_id: "tts.openai.gpt-tts" },
        },
      },
      providerModelCatalog: catalogWithOpenaiTts,
      voiceProfiles: [buildVoiceProfile("dashscope")],
    });
    const resolved = resolveGenerationConfiguration(input);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.error.code).toBe("generation_creative_voice_provider_incompatible");
    expect(resolved.error.capability).toBe("tts.synthesize");
  });
});
