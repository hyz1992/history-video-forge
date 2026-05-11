import { z } from "zod";

export const AssetPlanningValidationResult = z
  .object({
    stage: z.literal("asset_planning_local_validation"),
    decision: z.enum(["pass", "regen_once", "hard_fail"]),
    errors: z.array(z.string().min(1)),
    warnings: z.array(z.string().min(1)),
    metrics: z.record(z.string(), z.unknown()),
  })
  .strict();

export type AssetPlanningValidationResult = z.infer<
  typeof AssetPlanningValidationResult
>;
