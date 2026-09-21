/**
 * 角色 sheet 参考图解析（设计 §3.3，实施计划 §1 T2/T3）。
 *
 * 单一实现，dashscope 与 fake adapter 共用，避免两套"按 artifact metadata 查找"的逻辑漂移。
 *
 * 查找锚点是 **artifact metadata**（`sheet_role === "character_sheet"` + `character_id`），
 * **不是 execution 状态**：局部重跑时旧 artifact 全部注入工作 manifest，而非目标的旧
 * execution 会被过滤丢弃（assets-run.service.ts 的局部重跑过滤），按 execution 查在该场景
 * 必然静默落空。`parameters.character_sheet_task_ids` 只用来确定该分镜要找哪些角色。
 *
 * 任一步失败（模型不支持参考图 / 产物缺失 / 文件不可读 / 超 10MB / 超模型参考图上限）
 * 都只降级为纯文本锚点并记 note，**不失败**（设计 §3.5）。
 */

import { readFile } from "node:fs/promises";

import type { AssetManifest, AssetPlan } from "../../../../shared/src/index.js";

export interface SheetReferenceImage {
  base64: string;
  mimeType: string;
}

/** 供应商约束：参考图 JPEG/PNG/BMP/WEBP、宽高 [240, 8000]、≤10MB（设计 §1.3）。 */
export const SHEET_REFERENCE_MAX_BYTES = 10 * 1024 * 1024;

export function sheetReferenceMimeType(fileUri: string): string {
  const lower = fileUri.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".bmp")) return "image/bmp";
  return "image/png";
}

/** 该分镜任务要注入的角色 sheet：由编译期写入的 sheet task id 反查 character_id。 */
export function characterIdsForInjection(
  planTask: AssetPlan["tasks"][number],
  assetPlan: AssetPlan,
): string[] {
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

export async function resolveCharacterSheetReferenceImages(input: {
  manifest: AssetManifest;
  assetPlan: AssetPlan;
  planTask: AssetPlan["tasks"][number];
  /** 用于 note 文案的模型名。 */
  model: string;
  /** 该模型可用的参考图上限；0 = 确知不具备参考图能力。 */
  referenceLimit: number;
}): Promise<{ images: SheetReferenceImage[]; notes: string[] }> {
  const notes: string[] = [];
  const characterIds = characterIdsForInjection(input.planTask, input.assetPlan);
  if (characterIds.length === 0) return { images: [], notes };

  if (input.referenceLimit <= 0) {
    return {
      images: [],
      notes: [`注入跳过：冻结模型 ${input.model} 不支持参考图输入，按纯文本锚点生成`],
    };
  }

  const images: SheetReferenceImage[] = [];
  for (const characterId of characterIds) {
    if (images.length >= input.referenceLimit) {
      notes.push(
        `注入跳过：参考图数量超过模型上限 ${input.referenceLimit}（角色 ${characterId} 未注入）`,
      );
      continue;
    }
    const artifact = input.manifest.artifacts.find((candidate) => {
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
      if (buffer.byteLength > SHEET_REFERENCE_MAX_BYTES) {
        notes.push(
          `注入跳过：角色 ${characterId} 的 sheet 产物超过 ${SHEET_REFERENCE_MAX_BYTES} 字节上限，按纯文本锚点生成`,
        );
        continue;
      }
      images.push({
        base64: buffer.toString("base64"),
        mimeType: sheetReferenceMimeType(artifact.file_uri),
      });
    } catch {
      notes.push(`注入跳过：角色 ${characterId} 的 sheet 产物文件不可读，按纯文本锚点生成`);
    }
  }
  return { images, notes };
}
