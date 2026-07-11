export type MigrationIssueSeverity = "warning" | "error";

export interface MigrationIssue {
  code: string;
  severity: MigrationIssueSeverity;
  collection?: string;
  recordId?: string;
  detail?: string;
}

export interface LegacyMigrationInspection {
  sourcePath: string;
  sourceSha256: string;
  sourceVersion: string | null;
  counts: Record<string, number>;
  issues: MigrationIssue[];
  canImport: boolean;
}

export function createInspectionReport(input: Omit<LegacyMigrationInspection, "canImport">): LegacyMigrationInspection {
  return {
    ...input,
    canImport: !input.issues.some((issue) => issue.severity === "error"),
  };
}
