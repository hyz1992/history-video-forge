import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE_NAME,
  buildClearSessionCookieHeader,
  buildSessionCookieHeader,
  isAnonymous,
  parseCookieHeader,
} from "../../../backend/src/auth/auth-middleware.js";
import { createAnonymousAuthContext, createAuthenticatedAuthContext } from "../../../backend/src/auth/auth-context.js";

describe("parseCookieHeader", () => {
  it("returns an empty map when there is no cookie header", () => {
    expect(parseCookieHeader(undefined).size).toBe(0);
    expect(parseCookieHeader("").size).toBe(0);
  });

  it("parses a single cookie", () => {
    const cookies = parseCookieHeader("session=abc123");
    expect(cookies.get("session")).toBe("abc123");
  });

  it("parses multiple cookies separated by semicolons", () => {
    const cookies = parseCookieHeader("theme=dark; session=token-value; lang=zh");
    expect(cookies.get("theme")).toBe("dark");
    expect(cookies.get("session")).toBe("token-value");
    expect(cookies.get("lang")).toBe("zh");
  });

  it("decodes URL-encoded values", () => {
    const cookies = parseCookieHeader("session=" + encodeURIComponent("a+b/c="));
    expect(cookies.get("session")).toBe("a+b/c=");
  });

  it("skips malformed entries without throwing", () => {
    const cookies = parseCookieHeader("malformed; ; session=ok; =nokey");
    expect(cookies.get("session")).toBe("ok");
    expect(cookies.size).toBe(1);
  });

  it("uses 'session' as the cookie name", () => {
    expect(SESSION_COOKIE_NAME).toBe("session");
  });
});

describe("buildSessionCookieHeader", () => {
  it("includes HttpOnly and SameSite=Lax by default", () => {
    const header = buildSessionCookieHeader("token-xyz", {});
    expect(header).toContain("session=token-xyz");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=lax");
    expect(header).not.toContain("Secure");
  });

  it("adds Secure when secure=true", () => {
    const header = buildSessionCookieHeader("token-xyz", { secure: true });
    expect(header).toContain("Secure");
  });

  it("adds Max-Age when provided", () => {
    const header = buildSessionCookieHeader("token-xyz", { maxAgeSeconds: 3600 });
    expect(header).toContain("Max-Age=3600");
  });

  it("builds a cookie-clearing header", () => {
    expect(buildClearSessionCookieHeader()).toContain("Max-Age=0");
    expect(buildClearSessionCookieHeader()).toContain("session=");
  });
});

describe("isAnonymous", () => {
  it("returns true for anonymous context", () => {
    expect(isAnonymous(createAnonymousAuthContext())).toBe(true);
  });

  it("returns false for authenticated context", () => {
    const ctx = createAuthenticatedAuthContext({
      userId: "u1",
      username: "a",
      displayName: "A",
      role: "USER",
      sessionId: "s1",
    });
    expect(isAnonymous(ctx)).toBe(false);
  });
});
