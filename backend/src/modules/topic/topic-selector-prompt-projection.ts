export interface TopicSelectorPromptProjectionInput {
  candidate_id: string;
  event_identity: string;
  normalized_event_identity: string;
  title: string;
  one_line_angle: string;
  family_label: string;
  scope_label: string;
  core_conflict: string;
  strong_scene: string;
  must_cover_preview: string[];
  risk_hints: string[];
  viral_rubric: unknown;
  fatigue_score: number;
  recently_seen: boolean;
}

export function projectTopicSelectorPool(
  candidates: readonly TopicSelectorPromptProjectionInput[],
) {
  return candidates.map((candidate) => ({
    candidate_id: candidate.candidate_id,
    event_identity: candidate.event_identity,
    title: candidate.title,
    one_line_angle: candidate.one_line_angle,
    family_label: candidate.family_label,
    scope_label: candidate.scope_label,
    core_conflict: candidate.core_conflict,
    strong_scene: candidate.strong_scene,
    must_cover_preview: candidate.must_cover_preview,
    risk_hints: candidate.risk_hints,
    fatigue_score: candidate.fatigue_score,
  }));
}
