import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildUiAcceptanceFullPlan,
  createUiAcceptanceFullSummary,
} from "../../harness/scripts/ui-acceptance/ui-acceptance-full";
import {
  formatUiAcceptanceReport,
  readLatestUiAcceptanceSummary,
} from "../../harness/scripts/ui-acceptance/ui-acceptance-report";

describe("ui acceptance full", () => {
  it("defines the full run plan with regen_once and topic return steps", () => {
    const plan = buildUiAcceptanceFullPlan();

    expect(plan).toEqual({
      mode: "full",
      browser: "chromium",
      viewport: {
        width: 1440,
        height: 960,
      },
      scriptOutcomeTimeoutMs: 180000,
      scriptOutcomeSelectors: {
        success: "[data-testid='script-text']",
        loading: "[data-testid='script-running-state']",
        failed: "[data-testid='script-failed-state']",
        empty: "[data-testid='script-empty']",
      },
      screenshots: [
        "home",
        "projects",
        "topic-workspace-first",
        "script-workspace-first",
        "topic-workspace-second",
        "script-workspace-second",
      ],
      steps: [
        "open-home",
        "goto-projects",
        "create-project",
        "generate-topic",
        "confirm-topic-first",
        "wait-for-script-route-first",
        "wait-for-script-content-first",
        "run-regen-once",
        "wait-for-regen-result",
        "return-topic",
        "confirm-return-topic",
        "confirm-topic-second",
        "wait-for-script-route-second",
        "wait-for-script-content-second",
      ],
    });
  });

  it("creates a full summary that records second-pass screenshots and final route", () => {
    const outputDir = join(tmpdir(), "svf2-ui-acceptance-full");

    expect(
      createUiAcceptanceFullSummary({
        runId: "2026-04-21T12-10-00-000Z-full",
        outputDir,
        projectId: "project-full-1",
        finalUrl: "/projects/project-full-1/script",
      }),
    ).toMatchObject({
      run_id: "2026-04-21T12-10-00-000Z-full",
      mode: "full",
      project: {
        project_id: "project-full-1",
      },
      route: {
        final_url: "/projects/project-full-1/script",
      },
      actions: [
        "open-home",
        "goto-projects",
        "create-project",
        "generate-topic",
        "confirm-topic-first",
        "wait-for-script-route-first",
        "wait-for-script-content-first",
        "run-regen-once",
        "wait-for-regen-result",
        "return-topic",
        "confirm-return-topic",
        "confirm-topic-second",
        "wait-for-script-route-second",
        "wait-for-script-content-second",
      ],
      artifacts: {
        screenshot_points: {
          "script-workspace-second": join(outputDir, "screenshots", "script-workspace-second.png"),
        },
      },
    });
  });

  it("reads the latest summary and formats a readable report", () => {
    const outputRootDir = mkdtempSync(join(tmpdir(), "svf2-ui-acceptance-report-"));
    const firstRunDir = join(outputRootDir, "2026-04-21T11-00-00-000Z-smoke");
    const latestRunDir = join(outputRootDir, "2026-04-21T12-00-00-000Z-full");
    mkdirSync(firstRunDir, { recursive: true });
    mkdirSync(latestRunDir, { recursive: true });

    writeFileSync(
      join(firstRunDir, "summary.json"),
      JSON.stringify({
        run_id: "2026-04-21T11-00-00-000Z-smoke",
        mode: "smoke",
        status: "FAIL",
      }),
      "utf8",
    );
    writeFileSync(
      join(latestRunDir, "summary.json"),
      JSON.stringify({
        run_id: "2026-04-21T12-00-00-000Z-full",
        mode: "full",
        status: "FAIL",
        route: {
          final_url: "/projects/project-full-1/script",
        },
        project: {
          project_id: "project-full-1",
        },
        totals: {
          pass: 20,
          warn: 0,
          fail: 1,
        },
        checks: {
          chain: [],
          structure: [
            {
              code: "topic-history-section",
              status: "FAIL",
              message: "topic 工作区必须展示候选历史区",
            },
            {
              code: "topic-history-section",
              status: "FAIL",
              message: "topic 工作区必须展示候选历史区",
            },
          ],
          delivery: [],
        },
      }),
      "utf8",
    );

    const summary = readLatestUiAcceptanceSummary(outputRootDir);
    expect(summary.run_id).toBe("2026-04-21T12-00-00-000Z-full");

    const report = formatUiAcceptanceReport(summary);
    expect(report).toContain("Run: 2026-04-21T12-00-00-000Z-full");
    expect(report).toContain("Mode: full");
    expect(report).toContain("Status: FAIL");
    expect(report).toContain("Final Route: /projects/project-full-1/script");
    expect(report).toContain("topic-history-section");
    expect(report.match(/topic-history-section/g)).toHaveLength(1);
  });
});
