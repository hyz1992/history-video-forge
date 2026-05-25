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
  type SubtitleCaption,
} from "../assets-subtitle-generator.js";
import { alignCaptionsFromAsr } from "../asr-caption-aligner.js";
import { transcribeAudioFile } from "./dashscope/dashscope-asr-client.js";
import { DEFAULT_SUBTITLE_STYLE } from "../../../../../shared/src/index.js";

type SubtitleTimingSource =
  | "estimated"
  | "audio_probe"
  | "provider_timestamp"
  | "forced_alignment"
  | "mixed"
  | "provider"
  | "aligned";

export interface LocalSubtitleProviderOptions {
  dashscopeApiKey?: string;
  dashscopeBaseUrl?: string;
}

export function createLocalSubtitleProvider(
  options?: LocalSubtitleProviderOptions,
): AssetProviderAdapter {
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
      const ttsChunks: Array<
        TtsSubtitleChunk & {
          source_artifact_id: string;
          timing_source: SubtitleTimingSource;
        }
      > = [];

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
          timing_source?: string;
        };
        ttsChunks.push({
          tts_chunk_id: meta.tts_chunk_id,
          segment_ids: meta.segment_ids,
          script_excerpt: meta.script_excerpt,
          duration_sec: meta.duration_sec,
          source_artifact_id: artifact.artifact_id,
          timing_source: readTimingSource(meta.timing_source),
        });
      }

      // Sort by tts_chunk_id to maintain order (chunk_001, chunk_002, ...)
      ttsChunks.sort((a, b) =>
        a.tts_chunk_id.localeCompare(b.tts_chunk_id),
      );

      // Try ASR-based alignment when DashScope key is available
      let captions = await tryAsrAlignment(options, ctx, ttsChunks);

      let subtitleTimingSource: SubtitleTimingSource;
      if (captions) {
        subtitleTimingSource = "forced_alignment";
      } else {
        captions = estimateCaptionsFromTtsChunks(ttsChunks);
        subtitleTimingSource = mergeTimingSources(
          ttsChunks.map((chunk) => chunk.timing_source),
        );
      }

      const srtContent = buildSrtFromCaptions(captions);
      const vttContent = buildVttFromCaptions(captions);
      const subtitleDurationSec =
        captions.length > 0 ? captions[captions.length - 1]!.end_sec : undefined;
      const sourceTtsChunkArtifactIds = ttsChunks.map(
        (chunk) => chunk.source_artifact_id,
      );

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
            source_tts_chunk_artifact_ids: sourceTtsChunkArtifactIds,
            caption_count: captions.length,
            ...(subtitleDurationSec === undefined
              ? {}
              : { duration_sec: subtitleDurationSec }),
            timing_source: subtitleTimingSource,
            subtitle_style: DEFAULT_SUBTITLE_STYLE,
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
            source_tts_chunk_artifact_ids: sourceTtsChunkArtifactIds,
            caption_count: captions.length,
            ...(subtitleDurationSec === undefined
              ? {}
              : { duration_sec: subtitleDurationSec }),
            timing_source: subtitleTimingSource,
            subtitle_style: DEFAULT_SUBTITLE_STYLE,
          },
        },
      ];

      return { artifacts, notes: ["local subtitles generated"] };
    },

    cancel: async () => {},
  };
}

function readTimingSource(value: string | undefined): SubtitleTimingSource {
  switch (value) {
    case "audio_probe":
    case "provider_timestamp":
    case "forced_alignment":
    case "mixed":
    case "provider":
    case "aligned":
      return value;
    case "estimated":
    default:
      return "estimated";
  }
}

function mergeTimingSources(
  sources: SubtitleTimingSource[],
): SubtitleTimingSource {
  const unique = new Set(sources.length > 0 ? sources : ["estimated"]);
  return unique.size === 1 ? [...unique][0]! : "mixed";
}

async function tryAsrAlignment(
  options: LocalSubtitleProviderOptions | undefined,
  ctx: AssetProviderContext,
  ttsChunks: Array<TtsSubtitleChunk & { source_artifact_id: string; timing_source: SubtitleTimingSource }>,
): Promise<SubtitleCaption[] | null> {
  if (!options?.dashscopeApiKey) return null;

  const mergedArtifactId = ctx.manifest.audio_summary.tts_merged_artifact_id;
  if (!mergedArtifactId) return null;

  const mergedArtifact = ctx.manifest.artifacts.find(
    (a) => a.artifact_id === mergedArtifactId,
  );
  if (!mergedArtifact) return null;

  const audioFilePath = mergedArtifact.file_uri.replace(/^file:\/\//, "");
  if (!audioFilePath) return null;

  try {
    const asrWords = await transcribeAudioFile({
      apiKey: options.dashscopeApiKey,
      audioFilePath,
      baseUrl: options.dashscopeBaseUrl,
    });

    if (asrWords.length === 0) return null;

    // Concatenate chunk texts and build alignment input
    const scriptText = ttsChunks.map((c) => c.script_excerpt).join("");
    let charOffset = 0;
    const chunkBoundaries: number[] = [];
    const segmentIds: string[][] = [];
    for (const chunk of ttsChunks) {
      chunkBoundaries.push(charOffset);
      segmentIds.push(chunk.segment_ids);
      charOffset += chunk.script_excerpt.length;
    }

    const result = alignCaptionsFromAsr({
      asrWords,
      scriptText,
      chunkBoundaries,
      segmentIds,
    });

    if (!result.aligned) return null;

    return result.captions;
  } catch {
    return null;
  }
}
