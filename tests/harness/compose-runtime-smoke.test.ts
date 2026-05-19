import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runComposeRuntimeSmoke } from "../../harness/scripts/runtime/compose-runtime-smoke";

describe("compose runtime smoke harness", () => {
  it("runs assets to compose and clears stale compose after an assets refresh", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-compose-runtime-smoke-"));

    const result = await runComposeRuntimeSmoke({ outputDir });

    expect(result.status.stage).toBe("assets-to-compose");
    expect(result.status.status).toBe("sample-ready");
    expect(result.status.activeComposeAfterGenerate).toBeTruthy();
    expect(result.status.activeComposeAfterAssetsRefresh).toBeNull();

    for (const filename of [
      "assets-snapshot.json",
      "compose-snapshot.json",
      "assets-refresh-snapshot.json",
      "status.json",
      "trace.md",
    ]) {
      expect(existsSync(join(outputDir, filename))).toBe(true);
    }

    const composeSnapshot = JSON.parse(
      readFileSync(join(outputDir, "compose-snapshot.json"), "utf8"),
    ) as {
      active_compose: { compose_record_id: string } | null;
      trace_summary: { latest_compose_run: { phase: string } | null };
    };
    expect(composeSnapshot.active_compose?.compose_record_id).toBe(
      result.status.activeComposeAfterGenerate,
    );
    expect(composeSnapshot.trace_summary.latest_compose_run?.phase).toBe("compose");

    const refreshSnapshot = JSON.parse(
      readFileSync(join(outputDir, "assets-refresh-snapshot.json"), "utf8"),
    ) as {
      active_compose: unknown;
      trace_summary: { latest_compose_run: unknown };
    };
    expect(refreshSnapshot.active_compose).toBeNull();
    expect(refreshSnapshot.trace_summary.latest_compose_run).toBeNull();
  });

  it("registers the smoke command in package.json", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["harness:compose-runtime-smoke"]).toBe(
      "tsx harness/scripts/runtime/compose-runtime-smoke.ts",
    );
  });
});
