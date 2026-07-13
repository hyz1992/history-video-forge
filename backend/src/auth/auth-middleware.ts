import type { IncomingMessage } from "node:http";
import {
  type AnonymousAuthContext,
  type AuthContext,
  type AuthFailureReason,
  createAnonymousAuthContext,
} from "./auth-context.js";
import type { PrismaSessionStore } from "./session-store.js";

export const SESSION_COOKIE_NAME = "session";

export interface CookieAuthSource {
  token: string | undefined;
}

export function parseCookieHeader(cookieHeader: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!cookieHeader) return cookies;

  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const name = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!name) continue;
    cookies.set(name, decodeURIComponent(value));
  }
  return cookies;
}

export function extractSessionTokenFromRequest(request: IncomingMessage): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return undefined;
  const cookies = parseCookieHeader(cookieHeader);
  const token = cookies.get(SESSION_COOKIE_NAME);
  return token && token.length > 0 ? token : undefined;
}

export function extractSessionTokenFromSource(source: CookieAuthSource | undefined): string | undefined {
  if (!source) return undefined;
  return source.token && source.token.length > 0 ? source.token : undefined;
}

export interface AuthMiddlewareOptions {
  sessionStore: PrismaSessionStore;
}

export interface AuthMiddlewareResult {
  auth: AuthContext;
}

export async function resolveAuthFromToken(
  sessionStore: PrismaSessionStore,
  token: string | undefined,
): Promise<{ auth: AuthContext; reason?: AuthFailureReason }> {
  if (!token) {
    return { auth: createAnonymousAuthContext("no_session_token") };
  }
  const result = await sessionStore.resolveSession(token);
  if (result.ok && result.context) {
    return { auth: result.context };
  }
  return { auth: createAnonymousAuthContext(result.reason), reason: result.reason };
}

export async function applyAuthMiddleware(
  options: AuthMiddlewareOptions,
  request: IncomingMessage,
): Promise<AuthMiddlewareResult> {
  const token = extractSessionTokenFromRequest(request);
  const { auth } = await resolveAuthFromToken(options.sessionStore, token);
  return { auth };
}

export function buildSessionCookieHeader(token: string, options: {
  secure?: boolean;
  maxAgeSeconds?: number;
  sameSite?: "strict" | "lax" | "none";
}): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${options.sameSite ?? "lax"}`,
  ];
  if (options.secure) parts.push("Secure");
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${options.maxAgeSeconds}`);
  return parts.join("; ");
}

export function buildClearSessionCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=lax; Max-Age=0`;
}

export function isAnonymous(auth: AuthContext): auth is AnonymousAuthContext {
  return auth.anonymous;
}
