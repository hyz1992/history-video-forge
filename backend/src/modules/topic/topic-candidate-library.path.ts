export const TOPIC_CANDIDATE_LIBRARY_ROOT_DIR =
  "storage/topic-candidate-library";

interface TopicCandidateLibraryPathInput {
  seedFamily: string;
  seedProfile: string;
  title?: string;
}

export function buildTopicCandidateLibrarySlugs(
  input: TopicCandidateLibraryPathInput,
) {
  return {
    seedFamilySlug: toAsciiSlug(input.seedFamily),
    seedProfileSlug: toAsciiSlug(input.seedProfile),
  };
}

export function buildTopicCandidateLibraryDirectory(
  input: TopicCandidateLibraryPathInput,
) {
  const { seedFamilySlug, seedProfileSlug } =
    buildTopicCandidateLibrarySlugs(input);

  return `${TOPIC_CANDIDATE_LIBRARY_ROOT_DIR}/${seedFamilySlug}/${seedProfileSlug}`;
}

function toAsciiSlug(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "unknown";
}
