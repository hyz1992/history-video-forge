import type { TopicCandidateLibraryStatus } from "./topic-candidate-library.types.js";

export const TOPIC_CANDIDATE_LIBRARY_JSON_SCHEMA_VERSION = 1;

export interface TopicCandidateLibraryJsonCandidate {
  candidate_id: string;
  event_identity: string;
  title: string;
  one_line_angle: string;
  family_label: string;
  scope_label: string;
  status: TopicCandidateLibraryStatus;
  source_project_id: string;
  source_topic_run_id: string;
  source_seed_family: string;
  source_seed_profile: string;
  first_generated_at: string;
  last_selected_at?: string;
  times_selected: number;
  times_seen_in_pool: number;
  notes: string;
}

export interface TopicCandidateLibraryJsonDocument {
  schema_version: typeof TOPIC_CANDIDATE_LIBRARY_JSON_SCHEMA_VERSION;
  seed_family: string;
  seed_profile: string;
  seed_family_slug: string;
  seed_profile_slug: string;
  updated_at: string;
  candidates: TopicCandidateLibraryJsonCandidate[];
}
