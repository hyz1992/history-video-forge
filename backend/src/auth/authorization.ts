import type { AppResponse, RouteContext } from "../app.js";
import type {
  AuthContext,
  AuthenticatedAuthContext,
} from "./auth-context.js";
import { isAuthenticated } from "./auth-context.js";

export class AuthorizationError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export const ANONYMOUS_RESPONSE: AppResponse = Object.freeze({
  statusCode: 401,
  body: { error: "unauthorized", message: "请先登录" },
});

export function buildForbiddenResponse(code: string, message: string): AppResponse {
  return { statusCode: 403, body: { error: code, message } };
}

export function buildNotFoundResponse(code: string = "project_not_found"): AppResponse {
  return { statusCode: 404, body: { error: code } };
}

export function requireUser(auth: AuthContext): AuthenticatedAuthContext {
  if (!isAuthenticated(auth)) {
    throw new AuthorizationError(401, "unauthorized", "unauthorized");
  }
  return auth;
}

export function requireAdmin(auth: AuthContext): AuthenticatedAuthContext {
  const user = requireUser(auth);
  if (user.role !== "ADMIN") {
    throw new AuthorizationError(403, "admin_required", "admin_required");
  }
  return user;
}

export function requireOwner(
  auth: AuthenticatedAuthContext,
  projectOwnerId: string,
): void {
  if (auth.role === "ADMIN") return;
  if (projectOwnerId !== auth.userId) {
    throw new AuthorizationError(404, "project_not_found", "project_not_found");
  }
}

export function handleControllerAuthError(error: unknown): AppResponse | null {
  if (error instanceof AuthorizationError) {
    if (error.statusCode === 401) {
      return ANONYMOUS_RESPONSE;
    }
    if (error.statusCode === 403) {
      return buildForbiddenResponse(error.code, error.message);
    }
    return { statusCode: error.statusCode, body: { error: error.code } };
  }
  return null;
}

export function withAuthorization<T extends unknown[]>(
  handler: (auth: AuthenticatedAuthContext, ...args: T) => Promise<AppResponse> | AppResponse,
): (auth: AuthContext, ...args: T) => Promise<AppResponse> | AppResponse {
  return (auth, ...args) => {
    try {
      const user = requireUser(auth);
      return handler(user, ...args);
    } catch (error) {
      const handled = handleControllerAuthError(error);
      if (handled) return handled;
      throw error;
    }
  };
}

type RouteHandler = (context: RouteContext) => Promise<AppResponse> | AppResponse;

export function guardRoute(
  guard: (context: RouteContext) => void,
  handler: RouteHandler,
): RouteHandler {
  return async (context) => {
    try {
      guard(context);
      return await handler(context);
    } catch (error) {
      const handled = handleControllerAuthError(error);
      if (handled) return handled;
      throw error;
    }
  };
}

export function guardUserRoute(handler: RouteHandler): RouteHandler {
  return guardRoute((context) => { requireUser(context.auth); }, handler);
}

export function guardAdminRoute(handler: RouteHandler): RouteHandler {
  return guardRoute((context) => { requireAdmin(context.auth); }, handler);
}

export function guardOwnedRoute(handler: RouteHandler): RouteHandler {
  return guardRoute((context) => {
    const user = requireUser(context.auth);
    const projectId = context.params.projectId;
    if (!projectId) throw new AuthorizationError(404, "project_not_found", "project_not_found");
    const project = context.app.db.projects.get(projectId);
    if (!project) throw new AuthorizationError(404, "project_not_found", "project_not_found");
    requireOwner(user, project.ownerId);
  }, handler);
}
