/**
 * Local subtitle provider — reads completed TTS chunk artifacts from the
 * manifest and generates SRT + VTT subtitle files using timing estimates.
 *
 * This provider runs after the TTS provider (priority ordering) and depends
 * on `tts_chunk_artifact_ids` being populated in `audio_summary`.
 */

import type {
  AssetProviderAdapter,
  AssetProviderContext,
} from "../assets-provider-adapter.js";
import {
  resolveAssetsRunStorage,
  writeAssetFile,
} from "../assets-file-storage.js";
import {
  estimateCaptionsFromTtsChunks,
  buildSrtFromCaptions,
  buildVttFromCaptions,
  type TtsSubtitleChunk,
} from "../assets-subtitle-generator.js";

export function createLocalSubtitleProvider(): AssetProviderAdapter {
  return {
    providerName: "local_subtitle",
    providerType: "tts",
    canHandle: ({ taskType }) => taskType === "subtitle_track",

    prepare: async (ctx) => ({
      providerJobId: null,
      rawRequestJson: { task_id: ctx.execution.task_id },
    }),

    submit: async (ctx, prepared) => ({
      providerJobId: `local_job_${ctx.execution.task_id}`,
      rawResponseJson: prepared.rawRequestJson,
    }),

    poll: async (_ctx, submitted) => ({
      status: "completed",
      rawResponseJson: submitted.rawResponseJson,
    }),

    download: async () => [],

    normalizeResult: async ({ ctx }) => {
      const storage = resolveAssetsRunStorage({
        projectStorageRootDir: ctx.projectStorageRootDir,
        runId: ctx.assetRunId,
      });

      // Gather TTS chunk data from completed artifacts
      const chunkArtifactIds = ctx.manifest.audio_summary.tts_chunk_artifact_ids;
      const ttsChunks: TtsSubtitleChunk[] = [];

      for (const artifactId of chunkArtifactIds) {
        const artifact = ctx.manifest.artifacts.find(
          (a) => a.artifact_id === artifactId,
        );
        if (!artifact || artifact.artifact_type !== "tts_chunk_audio") continue;

        const meta = artifact.metadata as {
          duration_sec: number;
          tts_chunk_id: string;
          segment_ids: string[];
          script_excerpt: string;
        };
        ttsChunks.push({
          tts_chunk_id: meta.tts_chunk_id,
          segment_ids: meta.segment_ids,
          script_excerpt: meta.script_excerpt,
          duration_sec: meta.duration_sec,
        });
      }

      // Sort by tts_chunk_id to maintain order (chunk_001, chunk_002, ...)
      ttsChunks.sort((a, b) =>
        a.tts_chunk_id.localeCompare(b.tts_chunk_id),
      );

      const captions = estimateCaptionsFromTtsChunks(ttsChunks);
      const srtContent = buildSrtFromCaptions(captions);
      const vttContent = buildVttFromCaptions(captions);

      // Use the merged TTS artifact as the source reference
      const sourceTtsArtifactId =
        ctx.manifest.audio_summary.tts_merged_artifact_id ??
        (chunkArtifactIds.length > 0 ? chunkArtifactIds[0] : "unknown");

      const now = new Date().toISOString();

      // SRT artifact
      const srtWritten = await writeAssetFile({
        storage,
        category: "subtitles",
        fileName: `subtitle_${ctx.execution.task_id}.srt`,
        data: srtContent,
      });
      const srtArtifactId = `artifact_subtitle_srt_${ctx.execution.task_id}`;

      // VTT artifact
      const vttWritten = await writeAssetFile({
        storage,
        category: "subtitles",
        fileName: `subtitle_${ctx.execution.task_id}.vtt`,
        data: vttContent,
      });
      const vttArtifactId = `artifact_subtitle_vtt_${ctx.execution.task_id}`;

      const artifacts = [
        {
          artifact_id: srtArtifactId,
          artifact_type: "subtitle_track" as const,
          origin: "provider" as const,
          file_uri: srtWritten.fileUri,
          created_at: now,
          metadata: {
            format: "srt",
            source_tts_artifact_id: sourceTtsArtifactId,
            caption_count: captions.length,
          },
        },
        {
          artifact_id: vttArtifactId,
          artifact_type: "subtitle_track" as const,
          origin: "provider" as const,
          file_uri: vttWritten.fileUri,
          created_at: now,
          metadata: {
            format: "vtt",
            source_tts_artifact_id: sourceTtsArtifactId,
            caption_count: captions.length,
          },
        },
      ];

      return { artifacts, notes: ["local subtitles generated"] };
    },

    cancel: async () => {},
  };
}
