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
});
