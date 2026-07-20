import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

import { apiFetch, ApiError } from "../../frontend/src/utils/api";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  } as Response;
}

function mockAuthStore(overrides: { user?: NonNullable<ReturnType<typeof createAuthStore>["state"]["user"]> } = {}) {
  return {
    state: {
      user: overrides.user ?? null,
      initialized: true,
      loading: false,
    },
    loadMe: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    clear: vi.fn(),
    isAuthenticated: () => (overrides.user ?? null) !== null,
    authModal: { open: false, mode: "login" as const, pendingAction: null },
    openAuthModal: vi.fn(),
    openAuthModalForAction: vi.fn(),
    hideAuthModal: vi.fn(),
  };
}

describe("admin routes guard", () => {
  describe("createAppRouter admin route guard", () => {
    let createAppRouter: typeof import("../../frontend/src/router").createAppRouter;

    beforeAll(async () => {
      const mod = await import("../../frontend/src/router");
      createAppRouter = mod.createAppRouter;
    });

    it("redirects anonymous users away from /admin", async () => {
      const store = mockAuthStore();
      const router = createAppRouter("memory", { authStore: store as any });
      await router.push("/admin/users");
      await nextTick();
      expect(router.currentRoute.value.path).toBe("/");
    });

    it("redirects USER role away from /admin", async () => {
      const store = mockAuthStore({
        user: {
          id: "u1",
          username: "user1",
          displayName: "User1",
          role: "USER",
          status: "ACTIVE",
          mustChangePassword: false,
        },
      });
      const router = createAppRouter("memory", { authStore: store as any });
      await router.push("/admin/users");
      await nextTick();
      expect(router.currentRoute.value.path).toBe("/");
    });

    it("redirects USER role away from /admin/audit-logs", async () => {
      const store = mockAuthStore({
        user: {
          id: "u1",
          username: "user1",
          displayName: "User1",
          role: "USER",
          status: "ACTIVE",
          mustChangePassword: false,
        },
      });
      const router = createAppRouter("memory", { authStore: store as any });
      await router.push("/admin/audit-logs");
      await nextTick();
      expect(router.currentRoute.value.path).toBe("/");
    });

    it("allows ADMIN role to access /admin/users", async () => {
      const store = mockAuthStore({
        user: {
          id: "admin1",
          username: "admin",
          displayName: "Admin",
          role: "ADMIN",
          status: "ACTIVE",
          mustChangePassword: false,
        },
      });
      const router = createAppRouter("memory", { authStore: store as any });
      await router.push("/admin/users");
      await nextTick();
      expect(router.currentRoute.value.path).toBe("/admin/users");
    });

    it("allows ADMIN role to access /admin/projects", async () => {
      const store = mockAuthStore({
        user: {
          id: "admin1",
          username: "admin",
          displayName: "Admin",
          role: "ADMIN",
          status: "ACTIVE",
          mustChangePassword: false,
        },
      });
      const router = createAppRouter("memory", { authStore: store as any });
      await router.push("/admin/projects");
      await nextTick();
      expect(router.currentRoute.value.path).toBe("/admin/projects");
    });

    it("allows ADMIN role to access /admin/audit-logs", async () => {
      const store = mockAuthStore({
        user: {
          id: "admin1",
          username: "admin",
          displayName: "Admin",
          role: "ADMIN",
          status: "ACTIVE",
          mustChangePassword: false,
        },
      });
      const router = createAppRouter("memory", { authStore: store as any });
      await router.push("/admin/audit-logs");
      await nextTick();
      expect(router.currentRoute.value.path).toBe("/admin/audit-logs");
    });

    it("redirects /admin to /admin/users by default", async () => {
      const store = mockAuthStore({
        user: {
          id: "admin1",
          username: "admin",
          displayName: "Admin",
          role: "ADMIN",
          status: "ACTIVE",
          mustChangePassword: false,
        },
      });
      const router = createAppRouter("memory", { authStore: store as any });
      await router.push("/admin");
      await nextTick();
      expect(router.currentRoute.value.path).toBe("/admin/users");
    });
  });
});

describe("admin API calls", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GET /api/admin/users returns user list", async () => {
    const users = [
      {
        id: "u1",
        username: "alice",
        displayName: "Alice",
        role: "USER",
        status: "ACTIVE",
        mustChangePassword: false,
        lastLoginAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        isMigrationOwner: false,
      },
    ];
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { items: users }));

    const data = await apiFetch<{ items: typeof users }>("/api/admin/users");
    expect(data.items).toHaveLength(1);
    expect(data.items[0].username).toBe("alice");
  });

  it("POST /api/admin/users creates a user", async () => {
    const user = {
      id: "u2",
      username: "bob",
      displayName: "Bob",
      role: "USER",
      status: "ACTIVE",
      mustChangePassword: true,
      lastLoginAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      isMigrationOwner: false,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { user }));

    const data = await apiFetch<{ user: typeof user }>("/api/admin/users", {
      method: "POST",
      body: { username: "bob", password: "123456789012", role: "USER" },
    });

    expect(data.user.username).toBe("bob");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/users",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("POST /api/admin/users/:id/disable disables a user", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { userId: "u1", status: "DISABLED" }));

    const data = await apiFetch<{ userId: string; status: string }>(
      "/api/admin/users/u1/disable",
      { method: "POST" },
    );

    expect(data.status).toBe("DISABLED");
  });

  it("POST /api/admin/users/:id/enable enables a user", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { userId: "u1", status: "ACTIVE" }));

    const data = await apiFetch<{ userId: string; status: string }>(
      "/api/admin/users/u1/enable",
      { method: "POST" },
    );

    expect(data.status).toBe("ACTIVE");
  });

  it("POST /api/admin/users/:id/reset-password resets password", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { userId: "u1", mustChangePassword: true }));

    const data = await apiFetch<{ userId: string; mustChangePassword: boolean }>(
      "/api/admin/users/u1/reset-password",
      { method: "POST", body: { password: "newpassword123" } },
    );

    expect(data.mustChangePassword).toBe(true);
  });

  it("POST /api/admin/users/:id/sessions/revoke revokes sessions", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { userId: "u1", revokedCount: 3 }));

    const data = await apiFetch<{ userId: string; revokedCount: number }>(
      "/api/admin/users/u1/sessions/revoke",
      { method: "POST" },
    );

    expect(data.revokedCount).toBe(3);
  });

  it("GET /api/admin/projects returns project list", async () => {
    const projects = [
      {
        id: "p1",
        name: "测试项目",
        ownerId: "u1",
        createdById: "u1",
        status: "script_ready",
        archivedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { items: projects }));

    const data = await apiFetch<{ items: typeof projects }>("/api/admin/projects");
    expect(data.items).toHaveLength(1);
  });

  it("POST /api/admin/projects/:id/transfer-owner transfers ownership", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { projectId: "p1", ownerId: "u2", createdById: "u1" }),
    );

    const data = await apiFetch<{ projectId: string; ownerId: string; createdById: string }>(
      "/api/admin/projects/p1/transfer-owner",
      { method: "POST", body: { targetUserId: "u2", reason: "离职转移" } },
    );

    expect(data.ownerId).toBe("u2");
  });

  it("POST /api/admin/audit-logs/query returns audit logs", async () => {
    const logs = {
      items: [
        {
          id: "a1",
          actorUserId: "admin1",
          projectId: null,
          action: "user_create",
          targetType: "User",
          targetId: "u1",
          metadataJson: { username: "alice" },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, logs));

    const data = await apiFetch<typeof logs>("/api/admin/audit-logs/query", {
      method: "POST",
      body: { limit: 50, offset: 0 },
    });

    expect(data.items).toHaveLength(1);
    expect(data.total).toBe(1);
  });

  it("admin API returns 403 for non-admin user (simulated)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: "admin_required" }));

    try {
      await apiFetch("/api/admin/users");
      expect.fail("Expected ApiError to be thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(403);
    }
  });
});
