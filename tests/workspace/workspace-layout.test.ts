import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = resolve(fileURLToPath(new URL("../..", import.meta.url)));

describe("workspace layout", () => {
  it("creates the backend, frontend, and shared source directories", () => {
    const requiredPaths = [
      "backend/src",
      "frontend/src",
      "shared/src",
    ].map((relativePath) => resolve(rootDir, relativePath));

    for (const directoryPath of requiredPaths) {
      expect(existsSync(directoryPath)).toBe(true);
    }
  });
});
