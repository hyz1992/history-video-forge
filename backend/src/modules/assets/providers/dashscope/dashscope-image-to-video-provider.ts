/**
 * DashScope image-to-video provider shell.
 *
 * The adapter is opt-in only; default assets runs must not call paid video
 * generation providers.
 * Checked docs: https://help.aliyun.com/zh/model-studio/image-to-video-general-api-reference (2026-05-19).
 */

import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import type { AssetArtifact } from "../../../../../../shared/src/index.js";
import type { AssetProviderAdapter } from "../../assets-provider-adapter.js";
import {
  resolveAssetsRunStorage,
  writeAssetFile,
} from "../../assets-file-storage.js";

export interface DashScopeImageToVideoPayloadInput {
  model: string;
  prompt: string;
  sourceImageUrl: string;
  resolution?: string;
  durationSec?: number;
  promptExtend?: boolean;
  watermark?: boolean;
}

export interface DashScopeImageToVideoPayload {
  model: string;
  input: {
    prompt: string;
    media: Array<{ type: "first_frame"; url: string }>;
  };
  parameters: {
    resolution: string;
    duration: number;
    prompt_extend: boolean;
    watermark: boolean;
  };
}

export interface DashScopeImageToVideoProviderOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  resolution?: string;
  durationSec?: number;
  promptExtend?: boolean;
  watermark?: boolean;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
}

export function clampDashscopeImageToVideoDuration(
  value: number | undefined,
): number {
  const normalized = Number.isFinite(value) ? Math.round(value as number) : 5;
  return Math.min(15, Math.max(2, normalized));
}

export function buildDashscopeImageToVideoPayload(
  input: DashScopeImageToVideoPayloadInput,
): DashScopeImageToVideoPayload {
  return {
    model: input.model,
    input: {
      prompt: input.prompt,
      media: [{ type: "first_frame", url: input.sourceImageUrl }],
    },
    parameters: {
      resolution: input.resolution ?? "720P",
      duration: clampDashscopeImageToVideoDuration(input.durationSec),
      prompt_extend: input.promptExtend ?? true,
      watermark: input.watermark ?? false,
    },
  };
}

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl ?? "https://dashscope.aliyuncs.com").replace(/\/$/, "");
}

function endpointFor(baseUrl?: string): string {
  return `${normalizeBaseUrl(baseUrl)}/api/v1/services/aigc/video-generation/video-synthesis`;
}

function taskEndpointFor(baseUrl: string | undefined, taskId: string): string {
  return `${normalizeBaseUrl(baseUrl)}/api/v1/tasks/${taskId}`;
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function extractTaskId(raw: Record<string, unknown>): string | null {
  const output = raw.output as Record<string, unknown> | undefined;
  return getString(output?.task_id) ?? getString(raw.task_id);
}

function extractVideoUrl(raw: Record<string, unknown> | null): string | null {
  const output = raw?.output as Record<string, unknown> | undefined;
  return getString(output?.video_url) ?? getString(raw?.video_url);
}

function extractTaskStatus(raw: Record<string, unknown>): string {
  const output = (raw.output ?? raw) as Record<string, unknown>;
  return String(output.task_status ?? "").toUpperCase();
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function mimeTypeForFile(fileUri: string): string {
  const extension = extname(fileUri).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".bmp") return "image/bmp";
  if (extension === ".webp") return "image/webp";
  return "image/png";
}

async function readImageAsDataUri(fileUri: string): Promise<string> {
  if (fileUri.startsWith("data:image/")) return fileUri;
  if (fileUri.startsWith("http://") || fileUri.startsWith("https://")) {
    return fileUri;
  }

  const data = await readFile(fileUri);
  return `data:${mimeTypeForFile(fileUri)};base64,${data.toString("base64")}`;
}

function deriveVideoDimensions(resolution: string): {
  width: number;
  height: number;
} {
  if (resolution.toUpperCase() === "1080P") {
    return { width: 1080, height: 1920 };
  }
  return { width: 720, height: 1280 };
}

function findSameSegmentImageArtifact(input: {
  manifest: { artifacts: AssetArtifact[] };
  segmentId: string | null;
  primaryVisualArtifactId: string | null;
  fallbackVisualArtifactId: string | null;
}): AssetArtifact | null {
  if (!input.segmentId) return null;
  const imageById = (artifactId: string | null) =>
    input.manifest.artifacts.find(
      (artifact) =>
        artifact.artifact_id === artifactId &&
        artifact.artifact_type === "image",
    ) ?? null;
  return (
    imageById(input.primaryVisualArtifactId) ??
    imageById(input.fallbackVisualArtifactId)
  );
}

export function createDashscopeImageToVideoProvider(
  options: DashScopeImageToVideoProviderOptions,
): AssetProviderAdapter {
  return {
    providerName: "dashscope_image_to_video",
    providerType: "video",
    canHandle: ({ taskType }) => taskType === "video_clip",

    prepare: async (ctx) => {
      const route = ctx.manifest.segment_routes.find(
        (item) => item.segment_id === ctx.planTask.source_segment_id,
      );
      const sourceImage = findSameSegmentImageArtifact({
        manifest: ctx.manifest,
        segmentId: ctx.planTask.source_segment_id,
        primaryVisualArtifactId: route?.primary_visual_artifact_id ?? null,
        fallbackVisualArtifactId: route?.fallback_visual_artifact_id ?? null,
      });
      if (!sourceImage) {
        throw new Error("dashscope_image_to_video_source_image_missing");
      }

      const sourceImageUrl = await readImageAsDataUri(sourceImage.file_uri);
      const prompt = ctx.planTask.prompt_draft ?? ctx.planTask.source_excerpt;
      const durationSec = clampDashscopeImageToVideoDuration(
        typeof ctx.planTask.parameters.duration_sec === "number"
          ? ctx.planTask.parameters.duration_sec
          : options.durationSec,
      );
      const resolution =
        typeof ctx.planTask.parameters.resolution === "string"
          ? ctx.planTask.parameters.resolution
          : options.resolution ?? "720P";
      const promptExtend =
        typeof ctx.planTask.parameters.prompt_extend === "boolean"
          ? ctx.planTask.parameters.prompt_extend
          : options.promptExtend ?? true;
      const watermark =
        typeof ctx.planTask.parameters.watermark === "boolean"
          ? ctx.planTask.parameters.watermark
          : options.watermark ?? false;
      const payload = buildDashscopeImageToVideoPayload({
        model: options.model,
        prompt,
        sourceImageUrl,
        resolution,
        durationSec,
        promptExtend,
        watermark,
      });

      return {
        providerJobId: null,
        rawRequestJson: {
          endpoint: endpointFor(options.baseUrl),
          payload,
          source_image_artifact_id: sourceImage.artifact_id,
          duration_sec: payload.parameters.duration,
          resolution: payload.parameters.resolution,
          prompt_extend: payload.parameters.prompt_extend,
          watermark: payload.parameters.watermark,
        },
      };
    },

    submit: async (_ctx, prepared) => {
      if (!options.apiKey.trim()) {
        throw new Error("dashscope_api_key_missing");
      }

      const response = await fetch(String(prepared.rawRequestJson.endpoint), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
          "X-DashScope-Async": "enable",
        },
        body: JSON.stringify(prepared.rawRequestJson.payload),
      });
      const rawResponse = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(
          `DashScope image-to-video submit failed: ${response.status} ${JSON.stringify(rawResponse)}`,
        );
      }
      const taskId = extractTaskId(rawResponse);
      if (!taskId) {
        throw new Error(
          `DashScope image-to-video submit missing task_id: ${JSON.stringify(rawResponse)}`,
        );
      }

      return {
        providerJobId: taskId,
        rawResponseJson: {
          ...rawResponse,
          task_id: taskId,
          duration_sec: prepared.rawRequestJson.duration_sec,
          resolution: prepared.rawRequestJson.resolution,
          source_image_artifact_id:
            prepared.rawRequestJson.source_image_artifact_id,
          prompt_extend: prepared.rawRequestJson.prompt_extend,
          watermark: prepared.rawRequestJson.watermark,
        },
      };
    },

    poll: async (_ctx, submitted) => {
      const taskId = getString(submitted.providerJobId);
      if (!taskId) {
        return {
          status: "failed",
          rawResponseJson: submitted.rawResponseJson,
          errorCode: "dashscope_task_id_missing",
          errorMessage: "DashScope image-to-video task id missing",
        };
      }

      const maxAttempts = options.maxPollAttempts ?? 60;
      const pollIntervalMs = options.pollIntervalMs ?? 15000;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const response = await fetch(taskEndpointFor(options.baseUrl, taskId), {
          headers: { Authorization: `Bearer ${options.apiKey}` },
        });
        const rawResponse = (await response.json()) as Record<string, unknown>;
        if (!response.ok) {
          throw new Error(
            `DashScope image-to-video poll failed: ${response.status} ${JSON.stringify(rawResponse)}`,
          );
        }

        const status = extractTaskStatus(rawResponse);
        if (status === "SUCCEEDED") {
          return {
            status: "completed" as const,
            rawResponseJson: {
              ...rawResponse,
              task_id: taskId,
              duration_sec: submitted.rawResponseJson?.duration_sec,
              resolution: submitted.rawResponseJson?.resolution,
              source_image_artifact_id:
                submitted.rawResponseJson?.source_image_artifact_id,
              prompt_extend: submitted.rawResponseJson?.prompt_extend,
              watermark: submitted.rawResponseJson?.watermark,
            },
          };
        }
        if (status === "FAILED" || status === "CANCELED") {
          const output = (rawResponse.output ?? rawResponse) as Record<
            string,
            unknown
          >;
          return {
            status: "failed" as const,
            rawResponseJson: rawResponse,
            errorCode: getString(output.code) ?? status,
            errorMessage: getString(output.message) ?? JSON.stringify(output),
          };
        }
        await sleep(pollIntervalMs);
      }

      return {
        status: "running" as const,
        rawResponseJson: {
          task_id: taskId,
          message:
            "DashScope image-to-video task still running after max poll attempts",
        },
      };
    },

    download: async (ctx, pollResult) => {
      const videoUrl = extractVideoUrl(pollResult.rawResponseJson);
      if (!videoUrl) {
        throw new Error("dashscope_image_to_video_output_url_missing");
      }
      const response = await fetch(videoUrl);
      if (!response.ok) {
        throw new Error(
          `DashScope image-to-video download failed: ${response.status}`,
        );
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const storage = resolveAssetsRunStorage({
        projectStorageRootDir: ctx.projectStorageRootDir,
        runId: ctx.assetRunId,
      });
      const written = await writeAssetFile({
        storage,
        category: "videos",
        fileName: `dashscope_${ctx.execution.task_id}.mp4`,
        data: buffer,
      });
      const resolution = String(
        pollResult.rawResponseJson?.resolution ?? options.resolution ?? "720P",
      );
      const dimensions = deriveVideoDimensions(resolution);
      const durationSec =
        typeof pollResult.rawResponseJson?.duration_sec === "number"
          ? pollResult.rawResponseJson.duration_sec
          : clampDashscopeImageToVideoDuration(options.durationSec);

      const artifact: AssetArtifact = {
        artifact_id: `artifact_video_${ctx.execution.task_id}_${Date.now().toString(36)}`,
        artifact_type: "video",
        origin: "provider",
        file_uri: written.fileUri,
        created_at: new Date().toISOString(),
        metadata: {
          duration_sec: durationSec,
          width: dimensions.width,
          height: dimensions.height,
          fps: 24,
          model: options.model,
          provider_name: "dashscope_image_to_video",
          provider_job_id:
            getString(pollResult.rawResponseJson?.task_id) ?? undefined,
          source_image_artifact_id:
            getString(pollResult.rawResponseJson?.source_image_artifact_id) ??
            undefined,
          source_url: videoUrl,
          file_hash: written.fileHash,
          relative_path: written.relativePath,
          resolution,
          prompt_extend: pollResult.rawResponseJson?.prompt_extend ?? true,
          watermark: pollResult.rawResponseJson?.watermark ?? false,
        },
      };
      return [artifact];
    },

    normalizeResult: async ({ downloadedArtifacts }) => ({
      artifacts: downloadedArtifacts,
      notes: ["dashscope image-to-video generated"],
    }),

    cancel: async () => undefined,
  };
}
