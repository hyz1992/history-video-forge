import { TopicCandidateCard } from "../../../../shared/src/index.js";
import { env } from "../../config/env.js";
import type { DbClient } from "../../db/client";
import { saveCachedCandidate } from "../cache/candidate-cache.repository.js";
import { createLlmGateway, type LlmGateway } from "../../runtime/llm/llm-gateway.js";
import { createOpenAiCompatibleProvider } from "../../runtime/llm/openai-compatible-provider.js";
import type { StructuredPromptProvider } from "../../runtime/llm/provider-contract.js";
import { createPromptRegistry } from "../../runtime/prompts/prompt-registry.js";

import {
  buildTopicCandidates,
  type BuildTopicCandidatesInput,
} from "./topic-candidate.builder.js";

export interface TopicRecommendationOptions {
  llmGateway?: LlmGateway;
  projectId?: string | null;
}

export async function recommendTopicCandidates(
  db: DbClient,
  input: BuildTopicCandidatesInput,
  options?: TopicRecommendationOptions,
) {
  const gateway = options?.llmGateway ?? createTopicRecommendationGateway();
  const runtimeCandidates = await gateway.invokeStructuredPrompt<unknown[]>({
    promptId: "topic.candidate-builder",
    input,
  });
  const candidates = runtimeCandidates.map((candidate) =>
    TopicCandidateCard.parse(candidate),
  );

  for (const candidate of candidates) {
    await saveCachedCandidate(db, {
      projectId: options?.projectId ?? null,
      fingerprint: buildCandidateFingerprint(input.canonicalName, candidate.one_line_angle),
      oneLineAngle: candidate.one_line_angle,
      familyLabel: candidate.family_label,
      scopeLabel: candidate.scope_label,
      viralRubricJson: candidate.viral_rubric,
      estimatedDurationBandJson: candidate.estimated_duration_band,
      strongScene: candidate.strong_scene,
      coreConflict: candidate.core_conflict,
      mustCoverPreviewJson: candidate.must_cover_preview,
    });
  }

  return candidates;
}

function createTopicRecommendationGateway(): LlmGateway {
  const provider =
    env.llm.provider === "stub"
      ? createStubTopicRecommendationProvider()
      : createOpenAiCompatibleProvider({});

  return createLlmGateway({
    registry: createPromptRegistry(),
    provider,
  });
}

function createStubTopicRecommendationProvider(): StructuredPromptProvider {
  return {
    async invokeStructuredPrompt<T>({ input }): Promise<T> {
      return buildTopicCandidates(input as BuildTopicCandidatesInput) as T;
    },
  };
}

function buildCandidateFingerprint(
  canonicalName: string,
  oneLineAngle: string,
): string {
  return `${canonicalName}::${oneLineAngle}`;
}
