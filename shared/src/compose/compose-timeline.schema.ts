import { AssetManifestV2 } from "../assets/asset-manifest-v2.schema.js";
import { projectNarrationFrameRange } from "../narration/timeline-frame-projection.js";
import { z } from "zod";
import { NarrationReference } from "../narration/narration-reference.schema.js";
import { NarrationInteger, NarrationSha256 } from "../narration/narration-timing.schema.js";

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
    startMs: NarrationInteger.optional(),
    endMs: NarrationInteger.optional(),
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
    startMs: NarrationInteger.optional(),
    endMs: NarrationInteger.optional(),
    duration_sec: z.number().positive(),
    visual_clip_ids: z.array(z.string().min(1)),
    narration_clip_ids: z.array(z.string().min(1)),
    subtitle_clip_ids: z.array(z.string().min(1)),
    notes: z.array(z.string()),
  })
  .strict();

export const ComposeTimelineV1 = z
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

export const ComposeTimelineV2 = ComposeTimelineV1.extend({
 timeline_version:z.literal('compose_timeline_v2'),
 narration_reference:NarrationReference,
 subtitle_revision_id:z.string().min(1), subtitle_settings_hash:NarrationSha256,
 contentDurationMs:NarrationInteger.positive(),outroDurationMs:NarrationInteger,
}).superRefine((t,ctx)=>{
 const fail=(message:string)=>ctx.addIssue({code:z.ZodIssueCode.custom,message});
 if(t.contentDurationMs!==t.narration_reference.duration_ms||t.duration_sec!==(t.contentDurationMs+t.outroDurationMs)/1000)fail('narration_timeline_duration_mismatch');
 let end=0;for(const s of t.segments){if(s.startMs!==end||s.endMs===undefined||s.endMs<=end||s.start_sec!==s.startMs/1000||s.duration_sec!==(s.endMs-end)/1000)fail('narration_timeline_segment_invalid');end=s.endMs??-1;}
 if(end!==t.contentDurationMs)fail('narration_timeline_coverage_invalid');
 for(const track of t.tracks)for(const c of track.clips){if(c.startMs===undefined||c.endMs===undefined||c.endMs<=c.startMs||c.start_sec!==c.startMs/1000||c.duration_sec!==(c.endMs-c.startMs)/1000||c.endMs>t.contentDurationMs+t.outroDurationMs)fail('narration_timeline_clip_invalid');}
 for(const kind of ['narration','subtitle']){const tracks=t.tracks.filter(x=>x.track_type===kind);const c=tracks[0]?.clips[0];if(tracks.length!==1||tracks[0]!.clips.length!==1||c?.startMs!==0||c.endMs!==t.contentDurationMs)fail('narration_timeline_global_track_invalid');}
});
export const ComposeTimeline=z.union([ComposeTimelineV1,ComposeTimelineV2]);
export type ComposeTimelineV2=z.infer<typeof ComposeTimelineV2>;

export type ComposeReadiness = z.infer<typeof ComposeReadiness>;
export type ComposeTrackType = z.infer<typeof ComposeTrackType>;
export type ComposeClipKind = z.infer<typeof ComposeClipKind>;
export type ComposeClip = z.infer<typeof ComposeClip>;
export type ComposeTrack = z.infer<typeof ComposeTrack>;
export type ComposeTimelineSegment = z.infer<typeof ComposeTimelineSegment>;
export type ComposeTimeline = z.infer<typeof ComposeTimeline>;

/** 消费者必须验证完整v2合同，不能把缺失来源当legacy。 */
export function assertNarrationTimelineManifest(timeline:unknown,manifest:unknown){
 const t=ComposeTimelineV2.parse(timeline),m=AssetManifestV2.parse(manifest);
 if(t.source_asset_plan_record_id!==m.source_asset_plan_id||t.source_storyboard_record_id!==m.source_storyboard_record_id||t.source_script_record_id!==m.source_script_record_id||JSON.stringify(t.narration_reference)!==JSON.stringify(m.narration_reference)||t.subtitle_revision_id!==m.subtitle_revision_id||t.subtitle_settings_hash!==m.subtitle_settings_hash)throw new Error('narration_render_source_mismatch');
 if(t.segments.length!==m.segment_routes.length||t.segments.some((s,i)=>s.segment_id!==m.segment_routes[i]!.segment_id||s.startMs!==m.segment_routes[i]!.narrationRange.startMs||s.endMs!==m.segment_routes[i]!.narrationRange.endMs))throw new Error('narration_render_interval_mismatch');
 for(const segment of t.segments)projectNarrationFrameRange({startMs:segment.startMs!,endMs:segment.endMs!,fps:t.output_profile.fps});
 for(const track of t.tracks)for(const clip of track.clips){projectNarrationFrameRange({startMs:clip.startMs!,endMs:clip.endMs!,fps:t.output_profile.fps});if(track.track_type==='narration'&&clip.artifact_id!==m.audio_summary.tts_merged_artifact_id||track.track_type==='subtitle'&&clip.artifact_id!==m.audio_summary.subtitle_artifact_id)throw new Error('narration_render_artifact_mismatch');}
 return {timeline:t,manifest:m};
}
