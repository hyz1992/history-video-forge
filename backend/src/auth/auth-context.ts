export type UserRole = "ADMIN" | "USER";

export interface AuthenticatedAuthContext {
  readonly anonymous: false;
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly role: UserRole;
  readonly sessionId: string;
}

export interface AnonymousAuthContext {
  readonly anonymous: true;
  readonly reason?: AuthFailureReason;
}

export type AuthContext = AuthenticatedAuthContext | AnonymousAuthContext;

export type AuthFailureReason =
  | "no_session_token"
  | "session_not_found"
  | "session_expired"
  | "session_revoked"
  | "user_not_found"
  | "user_disabled";

export const ANONYMOUS_AUTH_CONTEXT: AnonymousAuthContext = Object.freeze({
  anonymous: true,
});

export function createAnonymousAuthContext(reason?: AuthFailureReason): AnonymousAuthContext {
  if (!reason) return ANONYMOUS_AUTH_CONTEXT;
  return { anonymous: true, reason };
}

export function createAuthenticatedAuthContext(input: {
  userId: string;
  username: string;
  displayName: string;
  role: UserRole;
  sessionId: string;
}): AuthenticatedAuthContext {
  return {
    anonymous: false,
    userId: input.userId,
    username: input.username,
    displayName: input.displayName,
    role: input.role,
    sessionId: input.sessionId,
  };
}

export function isAuthenticated(context: AuthContext): context is AuthenticatedAuthContext {
  return !context.anonymous;
}

export function assertUserStatus(value: string): asserts value is "ACTIVE" | "DISABLED" {
  if (value !== "ACTIVE" && value !== "DISABLED") {
    throw new Error(`invalid_user_status:${value}`);
  }
}

export function assertUserRole(value: string): asserts value is UserRole {
  if (value !== "ADMIN" && value !== "USER") {
    throw new Error(`invalid_user_role:${value}`);
  }
}
