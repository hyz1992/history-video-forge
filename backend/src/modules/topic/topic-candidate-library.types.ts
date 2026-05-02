export const TOPIC_CANDIDATE_LIBRARY_STATUSES = [
  "raw_generated",
  "selector_pool",
  "final_selected",
  "unused",
  "fallback_ready",
  "expired",
] as const;

export type TopicCandidateLibraryStatus =
  (typeof TOPIC_CANDIDATE_LIBRARY_STATUSES)[number];

export const TOPIC_CANDIDATE_LIBRARY_REQUIRED_FIELDS = [
  "candidateId",
  "seedFamily",
  "seedProfile",
  "status",
  "sourceProjectId",
  "sourceTopicRunId",
  "eventIdentity",
  "title",
  "oneLineAngle",
] as const;

export type TopicCandidateLibraryRequiredField =
  (typeof TOPIC_CANDIDATE_LIBRARY_REQUIRED_FIELDS)[number];

export interface TopicCandidateLibraryEntry {
  candidateId: string;
  seedFamily: string;
  seedProfile: string;
  status: TopicCandidateLibraryStatus;
  sourceProjectId: string;
  sourceTopicRunId: string;
  eventIdentity: string;
  title: string;
  oneLineAngle: string;
}
