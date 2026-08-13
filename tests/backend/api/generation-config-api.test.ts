import { describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { buildTestAuth } from "../auth/test-utils.js";
import { DEFAULT_GENERATION_CONFIGURATION } from "../../../shared/src/index.js";
import type { AuthenticatedAuthContext } from "../../../backend/src/auth/auth-context.js";

/**
 * S2-2A 任务 3 步骤 1：API 失败测试。
 *
 * 覆盖：
 * - GET/PATCH /api/me/generation-preferences
 * - GET/PATCH /api/projects/:projectId/generation-configuration
 * - GET /api/generation-capabilities
 * - 乐观锁 409 冲突码
 * - owner 隔离
 * - 创建项目时复制用户默认
 * - 修改用户默认不改变已有项目
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
    });

    it("PATCH updates user preference with correct expected_revision", async () => {
      const app = buildApp();
      // 先 GET 触发 backfill
      await app.inject({ method: "GET", url: "/api/me/generation-preferences", auth });
      const res = await app.inject({
        method: "PATCH",
        url: "/api/me/generation-preferences",
        payload: {
          expected_revision: 1,
          configuration: {
            ...DEFAULT_GENERATION_CONFIGURATION,
            video: { strategy: "all_api_video", api_quality: "high_1080p" },
          },
        },
        auth,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.revision).toBe(2);
      expect(body.configuration.video.strategy).toBe("all_api_video");
    });

    it("PATCH with stale revision returns 409 generation_preference_revision_conflict", async () => {
      const app = buildApp();
      await app.inject({ method: "GET", url: "/api/me/generation-preferences", auth });
      const res = await app.inject({
        method: "PATCH",
        url: "/api/me/generation-preferences",
        payload: {
          expected_revision: 99,
          configuration: DEFAULT_GENERATION_CONFIGURATION,
        },
        auth,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("generation_preference_revision_conflict");
    });

    it("GET/PATCH only accesses current user (not other users)", async () => {
      const app = buildApp();
      // user-a sets preference
      await app.inject({
        method: "PATCH",
        url: "/api/me/generation-preferences",
        payload: {
          expected_revision: null,
          configuration: {
            ...DEFAULT_GENERATION_CONFIGURATION,
            video: { strategy: "prefer_api_video", api_quality: "standard_720p" },
          },
        },
        auth,
      });
      // user-b reads own preference (should be backfilled default, not user-a's)
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
      // 先 GET 触发配置写入（创建项目时已复制，但确保 revision）
      await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/generation-configuration`,
        auth,
      });
      const res = await app.inject({
        method: "PATCH",
        url: `/api/projects/${projectId}/generation-configuration`,
        payload: {
          expected_revision: 1,
          configuration: {
            ...DEFAULT_GENERATION_CONFIGURATION,
            video: { strategy: "all_remotion", api_quality: "standard_720p" },
          },
        },
        auth,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.revision).toBe(2);
      expect(body.invalidation_preview).toBeDefined();
    });

    it("PATCH with stale revision returns 409 project_generation_configuration_revision_conflict", async () => {
      const app = buildApp();
      const projectId = await createProjectForUser(app, auth);
      await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/generation-configuration`,
        auth,
      });
      const res = await app.inject({
        method: "PATCH",
        url: `/api/projects/${projectId}/generation-configuration`,
        payload: {
          expected_revision: 99,
          configuration: DEFAULT_GENERATION_CONFIGURATION,
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
      // user-a sets a non-default strategy
      await app.inject({
        method: "PATCH",
        url: "/api/me/generation-preferences",
        payload: {
          expected_revision: null,
          configuration: {
            ...DEFAULT_GENERATION_CONFIGURATION,
            video: { strategy: "all_api_video", api_quality: "high_1080p" },
          },
        },
        auth,
      });
      // 创建项目
      const projectId = await createProjectForUser(app, auth);
      // 读取项目配置 → 应冻结为 all_api_video
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
      // 设置用户默认为 all_api_video
      await app.inject({
        method: "PATCH",
        url: "/api/me/generation-preferences",
        payload: {
          expected_revision: null,
          configuration: {
            ...DEFAULT_GENERATION_CONFIGURATION,
            video: { strategy: "all_api_video", api_quality: "standard_720p" },
          },
        },
        auth,
      });
      const projectId = await createProjectForUser(app, auth);
      // 修改用户默认为 all_remotion
      await app.inject({
        method: "PATCH",
        url: "/api/me/generation-preferences",
        payload: {
          expected_revision: 2,
          configuration: {
            ...DEFAULT_GENERATION_CONFIGURATION,
            video: { strategy: "all_remotion", api_quality: "standard_720p" },
          },
        },
        auth,
      });
      // 项目配置应保持冻结的 all_api_video
      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/generation-configuration`,
        auth,
      });
      expect(res.json().configuration.video.strategy).toBe("all_api_video");
    });
  });

  describe("GET /api/generation-capabilities", () => {
    it("returns 200 with capability catalog", async () => {
      const app = buildApp();
      // 手动 seed 一个 active catalog 条目（内存态无迁移 seed）
      app.db.providerModelCatalog.set("test.llm.smart", {
        id: "test.llm.smart",
        capability: "llm.smart",
        providerKey: "deepseek",
        modelId: "deepseek-v4-pro",
        modelVersion: null,
        displayName: "DeepSeek V4 Pro",
        qualityTier: "high",
        speedTier: "slow",
        parameterCapabilitiesJson: {},
        pricingVersion: "v1",
        pricingJson: { bounded: false },
        status: "active",
        isDefault: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const res = await app.inject({
        method: "GET",
        url: "/api/generation-capabilities",
        auth,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.capabilities)).toBe(true);
      expect(body.capabilities.length).toBeGreaterThan(0);
      expect(body.capabilities[0].capability).toBe("llm.smart");
    });
  });
});
