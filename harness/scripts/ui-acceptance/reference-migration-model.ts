export type ReferenceMigrationCheckStatus = "PASS" | "WARN" | "FAIL" | "SKIPPED";

export interface ReferenceMigrationCheck {
  code: string;
  status: ReferenceMigrationCheckStatus;
  message: string;
}

export interface ReferenceMigrationScreenshot {
  viewport: string;
  reference: string;
  target: string;
}

export interface ReferenceMigrationContractResult {
  contract_id: string;
  title: string;
  status: ReferenceMigrationCheckStatus;
  checks: ReferenceMigrationCheck[];
  screenshots: ReferenceMigrationScreenshot[];
  manual_review_items: string[];
}

export interface ReferenceMigrationRunSummary {
  run_id: string;
  status: ReferenceMigrationCheckStatus;
  generated_at: string;
  contracts: ReferenceMigrationContractResult[];
  totals: {
    pass: number;
    warn: number;
    fail: number;
    skipped: number;
  };
}

export function summarizeReferenceMigrationChecks(
  checks: ReferenceMigrationCheck[],
): { status: ReferenceMigrationCheckStatus; totals: ReferenceMigrationRunSummary["totals"] } {
  const totals = {
    pass: checks.filter((c) => c.status === "PASS").length,
    warn: checks.filter((c) => c.status === "WARN").length,
    fail: checks.filter((c) => c.status === "FAIL").length,
    skipped: checks.filter((c) => c.status === "SKIPPED").length,
  };

  let status: ReferenceMigrationCheckStatus;
  if (totals.fail > 0) {
    status = "FAIL";
  } else if (totals.warn > 0) {
    status = "WARN";
  } else if (totals.pass === 0 && totals.skipped > 0) {
    status = "SKIPPED";
  } else {
    status = "PASS";
  }

  return { status, totals };
}

export function createReferenceMigrationSummaryMarkdown(
  summary: ReferenceMigrationRunSummary,
): string {
  const lines: string[] = [];

  lines.push("# UI Reference Migration Report");
  lines.push("");
  lines.push(`**Run ID:** ${summary.run_id}`);
  lines.push(`**Generated:** ${summary.generated_at}`);
  lines.push(`**Status:** ${summary.status}`);
  lines.push("");

  lines.push("## 自动检查结果");
  lines.push("");
  lines.push(`| 状态 | 数量 |`);
  lines.push(`|------|------|`);
  lines.push(`| PASS | ${summary.totals.pass} |`);
  lines.push(`| WARN | ${summary.totals.warn} |`);
  lines.push(`| FAIL | ${summary.totals.fail} |`);
  lines.push(`| SKIPPED | ${summary.totals.skipped} |`);
  lines.push("");

  for (const contract of summary.contracts) {
    lines.push(`### ${contract.contract_id}: ${contract.title}`);
    lines.push("");
    lines.push(`**状态:** ${contract.status}`);
    lines.push("");

    if (contract.checks.length > 0) {
      lines.push("| Code | Status | Message |");
      lines.push("|------|--------|---------|");
      for (const check of contract.checks) {
        lines.push(`| ${check.code} | ${check.status} | ${check.message} |`);
      }
      lines.push("");
    }

    if (contract.screenshots.length > 0) {
      lines.push("**截图产物:**");
      lines.push("");
      for (const shot of contract.screenshots) {
        lines.push(`- ${shot.viewport}: reference=\`${shot.reference}\`, target=\`${shot.target}\``);
      }
      lines.push("");
    }

    if (contract.manual_review_items.length > 0) {
      lines.push("**需人工审查:**");
      lines.push("");
      for (const item of contract.manual_review_items) {
        lines.push(`- [ ] ${item}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
