import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildUiAcceptanceSmokePlan,
  createUiAcceptanceSmokeSummary,
} from "../../harness/scripts/ui-acceptance/ui-acceptance-smoke";
import { uiAcceptanceSelectors } from "../../harness/scripts/ui-acceptance/dom-selectors";

describe("ui acceptance smoke", () => {
  it("defines the smoke run plan with fixed route steps and screenshot points", () => {
    const plan = buildUiAcceptanceSmokePlan();

    expect(plan).toEqual({
      mode: "smoke",
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
        "topic-workspace",
        "script-workspace",
      ],
      steps: [
        "open-home",
        "goto-projects",
        "create-project",
        "generate-topic",
        "confirm-topic",
        "wait-for-script-route",
        "wait-for-script-content",
      ],
    });
  });

  it("exposes fixed selectors for the single smoke mainline", () => {
    expect(uiAcceptanceSelectors).toEqual({
      homePrimaryCta: "[data-testid='home-primary-cta']",
      createProject: "[data-testid='create-project']",
      generateTopic: "[data-testid='system-generate']",
      candidateDrawer: "[data-testid='candidate-drawer']",
      confirmCandidate: "[data-testid='confirm-candidate']",
      scriptText: "[data-testid='script-text']",
      scriptTraceEntry: "[data-testid='script-trace-entry']",
    });
  });

  it("creates a smoke summary that records screenshot outputs and final route", () => {
    const outputDir = resolve("D:/tmp/ui-acceptance/2026-04-21T11-00-00-000Z-smoke");

    expect(
      createUiAcceptanceSmokeSummary({
        runId: "2026-04-21T11-00-00-000Z-smoke",
        outputDir,
        projectId: "project-123",
        finalUrl: "/projects/project-123/script",
      }),
    ).toMatchObject({
      run_id: "2026-04-21T11-00-00-000Z-smoke",
      mode: "smoke",
      project: {
        project_id: "project-123",
      },
      route: {
        initial_url: "/",
        final_url: "/projects/project-123/script",
      },
      actions: [
        "open-home",
        "goto-projects",
        "create-project",
        "generate-topic",
        "confirm-topic",
        "wait-for-script-route",
        "wait-for-script-content",
      ],
      artifacts: {
        screenshot_points: {
          home: join(outputDir, "screenshots", "home.png"),
          projects: join(outputDir, "screenshots", "projects.png"),
          "topic-workspace": join(outputDir, "screenshots", "topic-workspace.png"),
          "script-workspace": join(outputDir, "screenshots", "script-workspace.png"),
        },
      },
    });
  });

  it("registers Playwright config and the smoke command in package.json", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.scripts).toMatchObject({
      "harness:ui-acceptance:smoke": "tsx harness/scripts/ui-acceptance/ui-acceptance-smoke.ts",
    });
    expect(packageJson.devDependencies).toMatchObject({
      "@playwright/test": expect.any(String),
    });

    const playwrightConfig = readFileSync(
      join(process.cwd(), "playwright.config.ts"),
      "utf8",
    );
    expect(playwrightConfig).toContain("chromium");
    expect(playwrightConfig).toContain("viewport");
  });
});
