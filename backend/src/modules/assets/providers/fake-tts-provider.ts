/**
 * Fake TTS provider — generates deterministic placeholder audio files for
 * development and testing. Produces one `tts_chunk_audio` artifact per
 * `tts_plan.chunks` entry and one `tts_merged_audio` artifact.
 */

import type {
  AssetProviderAdapter,
  AssetProviderContext,
} from "../assets-provider-adapter.js";
import {
  resolveAssetsRunStorage,
  writeAssetFile,
} from "../assets-file-storage.js";
import { createSilentWavBuffer } from "./audio-fixture.js";

export function createFakeTtsProvider(): AssetProviderAdapter {
  return {
    providerName: "fake_tts",
    providerType: "tts",
    canHandle: ({ taskType }) => taskType === "tts_audio",

    prepare: async (ctx) => ({
      providerJobId: null,
      rawRequestJson: { task_id: ctx.execution.task_id },
    }),

    submit: async (ctx, prepared) => ({
      providerJobId: `fake_job_${ctx.execution.task_id}`,
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

      const voiceProfileId = ctx.manifest.audio_summary.voice_profile_id;
      const chunks = ctx.assetPlan.tts_plan.chunks;
      const artifacts: Array<
        | {
            artifact_id: string;
            artifact_type: "tts_chunk_audio";
            origin: "provider";
            file_uri: string;
            created_at: string;
            metadata: {
              duration_sec: number;
              duration_source: "estimated";
              timing_source: "estimated";
              format: "wav";
              voice_profile_id: string;
              tts_chunk_id: string;
              segment_ids: string[];
              script_excerpt: string;
            };
          }
        | {
            artifact_id: string;
            artifact_type: "tts_merged_audio";
            origin: "provider";
            file_uri: string;
            created_at: string;
            metadata: {
              duration_sec: number;
              duration_source: "estimated";
              timing_source: "estimated";
              format: "wav";
              voice_profile_id: string;
              chunk_artifact_ids: string[];
            };
          }
      > = [];

      const chunkArtifactIds: string[] = [];
      let totalDuration = 0;

      for (const chunk of chunks) {
        const artifactId = `artifact_tts_chunk_${chunk.chunk_id}`;
        const fileName = `tts_${chunk.chunk_id}.wav`;
        const written = await writeAssetFile({
          storage,
          category: "audio/tts",
          fileName,
          data: createSilentWavBuffer({
            durationSec: chunk.estimated_duration_sec,
          }),
        });

        // Find matching tts_chunk_route to get segment_ids
        const chunkRoute = ctx.manifest.audio_summary.tts_chunk_routes.find(
          (r) => r.tts_chunk_id === chunk.chunk_id,
        );
        const segmentIds = chunkRoute?.segment_ids ?? [];

        artifacts.push({
          artifact_id: artifactId,
          artifact_type: "tts_chunk_audio",
          origin: "provider",
          file_uri: written.fileUri,
          created_at: new Date().toISOString(),
          metadata: {
            duration_sec: chunk.estimated_duration_sec,
            duration_source: "estimated",
            timing_source: "estimated",
            format: "wav",
            voice_profile_id: voiceProfileId,
            tts_chunk_id: chunk.chunk_id,
            segment_ids: segmentIds,
            script_excerpt: chunk.script_excerpt,
          },
        });

        chunkArtifactIds.push(artifactId);
        totalDuration += chunk.estimated_duration_sec;
      }

      // Merged audio artifact
      const mergedArtifactId = `artifact_tts_merged_${ctx.execution.task_id}`;
      const mergedWritten = await writeAssetFile({
        storage,
        category: "audio/tts",
        fileName: `tts_merged_${ctx.execution.task_id}.wav`,
        data: createSilentWavBuffer({
          durationSec: totalDuration,
        }),
      });

      artifacts.push({
        artifact_id: mergedArtifactId,
        artifact_type: "tts_merged_audio",
        origin: "provider",
        file_uri: mergedWritten.fileUri,
        created_at: new Date().toISOString(),
        metadata: {
          duration_sec: totalDuration,
          duration_source: "estimated",
          timing_source: "estimated",
          format: "wav",
          voice_profile_id: voiceProfileId,
          chunk_artifact_ids: chunkArtifactIds,
        },
      });

      return { artifacts, notes: ["fake TTS audio generated"] };
    },

    cancel: async () => {},
  };
}
