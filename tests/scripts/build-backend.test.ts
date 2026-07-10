import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { runBackendBuild } from "../../scripts/build-backend.mjs";

describe("backend build", () => {
  it("removes stale dist and propagates TypeScript compilation failures", () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-build-"));
    const distDir = join(root, "backend", "dist");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, "stale.js"), "stale", "utf8");
    const exec = vi.fn(() => {
      throw new Error("tsc failed");
    });

    expect(() => runBackendBuild({ distDir, exec })).toThrow("tsc failed");
    expect(exec).toHaveBeenCalledOnce();
    expect(existsSync(join(distDir, "stale.js"))).toBe(false);
  });
});
