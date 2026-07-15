import { END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";

import type { DbClient } from "../../db/client.js";
import type { BuildTopicCandidatesInput } from "../../modules/topic/topic-candidate.builder.js";
import {
  createTopicRecommendationNodes,
  type TopicRecommendationGraphDependencies,
  type TopicRecommendationGraphRuntime,
} from "./topic-recommendation-nodes.js";
import { createGraphTraceSummary } from "./graph-trace.js";
import { createRuntimeDiagnosticsSummary } from "./runtime-diagnostics.js";
import { createStepTraceLog } from "../trace/step-trace-log.js";

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
  runId?: string;
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
    builderRepairTriggered: false,
    builderRepairPassed: false,
    pendingFieldRepair: false,
    builderDegraded: false,
    pendingFieldIssues: [],
    pendingRawBuilderCandidates: [],
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

  const graphStartedAt = new Date();
  await graph.invoke({
    node_name: null,
    input_ref: null,
    output_ref: null,
    failure_reason: null,
    should_repair: false,
  });
  const graphEndedAt = new Date();

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

  if (runtime.builderRepairTriggered) {
    diagnostics.push({
      code: "topic_candidate_builder_repair_triggered",
      level: "info" as const,
    });
  }

  if (runtime.builderRepairPassed) {
    diagnostics.push({
      code: "topic_candidate_builder_repair_passed",
      level: "info" as const,
    });
  }

  if (runtime.builderDegraded) {
    diagnostics.push({
      code: "topic_candidate_builder_degraded",
      level: "warning" as const,
    } as never);
  }

  if (runtime.candidates.length > 0) {
    diagnostics.push({
      code: "topic_candidate_slot_guard_passed",
      level: "info" as const,
    });
  }

  if (runtime.slotsInsufficient) {
    diagnostics.push({
      code: "topic_candidate_slots_insufficient",
      level: "info" as const,
    } as never);
  }

  return {
    candidates: runtime.candidates,
    trace: createGraphTraceSummary({
      phase: "topic",
      run_id: input.runId ?? `topic_run_${input.db.generateId()}`,
      nodes: runtime.traceNodes,
      steps: [
        createStepTraceLog({
          stepName: "topic-recommendation-graph",
          phase: "topic",
          startedAt: graphStartedAt,
          endedAt: graphEndedAt,
          inputRef: `topic-event:${input.input.canonicalName}`,
          outputRef: `topic-candidate-list:${runtime.candidates.length}`,
          failureReason: null,
        }),
      ],
    }),
    diagnostics: createRuntimeDiagnosticsSummary(diagnostics),
  };
}
