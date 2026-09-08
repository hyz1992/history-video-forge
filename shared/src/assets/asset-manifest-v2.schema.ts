import { z } from "zod";
import { AssetManifestV1, SegmentAssetRoute, SubtitleStyle } from "./asset-manifest-v1.schema.js";
import { NarrationInteger, NarrationSha256 } from "../narration/narration-timing.schema.js";
import { NarrationReference } from "../narration/narration-reference.schema.js";
const id = z.string().min(1);
export const AssetManifestV2 = AssetManifestV1.extend({
  manifest_version: z.literal("asset_manifest_v2"), narration_reference: NarrationReference,
  subtitle_revision_id: id, subtitle_settings_hash: NarrationSha256,
  segment_routes: z.array(SegmentAssetRoute.extend({ narrationRange: z.object({ startMs: NarrationInteger, endMs: NarrationInteger }).strict().refine(r => r.endMs > r.startMs) })).min(1),
}).superRefine((m, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  const audio = m.artifacts.filter(a => a.artifact_type === "tts_merged_audio");
  const subtitles = m.artifacts.filter(a => a.artifact_type === "subtitle_track");
  if (audio.length !== 1 || subtitles.length !== 1 || m.artifacts.some(a => a.artifact_type === "tts_chunk_audio") || m.executions.some(e => e.task_type === "tts_audio" || e.task_type === "subtitle_track")) fail("narration_manifest_audio_multiplicity");
  if (m.audio_summary.tts_chunk_routes.length || m.audio_summary.tts_chunk_artifact_ids.length) fail("narration_manifest_chunking_forbidden");
  const a = audio[0], s = subtitles[0];
  if (!a || !s) return;
  if (m.audio_summary.tts_merged_artifact_id !== a.artifact_id || m.audio_summary.subtitle_artifact_id !== s.artifact_id || m.audio_summary.tts_total_duration_sec !== m.narration_reference.duration_ms / 1000) fail("narration_manifest_summary_mismatch");
  for (const artifact of [a, s]) {
    const md = artifact.metadata as Record<string, unknown>;
    if (md.narration_record_id !== m.narration_reference.narration_record_id || md.audio_hash !== m.narration_reference.audio_hash || md.timing_map_hash !== m.narration_reference.timing_map_hash || md.timing_source !== "provider_timestamp") fail("narration_manifest_provenance_invalid");
  }
  const am = a.metadata as Record<string, unknown>, sm = s.metadata as Record<string, unknown>;
  if (am.duration_sec !== m.narration_reference.duration_ms / 1000 || am.duration_source !== "audio_probe" || am.voice_profile_id !== m.audio_summary.voice_profile_id || m.execution_options.voice_profile_id !== m.audio_summary.voice_profile_id) fail("narration_manifest_audio_invalid");
  if (sm.subtitle_revision_id !== m.subtitle_revision_id || sm.subtitle_settings_hash !== m.subtitle_settings_hash || sm.source_tts_artifact_id !== a.artifact_id || !SubtitleStyle.safeParse(sm.subtitle_style).success || JSON.stringify(SubtitleStyle.safeParse(sm.subtitle_style).data) !== JSON.stringify(SubtitleStyle.safeParse(m.execution_options.subtitle_style).data)) fail("narration_manifest_subtitle_invalid");
  let end = 0; const ids = new Set<string>();
  for (const route of m.segment_routes) {
    if (ids.has(route.segment_id) || route.narrationRange.startMs !== end || route.narrationRange.endMs > m.narration_reference.duration_ms || route.tts_artifact_id !== a.artifact_id || route.subtitle_artifact_id !== s.artifact_id) fail("narration_manifest_interval_invalid");
    ids.add(route.segment_id); end = route.narrationRange.endMs;
  }
  if (end !== m.narration_reference.duration_ms) fail("narration_manifest_coverage_invalid");
});
export type AssetManifestV2 = z.infer<typeof AssetManifestV2>;
export const VersionedAssetManifest = z.union([AssetManifestV1, AssetManifestV2]);
export type VersionedAssetManifest = z.infer<typeof VersionedAssetManifest>;
