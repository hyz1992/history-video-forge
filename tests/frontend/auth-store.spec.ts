import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAuthStore } from "../../frontend/src/stores/auth";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  } as Response;
}

describe("auth store", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loadMe populates user when /api/auth/me returns 200", async () => {
    const user = {
      id: "u1",
      username: "alice",
      displayName: "Alice",
      role: "USER",
      status: "ACTIVE",
      mustChangePassword: false,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user }));

    const store = createAuthStore();
    const loaded = await store.loadMe();

    expect(loaded).toEqual(user);
    expect(store.state.user).toEqual(user);
    expect(store.isAuthenticated()).toBe(true);
    expect(store.state.initialized).toBe(true);
  });

  it("loadMe clears user when /api/auth/me returns 401", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: "unauthorized" }));

    const store = createAuthStore();
    const loaded = await store.loadMe();

    expect(loaded).toBeNull();
    expect(store.state.user).toBeNull();
    expect(store.isAuthenticated()).toBe(false);
    expect(store.state.initialized).toBe(true);
  });

  it("login posts credentials and populates user on success", async () => {
    const user = {
      id: "a1",
      username: "admin",
      displayName: "Admin",
      role: "ADMIN",
      status: "ACTIVE",
      mustChangePassword: false,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user }));

    const store = createAuthStore();
    await store.login("admin", "secret");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ username: "admin", password: "secret" }),
      }),
    );
    expect(store.state.user?.username).toBe("admin");
  });

  it("login throws ApiError on auth_failed and does not populate user", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: "auth_failed" }));

    const store = createAuthStore();
    await expect(store.login("admin", "wrong")).rejects.toMatchObject({
      status: 401,
      code: "auth_failed",
    });
    expect(store.state.user).toBeNull();
  });

  it("logout calls /api/auth/logout and clears local state", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { user: { id: "u1", username: "alice", displayName: "Alice", role: "USER", status: "ACTIVE", mustChangePassword: false } }))
      .mockResolvedValueOnce(jsonResponse(200, { anonymous: true }));

    const store = createAuthStore();
    await store.loadMe();
    expect(store.isAuthenticated()).toBe(true);

    await store.logout();

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/auth/logout",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(store.isAuthenticated()).toBe(false);
    expect(store.state.user).toBeNull();
  });

  it("logout still clears local state even when the request fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { user: { id: "u1", username: "alice", displayName: "Alice", role: "USER", status: "ACTIVE", mustChangePassword: false } }))
      .mockRejectedValueOnce(new Error("network"));

    const store = createAuthStore();
    await store.loadMe();

    await store.logout();

    expect(store.isAuthenticated()).toBe(false);
  });

  it("login request includes credentials: include (cookie is carried)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: { id: "u1", username: "alice", displayName: "Alice", role: "USER", status: "ACTIVE", mustChangePassword: false } }));

    const store = createAuthStore();
    await store.login("alice", "pw");

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).credentials).toBe("include");
  });

  it("token/password never stored in store state (only safe user fields)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: { id: "u1", username: "alice", displayName: "Alice", role: "USER", status: "ACTIVE", mustChangePassword: false } }));

    const store = createAuthStore();
    await store.login("alice", "super-secret-pw");

    const serialized = JSON.stringify(store.state.user);
    expect(serialized).not.toContain("super-secret-pw");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("passwordHash");
  });
});
