import { join, resolve } from "node:path";

export interface UiAcceptanceOutputPaths {
  runId: string;
  rootDir: string;
  screenshotsDir: string;
  summaryPath: string;
  tracePath: string;
  consoleSummaryPath: string;
  networkSummaryPath: string;
}

const DEFAULT_UI_ACCEPTANCE_OUTPUT_ROOT = resolve(
  process.cwd(),
  "harness/scripts/runtime/output/ui-acceptance",
);

export interface BuildUiAcceptanceOutputPathsInput {
  runId: string;
  outputRootDir?: string;
}

export function buildUiAcceptanceOutputPaths(
  input: BuildUiAcceptanceOutputPathsInput,
): UiAcceptanceOutputPaths {
  const rootDir = join(input.outputRootDir ?? DEFAULT_UI_ACCEPTANCE_OUTPUT_ROOT, input.runId);

  return {
    runId: input.runId,
    rootDir,
    screenshotsDir: join(rootDir, "screenshots"),
    summaryPath: join(rootDir, "summary.json"),
    tracePath: join(rootDir, "trace.zip"),
    consoleSummaryPath: join(rootDir, "console-summary.json"),
    networkSummaryPath: join(rootDir, "network-summary.json"),
  };
}
