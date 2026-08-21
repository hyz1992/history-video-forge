import { describe, expect, it } from "vitest";

import {
  ApiVideoQuality,
  ApiVideoSuitability,
  CapabilitySlot,
  CreativePreferences,
  CreativeRunOverrideSchema,
  DEFAULT_GENERATION_CONFIGURATION,
  GenerationConfigurationV1,
  ResolvedVisualRoute,
  RunConfigurationSnapshotV1,
  S2_2B_ConfigPatchRequest,
  S2_2B_ProjectConfigPatchRequest,
  VideoGenerationStrategy,
} from "../../shared/src/index.js";

describe("GenerationConfigurationV1 schema", () => {
  describe("video strategy enum", () => {
    it.each(["all_api_video", "prefer_api_video", "prefer_remotion", "all_remotion"] as const)(
      "accepts strategy %s",
      (strategy) => {
        const parsed = GenerationConfigurationV1.parse({
          ...DEFAULT_GENERATION_CONFIGURATION,
          video: { ...DEFAULT_GENERATION_CONFIGURATION.video, strategy },
        });
        expect(parsed.video.strategy).toBe(strategy);
      },
    );

    it.each([
      "api_video",
      "remotion",
      "prefer_api",
      "all_api",
      "",
      "ALL_API_VIDEO",
      "prefer_remotion_motion",
    ])("rejects invalid strategy %s", (strategy) => {
      expect(() =>
        GenerationConfigurationV1.parse({
          ...DEFAULT_GENERATION_CONFIGURATION,
          video: { ...DEFAULT_GENERATION_CONFIGURATION.video, strategy },
        }),
      ).toThrow();
    });
  });

  describe("api quality enum", () => {
    it.each(["standard_720p", "high_1080p"] as const)("accepts quality %s", (api_quality) => {
      const parsed = GenerationConfigurationV1.parse({
        ...DEFAULT_GENERATION_CONFIGURATION,
        video: { ...DEFAULT_GENERATION_CONFIGURATION.video, api_quality },
      });
      expect(parsed.video.api_quality).toBe(api_quality);
    });

    it.each(["720p", "1080p", "standard", "high", "4k", "", "STANDARD_720P"])(
      "rejects invalid api_quality %s",
      (api_quality) => {
        expect(() =>
          GenerationConfigurationV1.parse({
            ...DEFAULT_GENERATION_CONFIGURATION,
            video: { ...DEFAULT_GENERATION_CONFIGURATION.video, api_quality },
          }),
        ).toThrow();
      },
    );
  });

  describe("capability slots are fixed to the five approved slots", () => {
    it("keeps exactly the five capability slots and no others", () => {
      const parsed = GenerationConfigurationV1.parse(DEFAULT_GENERATION_CONFIGURATION);
      expect(Object.keys(parsed.capabilities).sort()).toEqual(
        [
          "image.generate",
          "llm.flash",
          "llm.smart",
          "tts.synthesize",
          "video.image_to_video",
        ].sort(),
      );
    });

    it("rejects configuration missing any of the five capability slots", () => {
      const slots: CapabilitySlot[] = [
        "llm.smart",
        "llm.flash",
        "image.generate",
        "video.image_to_video",
        "tts.synthesize",
      ];
      for (const slot of slots) {
        const capabilities = { ...DEFAULT_GENERATION_CONFIGURATION.capabilities };
        // @ts-expect-error intentionally removing a required slot
        delete capabilities[slot];
        expect(() =>
          GenerationConfigurationV1.parse({
            ...DEFAULT_GENERATION_CONFIGURATION,
            capabilities,
          }),
        ).toThrow();
      }
    });

    it("rejects an unknown capability slot", () => {
      expect(() =>
        GenerationConfigurationV1.parse({
          ...DEFAULT_GENERATION_CONFIGURATION,
          capabilities: {
            ...DEFAULT_GENERATION_CONFIGURATION.capabilities,
            "image.upscale": { mode: "auto" },
          },
        }),
      ).toThrow();
    });

    it("S2-2A default keeps every capability slot in auto mode", () => {
      const parsed = GenerationConfigurationV1.parse(DEFAULT_GENERATION_CONFIGURATION);
      for (const slot of Object.keys(parsed.capabilities) as CapabilitySlot[]) {
        expect(parsed.capabilities[slot]).toEqual({ mode: "auto" });
      }
    });

    it("S2-2C forward-compat: schema accepts fixed provider_model_id selection", () => {
      const parsed = GenerationConfigurationV1.parse({
        ...DEFAULT_GENERATION_CONFIGURATION,
        capabilities: {
          ...DEFAULT_GENERATION_CONFIGURATION.capabilities,
          "llm.smart": { mode: "fixed", provider_model_id: "dashscope.qwen-max-v2" },
        },
      });
      expect(parsed.capabilities["llm.smart"]).toEqual({
        mode: "fixed",
        provider_model_id: "dashscope.qwen-max-v2",
      });
    });

    it("rejects fixed selection without provider_model_id", () => {
      expect(() =>
        GenerationConfigurationV1.parse({
          ...DEFAULT_GENERATION_CONFIGURATION,
          capabilities: {
            ...DEFAULT_GENERATION_CONFIGURATION.capabilities,
            "llm.smart": { mode: "fixed" },
          },
        }),
      ).toThrow();
    });

    it("rejects empty provider_model_id for fixed selection", () => {
      expect(() =>
        GenerationConfigurationV1.parse({
          ...DEFAULT_GENERATION_CONFIGURATION,
          capabilities: {
            ...DEFAULT_GENERATION_CONFIGURATION.capabilities,
            "llm.smart": { mode: "fixed", provider_model_id: "" },
          },
        }),
      ).toThrow();
    });

    it("rejects an unknown capability mode", () => {
      expect(() =>
        GenerationConfigurationV1.parse({
          ...DEFAULT_GENERATION_CONFIGURATION,
          capabilities: {
            ...DEFAULT_GENERATION_CONFIGURATION.capabilities,
            "llm.smart": { mode: "smartest" },
          },
        }),
      ).toThrow();
    });
  });

  describe("budget currency and cost micros", () => {
    it("currency is fixed to CNY", () => {
      const parsed = GenerationConfigurationV1.parse(DEFAULT_GENERATION_CONFIGURATION);
      expect(parsed.budget.currency).toBe("CNY");
    });

    it("rejects any currency other than CNY", () => {
      for (const currency of ["USD", "EUR", "cny", "", "RMB"]) {
        expect(() =>
          GenerationConfigurationV1.parse({
            ...DEFAULT_GENERATION_CONFIGURATION,
            budget: { ...DEFAULT_GENERATION_CONFIGURATION.budget, currency },
          }),
        ).toThrow();
      }
    });

    it("max_paid_cost_micros_per_run accepts null (no cap)", () => {
      const parsed = GenerationConfigurationV1.parse(DEFAULT_GENERATION_CONFIGURATION);
      expect(parsed.budget.max_paid_cost_micros_per_run).toBeNull();
    });

    it("max_paid_cost_micros_per_run accepts a decimal string micro amount", () => {
      const parsed = GenerationConfigurationV1.parse({
        ...DEFAULT_GENERATION_CONFIGURATION,
        budget: { ...DEFAULT_GENERATION_CONFIGURATION.budget, max_paid_cost_micros_per_run: "1234567" },
      });
      expect(parsed.budget.max_paid_cost_micros_per_run).toBe("1234567");
    });

    it("max_paid_cost_micros_per_run is a decimal string, not a number", () => {
      // JSON API boundary serializes money as decimal strings to avoid number overflow.
      expect(() =>
        GenerationConfigurationV1.parse({
          ...DEFAULT_GENERATION_CONFIGURATION,
          budget: {
            ...DEFAULT_GENERATION_CONFIGURATION.budget,
            max_paid_cost_micros_per_run: 1234567,
          },
        }),
      ).toThrow();
    });

    it("max_paid_cost_micros_per_run rejects non-decimal string content", () => {
      for (const value of ["1.5", "abc", "0x10", "1e3", "-1", "12 34"]) {
        expect(() =>
          GenerationConfigurationV1.parse({
            ...DEFAULT_GENERATION_CONFIGURATION,
            budget: { ...DEFAULT_GENERATION_CONFIGURATION.budget, max_paid_cost_micros_per_run: value },
          }),
        ).toThrow();
      }
    });
  });

  describe("creative preferences are preserved but null in S2-2A", () => {
    it("keeps voice_profile_id, art_style_preset_id and subtitle_style_preset_id fields", () => {
      const parsed = GenerationConfigurationV1.parse(DEFAULT_GENERATION_CONFIGURATION);
      expect(parsed.creative).toEqual({
        voice_profile_id: null,
        art_style_preset_id: null,
        subtitle_style_preset_id: null,
        subtitle_style_overrides: {},
      });
    });

    it("rejects configuration missing any creative field", () => {
      // removing any of the three creative fields must fail (they are required even when null)
      expect(() =>
        GenerationConfigurationV1.parse({
          ...DEFAULT_GENERATION_CONFIGURATION,
          creative: {
            art_style_preset_id: null,
            subtitle_style_preset_id: null,
          },
        }),
      ).toThrow();
    });

    it("S2-2B forward-compat: schema accepts string preset ids", () => {
      const parsed = GenerationConfigurationV1.parse({
        ...DEFAULT_GENERATION_CONFIGURATION,
        creative: {
          voice_profile_id: "voice_cold_authority",
          art_style_preset_id: "art_ink_wash",
          subtitle_style_preset_id: "subtitle_minimal",
        },
      });
      expect(parsed.creative.voice_profile_id).toBe("voice_cold_authority");
    });
  });

  describe("default configuration matches the design 3.2 baseline", () => {
    it("matches prefer_remotion + standard_720p + no cap + creative all null + capabilities all auto", () => {
      expect(DEFAULT_GENERATION_CONFIGURATION).toEqual({
        schema_version: "generation_configuration_v1",
        video: {
          strategy: "prefer_remotion",
          api_quality: "standard_720p",
        },
        budget: {
          currency: "CNY",
          max_paid_cost_micros_per_run: null,
        },
        creative: {
          voice_profile_id: null,
          art_style_preset_id: null,
          subtitle_style_preset_id: null,
          subtitle_style_overrides: {},
        },
        capabilities: {
          "llm.smart": { mode: "auto" },
          "llm.flash": { mode: "auto" },
          "image.generate": { mode: "auto" },
          "video.image_to_video": { mode: "auto" },
          "tts.synthesize": { mode: "auto" },
        },
      });
    });

    it("the default is itself a valid GenerationConfigurationV1", () => {
      expect(() => GenerationConfigurationV1.parse(DEFAULT_GENERATION_CONFIGURATION)).not.toThrow();
    });

    it("schema_version is the fixed literal generation_configuration_v1", () => {
      const parsed = GenerationConfigurationV1.parse(DEFAULT_GENERATION_CONFIGURATION);
      expect(parsed.schema_version).toBe("generation_configuration_v1");
      expect(() =>
        GenerationConfigurationV1.parse({
          ...DEFAULT_GENERATION_CONFIGURATION,
          schema_version: "generation_configuration_v2",
        }),
      ).toThrow();
    });
  });

  describe("strict schema rejects unknown fields", () => {
    it("rejects an unknown top-level field", () => {
      expect(() =>
        GenerationConfigurationV1.parse({
          ...DEFAULT_GENERATION_CONFIGURATION,
          random_extra: true,
        }),
      ).toThrow();
    });

    it("rejects an unknown video sub-field", () => {
      expect(() =>
        GenerationConfigurationV1.parse({
          ...DEFAULT_GENERATION_CONFIGURATION,
          video: { ...DEFAULT_GENERATION_CONFIGURATION.video, extra_quality: "4k" },
        }),
      ).toThrow();
    });

    it("rejects an unknown budget sub-field", () => {
      expect(() =>
        GenerationConfigurationV1.parse({
          ...DEFAULT_GENERATION_CONFIGURATION,
          budget: { ...DEFAULT_GENERATION_CONFIGURATION.budget, hard_cap: "100" },
        }),
      ).toThrow();
    });
  });

  describe("auxiliary enums are exported for downstream reuse", () => {
    it("VideoGenerationStrategy parses the four approved strategies", () => {
      for (const strategy of [
        "all_api_video",
        "prefer_api_video",
        "prefer_remotion",
        "all_remotion",
      ] as const) {
        expect(VideoGenerationStrategy.parse(strategy)).toBe(strategy);
      }
      expect(() => VideoGenerationStrategy.parse("unknown")).toThrow();
    });

    it("ApiVideoSuitability parses the four approved suitability levels", () => {
      for (const suitability of [
        "remotion_only",
        "remotion_sufficient",
        "api_video_beneficial",
        "api_video_strongly_recommended",
      ] as const) {
        expect(ApiVideoSuitability.parse(suitability)).toBe(suitability);
      }
      expect(() => ApiVideoSuitability.parse("api_video")).toThrow();
    });

    it("ResolvedVisualRoute parses api and remotion routes", () => {
      expect(ResolvedVisualRoute.parse("api_video")).toBe("api_video");
      expect(ResolvedVisualRoute.parse("remotion")).toBe("remotion");
      expect(() => ResolvedVisualRoute.parse("3d")).toThrow();
    });
  });

  describe("RunConfigurationSnapshotV1 is a strongly-typed immutable snapshot", () => {
    // 一个完整、有效的 resolved 配置（五个 capability slot 全部已解析），作为 snapshot
    // 内嵌 resolved 字段的基础。强类型化后 snapshot 不再接受 garbage。
    const validResolvedCapability = {
      mode: "auto" as const,
      provider_model_id: "dashscope.qwen-max",
      provider_key: "dashscope",
      model_id: "qwen-max",
    };
    // 漂移检测 hash 必须符合 fnv1a64:<16-hex> 格式（DriftHashSchema 强制）。
    const CONFIG_HASH = "fnv1a64:111111111111abc1";
    const CATALOG_HASH = "fnv1a64:222222222222def2";
    const validResolved = {
      schema_version: "resolved_generation_configuration_v1",
      source_revisions: {
        source_user_preference_revision: null,
        project_configuration_revision: 3,
      },
      effective: DEFAULT_GENERATION_CONFIGURATION,
      resolved_capabilities: {
        "llm.smart": validResolvedCapability,
        "llm.flash": { ...validResolvedCapability, provider_model_id: "dashscope.qwen-flash", model_id: "qwen-flash" },
        "image.generate": { ...validResolvedCapability, provider_model_id: "dashscope.wanx", model_id: "wanx-v1" },
        "video.image_to_video": { ...validResolvedCapability, provider_model_id: "dashscope.video", model_id: "video-v1" },
        "tts.synthesize": { ...validResolvedCapability, provider_model_id: "dashscope.tts", model_id: "qwen3-tts" },
      },
      segment_visual_routes: [],
      constraints_applied: [],
      resolution_trace: [
        { layer: "project_configuration", note: "used frozen project config" },
      ],
      configuration_hash: CONFIG_HASH,
      catalog_hash: CATALOG_HASH,
    };

    const QUOTE_FINGERPRINT = "sha256:" + "b".repeat(64);
    const PRICING_HASH = "sha256:" + "a".repeat(64);
    // 基线 validSnapshot 是一个完整的付费运行（quote_id 非空 + 全部绑定证据齐全）。
    const validSnapshot = {
      schema_version: "run_configuration_snapshot_v1",
      project_id: "proj_001",
      user_id: "user_001",
      stage: "assets",
      operation: "assets.generate",
      run_id: "run_001",
      source_revisions: validResolved.source_revisions,
      resolved: validResolved,
      // 顶层 hash 必须与 resolved 内部一致（superRefine 校验）
      configuration_hash: CONFIG_HASH,
      catalog_hash: CATALOG_HASH,
      quote_id: "quote_001",
      // 加密级 quote 指纹（quote 创建时计算持久化，提交时重算比对）
      quote_fingerprint: QUOTE_FINGERPRINT,
      estimated_cost_micros: "12345",
      authorization_cost_micros: "14000",
      budget_limit_micros: null,
      budget_override_authorized: false,
      pricing_version_set: ["dashscope-cn-2026-08-12"],
      // 定价 hash（任务 7 PricingService 产出，SHA-256 格式）
      pricing_hash: PRICING_HASH,
      created_at: "2026-08-13T00:00:00.000Z",
    };

    it("accepts a complete quoted snapshot with full binding evidence", () => {
      const snapshot = RunConfigurationSnapshotV1.parse(validSnapshot);
      expect(snapshot.schema_version).toBe("run_configuration_snapshot_v1");
      expect(snapshot.project_id).toBe("proj_001");
      expect(snapshot.operation).toBe("assets.generate");
      expect(snapshot.source_revisions.project_configuration_revision).toBe(3);
      expect(snapshot.resolved.effective.video.strategy).toBe("prefer_remotion");
      expect(snapshot.resolved.resolved_capabilities["llm.smart"].provider_model_id).toBe(
        "dashscope.qwen-max",
      );
      expect(snapshot.budget_override_authorized).toBe(false);
      expect(snapshot.pricing_version_set).toEqual(["dashscope-cn-2026-08-12"]);
    });

    it("accepts a free-run snapshot with no quote binding evidence", () => {
      const snapshot = RunConfigurationSnapshotV1.parse({
        ...validSnapshot,
        quote_id: null,
        quote_fingerprint: null,
        pricing_hash: null,
        pricing_version_set: [],
        // 免费运行的费用字段可为 null（无报价）
        estimated_cost_micros: null,
        authorization_cost_micros: null,
      });
      expect(snapshot.quote_id).toBeNull();
      expect(snapshot.quote_fingerprint).toBeNull();
      expect(snapshot.pricing_hash).toBeNull();
      expect(snapshot.pricing_version_set).toEqual([]);
    });

    // P1-3 核心断言：付费运行（quote_id 非空）必须携带完整绑定证据。
    it("rejects a quoted run missing quote_fingerprint", () => {
      expect(() =>
        RunConfigurationSnapshotV1.parse({
          ...validSnapshot,
          quote_fingerprint: null,
        }),
      ).toThrow();
    });

    it("rejects a quoted run missing pricing_hash", () => {
      expect(() =>
        RunConfigurationSnapshotV1.parse({
          ...validSnapshot,
          pricing_hash: null,
        }),
      ).toThrow();
    });

    it("rejects a quoted run with empty pricing_version_set", () => {
      expect(() =>
        RunConfigurationSnapshotV1.parse({
          ...validSnapshot,
          pricing_version_set: [],
        }),
      ).toThrow();
    });

    it("rejects a quoted run missing estimated_cost_micros", () => {
      expect(() =>
        RunConfigurationSnapshotV1.parse({
          ...validSnapshot,
          estimated_cost_micros: null,
        }),
      ).toThrow();
    });

    it("rejects a quoted run missing authorization_cost_micros", () => {
      expect(() =>
        RunConfigurationSnapshotV1.parse({
          ...validSnapshot,
          authorization_cost_micros: null,
        }),
      ).toThrow();
    });

    it("rejects a free run that carries residual pricing evidence", () => {
      // 免费 run（quote_id=null）不得残留 pricing_hash
      expect(() =>
        RunConfigurationSnapshotV1.parse({
          ...validSnapshot,
          quote_id: null,
          // quote_fingerprint/pricing_hash/pricing_version_set 仍保留 → 矛盾
        }),
      ).toThrow();
    });

    // P1-2 核心断言：免 quote 快照不得表达正费用或预算超额授权。
    it("rejects a free run with positive estimated_cost_micros", () => {
      expect(() =>
        RunConfigurationSnapshotV1.parse({
          ...validSnapshot,
          quote_id: null,
          quote_fingerprint: null,
          pricing_hash: null,
          pricing_version_set: [],
          estimated_cost_micros: "1000000",
          authorization_cost_micros: null,
          budget_override_authorized: false,
        }),
      ).toThrow();
    });

    it("rejects a free run with positive authorization_cost_micros", () => {
      expect(() =>
        RunConfigurationSnapshotV1.parse({
          ...validSnapshot,
          quote_id: null,
          quote_fingerprint: null,
          pricing_hash: null,
          pricing_version_set: [],
          estimated_cost_micros: null,
          authorization_cost_micros: "1000000",
          budget_override_authorized: false,
        }),
      ).toThrow();
    });

    it("rejects a free run with budget_override_authorized=true", () => {
      expect(() =>
        RunConfigurationSnapshotV1.parse({
          ...validSnapshot,
          quote_id: null,
          quote_fingerprint: null,
          pricing_hash: null,
          pricing_version_set: [],
          estimated_cost_micros: null,
          authorization_cost_micros: null,
          budget_override_authorized: true,
        }),
      ).toThrow();
    });

    it("accepts a free run with zero cost and no override", () => {
      // 免 quote 运行允许 null 或 "0" 费用，budget_override_authorized=false
      expect(() =>
        RunConfigurationSnapshotV1.parse({
          ...validSnapshot,
          quote_id: null,
          quote_fingerprint: null,
          pricing_hash: null,
          pricing_version_set: [],
          estimated_cost_micros: "0",
          authorization_cost_micros: "0",
          budget_override_authorized: false,
        }),
      ).not.toThrow();
    });

    it("rejects snapshot missing run identity fields (project_id/operation)", () => {
      expect(() =>
        RunConfigurationSnapshotV1.parse({
          ...validSnapshot,
          project_id: undefined,
        }),
      ).toThrow();
      expect(() =>
        RunConfigurationSnapshotV1.parse({
          ...validSnapshot,
          operation: undefined,
        }),
      ).toThrow();
    });

    it("rejects snapshot missing cost/budget/pricing fields", () => {
      expect(() =>
        RunConfigurationSnapshotV1.parse({
          ...validSnapshot,
          estimated_cost_micros: undefined,
        }),
      ).toThrow();
      expect(() =>
        RunConfigurationSnapshotV1.parse({
          ...validSnapshot,
          budget_override_authorized: undefined,
        }),
      ).toThrow();
      expect(() =>
        RunConfigurationSnapshotV1.parse({
          ...validSnapshot,
          pricing_version_set: undefined,
        }),
      ).toThrow();
    });

    it("rejects non-decimal-string cost micros", () => {
      expect(() =>
        RunConfigurationSnapshotV1.parse({
          ...validSnapshot,
          estimated_cost_micros: 12345,
        }),
      ).toThrow();
      expect(() =>
        RunConfigurationSnapshotV1.parse({
          ...validSnapshot,
          estimated_cost_micros: "1.5",
        }),
      ).toThrow();
    });

    it("rejects drift hashes without the fnv1a64:<16-hex> format", () => {
      expect(() =>
        RunConfigurationSnapshotV1.parse({
          ...validSnapshot,
          resolved: { ...validResolved, configuration_hash: "different" },
          configuration_hash: "different",
        }),
      ).toThrow();
      expect(() =>
        RunConfigurationSnapshotV1.parse({
          ...validSnapshot,
          resolved: { ...validResolved, catalog_hash: "not-a-hash" },
          catalog_hash: "not-a-hash",
        }),
      ).toThrow();
    });

    it("rejects non-SHA-256 pricing_hash and quote_fingerprint values", () => {
      expect(() =>
        RunConfigurationSnapshotV1.parse({
          ...validSnapshot,
          pricing_hash: "fnv1a64:short",
        }),
      ).toThrow();
      expect(() =>
        RunConfigurationSnapshotV1.parse({
          ...validSnapshot,
          quote_fingerprint: "not-a-fingerprint",
        }),
      ).toThrow();
    });

    it("rejects non-ISO created_at", () => {
      expect(() =>
        RunConfigurationSnapshotV1.parse({
          ...validSnapshot,
          created_at: "not-a-date",
        }),
      ).toThrow();
    });

    // P1-3 核心断言：顶层与 resolved 内部字段必须一致（superRefine）。
    it("rejects when top-level configuration_hash differs from resolved.configuration_hash", () => {
      const mismatched = "fnv1a64:999999999999fff9";
      expect(() =>
        RunConfigurationSnapshotV1.parse({
          ...validSnapshot,
          configuration_hash: mismatched, // 顶层与 resolved.configuration_hash 不一致
        }),
      ).toThrow();
    });

    it("rejects when top-level catalog_hash differs from resolved.catalog_hash", () => {
      const mismatched = "fnv1a64:999999999999fff9";
      expect(() =>
        RunConfigurationSnapshotV1.parse({
          ...validSnapshot,
          catalog_hash: mismatched,
        }),
      ).toThrow();
    });

    it("rejects when top-level source_revisions differs from resolved.source_revisions", () => {
      expect(() =>
        RunConfigurationSnapshotV1.parse({
          ...validSnapshot,
          source_revisions: {
            source_user_preference_revision: null,
            project_configuration_revision: 99, // 与 resolved 内部的 3 不一致
          },
        }),
      ).toThrow();
    });

    it("rejects garbage resolved_capabilities (number instead of resolved model)", () => {
      expect(() =>
        RunConfigurationSnapshotV1.parse({
          ...validSnapshot,
          resolved: {
            ...validResolved,
            resolved_capabilities: {
              ...validResolved.resolved_capabilities,
              "llm.smart": 123,
            },
          },
        }),
      ).toThrow();
    });

    it("rejects garbage segment_visual_routes (string instead of route object)", () => {
      expect(() =>
        RunConfigurationSnapshotV1.parse({
          ...validSnapshot,
          resolved: {
            ...validResolved,
            segment_visual_routes: ["garbage"],
          },
        }),
      ).toThrow();
    });

    it("rejects resolved_capabilities missing any of the five slots", () => {
      const incomplete = { ...validResolved.resolved_capabilities };
      // @ts-expect-error intentionally removing a required slot
      delete incomplete["llm.smart"];
      expect(() =>
        RunConfigurationSnapshotV1.parse({
          ...validSnapshot,
          resolved: {
            ...validResolved,
            resolved_capabilities: incomplete,
          },
        }),
      ).toThrow();
    });

    it("rejects an unknown top-level field (snapshot stays strict)", () => {
      expect(() =>
        RunConfigurationSnapshotV1.parse({
          ...validSnapshot,
          unexpected_field: true,
        }),
      ).toThrow();
    });
  });
});

describe("S2-2B creative 配置扩展", () => {
  describe("CreativePreferences", () => {
    it("接受全 null 默认值（A 期形态）", () => {
      const parsed = CreativePreferences.parse({
        voice_profile_id: null,
        art_style_preset_id: null,
        subtitle_style_preset_id: null,
      });
      expect(parsed.subtitle_style_overrides).toEqual({});
    });

    it("接受非空预设 id 与覆盖集合", () => {
      const parsed = CreativePreferences.parse({
        voice_profile_id: "voice_preset_cold_authority",
        art_style_preset_id: "art_style_classical_ink",
        subtitle_style_preset_id: "subtitle_style_bold_stroke",
        subtitle_style_overrides: { font_size_px: 52, position: "top" },
      });
      expect(parsed.subtitle_style_overrides.font_size_px).toBe(52);
    });

    it("旧 JSON（无 subtitle_style_overrides 字段）解析成功并缺省为空对象", () => {
      const legacy = {
        voice_profile_id: null,
        art_style_preset_id: null,
        subtitle_style_preset_id: null,
      };
      const parsed = CreativePreferences.parse(legacy);
      expect(parsed.subtitle_style_overrides).toEqual({});
    });

    it("拒绝白名单外覆盖字段", () => {
      expect(() =>
        CreativePreferences.parse({
          voice_profile_id: null,
          art_style_preset_id: null,
          subtitle_style_preset_id: null,
          subtitle_style_overrides: { font_family: "Arial" },
        }),
      ).toThrow();
    });

    it("拒绝未知字段（strict）", () => {
      expect(() =>
        CreativePreferences.parse({
          voice_profile_id: null,
          art_style_preset_id: null,
          subtitle_style_preset_id: null,
          extra: true,
        }),
      ).toThrow();
    });
  });

  describe("CreativeRunOverrideSchema（单次运行覆盖）", () => {
    it("接受仅覆盖音色的部分覆盖", () => {
      const parsed = CreativeRunOverrideSchema.parse({
        voice_profile_id: "voice_preset_crisp_storyteller",
      });
      expect(parsed.voice_profile_id).toBe("voice_preset_crisp_storyteller");
      expect(parsed.art_style_preset_id).toBeUndefined();
    });

    it("接受显式 null（重置为 auto/none）", () => {
      const parsed = CreativeRunOverrideSchema.parse({
        voice_profile_id: null,
        art_style_preset_id: null,
        subtitle_style_preset_id: null,
      });
      expect(parsed.voice_profile_id).toBeNull();
    });

    it("接受覆盖集合但不允许白名单外字段", () => {
      expect(
        CreativeRunOverrideSchema.safeParse({
          subtitle_style_overrides: { max_lines: 3 },
        }).success,
      ).toBe(true);
      expect(
        CreativeRunOverrideSchema.safeParse({
          subtitle_style_overrides: { font_family: "Arial" },
        }).success,
      ).toBe(false);
    });

    it("拒绝未知字段（strict）", () => {
      expect(CreativeRunOverrideSchema.safeParse({ voice: "x" }).success).toBe(false);
    });
  });

  describe("S2_2B PATCH schema（两阶段替换：本任务新增 B 版）", () => {
    it("用户 PATCH：video+budget+creative 全量可用", () => {
      const parsed = S2_2B_ConfigPatchRequest.parse({
        expected_revision: 3,
        video: { strategy: "prefer_api_video", api_quality: "high_1080p" },
        budget: { currency: "CNY", max_paid_cost_micros_per_run: "1000000" },
        creative: {
          voice_profile_id: "voice_preset_steady_documentary",
          art_style_preset_id: null,
          subtitle_style_preset_id: null,
        },
      });
      expect(parsed.creative?.voice_profile_id).toBe("voice_preset_steady_documentary");
    });

    it("用户 PATCH：不携带 creative 段（A 期请求体兼容）", () => {
      const parsed = S2_2B_ConfigPatchRequest.parse({
        expected_revision: 3,
        video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
        budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
      });
      expect(parsed.creative).toBeUndefined();
    });

    it("项目 PATCH：expected_revision 必须为非负整数", () => {
      expect(
        S2_2B_ProjectConfigPatchRequest.safeParse({
          expected_revision: null,
          video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
          budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
        }).success,
      ).toBe(false);
      expect(
        S2_2B_ProjectConfigPatchRequest.safeParse({
          expected_revision: 1,
          video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
          budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
          creative: { voice_profile_id: null, art_style_preset_id: null, subtitle_style_preset_id: null },
        }).success,
      ).toBe(true);
    });

    it("capabilities 等 A 期外字段仍被拒绝", () => {
      expect(
        S2_2B_ConfigPatchRequest.safeParse({
          expected_revision: 1,
          video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
          budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
          capabilities: { "llm.smart": { mode: "fixed", provider_model_id: "x" } },
        }).success,
      ).toBe(false);
    });
  });

  describe("DEFAULT_GENERATION_CONFIGURATION 扩展", () => {
    it("默认配置的 creative 包含空覆盖集合且整体可解析", () => {
      const parsed = GenerationConfigurationV1.parse(
        DEFAULT_GENERATION_CONFIGURATION,
      );
      expect(parsed.creative.subtitle_style_overrides).toEqual({});
      expect(parsed.creative.voice_profile_id).toBeNull();
    });
  });
});
