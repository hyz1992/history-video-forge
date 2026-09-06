import { assertNarrationExecutionCompatibility } from "../../../narration/narration-execution-compatibility.js";
import { getVoiceProfileById } from "../../voice/voice-profile.repository.js";
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
import { readAudioDurationSec } from "../../audio-duration-probe.js";
import { resolveProviderVoice } from "../../voice/provider-voice-resolution.service.js";
import { mergeWavBuffers } from "../../wav-merge.js";

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

const FALLBACK_MAX_CHARS = 180;

async function submitChunkWithFallback(input: {
  apiKey: string;
  endpoint: string;
  model: string;
  providerVoiceId: string;
  format?: "mp3" | "wav" | "flac" | "pcm";
  sampleRate?: number;
  chunkId: string;
  text: string;
  estimatedDurationSec: number;
}): Promise<
  Array<{
    chunk_id: string;
    script_excerpt: string;
    estimated_duration_sec: number;
    audio_url: string | null;
    raw_response: Record<string, unknown>;
  }>
> {
  try {
    const payload = buildDashscopeTtsPayload({
      model: input.model,
      text: input.text,
      providerVoiceId: input.providerVoiceId,
      format: input.format,
      sampleRate: input.sampleRate,
    });
    const rawResponse = await submitTts({
      apiKey: input.apiKey,
      endpoint: input.endpoint,
      payload,
    });
    return [
      {
        chunk_id: input.chunkId,
        script_excerpt: input.text,
        estimated_duration_sec: input.estimatedDurationSec,
        audio_url: extractAudioUrl(rawResponse),
        raw_response: rawResponse,
      },
    ];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      input.text.length <= FALLBACK_MAX_CHARS ||
      !isRetryableLengthError(message)
    ) {
      throw err;
    }

    const pieces = splitForFallback(input.text);
    const totalChars = pieces.reduce((sum, p) => sum + p.length, 0);
    const results: Array<{
      chunk_id: string;
      script_excerpt: string;
      estimated_duration_sec: number;
      audio_url: string | null;
      raw_response: Record<string, unknown>;
    }> = [];

    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i]!;
      const charRatio = totalChars > 0 ? piece.length / totalChars : 1 / pieces.length;
      const duration = i === pieces.length - 1
        ? input.estimatedDurationSec - results.reduce((s, r) => s + r.estimated_duration_sec, 0)
        : input.estimatedDurationSec * charRatio;

      const payload = buildDashscopeTtsPayload({
        model: input.model,
        text: piece,
        providerVoiceId: input.providerVoiceId,
        format: input.format,
        sampleRate: input.sampleRate,
      });
      const rawResponse = await submitTts({
        apiKey: input.apiKey,
        endpoint: input.endpoint,
        payload,
      });
      results.push({
        chunk_id: `${input.chunkId}_fb_${i + 1}`,
        script_excerpt: piece,
        estimated_duration_sec: Math.max(0.5, duration),
        audio_url: extractAudioUrl(rawResponse),
        raw_response: rawResponse,
      });
    }

    return results;
  }
}

function isRetryableLengthError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("token") ||
    lower.includes("length") ||
    lower.includes("too long") ||
    lower.includes("text_too_long") ||
    lower.includes("字数") ||
    lower.includes("limit") ||
    lower.includes("400") ||
    lower.includes("invalid") ||
    lower.includes("exceed")
  );
}

function splitForFallback(text: string): string[] {
  const parts = text.split(/([。！？!?；;])/u);
  const sentences: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const body = parts[i] ?? "";
    const punct = parts[i + 1] ?? "";
    const s = `${body}${punct}`.trim();
    if (s) sentences.push(s);
  }
  if (sentences.length <= 1) {
    const fallback: string[] = [];
    for (let i = 0; i < text.length; i += FALLBACK_MAX_CHARS) {
      const piece = text.slice(i, i + FALLBACK_MAX_CHARS).trim();
      if (piece) fallback.push(piece);
    }
    return fallback.length > 0 ? fallback : [text];
  }
  const pieces: string[] = [];
  let current = "";
  for (const s of sentences) {
    if (current && current.length + s.length > FALLBACK_MAX_CHARS) {
      pieces.push(current);
      current = s;
    } else {
      current += s;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

export function createDashscopeTtsProvider(
  options: DashScopeTtsProviderOptions,
): AssetProviderAdapter {
  return {
    providerName: "dashscope_tts",
    providerType: "tts",
    // S2-2A 任务 9A：真实付费 adapter，受付费闸门与 usage 记账约束
    billing: { capability: "tts.synthesize", providerKey: "dashscope", modelId: options.model },
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
      const profile = options.db ? await getVoiceProfileById(options.db, voiceProfileId) : null;
      const compatibility = {
        catalog: [...options.db?.providerModelCatalog.values() ?? []],
        operation: "assets.generate" as const,
        providerKey: "dashscope",
        modelId: options.model,
        voice: profile,
      };
      assertNarrationExecutionCompatibility(compatibility);
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
      assertNarrationExecutionCompatibility({
        ...compatibility,
        actualVoiceTarget: providerVoice.targetModel,
        actualProviderVoiceId: providerVoice.providerVoiceId,
      });
      const allChunks = ctx.assetPlan.tts_plan.chunks;
      const fullText = allChunks.map((c) => c.script_excerpt).join("");
      const totalEstimatedDuration = allChunks.reduce(
        (sum, c) => sum + c.estimated_duration_sec,
        0,
      );

      if (fullText.length <= 500 && allChunks.length > 1) {
        const subPieces = await submitChunkWithFallback({
          apiKey: options.apiKey,
          endpoint,
          model: providerVoice.targetModel,
          providerVoiceId: providerVoice.providerVoiceId,
          format: options.format,
          sampleRate: options.sampleRate,
          chunkId: "single",
          text: fullText,
          estimatedDurationSec: totalEstimatedDuration,
        });
        const chunks = subPieces.map((piece) => ({
          ...piece,
          provider_voice_id: providerVoice.providerVoiceId,
          voice_profile_match_score: providerVoice.matchScore,
          voice_profile_match_reasons: providerVoice.matchReasons,
          target_model: providerVoice.targetModel,
        }));
        return {
          providerJobId: null,
          rawResponseJson: {
            chunks,
            single_synthesis: true,
            original_chunks: allChunks.map((c) => ({
              chunk_id: c.chunk_id,
              script_excerpt: c.script_excerpt,
              estimated_duration_sec: c.estimated_duration_sec,
            })),
          },
        };
      }

      const chunks = [];
      for (const chunk of allChunks) {
        const subPieces = await submitChunkWithFallback({
          apiKey: options.apiKey,
          endpoint,
          model: providerVoice.targetModel,
          providerVoiceId: providerVoice.providerVoiceId,
          format: options.format,
          sampleRate: options.sampleRate,
          chunkId: chunk.chunk_id,
          text: chunk.script_excerpt,
          estimatedDurationSec: chunk.estimated_duration_sec,
        });
        for (const piece of subPieces) {
          chunks.push({
            ...piece,
            provider_voice_id: providerVoice.providerVoiceId,
            voice_profile_match_score: providerVoice.matchScore,
            voice_profile_match_reasons: providerVoice.matchReasons,
            target_model: providerVoice.targetModel,
          });
        }
      }

      return {
        providerJobId: null,
        rawResponseJson: { chunks, single_synthesis: false },
      };
    },

    poll: async (_ctx, submitted) => ({
      status: "completed",
      rawResponseJson: submitted.rawResponseJson,
    }),

    download: async (ctx, pollResult) => {
      const rawResponse = pollResult.rawResponseJson ?? {};
      const isSingleSynthesis = rawResponse.single_synthesis === true;
      const rawChunks =
        (rawResponse.chunks as
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
      const format = options.format ?? "wav";

      if (isSingleSynthesis) {
        const chunkBuffers: Buffer[] = [];
        for (const chunk of rawChunks) {
          chunkBuffers.push(await downloadAudio(chunk.audio_url));
        }
        const mergedBuffer =
          format === "wav" && chunkBuffers.length > 1
            ? mergeWavBuffers(chunkBuffers, { crossfadeMs: 30 })
            : chunkBuffers.length === 1
              ? chunkBuffers[0]!
              : Buffer.concat(chunkBuffers);

        const totalEstimatedDuration = rawChunks.reduce(
          (sum, c) => sum + c.estimated_duration_sec,
          0,
        );
        const probedTotalSec = readAudioDurationSec({
          data: mergedBuffer,
          format,
          sampleRate: options.sampleRate ?? 24000,
          bytesPerSample: 2,
          channels: 1,
        });
        const totalDurationSec = probedTotalSec ?? totalEstimatedDuration;
        const durationWasProbed = probedTotalSec !== null;

        const mergedWritten = await writeAssetFile({
          storage,
          category: "audio/tts",
          fileName: `dashscope_merged_single.${format}`,
          data: mergedBuffer,
        });

        const originalChunks = (rawResponse.original_chunks as Array<{
          chunk_id: string;
          script_excerpt: string;
          estimated_duration_sec: number;
        }>) ?? [];
        const totalChars = originalChunks.reduce(
          (sum, c) => sum + c.script_excerpt.length,
          0,
        );

        const chunkArtifactIds: string[] = [];
        let allocatedDuration = 0;

        for (let i = 0; i < originalChunks.length; i++) {
          const chunk = originalChunks[i]!;
          const isLast = i === originalChunks.length - 1;
          const charRatio =
            totalChars > 0
              ? chunk.script_excerpt.length / totalChars
              : 1 / originalChunks.length;
          const durationSec = isLast
            ? totalDurationSec - allocatedDuration
            : totalDurationSec * charRatio;
          allocatedDuration += durationSec;

          const route = ctx.manifest.audio_summary.tts_chunk_routes.find(
            (item) => item.tts_chunk_id === chunk.chunk_id,
          );
          const artifactId = `artifact_tts_chunk_${chunk.chunk_id}`;
          chunkArtifactIds.push(artifactId);

          artifacts.push({
            artifact_id: artifactId,
            artifact_type: "tts_chunk_audio",
            origin: "provider",
            file_uri: mergedWritten.fileUri,
            created_at: new Date().toISOString(),
            metadata: {
              duration_sec: durationSec,
              estimated_duration_sec: chunk.estimated_duration_sec,
              duration_source: durationWasProbed
                ? "audio_probe_proportional"
                : "estimated",
              voice_profile_id: voiceProfileId,
              provider_voice_id: rawChunks[0]?.provider_voice_id,
              voice_profile_match_score:
                rawChunks[0]?.voice_profile_match_score ?? null,
              voice_profile_match_reasons:
                rawChunks[0]?.voice_profile_match_reasons ?? [],
              timing_source: durationWasProbed
                ? "audio_probe_proportional"
                : "estimated",
              sample_rate: options.sampleRate ?? 24000,
              format,
              tts_chunk_id: chunk.chunk_id,
              segment_ids: route?.segment_ids ?? [],
              script_excerpt: chunk.script_excerpt,
              model: rawChunks[0]?.target_model ?? options.model,
              provider_name: "dashscope_tts",
              file_hash: mergedWritten.fileHash,
              relative_path: mergedWritten.relativePath,
            },
          });
        }

        artifacts.push({
          artifact_id: `artifact_tts_merged_${ctx.execution.task_id}`,
          artifact_type: "tts_merged_audio",
          origin: "provider",
          file_uri: mergedWritten.fileUri,
          created_at: new Date().toISOString(),
          metadata: {
            duration_sec: totalDurationSec,
            estimated_duration_sec: totalEstimatedDuration,
            duration_source: durationWasProbed ? "audio_probe" : "estimated",
            voice_profile_id: voiceProfileId,
            provider_voice_id: rawChunks[0]?.provider_voice_id,
            voice_profile_match_score:
              rawChunks[0]?.voice_profile_match_score ?? null,
            voice_profile_match_reasons:
              rawChunks[0]?.voice_profile_match_reasons ?? [],
            timing_source: durationWasProbed ? "audio_probe" : "estimated",
            ...(durationWasProbed
              ? {}
              : { duration_probe_error: "audio_duration_probe_unavailable" }),
            sample_rate: options.sampleRate ?? 24000,
            format,
            chunk_artifact_ids: chunkArtifactIds,
            model: rawChunks[0]?.target_model ?? options.model,
            provider_name: "dashscope_tts",
            file_hash: mergedWritten.fileHash,
            relative_path: mergedWritten.relativePath,
          },
        });
      } else {
        const chunkArtifactIds: string[] = [];
        const chunkBuffers: Buffer[] = [];
        let totalDuration = 0;
        let totalEstimatedDuration = 0;
        let allDurationsProbed = true;

        for (const chunk of rawChunks) {
          const buffer = await downloadAudio(chunk.audio_url);
          chunkBuffers.push(buffer);
          const probedDurationSec = readAudioDurationSec({
            data: buffer,
            format: options.format ?? "wav",
            sampleRate: options.sampleRate ?? 24000,
            bytesPerSample: 2,
            channels: 1,
          });
          const durationWasProbed = probedDurationSec !== null;
          const durationSec = probedDurationSec ?? chunk.estimated_duration_sec;
          if (!durationWasProbed) {
            allDurationsProbed = false;
          }

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
          totalDuration += durationSec;
          totalEstimatedDuration += chunk.estimated_duration_sec;

          artifacts.push({
            artifact_id: artifactId,
            artifact_type: "tts_chunk_audio",
            origin: "provider",
            file_uri: written.fileUri,
            created_at: new Date().toISOString(),
            metadata: {
              duration_sec: durationSec,
              estimated_duration_sec: chunk.estimated_duration_sec,
              duration_source: durationWasProbed ? "audio_probe" : "estimated",
              voice_profile_id: voiceProfileId,
              provider_voice_id: chunk.provider_voice_id,
              voice_profile_match_score:
                chunk.voice_profile_match_score ?? null,
              voice_profile_match_reasons:
                chunk.voice_profile_match_reasons ?? [],
              timing_source: durationWasProbed ? "audio_probe" : "estimated",
              ...(durationWasProbed
                ? {}
                : { duration_probe_error: "audio_duration_probe_unavailable" }),
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

        const mergedData =
          format === "wav" && chunkBuffers.length > 1
            ? mergeWavBuffers(chunkBuffers, { crossfadeMs: 30 })
            : Buffer.concat(chunkBuffers);
        const merged = await writeAssetFile({
          storage,
          category: "audio/tts",
          fileName: `dashscope_merged_${ctx.execution.task_id}.${format}`,
          data: mergedData,
        });
        artifacts.push({
          artifact_id: `artifact_tts_merged_${ctx.execution.task_id}`,
          artifact_type: "tts_merged_audio",
          origin: "provider",
          file_uri: merged.fileUri,
          created_at: new Date().toISOString(),
          metadata: {
            duration_sec: totalDuration,
            estimated_duration_sec: totalEstimatedDuration,
            duration_source: allDurationsProbed ? "audio_probe" : "estimated",
            voice_profile_id: voiceProfileId,
            provider_voice_id: rawChunks[0]?.provider_voice_id,
            voice_profile_match_score:
              rawChunks[0]?.voice_profile_match_score ?? null,
            voice_profile_match_reasons:
              rawChunks[0]?.voice_profile_match_reasons ?? [],
            timing_source: allDurationsProbed ? "audio_probe" : "estimated",
            ...(allDurationsProbed
              ? {}
              : { duration_probe_error: "audio_duration_probe_unavailable" }),
            sample_rate: options.sampleRate ?? 24000,
            format,
            chunk_artifact_ids: chunkArtifactIds,
            model: rawChunks[0]?.target_model ?? options.model,
            provider_name: "dashscope_tts",
            file_hash: merged.fileHash,
            relative_path: merged.relativePath,
          },
        });
      }

      return artifacts;
    },

    normalizeResult: async ({ downloadedArtifacts }) => ({
      artifacts: downloadedArtifacts,
      notes: ["dashscope TTS audio generated"],
    }),

    cancel: async () => undefined,
  };
}
