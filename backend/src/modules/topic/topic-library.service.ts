import type { DbClient } from "../../db/client";

import { normalizeEventInput } from "./event-normalizer";
import { recommendTopicCandidates } from "./topic-recommendation.service";
import type { BuildTopicCandidatesInput } from "./topic-candidate.builder";

export async function buildLibraryTopicRecommendations(
  db: DbClient,
  input: NormalizeEventInput & BuildTopicCandidatesInput,
) {
  const normalized = await normalizeEventInput(db, input);

  return {
    normalized,
    candidates: recommendTopicCandidates(db, input),
  };
}

interface NormalizeEventInput {
  rawInput: string;
  aliases?: string[];
  sourceType?: string;
}
