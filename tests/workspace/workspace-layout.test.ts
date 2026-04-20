import { existsSync, readFileSync } from "node:fs";
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

  it("provides the minimal local dev shell files and scripts", () => {
    const requiredPaths = [
      "frontend/index.html",
      "frontend/vite.config.ts",
      ".vscode/launch.json",
      "kill_ports.py",
    ].map((relativePath) => resolve(rootDir, relativePath));

    for (const filePath of requiredPaths) {
      expect(existsSync(filePath)).toBe(true);
    }

    const packageJson = JSON.parse(
      readFileSync(resolve(rootDir, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts).toMatchObject({
      "dev:backend": expect.any(String),
      "dev:frontend": expect.any(String),
    });
  });
});
