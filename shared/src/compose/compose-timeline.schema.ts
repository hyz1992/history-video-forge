import { z } from "zod";

export const ComposeReadiness = z.enum([
  "ready_for_render",
  "partial",
  "blocked",
]);

export const ComposeTrackType = z.enum([
  "visual",
  "narration",
  "subtitle",
  "bgm",
  "sfx",
]);

export const ComposeClipKind = z.enum([
  "video",
  "image_with_motion",
  "image_only",
  "audio",
  "subtitle",
]);

export const ComposeClip = z
  .object({
    clip_id: z.string().min(1),
    segment_id: z.string().min(1).nullable(),
    artifact_id: z.string().min(1),
    start_sec: z.number().nonnegative(),
    duration_sec: z.number().positive(),
    clip_kind: ComposeClipKind,
    motion_artifact_id: z.string().min(1).nullable(),
    notes: z.array(z.string()),
  })
  .strict();

export const ComposeTrack = z
  .object({
    track_id: z.string().min(1),
    track_type: ComposeTrackType,
    clips: z.array(ComposeClip),
  })
  .strict();

export const ComposeTimelineSegment = z
  .object({
    segment_id: z.string().min(1),
    start_sec: z.number().nonnegative(),
    duration_sec: z.number().positive(),
    visual_clip_ids: z.array(z.string().min(1)),
    narration_clip_ids: z.array(z.string().min(1)),
    subtitle_clip_ids: z.array(z.string().min(1)),
    notes: z.array(z.string()),
  })
  .strict();

export const ComposeTimeline = z
  .object({
    timeline_version: z.literal("compose_timeline_v1"),
    source_asset_manifest_record_id: z.string().min(1),
    source_asset_plan_record_id: z.string().min(1),
    source_storyboard_record_id: z.string().min(1),
    source_script_record_id: z.string().min(1),
    output_profile: z
      .object({
        aspect_ratio: z.literal("9:16"),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        fps: z.number().positive(),
      })
      .strict(),
    duration_sec: z.number().positive(),
    tracks: z.array(ComposeTrack),
    segments: z.array(ComposeTimelineSegment),
    readiness: ComposeReadiness,
    notes: z.array(z.string()),
  })
  .strict();

export type ComposeReadiness = z.infer<typeof ComposeReadiness>;
export type ComposeTrackType = z.infer<typeof ComposeTrackType>;
export type ComposeClipKind = z.infer<typeof ComposeClipKind>;
export type ComposeClip = z.infer<typeof ComposeClip>;
export type ComposeTrack = z.infer<typeof ComposeTrack>;
export type ComposeTimelineSegment = z.infer<typeof ComposeTimelineSegment>;
export type ComposeTimeline = z.infer<typeof ComposeTimeline>;
