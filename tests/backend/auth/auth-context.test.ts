import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_AUTH_CONTEXT,
  assertUserRole,
  assertUserStatus,
  createAnonymousAuthContext,
  createAuthenticatedAuthContext,
  isAuthenticated,
} from "../../../backend/src/auth/auth-context.js";

describe("AuthContext constructors", () => {
  it("creates an authenticated context with role and sessionId", () => {
    const ctx = createAuthenticatedAuthContext({
      userId: "u1",
      username: "alice",
      displayName: "Alice",
      role: "USER",
      sessionId: "s1",
    });
    expect(ctx.anonymous).toBe(false);
    expect(ctx.userId).toBe("u1");
    expect(ctx.role).toBe("USER");
    expect(ctx.sessionId).toBe("s1");
    expect(isAuthenticated(ctx)).toBe(true);
  });

  it("creates an anonymous context without a reason", () => {
    const ctx = createAnonymousAuthContext();
    expect(ctx.anonymous).toBe(true);
    expect(ctx.reason).toBeUndefined();
    expect(isAuthenticated(ctx)).toBe(false);
  });

  it("creates an anonymous context with a failure reason", () => {
    const ctx = createAnonymousAuthContext("session_expired");
    expect(ctx.anonymous).toBe(true);
    expect(ctx.reason).toBe("session_expired");
  });

  it("exposes a frozen default anonymous singleton", () => {
    expect(ANONYMOUS_AUTH_CONTEXT.anonymous).toBe(true);
    expect(Object.isFrozen(ANONYMOUS_AUTH_CONTEXT)).toBe(true);
  });

  it("assertUserRole throws on unknown role values", () => {
    expect(() => assertUserRole("USER")).not.toThrow();
    expect(() => assertUserRole("ADMIN")).not.toThrow();
    expect(() => assertUserRole("SUPERUSER")).toThrow(/invalid_user_role/u);
  });

  it("assertUserStatus throws on unknown status values", () => {
    expect(() => assertUserStatus("ACTIVE")).not.toThrow();
    expect(() => assertUserStatus("DISABLED")).not.toThrow();
    expect(() => assertUserStatus("PENDING")).toThrow(/invalid_user_status/u);
  });
});
