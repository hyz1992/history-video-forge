import { END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";

import type { DbClient } from "../../db/client.js";
import type { BuildTopicCandidatesInput } from "../../modules/topic/topic-candidate.builder.js";
import {
  createTopicRecommendationNodes,
  type TopicRecommendationGraphDependencies,
  type TopicRecommendationGraphRuntime,
} from "./topic-recommendation-nodes.js";

const TopicRecommendationGraphStateSchema = z.object({
  node_name: z.enum(["topic-candidate-generate"]).nullable(),
  input_ref: z.string().nullable(),
  output_ref: z.string().nullable(),
  failure_reason: z.string().nullable(),
});

export interface RunTopicRecommendationGraphInput {
  db: DbClient;
  input: BuildTopicCandidatesInput;
  projectId?: string | null;
}

export async function runTopicRecommendationGraph(
  input: RunTopicRecommendationGraphInput,
  dependencies: TopicRecommendationGraphDependencies,
) {
  const runtime: TopicRecommendationGraphRuntime = {
    db: input.db,
    input: input.input,
    projectId: input.projectId,
    candidates: [],
  };
  const nodes = createTopicRecommendationNodes({
    runtime,
    dependencies,
  });

  const graph = new StateGraph(TopicRecommendationGraphStateSchema)
    .addNode("topic-candidate-generate", nodes.topicCandidateGenerate)
    .addEdge(START, "topic-candidate-generate")
    .addEdge("topic-candidate-generate", END)
    .compile({
      name: "topic-recommendation-graph",
    });

  const finalState = await graph.invoke({
    node_name: null,
    input_ref: null,
    output_ref: null,
    failure_reason: null,
  });

  return {
    candidates: runtime.candidates,
    trace: {
      nodes: [finalState],
    },
  };
}
