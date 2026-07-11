export type MigrationIssueSeverity = "warning" | "error";

export interface MigrationIssue {
  code: string;
  severity: MigrationIssueSeverity;
  collection?: string;
  recordId?: string;
  detail?: string;
}

export interface V1MigrationInspection {
  sourcePath: string;
  sourceSha256: string;
  sourceVersion: string | null;
  counts: Record<string, number>;
  issues: MigrationIssue[];
  canImport: boolean;
}

export function createInspectionReport(input: Omit<V1MigrationInspection, "canImport">): V1MigrationInspection {
  return {
    ...input,
    canImport: !input.issues.some((issue) => issue.severity === "error"),
  };
}
