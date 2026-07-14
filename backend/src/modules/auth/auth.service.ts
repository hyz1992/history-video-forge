import type { AppPrismaClient } from "../../db/prisma-client.types.js";
import {
  hashPassword,
  isMigrationOwnerPlaintextMarker,
  validatePasswordPolicy,
  verifyPassword,
} from "../../auth/password-hash.js";
import { PrismaSessionStore } from "../../auth/session-store.js";
import type { AuthenticatedAuthContext } from "../../auth/auth-context.js";

export interface SafeUserPublic {
  id: string;
  username: string;
  displayName: string;
  role: string;
  status: string;
  mustChangePassword: boolean;
}

export interface LoginInput {
  username: string;
  password: string;
}

export interface RegisterInput {
  username: string;
  password: string;
  displayName: string;
}

export interface LoginSuccess {
  user: SafeUserPublic;
  sessionToken: string;
  sessionId: string;
}

export class AuthApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "AuthApiError";
  }
}

function toSafeUserPublic(row: {
  id: string;
  username: string;
  displayName: string;
  role: string;
  status: string;
  mustChangePassword: boolean;
}): SafeUserPublic {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    status: row.status,
    mustChangePassword: row.mustChangePassword,
  };
}

export async function attemptLogin(
  client: AppPrismaClient,
  input: LoginInput,
): Promise<LoginSuccess> {
  const username = typeof input.username === "string" ? input.username.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";

  if (!username || !password) {
    throw new AuthApiError("auth_failed", 401, "auth_failed");
  }

  const user = await client.user.findUnique({ where: { username } });

  const fail = () => new AuthApiError("auth_failed", 401, "auth_failed");

  if (!user) {
    throw fail();
  }

  if (user.status !== "ACTIVE") {
    throw fail();
  }

  if (isMigrationOwnerPlaintextMarker(user.passwordHash)) {
    throw fail();
  }

  const passwordOk = await verifyPassword(user.passwordHash, password);
  if (!passwordOk) {
    throw fail();
  }

  const sessionStore = new PrismaSessionStore(client);
  const session = await sessionStore.createSession({
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role as "ADMIN" | "USER",
  });

  await client.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  return {
    user: toSafeUserPublic(user),
    sessionToken: session.token,
    sessionId: session.sessionId,
  };
}

export async function revokeCurrentSession(
  client: AppPrismaClient,
  auth: AuthenticatedAuthContext,
): Promise<void> {
  const sessionStore = new PrismaSessionStore(client);
  await sessionStore.revokeSession(auth.sessionId);
}

export async function attemptRegister(
  client: AppPrismaClient,
  input: RegisterInput,
): Promise<LoginSuccess> {
  const username = typeof input.username === "string" ? input.username.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const displayName = typeof input.displayName === "string" ? input.displayName.trim() : "";

  if (!username || !password || !displayName) {
    throw new AuthApiError("register_missing_fields", 400, "register_missing_fields");
  }

  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
    throw new AuthApiError("register_invalid_username", 400, "register_invalid_username");
  }

  try {
    validatePasswordPolicy(password);
  } catch {
    throw new AuthApiError("register_weak_password", 400, "register_weak_password");
  }

  if (displayName.length < 1 || displayName.length > 50) {
    throw new AuthApiError("register_invalid_display_name", 400, "register_invalid_display_name");
  }

  const existing = await client.user.findUnique({ where: { username } });
  if (existing) {
    throw new AuthApiError("register_username_taken", 409, "register_username_taken");
  }

  const passwordHash = await hashPassword(password);

  const user = await client.user.create({
    data: {
      username,
      displayName,
      passwordHash,
      role: "USER",
      status: "ACTIVE",
      mustChangePassword: false,
    },
  });

  const sessionStore = new PrismaSessionStore(client);
  const session = await sessionStore.createSession({
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role as "ADMIN" | "USER",
  });

  return {
    user: toSafeUserPublic(user),
    sessionToken: session.token,
    sessionId: session.sessionId,
  };
}
