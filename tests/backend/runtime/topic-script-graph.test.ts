import { describe, expect, it } from "vitest";

import {
  TopicScriptGraphStateSchema,
  TOPIC_SCRIPT_GRAPH_STATE_FIELDS,
} from "../../../backend/src/runtime/orchestration/graph-state.js";
import { TOPIC_SCRIPT_GRAPH_NODE_NAMES } from "../../../backend/src/runtime/orchestration/graph-node-contract.js";
import {
  createTopicScriptGraph,
  resolveNextNodeAfterLocalValidate,
  resolveNextNodeAfterSemanticReview,
} from "../../../backend/src/runtime/orchestration/topic-script-graph.js";

describe("topic-script graph scaffold", () => {
  it("keeps graph state limited to lightweight orchestration fields", () => {
    const parsed = TopicScriptGraphStateSchema.parse({
      node_name: "script-generate",
      input_ref: "topic-package:topic-1",
      output_ref: "script-draft:draft-1",
      failure_reason: null,
      patch_used: false,
      regenerate_used: false,
      workflow_state: {
        legacy: true,
      },
    });

    expect(TOPIC_SCRIPT_GRAPH_STATE_FIELDS).toEqual([
      "node_name",
      "input_ref",
      "output_ref",
      "failure_reason",
      "patch_used",
      "regenerate_used",
    ]);
    expect(parsed).toEqual({
      node_name: "script-generate",
      input_ref: "topic-package:topic-1",
      output_ref: "script-draft:draft-1",
      failure_reason: null,
      patch_used: false,
      regenerate_used: false,
    });
  });

  it("uses the phase-3 node names frozen for runtime orchestration", () => {
    expect(TOPIC_SCRIPT_GRAPH_NODE_NAMES).toEqual([
      "script-generate",
      "local-validate",
      "semantic-review",
      "patch-once",
      "regen-once",
    ]);

    const graph = createTopicScriptGraph();

    expect(graph.nodeNames).toEqual(TOPIC_SCRIPT_GRAPH_NODE_NAMES);
    expect(typeof graph.compiled.invoke).toBe("function");
  });

  it("enforces single patch_once and regen_once boundaries in routing", () => {
    expect(
      resolveNextNodeAfterLocalValidate({
        decision: "regen_once",
        regenerate_used: false,
      }),
    ).toBe("regen-once");
    expect(
      resolveNextNodeAfterLocalValidate({
        decision: "regen_once",
        regenerate_used: true,
      }),
    ).toBe("__end__");
    expect(
      resolveNextNodeAfterLocalValidate({
        decision: "pass",
        regenerate_used: false,
      }),
    ).toBe("semantic-review");

    expect(
      resolveNextNodeAfterSemanticReview({
        decision: "patch_once",
        patch_used: false,
        regenerate_used: false,
      }),
    ).toBe("patch-once");
    expect(
      resolveNextNodeAfterSemanticReview({
        decision: "patch_once",
        patch_used: true,
        regenerate_used: false,
      }),
    ).toBe("__end__");
    expect(
      resolveNextNodeAfterSemanticReview({
        decision: "regen_once",
        patch_used: false,
        regenerate_used: false,
      }),
    ).toBe("regen-once");
    expect(
      resolveNextNodeAfterSemanticReview({
        decision: "regen_once",
        patch_used: false,
        regenerate_used: true,
      }),
    ).toBe("__end__");
    expect(
      resolveNextNodeAfterSemanticReview({
        decision: "pass",
        patch_used: false,
        regenerate_used: false,
      }),
    ).toBe("__end__");
  });
});
