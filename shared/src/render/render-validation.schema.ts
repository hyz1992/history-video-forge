import { z } from "zod";

export const RenderValidationResult = z
  .object({
    stage: z.literal("render_local_validation"),
    decision: z.enum(["ready_to_render", "rendered", "blocked", "failed"]),
    errors: z.array(z.string()),
    warnings: z.array(z.string()),
    metrics: z.record(z.string(), z.unknown()),
  })
  .strict();

export type RenderValidationResult = z.infer<
  typeof RenderValidationResult
>;
