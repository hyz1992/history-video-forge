export interface RuntimeDiagnosticCheck {
  code: string;
  level: "info" | "warning" | "error";
}

export interface RuntimeDiagnosticsSummary {
  checks: RuntimeDiagnosticCheck[];
}

export function createRuntimeDiagnosticsSummary(
  checks: RuntimeDiagnosticCheck[],
): RuntimeDiagnosticsSummary {
  return {
    checks,
  };
}
