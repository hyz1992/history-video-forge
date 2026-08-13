import { describe, expect, it } from "vitest";

import {
  ApiVideoQuality,
  ApiVideoSuitability,
  CapabilitySlot,
  DEFAULT_GENERATION_CONFIGURATION,
  GenerationConfigurationV1,
  ResolvedVisualRoute,
  RunConfigurationSnapshotV1,
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
      configuration_hash: "fnv1a64:abc123",
      pricing_hash: "fnv1a64:pricing-v1",
    };

    const validSnapshot = {
      schema_version: "run_configuration_snapshot_v1",
      project_id: "proj_001",
      user_id: "user_001",
      stage: "assets",
      operation: "assets.generate",
      run_id: "run_001",
      source_revisions: validResolved.source_revisions,
      resolved: validResolved,
      configuration_hash: "fnv1a64:abc123",
      quote_id: null,
      estimated_cost_micros: "12345",
      authorization_cost_micros: "14000",
      budget_limit_micros: null,
      budget_override_authorized: false,
      pricing_version_set: ["dashscope-cn-2026-08-12"],
      pricing_hash: "fnv1a64:pricing-v1",
      created_at: "2026-08-13T00:00:00.000Z",
    };

    it("accepts a complete snapshot with run identity, costs, budget authorization and pricing", () => {
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
