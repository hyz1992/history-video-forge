import { describe, expect, it } from "vitest";
import {
  DEFAULT_PASSWORD_HASH_OPTIONS,
  MIN_PASSWORD_LENGTH,
  PasswordPolicyError,
  hashPassword,
  isMigrationOwnerPlaintextMarker,
  validatePasswordPolicy,
  verifyPassword,
} from "../../../backend/src/auth/password-hash.js";

describe("password hash (argon2id)", () => {
  it("hashes a password into an argon2id-encoded string and verifies it", async () => {
    const password = "correct horse battery staple";
    const hashed = await hashPassword(password);

    expect(typeof hashed).toBe("string");
    expect(hashed.startsWith("$argon2id$")).toBe(true);

    await expect(verifyPassword(hashed, password)).resolves.toBe(true);
  });

  it("returns false for an incorrect password without throwing", async () => {
    const hashed = await hashPassword("a-strong-password-1234");
    await expect(verifyPassword(hashed, "wrong-password-1234")).resolves.toBe(false);
  });

  it("produces different hashes for the same password (random salt)", async () => {
    const password = "another-strong-pw-1234";
    const a = await hashPassword(password);
    const b = await hashPassword(password);
    expect(a).not.toBe(b);
    await expect(verifyPassword(a, password)).resolves.toBe(true);
    await expect(verifyPassword(b, password)).resolves.toBe(true);
  });

  it("uses argon2id OWASP-recommended defaults", () => {
    expect(DEFAULT_PASSWORD_HASH_OPTIONS.algorithm ?? 2).toBe(2);
    expect(DEFAULT_PASSWORD_HASH_OPTIONS.memoryCost).toBe(19456);
    expect(DEFAULT_PASSWORD_HASH_OPTIONS.timeCost).toBe(2);
    expect(DEFAULT_PASSWORD_HASH_OPTIONS.parallelism).toBe(1);
  });

  it("rejects passwords shorter than the minimum length", async () => {
    expect(() => validatePasswordPolicy("short")).toThrow(PasswordPolicyError);
    expect(() => validatePasswordPolicy("short")).toThrow(/password_too_short/u);
    await expect(hashPassword("short")).rejects.toThrow(PasswordPolicyError);
  });

  it("enforces MIN_PASSWORD_LENGTH of 12 characters", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
  });

  it("rejects empty input and returns false on verify of non-hash", async () => {
    await expect(verifyPassword("", "anything")).resolves.toBe(false);
    await expect(verifyPassword("not-a-real-hash", "anything")).resolves.toBe(false);
  });

  it("detects the migration-owner no-login marker", () => {
    expect(isMigrationOwnerPlaintextMarker("!migration-owner-no-login")).toBe(true);
    expect(isMigrationOwnerPlaintextMarker("$argon2id$...")).toBe(false);
  });

  it("never produces MD5 or SHA1-style hashes", async () => {
    const hashed = await hashPassword("a-secure-password-99");
    expect(hashed.startsWith("$md5$")).toBe(false);
    expect(hashed.startsWith("$sha1$")).toBe(false);
    expect(hashed.length).toBeGreaterThan(40);
  });
});
