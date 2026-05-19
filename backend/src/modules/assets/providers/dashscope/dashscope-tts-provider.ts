/**
 * DashScope TTS provider shell.
 *
 * The adapter is opt-in only; the default assets run service still uses fake
 * providers so ordinary tests and local runs do not call paid services.
 * Checked docs: https://help.aliyun.com/zh/model-studio/ (2026-05-16).
 */

import type {
  AssetArtifact,
} from "../../../../../../shared/src/index.js";
import type { DbClient } from "../../../../db/client.js";
import type { AssetProviderAdapter } from "../../assets-provider-adapter.js";
import {
  resolveAssetsRunStorage,
  writeAssetFile,
} from "../../assets-file-storage.js";
import { resolveProviderVoice } from "../../voice/provider-voice-resolution.service.js";

export interface DashScopeTtsInput {
  model: string;
  text: string;
  providerVoiceId: string;
  format?: "mp3" | "wav" | "flac" | "pcm";
  sampleRate?: number;
}

export interface DashScopeTtsPayload {
  model: string;
  input: {
    text: string;
    voice: string;
  };
  parameters: {
    format: string;
    sample_rate?: number;
  };
}

export interface DashScopeTtsProviderOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  format?: "mp3" | "wav" | "flac" | "pcm";
  sampleRate?: number;
  db?: DbClient;
}

export function buildDashscopeTtsPayload(
  input: DashScopeTtsInput,
): DashScopeTtsPayload {
  return {
    model: input.model,
    input: {
      text: input.text,
      voice: input.providerVoiceId,
    },
    parameters: {
      format: input.format ?? "wav",
      sample_rate: input.sampleRate ?? 24000,
    },
  };
}

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl ?? "https://dashscope.aliyuncs.com").replace(/\/$/, "");
}

function endpointFor(baseUrl?: string): string {
  return `${normalizeBaseUrl(baseUrl)}/api/v1/services/aigc/multimodal-generation/generation`;
}

function extractAudioUrl(raw: Record<string, unknown>): string | null {
  const output = raw.output as Record<string, unknown> | undefined;
  const audio = output?.audio as Record<string, unknown> | undefined;
  const url = audio?.url;
  return typeof url === "string" && url.length > 0 ? url : null;
}

async function submitTts(input: {
  apiKey: string;
  endpoint: string;
  payload: DashScopeTtsPayload;
}): Promise<Record<string, unknown>> {
  const response = await fetch(input.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
      "X-DashScope-Async": "disable",
    },
    body: JSON.stringify(input.payload),
  });

  const raw = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`DashScope TTS failed: ${response.status} ${JSON.stringify(raw)}`);
  }
  if (!extractAudioUrl(raw)) {
    throw new Error(`DashScope TTS response missing audio URL: ${JSON.stringify(raw)}`);
  }
  return raw;
}

async function downloadAudio(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`DashScope TTS audio download failed: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export function createDashscopeTtsProvider(
  options: DashScopeTtsProviderOptions,
): AssetProviderAdapter {
  return {
    providerName: "dashscope_tts",
    providerType: "tts",
    canHandle: ({ taskType }) => taskType === "tts_audio",

    prepare: async (ctx) => ({
      providerJobId: null,
      rawRequestJson: {
        endpoint: endpointFor(options.baseUrl),
        model: options.model,
        format: options.format ?? "wav",
        chunk_count: ctx.assetPlan.tts_plan.chunks.length,
      },
    }),

    submit: async (ctx, prepared) => {
      if (!options.apiKey.trim()) {
        throw new Error("dashscope_api_key_missing");
      }

      const endpoint = String(prepared.rawRequestJson.endpoint);
      const voiceProfileId = ctx.manifest.audio_summary.voice_profile_id;
      const providerVoice = options.db
        ? await resolveProviderVoice({
            db: options.db,
            localVoiceProfileId: voiceProfileId,
            apiKey: options.apiKey,
            baseUrl: options.baseUrl,
          })
        : {
            localVoiceProfileId: voiceProfileId,
            providerVoiceId: voiceProfileId,
            targetModel: options.model,
            matchScore: null,
            matchReasons: [] as string[],
          };
      const chunks = [];

      for (const chunk of ctx.assetPlan.tts_plan.chunks) {
        const payload = buildDashscopeTtsPayload({
          model: providerVoice.targetModel,
          text: chunk.script_excerpt,
          providerVoiceId: providerVoice.providerVoiceId,
          format: options.format,
          sampleRate: options.sampleRate,
        });
        const rawResponse = await submitTts({
          apiKey: options.apiKey,
          endpoint,
          payload,
        });
        chunks.push({
          chunk_id: chunk.chunk_id,
          script_excerpt: chunk.script_excerpt,
          estimated_duration_sec: chunk.estimated_duration_sec,
          audio_url: extractAudioUrl(rawResponse),
          provider_voice_id: providerVoice.providerVoiceId,
          voice_profile_match_score: providerVoice.matchScore,
          voice_profile_match_reasons: providerVoice.matchReasons,
          target_model: providerVoice.targetModel,
          raw_response: rawResponse,
        });
      }

      return {
        providerJobId: null,
        rawResponseJson: { chunks },
      };
    },

    poll: async (_ctx, submitted) => ({
      status: "completed",
      rawResponseJson: submitted.rawResponseJson,
    }),

    download: async (ctx, pollResult) => {
      const rawChunks =
        (pollResult.rawResponseJson?.chunks as
          | Array<{
              chunk_id: string;
              script_excerpt: string;
              estimated_duration_sec: number;
              audio_url: string;
              provider_voice_id?: string;
              voice_profile_match_score?: number | null;
              voice_profile_match_reasons?: string[];
              target_model?: string;
            }>
          | undefined) ?? [];
      const storage = resolveAssetsRunStorage({
        projectStorageRootDir: ctx.projectStorageRootDir,
        runId: ctx.assetRunId,
      });
      const voiceProfileId = ctx.manifest.audio_summary.voice_profile_id;
      const artifacts: AssetArtifact[] = [];
      const chunkArtifactIds: string[] = [];
      const chunkBuffers: Buffer[] = [];
      let totalDuration = 0;

      for (const chunk of rawChunks) {
        const buffer = await downloadAudio(chunk.audio_url);
        chunkBuffers.push(buffer);

        const written = await writeAssetFile({
          storage,
          category: "audio/tts",
          fileName: `dashscope_${chunk.chunk_id}.${options.format ?? "wav"}`,
          data: buffer,
        });
        const route = ctx.manifest.audio_summary.tts_chunk_routes.find(
          (item) => item.tts_chunk_id === chunk.chunk_id,
        );
        const artifactId = `artifact_tts_chunk_${chunk.chunk_id}`;
        chunkArtifactIds.push(artifactId);
        totalDuration += chunk.estimated_duration_sec;

        artifacts.push({
          artifact_id: artifactId,
          artifact_type: "tts_chunk_audio",
          origin: "provider",
          file_uri: written.fileUri,
          created_at: new Date().toISOString(),
          metadata: {
            duration_sec: chunk.estimated_duration_sec,
            voice_profile_id: voiceProfileId,
            provider_voice_id: chunk.provider_voice_id,
            voice_profile_match_score:
              chunk.voice_profile_match_score ?? null,
            voice_profile_match_reasons:
              chunk.voice_profile_match_reasons ?? [],
            timing_source: "estimated",
            sample_rate: options.sampleRate ?? 24000,
            format: options.format ?? "wav",
            tts_chunk_id: chunk.chunk_id,
            segment_ids: route?.segment_ids ?? [],
            script_excerpt: chunk.script_excerpt,
            model: chunk.target_model ?? options.model,
            provider_name: "dashscope_tts",
            file_hash: written.fileHash,
            relative_path: written.relativePath,
          },
        });
      }

      const merged = await writeAssetFile({
        storage,
        category: "audio/tts",
        fileName: `dashscope_merged_${ctx.execution.task_id}.${options.format ?? "wav"}`,
        data: Buffer.concat(chunkBuffers),
      });
      artifacts.push({
        artifact_id: `artifact_tts_merged_${ctx.execution.task_id}`,
        artifact_type: "tts_merged_audio",
        origin: "provider",
        file_uri: merged.fileUri,
        created_at: new Date().toISOString(),
        metadata: {
          duration_sec: totalDuration,
          voice_profile_id: voiceProfileId,
          provider_voice_id: rawChunks[0]?.provider_voice_id,
          voice_profile_match_score:
            rawChunks[0]?.voice_profile_match_score ?? null,
          voice_profile_match_reasons:
            rawChunks[0]?.voice_profile_match_reasons ?? [],
          timing_source: "estimated",
          sample_rate: options.sampleRate ?? 24000,
          format: options.format ?? "wav",
          chunk_artifact_ids: chunkArtifactIds,
          model: rawChunks[0]?.target_model ?? options.model,
          provider_name: "dashscope_tts",
          file_hash: merged.fileHash,
          relative_path: merged.relativePath,
        },
      });

      return artifacts;
    },

    normalizeResult: async ({ downloadedArtifacts }) => ({
      artifacts: downloadedArtifacts,
      notes: ["dashscope TTS audio generated"],
    }),

    cancel: async () => undefined,
  };
}
