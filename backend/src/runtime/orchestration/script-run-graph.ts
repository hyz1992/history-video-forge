import { randomUUID } from "node:crypto";
import { END, START, StateGraph } from "@langchain/langgraph";

import {
  createTopicScriptGraphState,
  TopicScriptGraphStateSchema,
} from "./graph-state.js";
import {
  resolveNextNodeAfterLocalValidate,
  resolveNextNodeAfterSemanticReview,
} from "./topic-script-graph.js";
import {
  buildSkippedSemanticReview,
  createScriptRunNodes,
  type ScriptRunGraphDependencies,
  type ScriptRunGraphRuntime,
} from "./script-run-nodes.js";
import {
  createGraphTraceSummary,
  type GraphTraceNodeSummary,
} from "./graph-trace.js";
import { createRuntimeDiagnosticsSummary } from "./runtime-diagnostics.js";

export interface RunScriptRunGraphInput {
  bundle: ScriptRunGraphRuntime["bundle"];
  allowPatch?: boolean;
  allowRegen?: boolean;
  forceRegen?: boolean;
  runId?: string;
}

export async function runScriptRunGraph(
  input: RunScriptRunGraphInput,
  dependencies: ScriptRunGraphDependencies,
) {
  const runtime: ScriptRunGraphRuntime = {
    bundle: input.bundle,
    allowPatch: input.allowPatch ?? false,
    allowRegen: input.allowRegen ?? false,
    forceRegen: input.forceRegen ?? false,
    draft: null,
    localValidation: null,
    semanticReview: null,
    lastPatchIntent: null,
    stepLogs: [],
  };
  const nodes = createScriptRunNodes({
    runtime,
    dependencies,
  });

  const graph = new StateGraph(TopicScriptGraphStateSchema)
    .addNode("script-generate", nodes.scriptGenerate)
    .addNode("local-validate", nodes.localValidate)
    .addNode("semantic-review", nodes.semanticReview)
    .addNode("patch-once", nodes.patchOnce)
    .addNode("regen-once", nodes.regenOnce)
    .addEdge(START, "script-generate")
    .addEdge("script-generate", "local-validate")
    .addConditionalEdges(
      "local-validate",
      (state) => {
        if (!runtime.localValidation) {
          return END;
        }

        const next = resolveNextNodeAfterLocalValidate({
          decision: runtime.localValidation.decision,
          regenerate_used: state.regenerate_used,
        });

        if (next === "regen-once" && runtime.allowRegen) {
          return "regen-once" as const;
        }

        if (next === "semantic-review") {
          return "semantic-review" as const;
        }

        return END;
      },
      ["semantic-review", "regen-once", END],
    )
    .addConditionalEdges(
      "semantic-review",
      (state) => {
        if (!runtime.semanticReview) {
          return END;
        }

        const next = resolveNextNodeAfterSemanticReview({
          decision: runtime.semanticReview.decision,
          patch_used: state.patch_used,
          regenerate_used: state.regenerate_used,
        });

        if (next === "patch-once" && runtime.allowPatch) {
          return "patch-once" as const;
        }

        if (runtime.forceRegen && !state.regenerate_used) {
          return "regen-once" as const;
        }

        if (next === "regen-once" && runtime.allowRegen) {
          return "regen-once" as const;
        }

        return END;
      },
      ["patch-once", "regen-once", END],
    )
    .addEdge("patch-once", "local-validate")
    .addEdge("regen-once", "local-validate")
    .compile({
      name: "script-run-graph",
    });

  const finalState = await graph.invoke(
    createTopicScriptGraphState({
      input_ref: `script-input-bundle:${input.bundle.topic_package.topic_id}`,
    }),
  );

  if (!runtime.draft || !runtime.localValidation) {
    throw new Error("script run graph did not produce the required runtime outputs");
  }

  const semanticReview =
    runtime.semanticReview ??
    buildSkippedSemanticReview({
      localDecision: runtime.localValidation.decision,
      allowRegen: runtime.allowRegen,
    });

  const finalSemanticReview =
    semanticReview.decision === "pass" &&
    semanticReview.patch_intent === null &&
    runtime.lastPatchIntent
      ? {
          ...semanticReview,
          patch_intent: runtime.lastPatchIntent,
        }
      : semanticReview;
  const traceNodes: GraphTraceNodeSummary[] = [
    {
      node_name: "script-generate",
      input_ref: `script-input-bundle:${input.bundle.topic_package.topic_id}`,
      output_ref: "script-draft:current",
      failure_reason: null,
    },
    {
      node_name: "semantic-review",
      input_ref: "script-local-validation:current",
      output_ref: "script-semantic-review:current",
      failure_reason:
        finalSemanticReview.decision === "hard_fail"
          ? finalSemanticReview.summary
          : null,
    },
  ];

  return {
    draft: runtime.draft,
    localValidation: runtime.localValidation,
    semanticReview: finalSemanticReview,
    executionState: {
      patch_used: finalState.patch_used,
      regenerate_used: finalState.regenerate_used,
    },
    graphTraceSummary: createGraphTraceSummary({
      phase: "script",
      run_id:
        input.runId ??
        `script_run_${randomUUID().replace(/-/g, "").slice(0, 8)}`,
      nodes: traceNodes,
      steps: runtime.stepLogs,
    }),
    runtimeDiagnostics: createRuntimeDiagnosticsSummary([
      {
        code:
          finalSemanticReview.decision === "pass"
            ? "semantic_review_passed"
            : finalSemanticReview.decision,
        level:
          finalSemanticReview.decision === "hard_fail" ? "error" : "info",
      },
    ]),
  };
}
