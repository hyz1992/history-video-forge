import { z } from "zod";
import { AssetManifest, SegmentAssetRoute } from "../assets/asset-manifest.schema.js";
import { NarrationInteger, NarrationSha256 } from "./narration-timing.schema.js";
import { NarrationReference, NarrationVisualRange } from "./narration-reference.schema.js";
export { NarrationReference, NarrationVisualRange } from "./narration-reference.schema.js";
export { StoryboardPlanV2, VersionedStoryboardPlan } from "../storyboard/storyboard-plan.schema.js";
const id = z.string().min(1);

export { AssetPlanV2, VersionedAssetPlan } from "../asset-planning/asset-plan-v2.schema.js";

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
