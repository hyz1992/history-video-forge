import type { UiAcceptanceOutputPaths } from "./output-paths";

export type UiAcceptanceMode = "smoke" | "full";
export type UiAcceptanceStatus = "PASS" | "WARN" | "FAIL";

export interface UiAcceptanceCheck {
  code: string;
  message: string;
  status: UiAcceptanceStatus;
}

export interface UiAcceptanceCheckTotals {
  pass: number;
  warn: number;
  fail: number;
}

export interface UiAcceptanceCheckSummary {
  status: UiAcceptanceStatus;
  totals: UiAcceptanceCheckTotals;
}

export interface CreateUiAcceptanceSummaryInput {
  runId: string;
  mode: UiAcceptanceMode;
  startedAt: string;
  outputPaths: UiAcceptanceOutputPaths;
}

export interface UiAcceptanceSummary {
  schema_version: 1;
  run_id: string;
  mode: UiAcceptanceMode;
  status: UiAcceptanceStatus;
  started_at: string;
  completed_at: string | null;
  output_dir: string;
  artifacts: {
    summary_json: string;
    screenshots_dir: string;
    trace_zip: string;
    console_summary_json: string;
    network_summary_json: string;
  };
  project: {
    project_id: string | null;
  };
  route: {
    initial_url: string;
    final_url: string | null;
  };
  actions: string[];
  checks: {
    chain: UiAcceptanceCheck[];
    structure: UiAcceptanceCheck[];
    delivery: UiAcceptanceCheck[];
  };
  totals: UiAcceptanceCheckTotals;
}

export function summarizeUiAcceptanceChecks(
  checks: UiAcceptanceCheck[],
): UiAcceptanceCheckSummary {
  const totals = checks.reduce<UiAcceptanceCheckTotals>(
    (result, check) => {
      if (check.status === "PASS") {
        result.pass += 1;
      } else if (check.status === "WARN") {
        result.warn += 1;
      } else {
        result.fail += 1;
      }

      return result;
    },
    {
      pass: 0,
      warn: 0,
      fail: 0,
    },
  );

  if (totals.fail > 0) {
    return {
      status: "FAIL",
      totals,
    };
  }

  if (totals.warn > 0) {
    return {
      status: "WARN",
      totals,
    };
  }

  return {
    status: "PASS",
    totals,
  };
}

export function createUiAcceptanceSummary(
  input: CreateUiAcceptanceSummaryInput,
): UiAcceptanceSummary {
  const summary = summarizeUiAcceptanceChecks([]);

  return {
    schema_version: 1,
    run_id: input.runId,
    mode: input.mode,
    status: summary.status,
    started_at: input.startedAt,
    completed_at: null,
    output_dir: input.outputPaths.rootDir,
    artifacts: {
      summary_json: input.outputPaths.summaryPath,
      screenshots_dir: input.outputPaths.screenshotsDir,
      trace_zip: input.outputPaths.tracePath,
      console_summary_json: input.outputPaths.consoleSummaryPath,
      network_summary_json: input.outputPaths.networkSummaryPath,
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
    totals: summary.totals,
  };
}
