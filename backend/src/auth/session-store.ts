import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AppPrismaClient } from "../db/prisma-client.types.js";
import {
  assertUserRole,
  assertUserStatus,
  type AuthenticatedAuthContext,
  type AuthFailureReason,
  type UserRole,
  createAuthenticatedAuthContext,
} from "./auth-context.js";

export const SESSION_DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MAX_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_SLIDING_RENEW_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export interface CreateSessionInput {
  userId: string;
  username: string;
  displayName: string;
  role: UserRole;
  ttlMs?: number;
  userAgentHash?: string;
  ipPrefix?: string;
}

export interface CreateSessionResult {
  sessionId: string;
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface ResolveSessionResult {
  ok: boolean;
  context?: AuthenticatedAuthContext;
  reason?: AuthFailureReason;
  sessionId?: string;
  renewExpiresAt?: Date;
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function constantTimeTokenEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface SessionStoreDeps {
  now?: () => Date;
}

export class PrismaSessionStore {
  constructor(
    private readonly client: AppPrismaClient,
    private readonly deps: SessionStoreDeps = {},
  ) {}

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  async createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);
    const now = this.now();
    const ttl = input.ttlMs ?? SESSION_DEFAULT_TTL_MS;
    const expiresAt = new Date(now.getTime() + ttl);

    const session = await this.client.session.create({
      data: {
        userId: input.userId,
        tokenHash,
        expiresAt,
        lastSeenAt: now,
        userAgentHash: input.userAgentHash ?? null,
        ipPrefix: input.ipPrefix ?? null,
      },
    });

    return {
      sessionId: session.id,
      token,
      tokenHash,
      expiresAt,
    };
  }

  async resolveSession(token: string): Promise<ResolveSessionResult> {
    if (!token || typeof token !== "string") {
      return { ok: false, reason: "no_session_token" };
    }

    const tokenHash = hashSessionToken(token);
    const session = await this.client.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!session) {
      return { ok: false, reason: "session_not_found" };
    }

    const now = this.now();

    if (session.expiresAt.getTime() <= now.getTime()) {
      return { ok: false, reason: "session_expired", sessionId: session.id };
    }

    if (session.revokedAt !== null) {
      return { ok: false, reason: "session_revoked", sessionId: session.id };
    }

    if (!session.user) {
      return { ok: false, reason: "user_not_found", sessionId: session.id };
    }

    assertUserStatus(session.user.status);
    if (session.user.status !== "ACTIVE") {
      return { ok: false, reason: "user_disabled", sessionId: session.id };
    }

    assertUserRole(session.user.role);

    let renewExpiresAt: Date | undefined;
    const remainingMs = session.expiresAt.getTime() - now.getTime();
    if (remainingMs < SESSION_SLIDING_RENEW_THRESHOLD_MS) {
      renewExpiresAt = new Date(now.getTime() + SESSION_DEFAULT_TTL_MS);
    }

    await this.touchSession(session.id, now).catch(() => undefined);

    return {
      ok: true,
      sessionId: session.id,
      renewExpiresAt,
      context: createAuthenticatedAuthContext({
        userId: session.user.id,
        username: session.user.username,
        displayName: session.user.displayName,
        role: session.user.role as UserRole,
        sessionId: session.id,
      }),
    };
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.client.session.update({
      where: { id: sessionId },
      data: { revokedAt: this.now() },
    });
  }

  async revokeSessionsByUser(userId: string): Promise<number> {
    const result = await this.client.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: this.now() },
    });
    return result.count;
  }

  async touchSession(sessionId: string, lastSeenAt?: Date): Promise<void> {
    await this.client.session.update({
      where: { id: sessionId },
      data: { lastSeenAt: lastSeenAt ?? this.now() },
    });
  }

  async renewSession(sessionId: string, ttlMs: number = SESSION_DEFAULT_TTL_MS): Promise<Date> {
    const expiresAt = new Date(this.now().getTime() + ttlMs);
    await this.client.session.update({
      where: { id: sessionId },
      data: { expiresAt },
    });
    return expiresAt;
  }
}
