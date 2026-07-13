import { describe, expect, it } from "vitest";
import { buildApp } from "../../../backend/src/app.js";
import { createAnonymousAuthContext, createAuthenticatedAuthContext } from "../../../backend/src/auth/auth-context.js";
import { guardUserRoute, guardAdminRoute, requireUser, requireAdmin, AuthorizationError, handleControllerAuthError } from "../../../backend/src/auth/authorization.js";
import type { RouteContext, AppResponse } from "../../../backend/src/app.js";

function buildRouteContext(overrides: Partial<RouteContext> = {}): RouteContext {
  return {
    app: { env: { demoMode: false, protectedProjectIds: new Set() }, db: {} as any, topicCandidateStore: new Map() } as any,
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

  it("DELETE /api/projects/:projectId returns 403 with USER auth (not admin)", async () => {
    const app = buildApp({ skipSnapshotLoad: true, storageBaseDir: process.cwd() });
    const auth = createAuthenticatedAuthContext({ userId: "u1", username: "a", displayName: "A", role: "USER", sessionId: "s1" });
    const response = await app.inject({
      method: "DELETE",
      url: "/api/projects/fake-id",
      auth,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "admin_required" });
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
