export interface RuntimeDiagnosticCheck {
  code: string;
  level: "info" | "warning" | "error";
}

export interface TopicCandidateDeduction {
  axis: string;
  points_lost: number;
  reason: string;
}

export interface CandidateQualityScorecard {
  quality_rank: number;
  quality_score: number;
  deductions: TopicCandidateDeduction[];
  risk_summary: string;
}

export interface CandidatePreviewTraceEntry {
  candidate_id: string;
  event_identity: string;
  title: string;
  one_line_angle: string;
  must_cover_preview: string[];
  quality_rank?: number;
  quality_score?: number;
  deductions?: TopicCandidateDeduction[];
  risk_summary?: string;
}

export interface CandidatePreviewTrace {
  raw_candidates: CandidatePreviewTraceEntry[];
  selector_pool: CandidatePreviewTraceEntry[];
  ranked_candidates?: CandidatePreviewTraceEntry[];
  final_candidates: CandidatePreviewTraceEntry[];
}

export interface RuntimeDiagnosticsSummary {
  checks: RuntimeDiagnosticCheck[];
  candidate_preview_trace?: CandidatePreviewTrace;
}

export function createRuntimeDiagnosticsSummary(
  checks: RuntimeDiagnosticCheck[],
  details: Omit<RuntimeDiagnosticsSummary, "checks"> = {},
): RuntimeDiagnosticsSummary {
  return {
    checks,
    ...details,
  };
}
