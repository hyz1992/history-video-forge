import type { DbClient } from "../../db/client";

import { buildTopicCandidates, type BuildTopicCandidatesInput } from "./topic-candidate.builder";

export function recommendTopicCandidates(
  _db: DbClient,
  input: BuildTopicCandidatesInput,
) {
  return buildTopicCandidates(input);
}
