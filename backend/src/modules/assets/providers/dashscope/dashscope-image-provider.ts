/**
 * DashScope image generation provider shell.
 *
 * The adapter is opt-in only; the default assets run service still uses fake
 * providers so ordinary tests and local runs do not call paid services.
 * Checked docs: https://help.aliyun.com/zh/model-studio/ (2026-05-16).
 */

import { readFile } from "node:fs/promises";

import type { AssetArtifact, AssetPlan } from "../../../../../../shared/src/index.js";
import type { AssetProviderAdapter, AssetProviderContext } from "../../assets-provider-adapter.js";
import {
  resolveAssetsRunStorage,
  writeAssetFile,
} from "../../assets-file-storage.js";

/** 参考图（角色 sheet 注入）：按供应商要求走 base64 内联，不依赖公网 URL 有效期。 */
export interface DashScopeImageReference {
  base64: string;
  mimeType: string;
}

export interface DashScopeImageInput {
  model: string;
  prompt: string;
  negativePrompt?: string;
  size?: string;
  n?: number;
  referenceImages?: DashScopeImageReference[];
}

export interface DashScopeImagePayload {
  model: string;
  input: {
    messages?: Array<{
      role: string;
      content: Array<{ text: string } | { image: string }>;
    }>;
    prompt?: string;
    negative_prompt?: string;
  };
  parameters: {
    size: string;
    n: number;
    negative_prompt?: string;
    prompt_extend?: boolean;
    watermark?: boolean;
    /** 仅 wan2.6-image 编辑模式：无此参数即非编辑形态（设计 §3.4）。 */
    enable_interleave?: boolean;
    /** 仅 wan2.7-image 的参考图注入调用显式关闭（纯文生图不强制，设计 §3.4）。 */
    thinking_mode?: boolean;
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

export type DashScopeImageModelFamily =
  | "wan27_image"
  | "wan26_image"
  | "wan26_t2i"
  | "legacy_text2image";

/**
 * 模型族判定（设计 §3.4）：原 `isWan26Model` 二值正则必须扩三值——wan2.7-image
 * 不匹配 `/^wan2\.6/`，二值实现会把它送到 text2image 端点与 `input.prompt` 形态。
 * 三个 wan2.x 族共用 messages 骨架与 image-generation 端点，差异收敛在参数表。
 */
export function resolveDashscopeImageModelFamily(
  model: string,
): DashScopeImageModelFamily {
  const trimmed = model.trim();
  if (/^wan2\.7/i.test(trimmed)) return "wan27_image";
  if (/^wan2\.6-image/i.test(trimmed)) return "wan26_image";
  if (/^wan2\.6/i.test(trimmed)) return "wan26_t2i";
  return "legacy_text2image";
}

/** 参考图上限（设计 §1.3：wan2.6-image 1~4、wan2.7-image 0~9）。 */
export const DASHSCOPE_IMAGE_REFERENCE_LIMIT = { wan26_image: 4, wan27_image: 9 } as const;

/**
 * 冻结模型是否**确知**无法承担 character_sheet（候选 (c)，设计 §3.4）：
 * sheet 需要同一模型同时支持 ① 0 图调用（sheet 自身是纯文生图）与 ② 参考图调用。
 * - wan2.6-t2i：不支持参考图注入 → 确知不可用；
 * - wan2.6-image：编辑模式强制 1~4 图，不满足 ① → 确知不可用；
 * - wan2.7-image：0~9 图，两条件都满足 → 可用；
 * - 未识别模型族（wanx 等）：能力**未知**，返回 false——由调用方 fail-open
 *   （实施计划 T3 PP2：信息缺失必须按具备能力处理，否则假绿防线自身假绿）。
 */
export function dashscopeImageModelKnownIncapableOfCharacterSheet(
  model: string,
): boolean {
  const family = resolveDashscopeImageModelFamily(model);
  return family === "wan26_t2i" || family === "wan26_image";
}

/** 供应商约束：参考图 JPEG/PNG/BMP/WEBP、宽高 [240, 8000]、≤10MB（设计 §1.3）。 */
export const DASHSCOPE_IMAGE_REFERENCE_MAX_BYTES = 10 * 1024 * 1024;

export function buildDashscopeImagePayload(
  input: DashScopeImageInput,
): DashScopeImagePayload {
  const model = input.model;
  const family = resolveDashscopeImageModelFamily(model);
  const size = (input.size ?? "1080*1920").replace(/x/gi, "*");
  const references = input.referenceImages ?? [];

  if (family === "legacy_text2image") {
    return {
      model,
      input: {
        prompt: input.prompt,
        negative_prompt: input.negativePrompt ?? "低质量, 模糊, 变形, 水印, 文字",
      },
      parameters: { size, n: input.n ?? 1 },
    };
  }

  // 三个 wan2.x 族共用 messages 骨架（wan2.6-t2i 现状形态保持不变）。
  const content: Array<{ text: string } | { image: string }> = [
    { text: input.prompt },
  ];
  for (const reference of references) {
    content.push({ image: `data:${reference.mimeType};base64,${reference.base64}` });
  }
  const parameters: DashScopeImagePayload["parameters"] = {
    size,
    // n 强制 1：wan2.6-image 默认 4、wan2.7 组图模式默认 12（设计 §3.4 的两处坑）。
    n: family === "wan26_t2i" ? input.n ?? 1 : 1,
    prompt_extend: false,
    watermark: false,
    // 2026-09-21 运行级确认（付费探针，请求参数见 T2 提交信息）：wan2.7-image 接受 negative_prompt。
    negative_prompt: input.negativePrompt ?? "",
  };

  if (family === "wan26_image") {
    const limit = DASHSCOPE_IMAGE_REFERENCE_LIMIT.wan26_image;
    if (references.length < 1 || references.length > limit) {
      throw new Error("dashscope_wan26_image_reference_count_invalid");
    }
    parameters.enable_interleave = false;
  }

  if (family === "wan27_image") {
    if (references.length > DASHSCOPE_IMAGE_REFERENCE_LIMIT.wan27_image) {
      throw new Error("dashscope_wan27_image_reference_count_invalid");
    }
    // 该参数在纯文生图调用生效：只有参考图注入调用才显式关闭，
    // 强制关闭会实际降低定妆图质量（设计 §3.4 N8/F8 修正）。
    if (references.length > 0) parameters.thinking_mode = false;
  }

  return {
    model,
    input: { messages: [{ role: "user", content }] },
    parameters,
  };
}

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl ?? "https://dashscope.aliyuncs.com").replace(/\/$/, "");
}

function endpointFor(baseUrl?: string, model?: string): string {
  const base = normalizeBaseUrl(baseUrl);
  if (model && resolveDashscopeImageModelFamily(model) !== "legacy_text2image") {
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

function referenceMimeType(fileUri: string): string {
  const lower = fileUri.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".bmp")) return "image/bmp";
  return "image/png";
}

/** 该分镜任务要注入的角色 sheet：由编译期写入的 sheet task id 反查 character_id。 */
function characterIdsForInjection(planTask: AssetPlan["tasks"][number], assetPlan: AssetPlan): string[] {
  const sheetTaskIds = planTask.parameters.character_sheet_task_ids;
  if (!Array.isArray(sheetTaskIds)) return [];
  const characterIds: string[] = [];
  for (const taskId of sheetTaskIds) {
    if (typeof taskId !== "string") continue;
    const sheetTask = assetPlan.tasks.find((candidate) => candidate.task_id === taskId);
    const characterId = sheetTask?.parameters.character_id;
    if (typeof characterId === "string" && !characterIds.includes(characterId)) {
      characterIds.push(characterId);
    }
  }
  return characterIds;
}

/**
 * 参考图解析（设计 §3.3，实施计划 §1 T2 / P3）：
 * 按 **artifact metadata**（`sheet_role === "character_sheet"` + `character_id`）查找，
 * **不按 execution 状态**——局部重跑时旧 artifact 全部注入工作 manifest，而非目标的旧
 * execution 会被过滤丢弃，按 execution 查在"显式重生成单个分镜"场景必然静默落空。
 * `parameters.character_sheet_task_ids` 只用来确定该分镜要找哪些角色。
 *
 * 任一步失败（模型不支持参考图 / 产物缺失 / 文件不可读 / 超 10MB / 超模型参考图上限）
 * 都只降级为纯文本锚点并记 note，**不失败**（设计 §3.5）。
 */
async function resolveCharacterSheetReferences(
  ctx: AssetProviderContext,
  model: string,
): Promise<{ references: DashScopeImageReference[]; notes: string[] }> {
  const notes: string[] = [];
  const characterIds = characterIdsForInjection(ctx.planTask, ctx.assetPlan);
  if (characterIds.length === 0) return { references: [], notes };

  const family = resolveDashscopeImageModelFamily(model);
  const limit =
    family === "wan26_image"
      ? DASHSCOPE_IMAGE_REFERENCE_LIMIT.wan26_image
      : family === "wan27_image"
        ? DASHSCOPE_IMAGE_REFERENCE_LIMIT.wan27_image
        : 0;
  if (limit === 0) {
    return {
      references: [],
      notes: [`注入跳过：冻结模型 ${model} 不支持参考图输入，按纯文本锚点生成`],
    };
  }

  const references: DashScopeImageReference[] = [];
  for (const characterId of characterIds) {
    if (references.length >= limit) {
      notes.push(`注入跳过：参考图数量超过模型上限 ${limit}（角色 ${characterId} 未注入）`);
      continue;
    }
    const artifact = ctx.manifest.artifacts.find((candidate) => {
      const metadata = candidate.metadata as Record<string, unknown> | undefined;
      return (
        candidate.artifact_type === "image" &&
        metadata?.sheet_role === "character_sheet" &&
        metadata?.character_id === characterId
      );
    });
    if (!artifact) {
      notes.push(`注入跳过：未找到角色 ${characterId} 的 sheet 产物，按纯文本锚点生成`);
      continue;
    }
    try {
      const buffer = await readFile(artifact.file_uri);
      if (buffer.byteLength > DASHSCOPE_IMAGE_REFERENCE_MAX_BYTES) {
        notes.push(
          `注入跳过：角色 ${characterId} 的 sheet 产物超过 ${DASHSCOPE_IMAGE_REFERENCE_MAX_BYTES} 字节上限，按纯文本锚点生成`,
        );
        continue;
      }
      references.push({
        base64: buffer.toString("base64"),
        mimeType: referenceMimeType(artifact.file_uri),
      });
    } catch {
      notes.push(`注入跳过：角色 ${characterId} 的 sheet 产物文件不可读，按纯文本锚点生成`);
    }
  }
  return { references, notes };
}

/** sheet 产物的可追溯元数据：执行期按 metadata 查找 sheet 的锚点（设计 §3.1）。 */
function characterSheetArtifactMetadata(
  planTask: AssetPlan["tasks"][number],
): Record<string, unknown> {
  if (planTask.task_type !== "character_sheet") return {};
  const characterId = planTask.parameters.character_id;
  const characterLabel = planTask.parameters.character_label;
  return {
    sheet_role: "character_sheet",
    ...(typeof characterId === "string" ? { character_id: characterId } : {}),
    ...(typeof characterLabel === "string" ? { character_label: characterLabel } : {}),
  };
}

export function createDashscopeImageProvider(
  options: DashScopeImageProviderOptions,
): AssetProviderAdapter {
  return {
    providerName: "dashscope_image",
    providerType: "image",
    // S2-2A 任务 9A：真实付费 adapter，受付费闸门与 usage 记账约束
    billing: { capability: "image.generate", providerKey: "dashscope", modelId: options.model },
    // 角色 sheet 与分镜图同族：候选 (c) 下两者共用 run 快照冻结的同一 image 模型
    //（设计 §3.4：① 与 ③ 同模型），故同一实例必须兼收两类任务。
    canHandle: ({ taskType }) =>
      taskType === "image_still" || taskType === "character_sheet",

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
      const injection = await resolveCharacterSheetReferences(ctx, options.model);
      // 降级 note 写入 execution.notes：manifest 持久化 + 运行诊断可见（设计 §3.5 N8）。
      for (const note of injection.notes) {
        ctx.execution.notes = [...ctx.execution.notes, `[sheet] ${note}`];
      }
      const payload = buildDashscopeImagePayload({
        model: options.model,
        prompt,
        negativePrompt,
        size,
        referenceImages: injection.references,
      });

      return {
        providerJobId: null,
        rawRequestJson: {
          endpoint: endpointFor(options.baseUrl, options.model),
          payload,
          prompt,
          size: payload.parameters.size,
          reference_image_count: injection.references.length,
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
          ...characterSheetArtifactMetadata(ctx.planTask),
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
