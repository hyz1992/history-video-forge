/**
 * 资产面板「角色定妆图」区的派生逻辑（2026-09-23 实施计划 T1）。
 *
 * 抽成纯函数以便单测：定妆图是跨 segment 的参考资产（source_segment_id 恒为 null），
 * 不在任何分镜卡片里，必须由面板单独成区展示；此处只做"任务 × 执行 × 产物"的机械归并，
 * 不做语义判断（状态文案只区分已完成/生成中/待生成/降级/失败五态）。
 */

export interface SheetTaskLike {
  task_id: string;
  task_type: string;
  parameters?: Record<string, unknown> | null;
  manual_upload_policy?: { accepted_file_types?: string[] } | null;
}

export interface SheetExecutionLike {
  status: string;
  output_artifact_ids?: string[] | null;
  notes?: string[] | null;
}

export interface SheetArtifactLike {
  artifact_id: string;
  metadata?: Record<string, unknown> | null;
}

export type CharacterSheetState = "ready" | "generating" | "pending" | "degraded" | "failed";

export interface CharacterSheetRow {
  taskId: string;
  /** 角色名（来自计划参数 character_label；缺省回退 task_id）。 */
  label: string;
  /** 编译期统计的命中段数；缺失为 null。 */
  hitCount: number | null;
  /** 命中的 segment id（用于 title 提示）。 */
  matchedSegmentIds: string[];
  /** execution 状态；无 execution 时为空串。 */
  status: string;
  state: CharacterSheetState;
  /** 可预览的产物 id；产物缺失（未生成/被过滤/文件不可读由前端兜底）为 null。 */
  artifactId: string | null;
  /** 引擎或 adapter 写入的 note，原样透出，不做二次解读。 */
  notes: string[];
  acceptedFileTypes: string[];
}

const DEFAULT_ACCEPTED_FILE_TYPES = ["image/png", "image/jpeg"];

export function buildCharacterSheetRows(input: {
  tasks: readonly SheetTaskLike[];
  executionsByTaskId: ReadonlyMap<string, SheetExecutionLike>;
  artifactsById: ReadonlyMap<string, SheetArtifactLike>;
}): CharacterSheetRow[] {
  return input.tasks
    .filter((task) => task.task_type === "character_sheet")
    .map((task) => {
      const execution = input.executionsByTaskId.get(task.task_id) ?? null;
      const status = execution?.status ?? "";
      const artifactId =
        (execution?.output_artifact_ids ?? []).find((id) => input.artifactsById.has(id)) ?? null;
      const parameters = task.parameters ?? {};
      const label =
        typeof parameters.character_label === "string" && parameters.character_label.length > 0
          ? parameters.character_label
          : task.task_id;
      const hitCount =
        typeof parameters.segment_hit_count === "number" ? parameters.segment_hit_count : null;
      const matchedSegmentIds = Array.isArray(parameters.matched_segment_ids)
        ? parameters.matched_segment_ids.filter((id): id is string => typeof id === "string")
        : [];
      const acceptedFileTypes =
        task.manual_upload_policy?.accepted_file_types?.length
          ? [...task.manual_upload_policy.accepted_file_types]
          : [...DEFAULT_ACCEPTED_FILE_TYPES];
      return {
        taskId: task.task_id,
        label,
        hitCount,
        matchedSegmentIds,
        status,
        state: resolveCharacterSheetState(status),
        artifactId,
        notes: (execution?.notes ?? []).filter((note) => note.trim().length > 0),
        acceptedFileTypes,
      };
    });
}

export function resolveCharacterSheetState(status: string): CharacterSheetState {
  if (status === "completed" || status === "accepted") return "ready";
  if (status === "failed") return "failed";
  if (status === "skipped_with_fallback") return "degraded";
  if (status === "running" || status === "waiting_manual_upload") return "generating";
  return "pending";
}

/**
 * 状态文案。`hasArtifact=false` 且状态为已完成时说明产物缺失（被过滤/文件不可读），
 * 与"尚未生成"区分开，避免用户以为没跑过。
 */
export function characterSheetStateLabel(state: CharacterSheetState, hasArtifact: boolean): string {
  if (state === "ready") return hasArtifact ? "已完成" : "产物缺失";
  if (state === "generating") return "生成中";
  if (state === "degraded") return "已降级跳过";
  if (state === "failed") return "生成失败";
  return "待生成";
}

export function characterSheetStateTagType(
  state: CharacterSheetState,
): "success" | "warning" | "danger" | "info" {
  if (state === "ready") return "success";
  if (state === "generating") return "info";
  if (state === "failed") return "danger";
  return "warning";
}

/** 分区标题里的完成计数：只看"有可预览产物"。 */
export function countReadyCharacterSheets(rows: readonly CharacterSheetRow[]): number {
  return rows.filter((row) => row.artifactId !== null).length;
}
