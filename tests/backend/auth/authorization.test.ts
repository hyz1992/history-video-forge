import { describe, expect, it } from "vitest";
import { buildApp } from "../../../backend/src/app.js";
import { createLegacyProject } from "../projects/legacy-project.fixture.js";
import { createAnonymousAuthContext, createAuthenticatedAuthContext } from "../../../backend/src/auth/auth-context.js";
import { guardUserRoute, guardAdminRoute, requireUser, requireAdmin, AuthorizationError, handleControllerAuthError } from "../../../backend/src/auth/authorization.js";
import type { RouteContext, AppResponse } from "../../../backend/src/app.js";

function buildRouteContext(overrides: Partial<RouteContext> = {}): RouteContext {
  return {
    app: { env: { protectedProjectIds: new Set() }, db: {} as any, topicCandidateStore: new Map() } as any,
    params: {},
    payload: {},
    auth: createAnonymousAuthContext(),
    ...overrides,
  } as RouteContext;
}

describe("requireUser", () => {
  it("throws AuthorizationError with 401 for anonymous context", () => {
    expect(() => requireUser(createAnonymousAuthContext())).toThrow(AuthorizationError);
    try {
      requireUser(createAnonymousAuthContext());
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 401, code: "unauthorized" });
    }
  });

  it("returns the authenticated context for a logged-in user", () => {
    const auth = createAuthenticatedAuthContext({ userId: "u1", username: "a", displayName: "A", role: "USER", sessionId: "s1" });
    expect(requireUser(auth)).toBe(auth);
  });
});

describe("requireAdmin", () => {
  it("throws AuthorizationError with 403 for a USER", () => {
    const auth = createAuthenticatedAuthContext({ userId: "u1", username: "a", displayName: "A", role: "USER", sessionId: "s1" });
    expect(() => requireAdmin(auth)).toThrow(AuthorizationError);
    try {
      requireAdmin(auth);
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 403, code: "admin_required" });
    }
  });

  it("returns auth for an ADMIN", () => {
    const auth = createAuthenticatedAuthContext({ userId: "u1", username: "a", displayName: "A", role: "ADMIN", sessionId: "s1" });
    expect(requireAdmin(auth)).toBe(auth);
  });
});

describe("handleControllerAuthError", () => {
  it("returns 401 for anonymous", () => {
    const error = new AuthorizationError(401, "unauthorized", "unauthorized");
    const response = handleControllerAuthError(error);
    expect(response?.statusCode).toBe(401);
  });

  it("returns 403 for admin_required", () => {
    const error = new AuthorizationError(403, "admin_required", "admin_required");
    const response = handleControllerAuthError(error);
    expect(response?.statusCode).toBe(403);
  });

  it("returns null for non-AuthorizationError", () => {
    expect(handleControllerAuthError(new Error("boom"))).toBeNull();
  });
});

describe("guardUserRoute", () => {
  it("returns 401 when auth is anonymous", async () => {
    const handler = guardUserRoute(
      (): AppResponse => ({ statusCode: 200, body: "ok" }),
    );
    const ctx = buildRouteContext({ auth: createAnonymousAuthContext() });
    const response = await handler(ctx);
    expect(response.statusCode).toBe(401);
    expect(response.body).toMatchObject({ error: "unauthorized" });
  });

  it("passes through to the handler when authenticated", async () => {
    const handler = guardUserRoute(
      (ctx): AppResponse => ({ statusCode: 200, body: { projectId: ctx.params.projectId } }),
    );
    const auth = createAuthenticatedAuthContext({ userId: "u1", username: "a", displayName: "A", role: "USER", sessionId: "s1" });
    const ctx = buildRouteContext({ auth, params: { projectId: "p1" } });
    const response = await handler(ctx);
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ projectId: "p1" });
  });
});

describe("guardAdminRoute", () => {
  it("returns 401 when auth is anonymous", async () => {
    const handler = guardAdminRoute(
      (): AppResponse => ({ statusCode: 200, body: "ok" }),
    );
    const ctx = buildRouteContext({ auth: createAnonymousAuthContext() });
    const response = await handler(ctx);
    expect(response.statusCode).toBe(401);
  });

  it("returns 403 when user is not ADMIN", async () => {
    const handler = guardAdminRoute(
      (): AppResponse => ({ statusCode: 200, body: "ok" }),
    );
    const auth = createAuthenticatedAuthContext({ userId: "u1", username: "a", displayName: "A", role: "USER", sessionId: "s1" });
    const ctx = buildRouteContext({ auth });
    const response = await handler(ctx);
    expect(response.statusCode).toBe(403);
    expect(response.body).toMatchObject({ error: "admin_required" });
  });

  it("passes through when user is ADMIN", async () => {
    const handler = guardAdminRoute(
      (): AppResponse => ({ statusCode: 200, body: "ok" }),
    );
    const auth = createAuthenticatedAuthContext({ userId: "u1", username: "a", displayName: "A", role: "ADMIN", sessionId: "s1" });
    const ctx = buildRouteContext({ auth });
    const response = await handler(ctx);
    expect(response.statusCode).toBe(200);
  });
});

describe("app.inject auth integration", () => {
  it("GET /api/projects returns 401 with anonymous auth", async () => {
    const app = buildApp({ skipSnapshotLoad: true, storageBaseDir: process.cwd() });
    const response = await app.inject({
      method: "GET",
      url: "/api/projects",
      auth: createAnonymousAuthContext(),
    });
    expect(response.statusCode).toBe(401);
  });

  it("GET /api/projects returns 200 with authenticated user auth", async () => {
    const app = buildApp({ skipSnapshotLoad: true, storageBaseDir: process.cwd() });
    const auth = createAuthenticatedAuthContext({ userId: "u1", username: "a", displayName: "A", role: "USER", sessionId: "s1" });
    const response = await app.inject({
      method: "GET",
      url: "/api/projects",
      auth,
    });
    expect(response.statusCode).toBe(200);
  });

  it("GET /api/projects/:projectId returns 401 with anonymous auth", async () => {
    const app = buildApp({ skipSnapshotLoad: true, storageBaseDir: process.cwd() });
    const response = await app.inject({
      method: "GET",
      url: "/api/projects/fake-id",
      auth: createAnonymousAuthContext(),
    });
    expect(response.statusCode).toBe(401);
  });

  it("DELETE /api/projects/:projectId returns 401 with anonymous auth", async () => {
    const app = buildApp({ skipSnapshotLoad: true, storageBaseDir: process.cwd() });
    const response = await app.inject({
      method: "DELETE",
      url: "/api/projects/fake-id",
      auth: createAnonymousAuthContext(),
    });
    expect(response.statusCode).toBe(401);
  });

  it("DELETE /api/projects/:projectId returns 404 with USER auth when project does not exist", async () => {
    // 改用 guardOwnedRoute 后：USER 删除不存在的项目返回 404（不暴露存在性）
    // owner 删自己的项目返回 200，ADMIN 删任意项目返回 200，详见 project-delete-permission.test.ts
    const app = buildApp({ skipSnapshotLoad: true, storageBaseDir: process.cwd() });
    const auth = createAuthenticatedAuthContext({ userId: "u1", username: "a", displayName: "A", role: "USER", sessionId: "s1" });
    const response = await app.inject({
      method: "DELETE",
      url: "/api/projects/fake-id",
      auth,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: "project_not_found" });
  });

  it("POST /api/projects returns 401 with anonymous auth", async () => {
    const app = buildApp({ skipSnapshotLoad: true, storageBaseDir: process.cwd() });
    const response = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "test" },
      auth: createAnonymousAuthContext(),
    });
    expect(response.statusCode).toBe(401);
  });
});

describe("cross-user owner isolation", () => {
  it("user A creates a project, user B cannot access its snapshot", async () => {
    const app = buildApp({ skipSnapshotLoad: true, storageBaseDir: process.cwd() });
    const userA = createAuthenticatedAuthContext({ userId: "user-a", username: "a", displayName: "A", role: "USER", sessionId: "s-a" });
    const userB = createAuthenticatedAuthContext({ userId: "user-b", username: "b", displayName: "B", role: "USER", sessionId: "s-b" });

    // 口播前置定版后创建入口要求口播资格选择；本组验证 owner 隔离，经 legacy 夹具直造
    const created = await createLegacyProject(app.db, { name: "A项目", ownerId: "user-a" });
    const projectId = created.id;

    const bAccess = await app.inject({ method: "GET", url: `/api/projects/${projectId}`, auth: userB });
    expect(bAccess.statusCode).toBe(404);
    expect(bAccess.json()).toMatchObject({ error: "project_not_found" });

    const aAccess = await app.inject({ method: "GET", url: `/api/projects/${projectId}`, auth: userA });
    expect(aAccess.statusCode).toBe(200);
  });

  it("user A creates a project, user B's project list does not include it", async () => {
    const app = buildApp({ skipSnapshotLoad: true, storageBaseDir: process.cwd() });
    const userA = createAuthenticatedAuthContext({ userId: "user-a", username: "a", displayName: "A", role: "USER", sessionId: "s-a" });
    const userB = createAuthenticatedAuthContext({ userId: "user-b", username: "b", displayName: "B", role: "USER", sessionId: "s-b" });

    // 口播前置定版后创建入口要求口播资格选择；本组验证 owner 隔离，经 legacy 夹具直造
    const created = await createLegacyProject(app.db, { name: "A项目", ownerId: "user-a" });
    const projectId = created.id;

    const bList = await app.inject({ method: "GET", url: "/api/projects", auth: userB });
    const bProjects = bList.json() as Array<{ project_id: string }>;
    expect(bProjects.find((p) => p.project_id === projectId)).toBeUndefined();

    const aList = await app.inject({ method: "GET", url: "/api/projects", auth: userA });
    const aProjects = aList.json() as Array<{ project_id: string }>;
    expect(aProjects.find((p) => p.project_id === projectId)).toBeDefined();
  });

  it("admin can access any user's project snapshot", async () => {
    const app = buildApp({ skipSnapshotLoad: true, storageBaseDir: process.cwd() });
    const userA = createAuthenticatedAuthContext({ userId: "user-a", username: "a", displayName: "A", role: "USER", sessionId: "s-a" });
    const admin = createAuthenticatedAuthContext({ userId: "admin-x", username: "admin", displayName: "Admin", role: "ADMIN", sessionId: "s-admin" });

    // 口播前置定版后创建入口要求口播资格选择；本组验证 owner 隔离，经 legacy 夹具直造
    const created = await createLegacyProject(app.db, { name: "A项目", ownerId: "user-a" });
    const projectId = created.id;

    const adminAccess = await app.inject({ method: "GET", url: `/api/projects/${projectId}`, auth: admin });
    expect(adminAccess.statusCode).toBe(200);
  });

  it("requires authenticated user to access stage generation on a project", async () => {
    const app = buildApp({ skipSnapshotLoad: true, storageBaseDir: process.cwd() });
    const userA = createAuthenticatedAuthContext({ userId: "user-a", username: "a", displayName: "A", role: "USER", sessionId: "s-a" });
    const userB = createAuthenticatedAuthContext({ userId: "user-b", username: "b", displayName: "B", role: "USER", sessionId: "s-b" });

    // 口播前置定版后创建入口要求口播资格选择；本组验证 owner 隔离，经 legacy 夹具直造
    const created = await createLegacyProject(app.db, { name: "A项目", ownerId: "user-a" });
    const projectId = created.id;

    const bAttempt = await app.inject({ method: "POST", url: `/api/projects/${projectId}/script/generate`, payload: {}, auth: userB });
    expect(bAttempt.statusCode).toBe(404);
    expect(bAttempt.json()).toMatchObject({ error: "project_not_found" });
  });
});

describe("generation cost owner isolation (S2-2A 任务 8)", () => {
  it("user B cannot read cost summary / records / run configuration of user A's project", async () => {
    const app = buildApp({ skipSnapshotLoad: true, storageBaseDir: process.cwd() });
    const userA = createAuthenticatedAuthContext({ userId: "user-a", username: "a", displayName: "A", role: "USER", sessionId: "s-a" });
    const userB = createAuthenticatedAuthContext({ userId: "user-b", username: "b", displayName: "B", role: "USER", sessionId: "s-b" });

    // 口播前置定版后创建入口要求口播资格选择；本组验证 owner 隔离，经 legacy 夹具直造
    const created = await createLegacyProject(app.db, { name: "A项目", ownerId: "user-a" });
    const projectId = created.id;

    // 其他用户即使猜到 quote/run/snapshot/cost id 也只能得到 404
    for (const url of [
      `/api/projects/${projectId}/costs/summary`,
      `/api/projects/${projectId}/costs/records`,
      `/api/projects/${projectId}/runs/any-run-id/configuration`,
    ]) {
      const res = await app.inject({ method: "GET", url, auth: userB });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: "project_not_found" });
    }

  });

  it("anonymous user cannot create quotes or read costs", async () => {
    const app = buildApp({ skipSnapshotLoad: true, storageBaseDir: process.cwd() });
    const userA = createAuthenticatedAuthContext({ userId: "user-a", username: "a", displayName: "A", role: "USER", sessionId: "s-a" });
    // 口播前置定版后创建入口要求口播资格选择；本组验证 owner 隔离，经 legacy 夹具直造
    const created = await createLegacyProject(app.db, { name: "A项目", ownerId: "user-a" });
    const projectId = created.id;

    const summary = await app.inject({ method: "GET", url: `/api/projects/${projectId}/costs/summary` });
    expect(summary.statusCode).toBe(401);
  });
});
