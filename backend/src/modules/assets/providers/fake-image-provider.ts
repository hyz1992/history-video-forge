import { Buffer } from "node:buffer";

import type {
  AssetProviderAdapter,
  AssetProviderContext,
} from "../assets-provider-adapter.js";
import type { AssetPlan } from "../../../../../shared/src/index.js";
import {
  resolveAssetsRunStorage,
  writeAssetFile,
} from "../assets-file-storage.js";
import { resolveCharacterSheetReferenceImages } from "../character-sheet-reference.js";

const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

/**
 * 可选能力声明（实施计划 T5 / PP3）：支撑冒烟断言"不支持的模型形态"。
 * 缺省 = 与现状逐字一致（image_still only 行为不变的部分见 canHandle）。
 */
export interface FakeImageProviderOptions {
  /** 供冒烟与诊断展示的模型名（不参与真实调用）。 */
  model?: string;
  /** 是否声明具备参考图能力；false 时 prepare 走"未注入 + note"形态。 */
  referenceImagesSupported?: boolean;
}

function fakeImageSize(planTask: AssetPlan["tasks"][number]): { width: number; height: number } {
  const size = planTask.parameters.size;
  const match = typeof size === "string" ? size.match(/^(\d+)\s*[*xX]\s*(\d+)$/) : null;
  // 角色 sheet 是横版 2K（2048*1152），与分镜图 9:16 竖版不同：
  // 尺寸从任务参数解析，避免下游断言依赖被硬编码的 1080×1920（T5 顺带对齐）。
  if (match) return { width: Number(match[1]), height: Number(match[2]) };
  return { width: 1080, height: 1920 };
}

export function createFakeImageProvider(
  options: FakeImageProviderOptions = {},
): AssetProviderAdapter {
  const model = options.model ?? "fake-image";
  const referenceImagesSupported = options.referenceImagesSupported ?? true;
  return {
    providerName: "fake_image",
    providerType: "image",
    // 角色 sheet 与分镜图同族任务：fake 必须兼收，否则 registry 无适配器时引擎对非视频
    // 类型静默 continue（状态停在 planned），叠加可选不完备白名单会制造"run 成功、零 sheet"
    // 的假绿（设计 §3.7 第 7 项 N13）。
    canHandle: ({ taskType }) =>
      taskType === "image_still" || taskType === "character_sheet",

    prepare: async (ctx) => {
      const injection = await resolveCharacterSheetReferenceImages({
        manifest: ctx.manifest,
        assetPlan: ctx.assetPlan,
        planTask: ctx.planTask,
        model,
        // 参考图上限沿用供应商形态；能力不支持时传 0 → 记 note 且不注入。
        referenceLimit: referenceImagesSupported ? 9 : 0,
      });
      for (const note of injection.notes) {
        ctx.execution.notes = [...ctx.execution.notes, `[sheet] ${note}`];
      }
      return {
        providerJobId: null,
        rawRequestJson: {
          task_id: ctx.execution.task_id,
          // 回显"收到参考图"标记：冒烟据此断言注入路径真的走通（设计 §4-2）。
          reference_image_count: injection.images.length,
          reference_base64_lengths: injection.images.map((image) => image.base64.length),
        },
      };
    },

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

      const fileName = `${ctx.execution.task_id}.png`;
      const written = await writeAssetFile({
        storage,
        category: "images",
        fileName,
        data: Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"),
      });

      const size = fakeImageSize(ctx.planTask);
      const artifact = {
        artifact_id: `artifact_img_${ctx.execution.task_id}_${Date.now().toString(36)}`,
        artifact_type: "image" as const,
        origin: "provider" as const,
        file_uri: written.fileUri,
        created_at: new Date().toISOString(),
        metadata: {
          width: size.width,
          height: size.height,
          // sheet 产物的可追溯元数据：执行期按 metadata 查找 sheet 的锚点（设计 §3.1）。
          ...(ctx.planTask.task_type === "character_sheet"
            ? {
                sheet_role: "character_sheet",
                ...(typeof ctx.planTask.parameters.character_id === "string"
                  ? { character_id: ctx.planTask.parameters.character_id }
                  : {}),
              }
            : {}),
          file_hash: written.fileHash,
          relative_path: written.relativePath,
        },
      };

      return { artifacts: [artifact], notes: ["fake image generated"] };
    },

    cancel: async () => {},
  };
}
