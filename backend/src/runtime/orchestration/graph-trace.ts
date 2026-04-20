export interface GraphTraceNodeSummary {
  node_name: string;
  input_ref: string | null;
  output_ref: string | null;
  failure_reason: string | null;
}

export interface GraphTraceSummary {
  nodes: GraphTraceNodeSummary[];
}

export function createGraphTraceSummary(
  nodes: GraphTraceNodeSummary[],
): GraphTraceSummary {
  return {
    nodes,
  };
}

export function mergeGraphTraceSummaries(
  ...summaries: Array<GraphTraceSummary | null | undefined>
): GraphTraceSummary {
  return {
    nodes: summaries.flatMap((summary) => summary?.nodes ?? []),
  };
}
