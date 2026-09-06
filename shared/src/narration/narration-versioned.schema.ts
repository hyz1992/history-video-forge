import { z } from "zod";
import { StoryboardPlan, StoryboardSegment } from "../storyboard/storyboard-plan.schema.js";
import { AssetPlan, AssetTask } from "../asset-planning/asset-plan.schema.js";
import { AssetManifest, SegmentAssetRoute } from "../assets/asset-manifest.schema.js";
import { NarrationInteger, NarrationSha256 } from "./narration-timing.schema.js";

const id = z.string().min(1);
export const NarrationReference = z.object({
  narration_record_id: id, audio_hash: NarrationSha256, timing_map_hash: NarrationSha256,
  duration_ms: NarrationInteger.positive(),
}).strict();
export type NarrationReference = z.infer<typeof NarrationReference>;
export const NarrationVisualRange = z.object({
  start_boundary_id: id, end_boundary_id: id,
  source_start: NarrationInteger, source_end: NarrationInteger,
  visual_start_ms: NarrationInteger, visual_end_ms: NarrationInteger,
}).strict().refine(r => r.source_end > r.source_start && r.visual_end_ms > r.visual_start_ms &&
  r.start_boundary_id !== r.end_boundary_id, { message: "narration_visual_range_invalid" });
export type NarrationVisualRange = z.infer<typeof NarrationVisualRange>;

// 此处只新增版本读取合同；旧全局类型维持 v1，消费者按任务7/9A/9B逐步接入。
const StoryboardSegmentV2 = StoryboardSegment.innerType().extend(NarrationVisualRange.innerType().shape)
  .refine(r => r.source_end > r.source_start && r.visual_end_ms > r.visual_start_ms &&
    r.start_boundary_id !== r.end_boundary_id && r.start_hint_sec === r.visual_start_ms / 1000 &&
    r.end_hint_sec === r.visual_end_ms / 1000 && r.script_excerpt.length === r.source_end - r.source_start,
  { message: "storyboard_v2_range_invalid" });
const StoryboardPlanV2Object = StoryboardPlan.extend({
  plan_version: z.literal("storyboard_v2"), narration_reference: NarrationReference,
  segments: z.array(StoryboardSegmentV2).min(1),
});
export const StoryboardPlanV2 = StoryboardPlanV2Object.superRefine((p, ctx) => {
  let time = 0; let source = 0; let previousBoundary: string | undefined;
  const ids = new Set<string>();
  for (const [i, s] of p.segments.entries()) {
    if (s.visual_start_ms !== time || s.source_start !== source || s.order !== i || ids.has(s.segment_id) ||
      (previousBoundary !== undefined && s.start_boundary_id !== previousBoundary)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "storyboard_v2_discontinuous" });
    time = s.visual_end_ms; source = s.source_end; previousBoundary = s.end_boundary_id; ids.add(s.segment_id);
  }
  if (time !== p.narration_reference.duration_ms || p.estimated_total_duration_sec !== time / 1000) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "storyboard_v2_duration_mismatch" });
});
export type StoryboardPlanV2 = z.infer<typeof StoryboardPlanV2>;
// 两个分支都有固定版本字面量；v2 parse 失败不会回落到 v1。
export const VersionedStoryboardPlan = z.union([StoryboardPlan, StoryboardPlanV2]);
export type VersionedStoryboardPlan = z.infer<typeof VersionedStoryboardPlan>;

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
