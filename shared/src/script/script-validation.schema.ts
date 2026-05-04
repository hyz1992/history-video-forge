import { z } from "zod";

const ValidationMessage = z
  .object({
    code: z.string().min(1).optional(),
    message: z.string().min(1).optional(),
    field: z.string().nullable().optional(),
    severity: z.string().min(1).optional(),
  })
  .strict();

const LocalValidationMetrics = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

export const ScriptLocalValidationResult = z
  .object({
    stage: z.literal("script_local_validation"),
    decision: z.enum(["pass", "regen_once", "hard_fail"]),
    errors: z.array(z.union([z.string(), ValidationMessage])),
    warnings: z.array(z.union([z.string(), ValidationMessage])),
    metrics: LocalValidationMetrics,
  })
  .strict();

export const ScriptSemanticReviewResult = z
  .object({
    stage: z.literal("script_semantic_review"),
    decision: z.enum([
      "pass",
      "patch_once",
      "regen_once",
      "return_topic",
      "skipped",
    ]),
    patch_intent: z.enum(["fix", "lift"]).nullable(),
    hard_issues: z.array(z.union([z.string(), ValidationMessage])),
    soft_issues: z.array(z.union([z.string(), ValidationMessage])),
    patch_targets: z.array(z.string()),
    summary: z.string().min(1),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const ScriptValidationResult = z.discriminatedUnion("stage", [
  ScriptLocalValidationResult,
  ScriptSemanticReviewResult,
]);

export type ScriptLocalValidationResult = z.infer<
  typeof ScriptLocalValidationResult
>;
export type ScriptSemanticReviewResult = z.infer<
  typeof ScriptSemanticReviewResult
>;
export type ScriptValidationResult = z.infer<typeof ScriptValidationResult>;
