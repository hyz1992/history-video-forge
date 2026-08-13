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
 */
const fullActiveCatalog: ProviderModelCatalogEntry[] = [
  {
    provider_model_id: "dashscope.qwen-max",
    capability: "llm.smart",
    provider_key: "dashscope",
    model_id: "qwen-max",
    status: "active",
  },
  {
    provider_model_id: "dashscope.qwen-flash",
    capability: "llm.flash",
    provider_key: "dashscope",
    model_id: "qwen-flash",
    status: "active",
  },
  {
    provider_model_id: "dashscope.wanx",
    capability: "image.generate",
    provider_key: "dashscope",
    model_id: "wanx-v1",
    status: "active",
  },
  {
    provider_model_id: "dashscope.video",
    capability: "video.image_to_video",
    provider_key: "dashscope",
    model_id: "video-v1",
    status: "active",
  },
  {
    provider_model_id: "dashscope.tts",
    capability: "tts.synthesize",
    provider_key: "dashscope",
    model_id: "qwen3-tts",
    status: "active",
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
    },
    {
      provider_model_id: "dashscope.qwen-flash",
      capability: "llm.flash",
      provider_key: "dashscope",
      model_id: "qwen-flash",
      status: "active",
    },
    {
      provider_model_id: "dashscope.wanx",
      capability: "image.generate",
      provider_key: "dashscope",
      model_id: "wanx-v1",
      status: "active",
    },
    {
      provider_model_id: "dashscope.video",
      capability: "video.image_to_video",
      provider_key: "dashscope",
      model_id: "video-v1",
      status: "active",
    },
    {
      provider_model_id: "dashscope.tts",
      capability: "tts.synthesize",
      provider_key: "dashscope",
      model_id: "qwen3-tts",
      status: "active",
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
  it("produces a stable pricing_hash from the catalog", () => {
    const a = resolveGenerationConfiguration(
      buildInput({ providerModelCatalog: fullActiveCatalog }),
    );
    const b = resolveGenerationConfiguration(
      buildInput({ providerModelCatalog: fullActiveCatalog }),
    );
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.pricing_hash).toBe(b.value.pricing_hash);
    }
  });

  it("different catalog produces a different pricing_hash", () => {
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
      expect(a.value.pricing_hash).not.toBe(b.value.pricing_hash);
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
