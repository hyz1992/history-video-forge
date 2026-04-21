import { END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";

import type { DbClient } from "../../db/client.js";
import type { BuildTopicCandidatesInput } from "../../modules/topic/topic-candidate.builder.js";
import {
  TOPIC_CANDIDATE_TARGET_COUNT,
  createTopicRecommendationNodes,
  type TopicRecommendationGraphDependencies,
  type TopicRecommendationGraphRuntime,
} from "./topic-recommendation-nodes.js";
import { createGraphTraceSummary } from "./graph-trace.js";
import { createRuntimeDiagnosticsSummary } from "./runtime-diagnostics.js";
import { createSyntheticStepTraceLogs } from "../trace/step-trace-log.js";

const TopicRecommendationGraphStateSchema = z.object({
  node_name: z
    .enum(["topic-candidate-generate", "topic-candidate-repair"])
    .nullable(),
  input_ref: z.string().nullable(),
  output_ref: z.string().nullable(),
  failure_reason: z.string().nullable(),
  should_repair: z.boolean(),
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
    traceNodes: [],
    repairTriggered: false,
    slotsInsufficient: false,
  };
  const nodes = createTopicRecommendationNodes({
    runtime,
    dependencies,
  });

  const graph = new StateGraph(TopicRecommendationGraphStateSchema)
    .addNode("topic-candidate-generate", nodes.topicCandidateGenerate)
    .addNode("topic-candidate-repair", nodes.topicCandidateRepair)
    .addEdge(START, "topic-candidate-generate")
    .addConditionalEdges("topic-candidate-generate", (state) =>
      state.should_repair ? "topic-candidate-repair" : END,
    )
    .addEdge("topic-candidate-repair", END)
    .compile({
      name: "topic-recommendation-graph",
    });

  await graph.invoke({
    node_name: null,
    input_ref: null,
    output_ref: null,
    failure_reason: null,
    should_repair: false,
  });

  const diagnostics = [
    {
      code: "topic_candidate_generate_passed",
      level: "info" as const,
    },
  ];

  if (runtime.repairTriggered) {
    diagnostics.push({
      code: "topic_candidate_repair_triggered",
      level: "info" as const,
    });
  }

  if (runtime.candidates.length === TOPIC_CANDIDATE_TARGET_COUNT) {
    diagnostics.push({
      code: "topic_candidate_slot_guard_passed",
      level: "info" as const,
    });
  }

  if (runtime.slotsInsufficient) {
    diagnostics.push({
      code: "topic_candidate_slots_insufficient",
      level: "error" as const,
    });
  }

  return {
    candidates: runtime.candidates,
    trace: createGraphTraceSummary({
      phase: "topic",
      run_id: `topic_run_${input.db.generateId()}`,
      nodes: runtime.traceNodes,
      steps: createSyntheticStepTraceLogs({
        phase: "topic",
        nodes: runtime.traceNodes,
      }),
    }),
    diagnostics: createRuntimeDiagnosticsSummary(diagnostics),
  };
}
