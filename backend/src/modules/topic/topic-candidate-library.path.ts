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
  const trimmed = value.trim();
  const normalized = trimmed
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (normalized) {
    return normalized;
  }

  const unicodeSegments = trimmed
    .toLowerCase()
    .split(/[^\p{Letter}\p{Number}]+/u)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (unicodeSegments.length === 0) {
    return "unknown";
  }

  return unicodeSegments
    .map((segment) => `u8-${Buffer.from(segment, "utf8").toString("hex")}`)
    .join("-");
}
