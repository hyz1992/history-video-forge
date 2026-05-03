import {
  TOPIC_CANDIDATE_LIBRARY_JSON_SCHEMA_VERSION,
  type TopicCandidateLibraryJsonCandidate,
  type TopicCandidateLibraryJsonDocument,
} from "./topic-candidate-library-json.types.js";

export function serializeTopicCandidateLibraryJsonDocument(
  document: TopicCandidateLibraryJsonDocument,
) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function parseTopicCandidateLibraryJsonDocument(
  content: string,
): TopicCandidateLibraryJsonDocument {
  const parsed = JSON.parse(content) as Partial<TopicCandidateLibraryJsonDocument>;

  if (
    parsed.schema_version !== TOPIC_CANDIDATE_LIBRARY_JSON_SCHEMA_VERSION ||
    !Array.isArray(parsed.candidates) ||
    typeof parsed.seed_family !== "string" ||
    typeof parsed.seed_profile !== "string" ||
    typeof parsed.seed_family_slug !== "string" ||
    typeof parsed.seed_profile_slug !== "string" ||
    typeof parsed.updated_at !== "string"
  ) {
    throw new Error("topic_candidate_library_json_invalid_document");
  }

  return {
    schema_version: parsed.schema_version,
    seed_family: parsed.seed_family,
    seed_profile: parsed.seed_profile,
    seed_family_slug: parsed.seed_family_slug,
    seed_profile_slug: parsed.seed_profile_slug,
    updated_at: parsed.updated_at,
    candidates: parsed.candidates.map(parseCandidate),
  };
}

function parseCandidate(value: unknown): TopicCandidateLibraryJsonCandidate {
  if (!value || typeof value !== "object") {
    throw new Error("topic_candidate_library_json_invalid_candidate");
  }

  const candidate = value as Partial<TopicCandidateLibraryJsonCandidate>;

  if (
    typeof candidate.candidate_id !== "string" ||
    typeof candidate.event_identity !== "string" ||
    typeof candidate.title !== "string" ||
    typeof candidate.one_line_angle !== "string" ||
    typeof candidate.family_label !== "string" ||
    typeof candidate.scope_label !== "string" ||
    typeof candidate.status !== "string" ||
    typeof candidate.source_project_id !== "string" ||
    typeof candidate.source_topic_run_id !== "string" ||
    typeof candidate.source_seed_family !== "string" ||
    typeof candidate.source_seed_profile !== "string" ||
    typeof candidate.first_generated_at !== "string" ||
    typeof candidate.times_selected !== "number" ||
    typeof candidate.times_seen_in_pool !== "number" ||
    typeof candidate.notes !== "string"
  ) {
    throw new Error("topic_candidate_library_json_invalid_candidate");
  }

  return {
    candidate_id: candidate.candidate_id,
    event_identity: candidate.event_identity,
    title: candidate.title,
    one_line_angle: candidate.one_line_angle,
    family_label: candidate.family_label,
    scope_label: candidate.scope_label,
    status: candidate.status,
    source_project_id: candidate.source_project_id,
    source_topic_run_id: candidate.source_topic_run_id,
    source_seed_family: candidate.source_seed_family,
    source_seed_profile: candidate.source_seed_profile,
    first_generated_at: candidate.first_generated_at,
    last_selected_at: candidate.last_selected_at,
    times_selected: candidate.times_selected,
    times_seen_in_pool: candidate.times_seen_in_pool,
    notes: candidate.notes,
  };
}
