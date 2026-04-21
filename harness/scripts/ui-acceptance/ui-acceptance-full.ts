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

export interface UiAcceptanceFullPlan {
  mode: "full";
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

export interface CreateUiAcceptanceFullSummaryInput {
  runId: string;
  outputDir: string;
  projectId: string | null;
  finalUrl: string | null;
  startedAt?: string;
  completedAt?: string;
  pageRuleResult?: UiAcceptancePageRuleResult;
}

export type UiAcceptanceFullSummary = UiAcceptanceSummary & {
  artifacts: UiAcceptanceSummary["artifacts"] & {
    screenshot_points: Record<string, string>;
  };
};

const FULL_SCREENSHOTS = [
  "home",
  "projects",
  "topic-workspace-first",
  "script-workspace-first",
  "topic-workspace-second",
  "script-workspace-second",
] as const;

const FULL_STEPS = [
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
] as const;

export function buildUiAcceptanceFullPlan(): UiAcceptanceFullPlan {
  return {
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
    screenshots: [...FULL_SCREENSHOTS],
    steps: [...FULL_STEPS],
  };
}

function buildRunId(timestamp = new Date()) {
  return `${timestamp.toISOString().replaceAll(":", "-").replaceAll(".", "-")}-full`;
}

function buildScreenshotPoints(outputDir: string) {
  return Object.fromEntries(
    FULL_SCREENSHOTS.map((name) => [
      name,
      resolve(outputDir, "screenshots", `${name}.png`),
    ]),
  ) as Record<string, string>;
}

export function createUiAcceptanceFullSummary(
  input: CreateUiAcceptanceFullSummaryInput,
): UiAcceptanceFullSummary {
  const outputPaths = buildUiAcceptanceOutputPaths({
    runId: input.runId,
    outputRootDir: resolve(input.outputDir, ".."),
  });
  const summary = createUiAcceptanceSummary({
    runId: input.runId,
    mode: "full",
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
    actions: [...FULL_STEPS],
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

export async function runUiAcceptanceFull() {
  const plan = buildUiAcceptanceFullPlan();
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

  const summary = createUiAcceptanceFullSummary({
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
  const result = await runUiAcceptanceFull();
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "ui-acceptance-full-completed",
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
