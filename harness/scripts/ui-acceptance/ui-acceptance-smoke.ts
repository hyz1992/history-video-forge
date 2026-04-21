import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { runUiAcceptanceBrowser } from "./browser-runner";
import { buildUiAcceptanceOutputPaths } from "./output-paths";
import { auditUiAcceptancePages } from "./page-auditor";
import type { UiAcceptancePageRuleResult } from "./page-rules";
import {
  createUiAcceptanceSummary,
  type UiAcceptanceSummary,
} from "./report-model";
import { runWithUiAcceptanceServices } from "./service-manager";

export interface UiAcceptanceSmokePlan {
  mode: "smoke";
  browser: "chromium";
  viewport: {
    width: number;
    height: number;
  };
  scriptOutcomeTimeoutMs: number;
  scriptOutcomeSelectors: {
    success: string;
    loading: string;
    failed: string;
    empty: string;
  };
  screenshots: string[];
  steps: string[];
}

export interface CreateUiAcceptanceSmokeSummaryInput {
  runId: string;
  outputDir: string;
  projectId: string | null;
  finalUrl: string | null;
  startedAt?: string;
  completedAt?: string;
  pageRuleResult?: UiAcceptancePageRuleResult;
}

export type UiAcceptanceSmokeSummary = UiAcceptanceSummary & {
  artifacts: UiAcceptanceSummary["artifacts"] & {
    screenshot_points: Record<string, string>;
  };
};

const SMOKE_SCREENSHOTS = [
  "home",
  "projects",
  "topic-workspace",
  "script-workspace",
] as const;

const SMOKE_STEPS = [
  "open-home",
  "goto-projects",
  "create-project",
  "generate-topic",
  "confirm-topic",
  "wait-for-script-route",
  "wait-for-script-content",
] as const;

export function buildUiAcceptanceSmokePlan(): UiAcceptanceSmokePlan {
  return {
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
    screenshots: [...SMOKE_SCREENSHOTS],
    steps: [...SMOKE_STEPS],
  };
}

function buildRunId(timestamp = new Date()) {
  return `${timestamp.toISOString().replaceAll(":", "-").replaceAll(".", "-")}-smoke`;
}

function buildScreenshotPoints(outputDir: string) {
  return Object.fromEntries(
    SMOKE_SCREENSHOTS.map((name) => [
      name,
      resolve(outputDir, "screenshots", `${name}.png`),
    ]),
  ) as Record<string, string>;
}

export function createUiAcceptanceSmokeSummary(
  input: CreateUiAcceptanceSmokeSummaryInput,
): UiAcceptanceSmokeSummary {
  const outputPaths = buildUiAcceptanceOutputPaths({
    runId: input.runId,
    outputRootDir: resolve(input.outputDir, ".."),
  });
  const summary = createUiAcceptanceSummary({
    runId: input.runId,
    mode: "smoke",
    startedAt: input.startedAt ?? input.runId,
    outputPaths,
  });

  return {
    ...summary,
    status: input.pageRuleResult?.status ?? "PASS",
    completed_at: input.completedAt ?? input.startedAt ?? input.runId,
    project: {
      project_id: input.projectId,
    },
    route: {
      initial_url: "/",
      final_url: input.finalUrl,
    },
    actions: [...SMOKE_STEPS],
    checks: {
      chain: [],
      structure: input.pageRuleResult?.structureChecks ?? [],
      delivery: input.pageRuleResult?.deliveryChecks ?? [],
    },
    totals: input.pageRuleResult?.totals ?? summary.totals,
    artifacts: {
      ...summary.artifacts,
      screenshot_points: buildScreenshotPoints(input.outputDir),
    },
  };
}

export async function runUiAcceptanceSmoke() {
  const plan = buildUiAcceptanceSmokePlan();
  const startedAt = new Date().toISOString();
  const runId = buildRunId(new Date(startedAt));
  const outputPaths = buildUiAcceptanceOutputPaths({
    runId,
  });

  mkdirSync(outputPaths.screenshotsDir, { recursive: true });

  const browserResult = await runWithUiAcceptanceServices(async () => {
    return runUiAcceptanceBrowser({
      plan,
      outputDir: outputPaths.rootDir,
      tracePath: outputPaths.tracePath,
      consoleSummaryPath: outputPaths.consoleSummaryPath,
      networkSummaryPath: outputPaths.networkSummaryPath,
      screenshotsDir: outputPaths.screenshotsDir,
    });
  });
  const pageRuleResult = auditUiAcceptancePages(browserResult.pageSnapshots);

  const summary = createUiAcceptanceSmokeSummary({
    runId,
    outputDir: outputPaths.rootDir,
    projectId: browserResult.projectId,
    finalUrl: browserResult.finalUrl,
    startedAt,
    completedAt: new Date().toISOString(),
    pageRuleResult,
  });

  writeFileSync(outputPaths.summaryPath, JSON.stringify(summary, null, 2), "utf8");

  return {
    plan,
    outputPaths,
    summary,
  };
}

async function main() {
  const result = await runUiAcceptanceSmoke();
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "ui-acceptance-smoke-completed",
        run_id: result.summary.run_id,
        output_dir: result.summary.output_dir,
        final_url: result.summary.route.final_url,
      },
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
