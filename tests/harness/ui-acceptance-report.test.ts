import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createUiAcceptanceSummary,
  summarizeUiAcceptanceChecks,
  type UiAcceptanceCheck,
} from "../../harness/scripts/ui-acceptance/report-model";
import { buildUiAcceptanceOutputPaths } from "../../harness/scripts/ui-acceptance/output-paths";

describe("ui acceptance report model", () => {
  it("plans output paths under the run id directory", () => {
    const outputPaths = buildUiAcceptanceOutputPaths({
      runId: "2026-04-21T10-30-00-000Z-smoke",
      outputRootDir: join(tmpdir(), "svf2-ui-acceptance"),
    });

    expect(outputPaths).toEqual({
      runId: "2026-04-21T10-30-00-000Z-smoke",
      rootDir: join(tmpdir(), "svf2-ui-acceptance", "2026-04-21T10-30-00-000Z-smoke"),
      screenshotsDir: join(
        tmpdir(),
        "svf2-ui-acceptance",
        "2026-04-21T10-30-00-000Z-smoke",
        "screenshots",
      ),
      summaryPath: join(
        tmpdir(),
        "svf2-ui-acceptance",
        "2026-04-21T10-30-00-000Z-smoke",
        "summary.json",
      ),
      tracePath: join(
        tmpdir(),
        "svf2-ui-acceptance",
        "2026-04-21T10-30-00-000Z-smoke",
        "trace.zip",
      ),
      consoleSummaryPath: join(
        tmpdir(),
        "svf2-ui-acceptance",
        "2026-04-21T10-30-00-000Z-smoke",
        "console-summary.json",
      ),
      networkSummaryPath: join(
        tmpdir(),
        "svf2-ui-acceptance",
        "2026-04-21T10-30-00-000Z-smoke",
        "network-summary.json",
      ),
    });
  });

  it("creates a fixed summary skeleton for summary.json", () => {
    const outputPaths = buildUiAcceptanceOutputPaths({
      runId: "2026-04-21T10-30-00-000Z-smoke",
      outputRootDir: join(tmpdir(), "svf2-ui-acceptance"),
    });

    expect(
      createUiAcceptanceSummary({
        runId: outputPaths.runId,
        mode: "smoke",
        startedAt: "2026-04-21T10:30:00.000Z",
        outputPaths,
      }),
    ).toEqual({
      schema_version: 1,
      run_id: "2026-04-21T10-30-00-000Z-smoke",
      mode: "smoke",
      status: "PASS",
      started_at: "2026-04-21T10:30:00.000Z",
      completed_at: null,
      output_dir: outputPaths.rootDir,
      artifacts: {
        summary_json: outputPaths.summaryPath,
        screenshots_dir: outputPaths.screenshotsDir,
        trace_zip: outputPaths.tracePath,
        console_summary_json: outputPaths.consoleSummaryPath,
        network_summary_json: outputPaths.networkSummaryPath,
      },
      project: {
        project_id: null,
      },
      route: {
        initial_url: "/",
        final_url: null,
      },
      actions: [],
      checks: {
        chain: [],
        structure: [],
        delivery: [],
      },
      totals: {
        pass: 0,
        warn: 0,
        fail: 0,
      },
    });
  });

  it("uses fail-over-warn-over-pass precedence when summarizing checks", () => {
    const checks: UiAcceptanceCheck[] = [
      { code: "home-hero", message: "home hero exists", status: "PASS" },
      { code: "projects-draft-zone", message: "draft zone is weak", status: "WARN" },
      { code: "script-main-content", message: "script content missing", status: "FAIL" },
    ];

    expect(summarizeUiAcceptanceChecks(checks)).toEqual({
      status: "FAIL",
      totals: {
        pass: 1,
        warn: 1,
        fail: 1,
      },
    });
  });
});
