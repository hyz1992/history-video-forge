import { hash, verify } from "@node-rs/argon2";

export const PASSWORD_HASH_ALGORITHM_ARGON2ID = 2 as const;

export interface PasswordHashOptions {
  memoryCost?: number;
  timeCost?: number;
  parallelism?: number;
}

export const DEFAULT_PASSWORD_HASH_OPTIONS: Required<PasswordHashOptions> = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;

export class PasswordPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordPolicyError";
  }
}

export function validatePasswordPolicy(password: string): void {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordPolicyError(`password_too_short:${MIN_PASSWORD_LENGTH}`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new PasswordPolicyError(`password_too_long:${MAX_PASSWORD_LENGTH}`);
  }
}

export async function hashPassword(
  password: string,
  options: PasswordHashOptions = {},
): Promise<string> {
  validatePasswordPolicy(password);
  const merged: Required<PasswordHashOptions> = { ...DEFAULT_PASSWORD_HASH_OPTIONS, ...options };
  return hash(password, {
    algorithm: PASSWORD_HASH_ALGORITHM_ARGON2ID,
    memoryCost: merged.memoryCost,
    timeCost: merged.timeCost,
    parallelism: merged.parallelism,
  });
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  if (!passwordHash || typeof passwordHash !== "string") return false;
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

export function isMigrationOwnerPlaintextMarker(hashValue: string): boolean {
  return hashValue === "!migration-owner-no-login";
}
