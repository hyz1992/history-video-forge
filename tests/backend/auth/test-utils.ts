import type { AuthenticatedAuthContext } from "../../../backend/src/auth/auth-context.js";
import { createAuthenticatedAuthContext } from "../../../backend/src/auth/auth-context.js";

export function buildTestAuth(overrides: {
  userId?: string;
  username?: string;
  role?: "ADMIN" | "USER";
} = {}): AuthenticatedAuthContext {
  return createAuthenticatedAuthContext({
    userId: overrides.userId ?? "test-user",
    username: overrides.username ?? "test-user",
    displayName: "Test User",
    role: overrides.role ?? "USER",
    sessionId: "test-session",
  });
}
