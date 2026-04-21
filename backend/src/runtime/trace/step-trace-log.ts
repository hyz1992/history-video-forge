export interface StepTraceLogEntry {
  step_name: string;
  phase: string;
  status: "succeeded" | "failed";
  started_at: string;
  ended_at: string;
  duration_ms: number;
  input_ref: string | null;
  output_ref: string | null;
  failure_reason: string | null;
}

export function createStepTraceLog(input: {
  stepName: string;
  phase: string;
  startedAt: Date;
  endedAt: Date;
  inputRef?: string | null;
  outputRef?: string | null;
  failureReason?: string | null;
}): StepTraceLogEntry {
  const durationMs = Math.max(input.endedAt.getTime() - input.startedAt.getTime(), 0);

  return {
    step_name: input.stepName,
    phase: input.phase,
    status: input.failureReason ? "failed" : "succeeded",
    started_at: input.startedAt.toISOString(),
    ended_at: input.endedAt.toISOString(),
    duration_ms: durationMs,
    input_ref: input.inputRef ?? null,
    output_ref: input.outputRef ?? null,
    failure_reason: input.failureReason ?? null,
  };
}

export function createSyntheticStepTraceLogs(input: {
  phase: string;
  nodes: Array<{
    node_name: string;
    input_ref: string | null;
    output_ref: string | null;
    failure_reason: string | null;
  }>;
}): StepTraceLogEntry[] {
  const seedTime = Date.now();

  return input.nodes.map((node, index) => {
    const startedAt = new Date(seedTime + index * 10);
    const endedAt = new Date(startedAt.getTime() + 1);

    return createStepTraceLog({
      stepName: node.node_name,
      phase: input.phase,
      startedAt,
      endedAt,
      inputRef: node.input_ref,
      outputRef: node.output_ref,
      failureReason: node.failure_reason,
    });
  });
}
