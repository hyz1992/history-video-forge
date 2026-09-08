import { z } from "zod";
import { AssetPlan, AssetTask } from "../asset-planning/asset-plan.schema.js";
import { AssetManifest, SegmentAssetRoute } from "../assets/asset-manifest.schema.js";
import { NarrationInteger, NarrationSha256 } from "./narration-timing.schema.js";
import { NarrationReference, NarrationVisualRange } from "./narration-reference.schema.js";
export { NarrationReference, NarrationVisualRange } from "./narration-reference.schema.js";
export { StoryboardPlanV2, VersionedStoryboardPlan } from "../storyboard/storyboard-plan.schema.js";
const id = z.string().min(1);

export const AssetPlanV2 = AssetPlan.omit({ tts_plan: true }).extend({
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
export const VersionedAssetPlan = z.union([AssetPlan, AssetPlanV2]);
export type VersionedAssetPlan = z.infer<typeof VersionedAssetPlan>;

export const AssetManifestV2 = AssetManifest.extend({
  manifest_version: z.literal("asset_manifest_v2"), narration_reference: NarrationReference,
  subtitle_revision_id: id, subtitle_settings_hash: NarrationSha256,
  segment_routes: z.array(SegmentAssetRoute.extend({
    narrationRange: z.object({ startMs: NarrationInteger, endMs: NarrationInteger }).strict()
      .refine(r => r.endMs > r.startMs, { message: "narration_manifest_range_invalid" }),
  })).min(1),
}).superRefine((manifest, ctx) => {
  for (const [index, route] of manifest.segment_routes.entries()) {
    if (route.narrationRange.endMs > manifest.narration_reference.duration_ms) ctx.addIssue({
      code: z.ZodIssueCode.custom, message: "narration_manifest_interval_out_of_bounds",
      path: ["segment_routes", index, "narrationRange", "endMs"],
    });
  }
});
export type AssetManifestV2 = z.infer<typeof AssetManifestV2>;
export const VersionedAssetManifest = z.union([AssetManifest, AssetManifestV2]);
export type VersionedAssetManifest = z.infer<typeof VersionedAssetManifest>;
