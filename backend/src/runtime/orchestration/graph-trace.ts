import type { StepTraceLogEntry } from "../trace/step-trace-log.js";

export interface GraphTraceNodeSummary {
  node_name: string;
  input_ref: string | null;
  output_ref: string | null;
  failure_reason: string | null;
}

export interface GraphTraceSummary {
  phase?: string;
  run_id?: string;
  nodes: GraphTraceNodeSummary[];
  steps?: StepTraceLogEntry[];
}

export function createGraphTraceSummary(
  input:
    | GraphTraceNodeSummary[]
    | {
        phase: string;
        run_id: string;
        nodes: GraphTraceNodeSummary[];
        steps?: StepTraceLogEntry[];
      },
): GraphTraceSummary {
  if (Array.isArray(input)) {
    return {
      nodes: input,
    };
  }

  return {
    phase: input.phase,
    run_id: input.run_id,
    nodes: input.nodes,
    steps: input.steps ?? [],
  };
}

export function mergeGraphTraceSummaries(
  ...summaries: Array<GraphTraceSummary | null | undefined>
): GraphTraceSummary {
  return {
    phase: summaries.at(-1)?.phase,
    run_id: summaries.at(-1)?.run_id,
    nodes: summaries.flatMap((summary) => summary?.nodes ?? []),
    steps: summaries.flatMap((summary) => summary?.steps ?? []),
  };
}
