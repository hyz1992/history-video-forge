/**
 * DashScope image generation provider shell.
 *
 * The adapter is opt-in only; the default assets run service still uses fake
 * providers so ordinary tests and local runs do not call paid services.
 * Checked docs: https://help.aliyun.com/zh/model-studio/ (2026-05-16).
 */

import type { AssetArtifact } from "../../../../../../shared/src/index.js";
import type { AssetProviderAdapter } from "../../assets-provider-adapter.js";
import {
  resolveAssetsRunStorage,
  writeAssetFile,
} from "../../assets-file-storage.js";

export interface DashScopeImageInput {
  model: string;
  prompt: string;
  negativePrompt?: string;
  size?: string;
  n?: number;
}

export interface DashScopeImagePayload {
  model: string;
  input: {
    messages?: Array<{ role: string; content: Array<{ text: string }> }>;
    prompt?: string;
    negative_prompt?: string;
  };
  parameters: {
    size: string;
    n: number;
    negative_prompt?: string;
    prompt_extend?: boolean;
    watermark?: boolean;
  };
}

export interface DashScopeImageProviderOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  size?: string;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
}

function isWan26Model(model: string): boolean {
  return /^wan2\.6/i.test(model.trim());
}

export function buildDashscopeImagePayload(
  input: DashScopeImageInput,
): DashScopeImagePayload {
  const model = input.model;
  const useWan26 = isWan26Model(model);
  const size = (input.size ?? "1080*1920").replace(/x/gi, "*");

  if (useWan26) {
    return {
      model,
      input: {
        messages: [{ role: "user", content: [{ text: input.prompt }] }],
      },
      parameters: {
        size,
        n: input.n ?? 1,
        negative_prompt: input.negativePrompt ?? "",
        prompt_extend: false,
        watermark: false,
      },
    };
  }

  return {
    model,
    input: {
      prompt: input.prompt,
      negative_prompt: input.negativePrompt ?? "低质量, 模糊, 变形, 水印, 文字",
    },
    parameters: { size, n: input.n ?? 1 },
  };
}

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl ?? "https://dashscope.aliyuncs.com").replace(/\/$/, "");
}

function endpointFor(baseUrl?: string, model?: string): string {
  const base = normalizeBaseUrl(baseUrl);
  if (model && isWan26Model(model)) {
    return `${base}/api/v1/services/aigc/image-generation/generation`;
  }
  return `${base}/api/v1/services/aigc/text2image/image-synthesis`;
}

function taskEndpointFor(baseUrl: string, taskId: string): string {
  return `${normalizeBaseUrl(baseUrl)}/api/v1/tasks/${taskId}`;
}

function parseSize(size: string): { width: number; height: number } {
  const match = size.match(/^(\d+)\s*\*\s*(\d+)$/);
  if (!match) {
    return { width: 1080, height: 1920 };
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function extractTaskId(raw: Record<string, unknown>): string | null {
  const output = raw.output as Record<string, unknown> | undefined;
  return getString(output?.task_id) ?? getString(output?.taskId) ?? getString(raw.task_id);
}

function collectHttpUrls(root: unknown): string[] {
  const urls: string[] = [];
  const queue: unknown[] = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    if (typeof current !== "object") continue;
    for (const value of Object.values(current as Record<string, unknown>)) {
      if (typeof value === "string" && value.startsWith("http")) {
        urls.push(value);
      } else if (value && typeof value === "object") {
        queue.push(value);
      }
    }
  }
  return [...new Set(urls)];
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function createDashscopeImageProvider(
  options: DashScopeImageProviderOptions,
): AssetProviderAdapter {
  return {
    providerName: "dashscope_image",
    providerType: "image",
    // S2-2A 任务 9A：真实付费 adapter，受付费闸门与 usage 记账约束
    billing: { capability: "image.generate", providerKey: "dashscope", modelId: options.model },
    canHandle: ({ taskType }) => taskType === "image_still",

    prepare: async (ctx) => {
      const prompt = ctx.planTask.prompt_draft ?? ctx.planTask.source_excerpt;
      const size =
        typeof ctx.planTask.parameters.size === "string"
          ? ctx.planTask.parameters.size
          : options.size ?? "1080*1920";
      const negativePrompt =
        typeof ctx.planTask.parameters.negative_prompt === "string"
          ? ctx.planTask.parameters.negative_prompt
          : ctx.assetPlan.art_bible.global_negative_prompts.join(", ");
      const payload = buildDashscopeImagePayload({
        model: options.model,
        prompt,
        negativePrompt,
        size,
      });

      return {
        providerJobId: null,
        rawRequestJson: {
          endpoint: endpointFor(options.baseUrl, options.model),
          payload,
          prompt,
          size: payload.parameters.size,
        },
      };
    },

    submit: async (ctx, prepared) => {
      if (!options.apiKey.trim()) {
        throw new Error("dashscope_api_key_missing");
      }

      await ctx.beforeDispatch?.();

      ctx.onDispatch?.();
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
        throw new Error(`DashScope image submit failed: ${response.status} ${JSON.stringify(rawResponse)}`);
      }
      const taskId = extractTaskId(rawResponse);
      if (!taskId) {
        throw new Error(`DashScope image submit missing task_id: ${JSON.stringify(rawResponse)}`);
      }

      return {
        providerJobId: taskId,
        rawResponseJson: {
          ...rawResponse,
          task_id: taskId,
          size: prepared.rawRequestJson.size,
        },
      };
    },

    poll: async (ctx, submitted) => {
      const taskId = getString(submitted.providerJobId);
      if (!taskId) {
        return {
          status: "failed",
          rawResponseJson: submitted.rawResponseJson,
          errorCode: "dashscope_task_id_missing",
          errorMessage: "DashScope image task id missing",
        };
      }

      const baseUrl = normalizeBaseUrl(options.baseUrl);
      const maxAttempts = options.maxPollAttempts ?? 60;
      const pollIntervalMs = options.pollIntervalMs ?? 3000;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        await ctx.beforeDispatch?.();
        const response = await fetch(taskEndpointFor(baseUrl, taskId), {
          headers: { Authorization: `Bearer ${options.apiKey}` },
        });
        const rawResponse = (await response.json()) as Record<string, unknown>;
        if (!response.ok) {
          throw new Error(`DashScope image poll failed: ${response.status} ${JSON.stringify(rawResponse)}`);
        }

        const output = (rawResponse.output ?? rawResponse) as Record<string, unknown>;
        const status = String(output.task_status ?? "").toUpperCase();
        if (status === "SUCCEEDED") {
          return {
            status: "completed" as const,
            rawResponseJson: {
              ...rawResponse,
              task_id: taskId,
              size: submitted.rawResponseJson?.size,
              output_urls: collectHttpUrls(output),
            },
          };
        }
        if (status === "FAILED" || status === "CANCELED") {
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
          message: "DashScope image task still running after max poll attempts",
        },
      };
    },

    download: async (ctx, pollResult) => {
      const urls = (pollResult.rawResponseJson?.output_urls as string[] | undefined) ?? [];
      const imageUrl = urls[0];
      if (!imageUrl) {
        throw new Error("dashscope_image_output_url_missing");
      }
      await ctx.beforeDispatch?.();
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`DashScope image download failed: ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const storage = resolveAssetsRunStorage({
        projectStorageRootDir: ctx.projectStorageRootDir,
        runId: ctx.assetRunId,
      });
      const written = await writeAssetFile({
        storage,
        category: "images",
        fileName: `dashscope_${ctx.execution.task_id}.png`,
        data: buffer,
      });
      const size = parseSize(String(pollResult.rawResponseJson?.size ?? options.size ?? "1080*1920"));

      const artifact: AssetArtifact = {
        artifact_id: `artifact_img_${ctx.execution.task_id}_${Date.now().toString(36)}`,
        artifact_type: "image",
        origin: "provider",
        file_uri: written.fileUri,
        created_at: new Date().toISOString(),
        metadata: {
          width: size.width,
          height: size.height,
          model: options.model,
          provider_name: "dashscope_image",
          provider_job_id: getString(pollResult.rawResponseJson?.task_id) ?? undefined,
          source_url: imageUrl,
          file_hash: written.fileHash,
          relative_path: written.relativePath,
        },
      };
      return [artifact];
    },

    normalizeResult: async ({ downloadedArtifacts }) => ({
      artifacts: downloadedArtifacts,
      notes: ["dashscope image generated"],
    }),

    cancel: async () => undefined,
  };
}
