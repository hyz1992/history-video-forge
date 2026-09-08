import { z } from "zod";
import { AssetPlanV1, AssetTask } from "./asset-plan-v1.schema.js";
import { NarrationReference, NarrationVisualRange } from "../narration/narration-reference.schema.js";
const id = z.string().min(1);
export const AssetPlanV2 = AssetPlanV1.omit({ tts_plan: true }).extend({
  plan_version: z.literal("asset_plan_v2"), narration_reference: NarrationReference,
  global_audio_strategy: z.object({}).passthrough().refine(strategy => !("voice_intent" in strategy),
    { message: "narration_v2_voice_reselection_forbidden" }),
  tasks: z.array(AssetTask.refine(t => t.task_type !== "tts_audio", { message: "narration_v2_tts_task_forbidden" })).min(1),
  narration_intervals: z.array(z.object({ segment_id: id, range: NarrationVisualRange }).strict()).min(1),
}).superRefine((plan, ctx) => {
  for (const [index, interval] of plan.narration_intervals.entries()) {
    if (interval.range.visual_end_ms > plan.narration_reference.duration_ms) ctx.addIssue({
      code: z.ZodIssueCode.custom, message: "narration_asset_interval_out_of_bounds",
      path: ["narration_intervals", index, "range", "visual_end_ms"],
    });
  }
});
export type AssetPlanV2 = z.infer<typeof AssetPlanV2>;
export const VersionedAssetPlan = z.union([AssetPlanV1, AssetPlanV2]);
export type VersionedAssetPlan = z.infer<typeof VersionedAssetPlan>;
