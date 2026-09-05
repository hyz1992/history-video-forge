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
import type {
  AssetProviderAdapter,
  AssetProviderPreparedJob,
  AssetProviderSubmittedJob,
  AssetProviderPollResult,
} from "../../assets-provider-adapter.js";
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
  input:
    | {
        prompt: string;
        media: Array<{ type: "first_frame"; url: string }>;
      }
    | {
        prompt: string;
        img_url: string;
      };
  parameters: {
    resolution: string;
    duration: number;
    prompt_extend: boolean;
    watermark: boolean;
    /** wan2.6 系列显式有声（audio=false 为无声版）；wan2.7 无此参数（默认有声）。 */
    audio?: boolean;
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
  const normalized = Number.isFinite(value) ? Math.ceil(value as number) : 5;
  return Math.min(15, Math.max(2, normalized));
}

/**
 * wan2.6 系列（wan2.6-i2v-flash 等）与 wan2.7 的请求体结构不同：
 * - wan2.6 用 `input.img_url` 传首帧图，`parameters.audio` 控制有声（true 有声 / false 无声）。
 * - wan2.7 用 `input.media: [{type:"first_frame",url}]`，无 audio 参数（默认有声）。
 * 未知模型按 wan2.7 格式构造（fail-safe 到已验证路径）。
 */
export function isWan26ImageToVideoModel(model: string): boolean {
  return model.includes("wan2.6");
}

export function buildDashscopeImageToVideoPayload(
  input: DashScopeImageToVideoPayloadInput,
): DashScopeImageToVideoPayload {
  const useWan26Input = isWan26ImageToVideoModel(input.model);
  const parameters: DashScopeImageToVideoPayload["parameters"] = {
    resolution: input.resolution ?? "720P",
    duration: clampDashscopeImageToVideoDuration(input.durationSec),
    prompt_extend: input.promptExtend ?? true,
    watermark: input.watermark ?? false,
    ...(useWan26Input ? { audio: true } : {}),
  };
  return {
    model: input.model,
    input: useWan26Input
      ? { prompt: input.prompt, img_url: input.sourceImageUrl }
      : { prompt: input.prompt, media: [{ type: "first_frame", url: input.sourceImageUrl }] },
    parameters,
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

/* -------------------------------------------------------------------------- */
/*  Split helpers                                                             */
/* -------------------------------------------------------------------------- */

interface SplitPlan {
  count: number;
  durationPerSplit: number;
}

interface SplitJob {
  prepared: AssetProviderPreparedJob;
  submitted: AssetProviderSubmittedJob | null;
  pollResult: AssetProviderPollResult | null;
  artifact: AssetArtifact | null;
}

function computeSplitPlan(ttsDurationSec: number): SplitPlan | null {
  if (ttsDurationSec <= 15) return null;
  const count = Math.ceil(ttsDurationSec / 15);
  const durationPerSplit = Math.ceil(ttsDurationSec / count);
  return { count, durationPerSplit };
}

export function createDashscopeImageToVideoProvider(
  options: DashScopeImageToVideoProviderOptions,
): AssetProviderAdapter {
  let splitJobs: SplitJob[] = [];

  return {
    providerName: "dashscope_image_to_video",
    providerType: "video",
    // S2-2A 任务 9A：真实付费 adapter，受付费闸门与 usage 记账约束
    billing: { capability: "video.image_to_video", providerKey: "dashscope", modelId: options.model },
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

      const ttsMeta = route?.tts_artifact_id
        ? (ctx.manifest.artifacts.find(
            (a) => a.artifact_id === route.tts_artifact_id,
          )?.metadata as Record<string, unknown> | undefined)
        : undefined;
      const ttsDurationSec =
        typeof ttsMeta?.duration_sec === "number" ? ttsMeta.duration_sec : undefined;
      // 仅当 TTS chunk 带真实探测标记（duration_source）时以口播时长为准。
      // 正式枚举含 "estimated"：fake TTS 与 DashScope 探测失败路径都写该值，
      // 属估计占位而非实测，不能覆盖显式时长（与 compose shouldProbeAudioDuration 同源）。
      const ttsIsMeasured =
        typeof ttsMeta?.duration_source === "string" &&
        ttsMeta.duration_source !== "estimated";

      const explicitDurationSec =
        typeof ctx.planTask.parameters.duration_sec === "number"
          ? ctx.planTask.parameters.duration_sec
          : options.durationSec;
      // 2026-09-04 修复：视频时长以该段实际口播（TTS chunk）为准——plan 里的
      // duration_sec 是资产规划按脚本节奏的估计值，与真实口播偏差可达数秒，
      // 生成过长视频会被 compose 裁剪、过短会截断口播。TTS 在 manifest 就绪，
      // 优先于估计值；显式值仅在无 TTS 时作兜底。
      const durationInput =
        (ttsIsMeasured && typeof ttsDurationSec === "number" && ttsDurationSec > 0
          ? Math.ceil(ttsDurationSec)
          : undefined) ??
        explicitDurationSec;

      const durationSec = clampDashscopeImageToVideoDuration(durationInput);
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

      // 2026-08-29 修复：时长超过单任务上限时必须拆分多段，不能 clamp 静默截断
      // （口播对不上、卡帧）。拆分判断基于未 clamp 的 durationInput（TTS 优先
      // 解析后的总时长），拆分后每段 ≤15s；computeSplitPlan 对 ≤15s 返回 null，
      // 不影响正常单段任务。
      const splitPlan =
        typeof durationInput === "number" && Number.isFinite(durationInput)
          ? computeSplitPlan(durationInput)
          : null;

      if (splitPlan) {
        splitJobs = [];
        for (let i = 0; i < splitPlan.count; i++) {
          const payload = buildDashscopeImageToVideoPayload({
            model: options.model,
            prompt,
            sourceImageUrl,
            resolution,
            durationSec: splitPlan.durationPerSplit,
            promptExtend,
            watermark,
          });
          splitJobs.push({
            prepared: {
              providerJobId: null,
              rawRequestJson: {
                endpoint: endpointFor(options.baseUrl),
                payload,
                source_image_artifact_id: sourceImage.artifact_id,
                duration_sec: payload.parameters.duration,
                resolution: payload.parameters.resolution,
                prompt_extend: payload.parameters.prompt_extend,
                watermark: payload.parameters.watermark,
                split_index: i,
                split_total: splitPlan.count,
              },
            },
            submitted: null,
            pollResult: null,
            artifact: null,
          });
        }
        return splitJobs[0].prepared;
      }

      splitJobs = [];

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

      const submitOne = async (
        prep: AssetProviderPreparedJob,
      ): Promise<AssetProviderSubmittedJob> => {
        const response = await fetch(String(prep.rawRequestJson.endpoint), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable",
          },
          body: JSON.stringify(prep.rawRequestJson.payload),
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
            duration_sec: prep.rawRequestJson.duration_sec,
            resolution: prep.rawRequestJson.resolution,
            source_image_artifact_id: prep.rawRequestJson.source_image_artifact_id,
            prompt_extend: prep.rawRequestJson.prompt_extend,
            watermark: prep.rawRequestJson.watermark,
            split_index: prep.rawRequestJson.split_index,
            split_total: prep.rawRequestJson.split_total,
          },
        };
      };

      if (splitJobs.length > 0) {
        for (let i = 0; i < splitJobs.length; i++) {
          splitJobs[i].submitted = await submitOne(splitJobs[i].prepared);
        }
        return splitJobs[0].submitted!;
      }

      return submitOne(prepared);
    },

    poll: async (_ctx, submitted) => {
      const pollOne = async (
        sub: AssetProviderSubmittedJob,
      ): Promise<AssetProviderPollResult> => {
        const taskId = getString(sub.providerJobId);
        if (!taskId) {
          return {
            status: "failed",
            rawResponseJson: sub.rawResponseJson,
            errorCode: "dashscope_task_id_missing",
            errorMessage: "DashScope image-to-video task id missing",
          };
        }

        const maxAttempts = options.maxPollAttempts ?? 60;
        const pollIntervalMs = options.pollIntervalMs ?? 15000;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          const response = await fetch(
            taskEndpointFor(options.baseUrl, taskId),
            { headers: { Authorization: `Bearer ${options.apiKey}` } },
          );
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
                duration_sec: sub.rawResponseJson?.duration_sec,
                resolution: sub.rawResponseJson?.resolution,
                source_image_artifact_id:
                  sub.rawResponseJson?.source_image_artifact_id,
                prompt_extend: sub.rawResponseJson?.prompt_extend,
                watermark: sub.rawResponseJson?.watermark,
                split_index: sub.rawResponseJson?.split_index,
                split_total: sub.rawResponseJson?.split_total,
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
              errorMessage:
                getString(output.message) ?? JSON.stringify(output),
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
      };

      if (splitJobs.length > 0) {
        let anyRunning = false;
        for (let i = 0; i < splitJobs.length; i++) {
          if (!splitJobs[i].pollResult) {
            splitJobs[i].pollResult = await pollOne(
              splitJobs[i].submitted!,
            );
          }
          if (splitJobs[i].pollResult?.status === "running") {
            anyRunning = true;
          }
        }
        if (anyRunning) {
          return { status: "running", rawResponseJson: {} };
        }
        const failed = splitJobs.find(
          (j) => j.pollResult?.status === "failed",
        );
        if (failed) return failed.pollResult!;
        return { status: "completed", rawResponseJson: {} };
      }

      return pollOne(submitted);
    },

    download: async (ctx, pollResult) => {
      const downloadOne = async (
        pr: AssetProviderPollResult,
      ): Promise<AssetArtifact> => {
        const videoUrl = extractVideoUrl(pr.rawResponseJson);
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
        // 2026-08-29 修复（审查 P1）：拆分多段必须各自独立落盘——
        // writeAssetFile 覆盖写，此前固定文件名会让后段覆盖前段，
        // 所有 artifact 指向同一份最后下载的视频。
        const splitIndex =
          typeof pr.rawResponseJson?.split_index === "number"
            ? pr.rawResponseJson.split_index
            : null;
        const splitSuffix = splitIndex !== null ? `_part${splitIndex + 1}` : "";
        const written = await writeAssetFile({
          storage,
          category: "videos",
          fileName: `dashscope_${ctx.execution.task_id}${splitSuffix}.mp4`,
          data: buffer,
        });
        const resolution = String(
          pr.rawResponseJson?.resolution ?? options.resolution ?? "720P",
        );
        const dimensions = deriveVideoDimensions(resolution);
        const durationSec =
          typeof pr.rawResponseJson?.duration_sec === "number"
            ? pr.rawResponseJson.duration_sec
            : clampDashscopeImageToVideoDuration(options.durationSec);

        return {
          artifact_id: `artifact_video_${ctx.execution.task_id}${splitSuffix}_${Date.now().toString(36)}`,
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
              getString(pr.rawResponseJson?.task_id) ?? undefined,
            source_image_artifact_id:
              getString(pr.rawResponseJson?.source_image_artifact_id) ??
              undefined,
            source_url: videoUrl,
            file_hash: written.fileHash,
            relative_path: written.relativePath,
            resolution,
            prompt_extend: pr.rawResponseJson?.prompt_extend ?? true,
            watermark: pr.rawResponseJson?.watermark ?? false,
            video_split_of_task:
              typeof pr.rawResponseJson?.split_total === "number" &&
              (pr.rawResponseJson.split_total as number) > 1
                ? ctx.planTask.task_id
                : undefined,
            video_split_index:
              typeof pr.rawResponseJson?.split_index === "number"
                ? (pr.rawResponseJson.split_index as number)
                : undefined,
            video_split_total:
              typeof pr.rawResponseJson?.split_total === "number" &&
              (pr.rawResponseJson.split_total as number) > 1
                ? (pr.rawResponseJson.split_total as number)
                : undefined,
          },
        };
      };

      if (splitJobs.length > 0) {
        const artifacts: AssetArtifact[] = [];
        for (let i = 0; i < splitJobs.length; i++) {
          const art = await downloadOne(splitJobs[i].pollResult!);
          splitJobs[i].artifact = art;
          artifacts.push(art);
        }
        return artifacts;
      }

      return [await downloadOne(pollResult)];
    },

    normalizeResult: async ({ downloadedArtifacts }) => {
      const notes = ["dashscope image-to-video generated"];
      if (downloadedArtifacts.length > 1) {
        notes.push(
          `dashscope image-to-video split into ${downloadedArtifacts.length} segments`,
        );
      }
      return {
        artifacts: downloadedArtifacts,
        notes,
      };
    },

    cancel: async () => undefined,
  };
}
