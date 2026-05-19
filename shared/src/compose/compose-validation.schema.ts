import { z } from "zod";

export const ComposeValidationResult = z
  .object({
    stage: z.literal("compose_local_validation"),
    decision: z.enum(["ready_for_render", "partial", "blocked"]),
    errors: z.array(z.string()),
    warnings: z.array(z.string()),
    metrics: z.record(z.string(), z.unknown()),
  })
  .strict();

export type ComposeValidationResult = z.infer<
  typeof ComposeValidationResult
>;
