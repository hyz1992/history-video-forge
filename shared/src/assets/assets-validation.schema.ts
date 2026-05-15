import { z } from "zod";

export const AssetsValidationResult = z
  .object({
    stage: z.literal("assets_local_validation"),
    decision: z.enum(["ready_for_compose", "blocked", "partial"]),
    errors: z.array(z.string().min(1)),
    warnings: z.array(z.string().min(1)),
    metrics: z.record(z.string(), z.unknown()),
  })
  .strict();

export type AssetsValidationResult = z.infer<typeof AssetsValidationResult>;
