import { describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { buildTestAuth } from "../auth/test-utils.js";
import { DEFAULT_GENERATION_CONFIGURATION } from "../../../shared/src/index.js";
import type { AuthenticatedAuthContext } from "../../../backend/src/auth/auth-context.js";

/**
 * S2-2A 任务 3 整改：API 测试。
 * P1-3：PATCH 只允许 { expected_revision, video, budget }（strict schema）。
 * P1-1：repository async。
 */
describe("generation-config API", () => {
  const auth = buildTestAuth({ userId: "user-a" });
  const otherAuth = buildTestAuth({ userId: "user-b" });

  async function createProjectForUser(
    app: ReturnType<typeof buildApp>,
    a: AuthenticatedAuthContext,
    name = "Test Project",
  ): Promise<string> {
    const res = await app.inject({ method: "POST", url: "/api/projects", payload: { name }, auth: a });
    return res.json().project_id as string;
  }

  describe("GET/PATCH /api/me/generation-preferences", () => {
    it("GET returns backfilled default when no preference exists", async () => {
      const app = buildApp();
      const res = await app.inject({ method: "GET", url: "/api/me/generation-preferences", auth });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.source).toBe("backfilled_default");
      expect(body.configuration).toEqual(DEFAULT_GENERATION_CONFIGURATION);
      expect(body.revision).toBe(1);
      expect(body.updated_at).toBeDefined();
    });

    it("PATCH updates user preference with correct expected_revision", async () => {
      const app = buildApp();
      await app.inject({ method: "GET", url: "/api/me/generation-preferences", auth });
      const res = await app.inject({
        method: "PATCH",
        url: "/api/me/generation-preferences",
        payload: {
          expected_revision: 1,
          video: { strategy: "all_api_video", api_quality: "high_1080p" },
          budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
        },
        auth,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.revision).toBe(2);
      expect(body.configuration.video.strategy).toBe("all_api_video");
      expect(body.updated_at).toBeDefined();
    });

    it("PATCH with stale revision returns 409 generation_preference_revision_conflict", async () => {
      const app = buildApp();
      await app.inject({ method: "GET", url: "/api/me/generation-preferences", auth });
      const res = await app.inject({
        method: "PATCH",
        url: "/api/me/generation-preferences",
        payload: {
          expected_revision: 99,
          video: { strategy: "all_api_video", api_quality: "standard_720p" },
          budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
        },
        auth,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("generation_preference_revision_conflict");
    });

    it("PATCH rejects creative fields (S2-2A scope)", async () => {
      const app = buildApp();
      await app.inject({ method: "GET", url: "/api/me/generation-preferences", auth });
      const res = await app.inject({
        method: "PATCH",
        url: "/api/me/generation-preferences",
        payload: {
          expected_revision: 1,
          video: { strategy: "all_api_video", api_quality: "standard_720p" },
          budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
          creative: { voice_profile_id: "voice-1" },  // 越权字段
        },
        auth,
      });
      expect(res.statusCode).toBe(400);
    });

    it("GET/PATCH only accesses current user", async () => {
      const app = buildApp();
      await app.inject({
        method: "PATCH",
        url: "/api/me/generation-preferences",
        payload: {
          expected_revision: null,
          video: { strategy: "prefer_api_video", api_quality: "standard_720p" },
          budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
        },
        auth,
      });
      const res = await app.inject({ method: "GET", url: "/api/me/generation-preferences", auth: otherAuth });
      expect(res.statusCode).toBe(200);
      expect(res.json().source).toBe("backfilled_default");
      expect(res.json().configuration.video.strategy).toBe("prefer_remotion");
    });
  });

  describe("GET/PATCH /api/projects/:projectId/generation-configuration", () => {
    it("GET returns configuration for owned project", async () => {
      const app = buildApp();
      const projectId = await createProjectForUser(app, auth);
      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/generation-configuration`,
        auth,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.configuration).toEqual(DEFAULT_GENERATION_CONFIGURATION);
      expect(body.updated_at).toBeDefined();
    });

    it("GET returns 404 for non-owned project", async () => {
      const app = buildApp();
      const projectId = await createProjectForUser(app, auth);
      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/generation-configuration`,
        auth: otherAuth,
      });
      expect(res.statusCode).toBe(404);
    });

    it("PATCH updates project configuration with invalidation preview", async () => {
      const app = buildApp();
      const projectId = await createProjectForUser(app, auth);
      await app.inject({ method: "GET", url: `/api/projects/${projectId}/generation-configuration`, auth });
      const res = await app.inject({
        method: "PATCH",
        url: `/api/projects/${projectId}/generation-configuration`,
        payload: {
          expected_revision: 1,
          video: { strategy: "all_remotion", api_quality: "standard_720p" },
          budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
        },
        auth,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.revision).toBe(2);
      expect(body.invalidation_preview).toBeDefined();
      expect(body.updated_at).toBeDefined();
    });

    it("PATCH with stale revision returns 409 project_generation_configuration_revision_conflict", async () => {
      const app = buildApp();
      const projectId = await createProjectForUser(app, auth);
      await app.inject({ method: "GET", url: `/api/projects/${projectId}/generation-configuration`, auth });
      const res = await app.inject({
        method: "PATCH",
        url: `/api/projects/${projectId}/generation-configuration`,
        payload: {
          expected_revision: 99,
          video: { strategy: "all_remotion", api_quality: "standard_720p" },
          budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
        },
        auth,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("project_generation_configuration_revision_conflict");
    });
  });

  describe("project creation copies user default", () => {
    it("creating a project freezes the current user default", async () => {
      const app = buildApp();
      await app.inject({
        method: "PATCH",
        url: "/api/me/generation-preferences",
        payload: {
          expected_revision: null,
          video: { strategy: "all_api_video", api_quality: "high_1080p" },
          budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
        },
        auth,
      });
      const projectId = await createProjectForUser(app, auth);
      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/generation-configuration`,
        auth,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().configuration.video.strategy).toBe("all_api_video");
      expect(res.json().configuration.video.api_quality).toBe("high_1080p");
    });

    it("modifying user default after project creation does not change existing project", async () => {
      const app = buildApp();
      await app.inject({
        method: "PATCH",
        url: "/api/me/generation-preferences",
        payload: {
          expected_revision: null,
          video: { strategy: "all_api_video", api_quality: "standard_720p" },
          budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
        },
        auth,
      });
      const projectId = await createProjectForUser(app, auth);
      await app.inject({
        method: "PATCH",
        url: "/api/me/generation-preferences",
        payload: {
          expected_revision: 2,
          video: { strategy: "all_remotion", api_quality: "standard_720p" },
          budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
        },
        auth,
      });
      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/generation-configuration`,
        auth,
      });
      expect(res.json().configuration.video.strategy).toBe("all_api_video");
    });
  });

  describe("GET /api/generation-capabilities", () => {
    it("returns 200 with capability catalog including provider/model/availability", async () => {
      const app = buildApp();
      app.db.providerModelCatalog.set("test.llm.smart", {
        id: "test.llm.smart",
        capability: "llm.smart",
        providerKey: "deepseek",
        modelId: "deepseek-v4-pro",
        modelVersion: null,
        displayName: "DeepSeek V4 Pro",
        qualityTier: "high",
        speedTier: "slow",
        parameterCapabilitiesJson: { thinking: true },
        pricingVersion: "v1",
        pricingJson: { bounded: false },
        status: "active",
        isDefault: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const res = await app.inject({ method: "GET", url: "/api/generation-capabilities", auth });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.capabilities.length).toBeGreaterThan(0);
      expect(body.capabilities[0].provider_key).toBe("deepseek");
      expect(body.capabilities[0].model_id).toBe("deepseek-v4-pro");
      expect(body.capabilities[0].availability).toBe("enabled");
    });
  });

  describe("S2-2B creative PATCH 与目录 API", () => {
    it("PATCH creative：音色/画风/字幕与安全覆盖保存成功并可读回", async () => {
      const app = buildApp();
      await app.inject({
        method: "PATCH",
        url: "/api/me/generation-preferences",
        payload: {
          expected_revision: null,
          video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
          budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
          creative: {
            voice_profile_id: "voice_preset_cold_authority",
            art_style_preset_id: "art_style_classical_ink",
            subtitle_style_preset_id: "subtitle_style_bold_stroke",
            subtitle_style_overrides: { font_size_px: 60, position: "top" },
          },
        },
        auth,
      });
      const res = await app.inject({ method: "GET", url: "/api/me/generation-preferences", auth });
      expect(res.statusCode).toBe(200);
      const creative = res.json().configuration.creative;
      expect(creative.voice_profile_id).toBe("voice_preset_cold_authority");
      expect(creative.art_style_preset_id).toBe("art_style_classical_ink");
      expect(creative.subtitle_style_preset_id).toBe("subtitle_style_bold_stroke");
      expect(creative.subtitle_style_overrides).toEqual({ font_size_px: 60, position: "top" });
    });

    it("旧 A 请求体（无 creative 段）兼容：creative 回 A 期默认全 null", async () => {
      const app = buildApp();
      await app.inject({
        method: "PATCH",
        url: "/api/me/generation-preferences",
        payload: {
          expected_revision: null,
          video: { strategy: "all_remotion", api_quality: "standard_720p" },
          budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
        },
        auth,
      });
      const res = await app.inject({ method: "GET", url: "/api/me/generation-preferences", auth });
      const creative = res.json().configuration.creative;
      expect(creative.voice_profile_id).toBeNull();
      expect(creative.art_style_preset_id).toBeNull();
      expect(creative.subtitle_style_preset_id).toBeNull();
      expect(creative.subtitle_style_overrides).toEqual({});
    });

    it("capabilities 部分提供（只给一槽）→ 400 invalid_patch_payload（五槽 strict 合同）", async () => {
      const app = buildApp();
      const res = await app.inject({
        method: "PATCH",
        url: "/api/me/generation-preferences",
        payload: {
          expected_revision: null,
          video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
          budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
          capabilities: { "llm.smart": { mode: "fixed", provider_model_id: "x" } },
        },
        auth,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("invalid_patch_payload");
    });

    it("项目配置 PATCH creative 后失效预览覆盖 creative 变更", async () => {
      const app = buildApp();
      const projectId = await createProjectForUser(app, auth);
      await app.inject({
        method: "PATCH",
        url: `/api/projects/${projectId}/generation-configuration`,
        payload: {
          expected_revision: 1,
          video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
          budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
          creative: {
            voice_profile_id: "voice_preset_cold_authority",
            art_style_preset_id: "art_style_classical_ink",
            subtitle_style_preset_id: null,
          },
        },
        auth,
      });
      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/generation-configuration`,
        auth,
      });
      expect(res.statusCode).toBe(200);
      const creative = res.json().configuration.creative;
      expect(creative.voice_profile_id).toBe("voice_preset_cold_authority");
      expect(creative.art_style_preset_id).toBe("art_style_classical_ink");
      expect(creative.subtitle_style_preset_id).toBeNull();
      // GET 的失效预览：与用户默认的 diff 影响阶段
      const preview = res.json().invalidation_preview as { affected_stages: string[] };
      expect(preview.affected_stages).toEqual(
        expect.arrayContaining(["asset_planning", "assets"]),
      );
    });

    it("GET /api/creative-presets 返回画风与字幕公开目录", async () => {
      const app = buildApp();
      const res = await app.inject({ method: "GET", url: "/api/creative-presets", auth });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.art_style.length).toBeGreaterThanOrEqual(3);
      expect(body.subtitle.length).toBeGreaterThanOrEqual(3);
      const artPreset = body.art_style[0];
      expect(artPreset.preset_id).toBeTruthy();
      expect(artPreset.preset_version).toBeTruthy();
      expect(artPreset.overridable_fields).toBeNull();
      const subtitlePreset = body.subtitle[0];
      expect(subtitlePreset.overridable_fields.length).toBeGreaterThan(0);
    });
  });

  describe("S2-2C capabilities PATCH 与保留语义", () => {
    const FULL_CAPABILITIES = {
      "llm.smart": { mode: "fixed", provider_model_id: "llm.smart.deepseek.deepseek-v4-pro" },
      "llm.flash": { mode: "auto" },
      "image.generate": { mode: "auto" },
      "video.image_to_video": { mode: "auto" },
      "tts.synthesize": { mode: "auto" },
    };

    it("用户 PATCH 携带完整五槽 capabilities：fixed 保存并可读回", async () => {
      const app = buildApp();
      const res = await app.inject({
        method: "PATCH",
        url: "/api/me/generation-preferences",
        payload: {
          expected_revision: null,
          video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
          budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
          capabilities: FULL_CAPABILITIES,
        },
        auth,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().configuration.capabilities["llm.smart"]).toEqual({
        mode: "fixed",
        provider_model_id: "llm.smart.deepseek.deepseek-v4-pro",
      });
      const read = await app.inject({ method: "GET", url: "/api/me/generation-preferences", auth });
      expect(read.json().configuration.capabilities["llm.smart"].mode).toBe("fixed");
    });

    it("保留语义：已有 fixed + 旧 B 形状请求体（无 capabilities 段）→ fixed 保持不变", async () => {
      const app = buildApp();
      await app.inject({
        method: "PATCH",
        url: "/api/me/generation-preferences",
        payload: {
          expected_revision: null,
          video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
          budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
          capabilities: FULL_CAPABILITIES,
        },
        auth,
      });
      // 旧 B 客户端只改 video，不携带 capabilities 段
      const res = await app.inject({
        method: "PATCH",
        url: "/api/me/generation-preferences",
        payload: {
          expected_revision: 1,
          video: { strategy: "all_remotion", api_quality: "standard_720p" },
          budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
        },
        auth,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().configuration.capabilities["llm.smart"]).toEqual({
        mode: "fixed",
        provider_model_id: "llm.smart.deepseek.deepseek-v4-pro",
      });
    });

    it("首次创建缺省（无 capabilities 段）→ 全 auto", async () => {
      const app = buildApp();
      const res = await app.inject({
        method: "PATCH",
        url: "/api/me/generation-preferences",
        payload: {
          expected_revision: null,
          video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
          budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
        },
        auth,
      });
      expect(res.statusCode).toBe(200);
      for (const slot of Object.keys(res.json().configuration.capabilities)) {
        expect(res.json().configuration.capabilities[slot]).toEqual({ mode: "auto" });
      }
    });

    it("项目保留语义：项目已 fixed + 旧 B 形状请求体 → fixed 保持不变", async () => {
      const app = buildApp();
      const projectId = await createProjectForUser(app, auth);
      await app.inject({
        method: "PATCH",
        url: `/api/projects/${projectId}/generation-configuration`,
        payload: {
          expected_revision: 1,
          video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
          budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
          capabilities: FULL_CAPABILITIES,
        },
        auth,
      });
      const res = await app.inject({
        method: "PATCH",
        url: `/api/projects/${projectId}/generation-configuration`,
        payload: {
          expected_revision: 2,
          video: { strategy: "prefer_api_video", api_quality: "high_1080p" },
          budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
        },
        auth,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().configuration.capabilities["llm.smart"]).toEqual({
        mode: "fixed",
        provider_model_id: "llm.smart.deepseek.deepseek-v4-pro",
      });
    });

    it("跨实例 PATCH：DB 有 fixed 配置（本实例内存无）→ 无 capabilities 段保留 DB 值且 revision 不误报", async () => {
      const app = buildApp();
      const now = new Date();
      const dbRecord = {
        id: "db-id",
        userId: "user-a",
        schemaVersion: "generation_configuration_v1",
        revision: 3,
        configurationJson: {
          ...DEFAULT_GENERATION_CONFIGURATION,
          capabilities: {
            ...DEFAULT_GENERATION_CONFIGURATION.capabilities,
            "llm.smart": { mode: "fixed", provider_model_id: "llm.smart.deepseek.deepseek-v4-pro" },
          },
        },
        createdAt: now,
        updatedAt: now,
      };
      // 模拟 Prisma 态：注入带 DB 权威查询与 CAS 的 writer（本实例内存无记录）
      app.db.firstAggregateWriter = {
        getUserGenerationPreference: async () => dbRecord,
        casUpsertUserGenerationPreference: async () => ({ success: true }),
      };
      const res = await app.inject({
        method: "PATCH",
        url: "/api/me/generation-preferences",
        payload: {
          expected_revision: 3,
          video: { strategy: "all_remotion", api_quality: "standard_720p" },
          budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
        },
        auth,
      });
      expect(res.statusCode).toBe(200);
      // 缺省 capabilities 段 → 从 DB 权威值保留 fixed（不静默清空）
      expect(res.json().configuration.capabilities["llm.smart"]).toEqual({
        mode: "fixed",
        provider_model_id: "llm.smart.deepseek.deepseek-v4-pro",
      });
    });

    it("项目配置 capabilities 变更 → 失效预览覆盖对应阶段", async () => {
      const app = buildApp();
      const projectId = await createProjectForUser(app, auth);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/projects/${projectId}/generation-configuration`,
        payload: {
          expected_revision: 1,
          video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
          budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
          capabilities: FULL_CAPABILITIES,
        },
        auth,
      });
      expect(res.statusCode).toBe(200);
      const preview = res.json().invalidation_preview as { affected_stages: string[] };
      // llm.smart 变更 → llm_generation
      expect(preview.affected_stages).toContain("llm_generation");
    });
  });
});
