import { TopicCandidateCard } from "../../../../shared/src/index.js";
import { env } from "../../config/env.js";
import type { DbClient } from "../../db/client";
import { saveCachedCandidate } from "../cache/candidate-cache.repository.js";
import { createLlmGateway, type LlmGateway } from "../../runtime/llm/llm-gateway.js";
import { createOpenAiCompatibleProvider } from "../../runtime/llm/openai-compatible-provider.js";
import type { StructuredPromptProvider } from "../../runtime/llm/provider-contract.js";
import { createPromptRegistry } from "../../runtime/prompts/prompt-registry.js";
import { runTopicRecommendationGraph } from "../../runtime/orchestration/topic-recommendation-graph.js";

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
  const result = await runTopicRecommendationGraph(
    {
      db,
      input,
      projectId: options?.projectId ?? null,
    },
    {
      invokeStructuredPrompt: (runnerInput) =>
        gateway.invokeStructuredPrompt<unknown[]>(runnerInput),
    },
  );

  return result.candidates;
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
