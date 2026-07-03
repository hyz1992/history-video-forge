export type PipelineStagePhase =
  | { kind: "generating" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" }
  | { kind: "empty" };

export interface ResolvePipelineStagePhaseInput {
  isGenerating: boolean;
  isLoading: boolean;
  hasContent: boolean;
  loadError?: string | null;
}

export function resolvePipelineStagePhase(
  input: ResolvePipelineStagePhaseInput,
): PipelineStagePhase {
  if (input.isGenerating) {
    return { kind: "generating" };
  }

  if (input.isLoading) {
    return { kind: "loading" };
  }

  if (input.loadError) {
    return { kind: "error", message: input.loadError };
  }

  if (input.hasContent) {
    return { kind: "ready" };
  }

  return { kind: "empty" };
}
