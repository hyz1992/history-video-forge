import { AssetManifestV2, AssetPlanV2, NarrationRecord, NarrationSubtitleRevision, type AssetExecutionOptions, type StoryboardPlan } from "../../../../shared/src/index.js";
import { NarrationBundleStorage } from "../narration/narration-bundle-storage.js";
import { verifyStoryboardNarrationContext } from "../storyboard/storyboard-narration-context.js";
import { validateAssetPlan } from "../asset-planning/asset-planning-local-validator.js";
import { buildNarrationVisualSkeleton } from "./assets-manifest-builder.js";
import { resolveNarrationFilePath } from "./artifact-file-resolver.js";

export async function importNarrationManifest(input: {
  assetPlanRecordId: string; assetPlan: unknown; storyboard: StoryboardPlan;
  record: unknown; revision: unknown; storageRootDir: string; executionOptions?: AssetExecutionOptions;
}): Promise<AssetManifestV2> {
  const record = NarrationRecord.parse(input.record), revision = NarrationSubtitleRevision.parse(input.revision), plan = AssetPlanV2.parse(input.assetPlan);
  if (record.status !== "confirmed" || !record.output || revision.narrationRecordId !== record.id || revision.projectId !== record.projectId) throw new Error("narration_manifest_source_invalid");
  const reference = { narration_record_id: record.id, audio_hash: record.output.audio.sha256, timing_map_hash: record.output.timingMap.sha256, duration_ms: record.output.durationMs };
  const store = new NarrationBundleStorage({ projectId: record.projectId, storageRootDir: input.storageRootDir });
  const bytes = await store.readFile({ record, kind: "timing" });
  const timing = verifyStoryboardNarrationContext({ timingMap: JSON.parse(bytes.toString("utf8")), narrationReference: reference });
  const validation = validateAssetPlan({ storyboardRecordId: plan.source_storyboard_record_id, scriptRecordId: record.scriptRecordId, topicPackageId: plan.source_topic_package_id,
    storyboard: input.storyboard, scriptText: timing.timingMap.sourceText, plan, narrationTiming: timing });
  if (validation.decision !== "pass") throw new Error("narration_manifest_plan_invalid");
  const subtitle = await store.readSubtitleRevision({ record, revision });
  const options: AssetExecutionOptions = { execution_mode: input.executionOptions?.execution_mode ?? "auto_available", voice_profile_id: record.settings.voice,
    enabled_provider_types: (input.executionOptions?.enabled_provider_types ?? ["image", "video", "sfx", "bgm"]).filter(p => p !== "tts"), allow_manual_placeholders: input.executionOptions?.allow_manual_placeholders ?? false,
    subtitle_style: revision.subtitleSettingsSnapshotJson.resolvedStyle };
  const visual = buildNarrationVisualSkeleton(plan, options), audioId = "narration_audio_" + record.id, subtitleId = "narration_subtitle_" + revision.id;
  const provenance = { narration_record_id: record.id, audio_hash: reference.audio_hash, timing_map_hash: reference.timing_map_hash, timing_source: "provider_timestamp" };
  const resolve = (fileUri: string) => resolveNarrationFilePath({ projectStorageRootDir: input.storageRootDir, runId: record.generationRunId, fileUri });
  const audioPath = await resolve(record.output.audio.uri), subtitlePath = await resolve(revision.srt.uri);
  return AssetManifestV2.parse({ manifest_version: "asset_manifest_v2", source_asset_plan_id: input.assetPlanRecordId, source_storyboard_record_id: plan.source_storyboard_record_id, source_script_record_id: record.scriptRecordId,
    narration_reference: reference, subtitle_revision_id: revision.id, subtitle_settings_hash: revision.subtitleSettingsHash,
    execution_options: options, executions: visual.executions,
    artifacts: [...visual.artifacts,
      { artifact_id: audioId, artifact_type: "tts_merged_audio", origin: "local", file_uri: audioPath, created_at: record.createdAt,
        metadata: { ...provenance, duration_sec: reference.duration_ms / 1000, duration_source: "audio_probe", voice_profile_id: record.settings.voice, provider_voice_id: record.settings.voice, sample_rate: record.settings.sampleRate, format: "wav", chunk_artifact_ids: [] } },
      { artifact_id: subtitleId, artifact_type: "subtitle_track", origin: "local", file_uri: subtitlePath, created_at: revision.createdAt,
        metadata: { ...provenance, format: "srt", source_tts_artifact_id: audioId, source_tts_chunk_artifact_ids: [], caption_count: subtitle.timeline.cues.length, duration_sec: reference.duration_ms / 1000,
          subtitle_revision_id: revision.id, subtitle_settings_hash: revision.subtitleSettingsHash, subtitle_style: revision.subtitleSettingsSnapshotJson.resolvedStyle } }],
    audio_summary: { voice_profile_id: record.settings.voice, tts_total_duration_sec: reference.duration_ms / 1000, tts_chunk_artifact_ids: [], tts_chunk_routes: [], tts_merged_artifact_id: audioId, subtitle_artifact_id: subtitleId, bgm_placements: visual.bgmPlacements, sfx_artifact_ids: [] },
    segment_routes: visual.segmentRoutes.map(route => { const range = plan.narration_intervals.find(i => i.segment_id === route.segment_id)!.range; return { ...route, tts_artifact_id: audioId, subtitle_artifact_id: subtitleId, narrationRange: { startMs: range.visual_start_ms, endMs: range.visual_end_ms } }; }),
    readiness: "blocked", notes: [],
  });
}
