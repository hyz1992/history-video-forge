import type { AppInstance } from "../../app.js";
import type { AuthContext, AuthenticatedAuthContext } from "../../auth/auth-context.js";
import { isAuthenticated } from "../../auth/auth-context.js";
import {
  attemptLogin,
  attemptRegister,
  AuthApiError,
  revokeCurrentSession,
  type SafeUserPublic,
} from "./auth.service.js";

export interface AuthApiResponseBody {
  user?: SafeUserPublic;
  error?: string;
  message?: string;
  anonymous?: boolean;
}

export interface AuthApiResponse {
  statusCode: number;
  body: AuthApiResponseBody;
  cookieAction?:
    | { type: "set"; token: string }
    | { type: "clear" };
}

function handleError(error: unknown): AuthApiResponse {
  if (error instanceof AuthApiError) {
    return {
      statusCode: error.statusCode,
      body: { error: error.code, message: error.code },
    };
  }
  return {
    statusCode: 500,
    body: { error: "internal_error", message: "internal_error" },
  };
}

function requirePrisma(app: AppInstance): AuthApiResponse | null {
  if (!app.prismaClient) {
    return {
      statusCode: 503,
      body: { error: "auth_store_unavailable", message: "auth_store_unavailable" },
    };
  }
  return null;
}

export async function loginHandler(
  app: AppInstance,
  payload: unknown,
): Promise<AuthApiResponse> {
  const unavailable = requirePrisma(app);
  if (unavailable) return unavailable;

  const body = (payload ?? {}) as { username?: unknown; password?: unknown };
  try {
    const result = await attemptLogin(app.prismaClient!, {
      username: typeof body.username === "string" ? body.username : "",
      password: typeof body.password === "string" ? body.password : "",
    });
    return {
      statusCode: 200,
      body: { user: result.user },
      cookieAction: { type: "set", token: result.sessionToken },
    };
  } catch (error) {
    return handleError(error);
  }
}

export async function logoutHandler(
  app: AppInstance,
  auth: AuthContext,
): Promise<AuthApiResponse> {
  if (!isAuthenticated(auth)) {
    return {
      statusCode: 200,
      body: { anonymous: true },
      cookieAction: { type: "clear" },
    };
  }
  const unavailable = requirePrisma(app);
  if (unavailable) return unavailable;
  try {
    await revokeCurrentSession(app.prismaClient!, auth as AuthenticatedAuthContext);
    return {
      statusCode: 200,
      body: { anonymous: true },
      cookieAction: { type: "clear" },
    };
  } catch (error) {
    return handleError(error);
  }
}

export async function meHandler(
  app: AppInstance,
  auth: AuthContext,
): Promise<AuthApiResponse> {
  if (!isAuthenticated(auth)) {
    return {
      statusCode: 401,
      body: { error: "unauthorized", anonymous: true },
    };
  }
  const authenticated = auth as AuthenticatedAuthContext;
  const unavailable = requirePrisma(app);
  if (unavailable) return unavailable;
  const user = await app.prismaClient!.user.findUnique({
    where: { id: authenticated.userId },
    select: {
      id: true,
      username: true,
      displayName: true,
      role: true,
      status: true,
      mustChangePassword: true,
    },
  });
  if (!user || user.status !== "ACTIVE") {
    return {
      statusCode: 401,
      body: { error: "unauthorized", anonymous: true },
    };
  }
  return {
    statusCode: 200,
    body: { user },
  };
}

export async function registerHandler(
  app: AppInstance,
  payload: unknown,
): Promise<AuthApiResponse> {
  const unavailable = requirePrisma(app);
  if (unavailable) return unavailable;

  const body = (payload ?? {}) as { username?: unknown; password?: unknown; displayName?: unknown };
  try {
    const result = await attemptRegister(app.prismaClient!, {
      username: typeof body.username === "string" ? body.username : "",
      password: typeof body.password === "string" ? body.password : "",
      displayName: typeof body.displayName === "string" ? body.displayName : "",
    });
    return {
      statusCode: 200,
      body: { user: result.user },
      cookieAction: { type: "set", token: result.sessionToken },
    };
  } catch (error) {
    return handleError(error);
  }
}
