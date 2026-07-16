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
  consistency_status?: "pass" | "risk";
  primary_consistency_issue?:
    | "none"
    | "actor_role_mismatch"
    | "action_event_mismatch"
    | "cause_outcome_mismatch"
    | "scope_boundary_mismatch"
    | "language_contamination"
    | "overclaim_or_ambiguity";
  consistency_note?: string;
}

export interface CandidatePreviewTrace {
  raw_candidates: CandidatePreviewTraceEntry[];
  selector_pool: CandidatePreviewTraceEntry[];
  reviewed_candidates: CandidatePreviewTraceEntry[];
  ranked_candidates?: CandidatePreviewTraceEntry[];
  final_candidates: CandidatePreviewTraceEntry[];
}

export interface TopicReviewRejectedCandidate {
  candidate_id: string;
  consistency_issue: Exclude<
    NonNullable<CandidatePreviewTraceEntry["primary_consistency_issue"]>,
    "none"
  >;
  note: string;
}

export interface TopicReviewTrace {
  reviewed_candidate_ids: string[];
  accepted_candidate_ids: string[];
  rejected_candidates: TopicReviewRejectedCandidate[];
  refill_attempts: number;
  initial_candidate_count: number;
  initial_review_pass_count: number;
  refill_triggered: boolean;
  refill_candidate_count: number;
  refill_review_pass_count: number;
  final_candidate_count: number;
  zero_eligible_candidate: boolean;
}

export interface RuntimeDiagnosticsSummary {
  checks: RuntimeDiagnosticCheck[];
  candidate_preview_trace?: CandidatePreviewTrace;
  review_trace?: TopicReviewTrace;
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
