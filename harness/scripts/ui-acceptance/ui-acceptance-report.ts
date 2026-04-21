import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

interface MinimalUiAcceptanceCheck {
  code: string;
  status: string;
  message: string;
}

export interface UiAcceptanceReportSummary {
  run_id: string;
  mode: string;
  status: string;
  route?: {
    final_url?: string | null;
  };
  project?: {
    project_id?: string | null;
  };
  totals?: {
    pass: number;
    warn: number;
    fail: number;
  };
  checks?: {
    chain?: MinimalUiAcceptanceCheck[];
    structure?: MinimalUiAcceptanceCheck[];
    delivery?: MinimalUiAcceptanceCheck[];
  };
}

const DEFAULT_OUTPUT_ROOT_DIR = resolve(
  process.cwd(),
  "harness/scripts/runtime/output/ui-acceptance",
);

export function readLatestUiAcceptanceSummary(
  outputRootDir = DEFAULT_OUTPUT_ROOT_DIR,
): UiAcceptanceReportSummary {
  const candidates = readdirSync(outputRootDir, {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      summaryPath: resolve(outputRootDir, entry.name, "summary.json"),
    }))
    .filter((entry) => existsSync(entry.summaryPath))
    .sort((a, b) => b.name.localeCompare(a.name));

  const latest = candidates[0];
  if (!latest) {
    throw new Error("ui_acceptance_summary_missing");
  }

  return JSON.parse(
    readFileSync(latest.summaryPath, "utf8"),
  ) as UiAcceptanceReportSummary;
}

export function formatUiAcceptanceReport(summary: UiAcceptanceReportSummary) {
  const checks = [
    ...(summary.checks?.chain ?? []),
    ...(summary.checks?.structure ?? []),
    ...(summary.checks?.delivery ?? []),
  ];
  const failedChecks = checks.filter((check) => check.status === "FAIL");
  const uniqueFailedChecks = failedChecks.filter((check, index, array) => {
    return (
      array.findIndex(
        (candidate) =>
          candidate.code === check.code && candidate.message === check.message,
      ) === index
    );
  });

  return [
    `Run: ${summary.run_id}`,
    `Mode: ${summary.mode}`,
    `Status: ${summary.status}`,
    `Project: ${summary.project?.project_id ?? "n/a"}`,
    `Final Route: ${summary.route?.final_url ?? "n/a"}`,
    `Totals: pass=${summary.totals?.pass ?? 0}, warn=${summary.totals?.warn ?? 0}, fail=${summary.totals?.fail ?? 0}`,
    "",
    "Failed Checks:",
    ...(uniqueFailedChecks.length > 0
      ? uniqueFailedChecks.map((check) => `- ${check.code}: ${check.message}`)
      : ["- none"]),
  ].join("\n");
}

export function runUiAcceptanceReport(outputRootDir = DEFAULT_OUTPUT_ROOT_DIR) {
  const summary = readLatestUiAcceptanceSummary(outputRootDir);
  return {
    summary,
    report: formatUiAcceptanceReport(summary),
  };
}

async function main() {
  const result = runUiAcceptanceReport();
  process.stdout.write(`${result.report}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
