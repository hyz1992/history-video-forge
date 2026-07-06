import { END, START, StateGraph } from "@langchain/langgraph";

import {
  createNodeStateUpdate,
  TopicScriptGraphStateSchema,
  type TopicScriptGraphState,
} from "./graph-state.js";
import { TOPIC_SCRIPT_GRAPH_NODE_NAMES } from "./graph-node-contract.js";

type LocalValidateDecision = "pass" | "regen_once" | "hard_fail";
type SemanticReviewDecision =
  | "pass"
  | "patch_once"
  | "regen_once"
  | "hard_fail";

export function resolveNextNodeAfterLocalValidate(input: {
  decision: LocalValidateDecision;
  regenerate_used: boolean;
}) {
  if (input.decision === "pass") {
    return "semantic-review" as const;
  }

  if (input.decision === "regen_once" && !input.regenerate_used) {
    return "regen-once" as const;
  }

  return END;
}

export function resolveNextNodeAfterSemanticReview(input: {
  decision: SemanticReviewDecision;
  patch_used: boolean;
  regenerate_used: boolean;
}) {
  if (input.decision === "patch_once" && !input.patch_used) {
    return "patch-once" as const;
  }

  if (input.decision === "regen_once" && !input.regenerate_used) {
    return "regen-once" as const;
  }

  return END;
}

function createStubNode(nodeName: (typeof TOPIC_SCRIPT_GRAPH_NODE_NAMES)[number]) {
  return async (state: TopicScriptGraphState) =>
    createNodeStateUpdate(nodeName, {
      input_ref: state.input_ref,
      output_ref: state.output_ref,
      failure_reason: state.failure_reason,
      patch_used: state.patch_used,
      regenerate_used: state.regenerate_used,
    });
}

function routeStubAfterLocalValidate(state: TopicScriptGraphState) {
  if (state.failure_reason === "needs_regen" && !state.regenerate_used) {
    return "regen-once" as const;
  }

  return "semantic-review" as const;
}

function routeStubAfterSemanticReview(state: TopicScriptGraphState) {
  if (state.failure_reason === "needs_patch" && !state.patch_used) {
    return "patch-once" as const;
  }

  if (state.failure_reason === "needs_regen" && !state.regenerate_used) {
    return "regen-once" as const;
  }

  return END;
}

export function createTopicScriptGraph(): unknown {
  const builder = new StateGraph(TopicScriptGraphStateSchema)
    .addNode("script-generate", createStubNode("script-generate"))
    .addNode("local-validate", createStubNode("local-validate"))
    .addNode("semantic-review", createStubNode("semantic-review"))
    .addNode("patch-once", createStubNode("patch-once"))
    .addNode("regen-once", createStubNode("regen-once"))
    .addEdge(START, "script-generate")
    .addEdge("script-generate", "local-validate")
    .addConditionalEdges("local-validate", routeStubAfterLocalValidate, [
      "semantic-review",
      "regen-once",
    ])
    .addConditionalEdges("semantic-review", routeStubAfterSemanticReview, [
      "patch-once",
      "regen-once",
      END,
    ])
    .addEdge("patch-once", "local-validate")
    .addEdge("regen-once", "local-validate");

  return {
    nodeNames: [...TOPIC_SCRIPT_GRAPH_NODE_NAMES],
    compiled: builder.compile({
      name: "topic-script-runtime-orchestration",
    }),
  };
}
