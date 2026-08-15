import type {
  AssetPlan,
  AssetPlanningValidationResult,
  AssetTask,
  ResolvedSegmentVisualRoute,
  StoryboardPlan,
} from "../../../../shared/src/index.js";
import { AssetPlanningValidationResult as AssetPlanningValidationResultSchema } from "../../../../shared/src/index.js";
import { locateSubstringFuzzy } from "../../runtime/llm/text-match.js";

interface LocatedExcerpt {
  start: number;
  end: number;
}

interface AssetPlanningRepairHint {
  task_id: string;
  task_type: AssetTask["task_type"];
  source_segment_id: string | null;
  missing_fields: string[];
}

const TIMING_SOURCE_ALLOWED_TASK_TYPES = new Set([
  "tts_audio",
  "subtitle_track",
  "video_clip",
  "bgm_cue",
]);

const NULL_SEGMENT_ALLOWED_TASK_TYPES = new Set([
  "tts_audio",
  "subtitle_track",
  "sfx_cue",
  "bgm_cue",
]);

const VISUAL_TASK_TYPES = new Set([
  "image_still",
  "render_motion_cue",
  "video_clip",
]);

function pushUnique(target: string[], code: string) {
  if (!target.includes(code)) {
    target.push(code);
  }
}

function pushRepairHint(
  target: AssetPlanningRepairHint[],
  task: AssetTask,
  missingField: string,
) {
  let hint = target.find((item) => item.task_id === task.task_id);
  if (!hint) {
    hint = {
      task_id: task.task_id,
      task_type: task.task_type,
      source_segment_id: task.source_segment_id,
      missing_fields: [],
    };
    target.push(hint);
  }

  pushUnique(hint.missing_fields, missingField);
}

function sumCoveredChars(spans: LocatedExcerpt[]) {
  if (spans.length === 0) {
    return 0;
  }

  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let covered = 0;
  let current = sorted[0];

  for (const span of sorted.slice(1)) {
    if (span.start <= current.end) {
      current = {
        start: current.start,
        end: Math.max(current.end, span.end),
      };
      continue;
    }

    covered += current.end - current.start;
    current = span;
  }

  covered += current.end - current.start;
  return covered;
}

function getTaskById(plan: AssetPlan) {
  return new Map(plan.tasks.map((task) => [task.task_id, task]));
}

function hasDependencyCycle(plan: AssetPlan, existingTaskIds: Set<string>) {
  const graph = new Map<string, string[]>();
  for (const task of plan.tasks) {
    graph.set(task.task_id, []);
  }
  for (const dependency of plan.dependencies) {
    if (
      !existingTaskIds.has(dependency.task_id) ||
      !existingTaskIds.has(dependency.depends_on_task_id)
    ) {
      continue;
    }

    graph.get(dependency.task_id)?.push(dependency.depends_on_task_id);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(taskId: string): boolean {
    if (visiting.has(taskId)) {
      return true;
    }
    if (visited.has(taskId)) {
      return false;
    }

    visiting.add(taskId);
    for (const next of graph.get(taskId) ?? []) {
      if (visit(next)) {
        return true;
      }
    }
    visiting.delete(taskId);
    visited.add(taskId);
    return false;
  }

  return [...graph.keys()].some((taskId) => visit(taskId));
}

function getTtsCoverage(scriptText: string, plan: AssetPlan) {
  const spans: LocatedExcerpt[] = [];
  const driftedChunkIds: string[] = [];
  for (const chunk of plan.tts_plan.chunks) {
    // 严格 indexOf 优先；失败后做标点归一化软匹配（LLM 在切 chunk 时
    // 经常漂移全/半角标点、引号、空格，这是 DeepSeek-V4-Pro 等模型的固有不精确性）。
    const located = locateSubstringFuzzy(scriptText, chunk.script_excerpt);
    if (located.index === -1) {
      return {
        coveredCharCount: 0,
        coverageRatio: 0,
        hasMissingExcerpt: true,
        driftedChunkIds,
      };
    }

    if (located.drifted) {
      driftedChunkIds.push(chunk.chunk_id);
    }

    // 用 located.end 而不是 located.index + chunk.script_excerpt.length：
    // 当 drift 涉及删除型字符（引号、空格）时，haystack 实际覆盖长度与 needle
    // 长度不同，必须用归一化映射回的真实 end，否则 coverage 计算会偏。
    spans.push({
      start: located.index,
      end: located.end,
    });
  }

  const coveredCharCount = sumCoveredChars(spans);
  return {
    coveredCharCount,
    coverageRatio: scriptText.length > 0 ? coveredCharCount / scriptText.length : 0,
    hasMissingExcerpt: false,
    driftedChunkIds,
  };
}

function hasSubtitleTtsTimingDependency(
  subtitleTask: AssetTask,
  plan: AssetPlan,
  tasksById: Map<string, AssetTask>,
) {
  return plan.dependencies.some((dependency) => {
    const upstream = tasksById.get(dependency.depends_on_task_id);
    return (
      dependency.task_id === subtitleTask.task_id &&
      dependency.dependency_type === "requires_timing" &&
      upstream?.task_type === "tts_audio"
    );
  });
}

/**
 * S2-2A 任务 5 整改：先建立每段唯一 anchor，再强制显式 fallback、video 依赖和
 * motion 绑定全部精确指向该 anchor。
 *
 * anchor 唯一性由调用方校验（每段 anchor 数量必须恰好 1，否则 anchor_duplicate/
 * anchor_missing 已报错）；这里只按"伪唯一"anchor 做精确引用核对。
 */

/**
 * S2-2A 任务 5 整改：requires_output 依赖图必须与任务参数表达同一素材来源。
 * 每个 video/motion 恰好一条 requires_output，且 depends_on_task_id 精确等于
 * 同段唯一 anchor；多一条、少一条或指向其他图片都直接失败。
 */
function hasExactSingleAnchorOutputBinding(
  task: AssetTask,
  plan: AssetPlan,
  anchorsBySegment: ReadonlyMap<string, string>,
): boolean {
  const anchorTaskId = anchorsBySegment.get(task.source_segment_id ?? "");
  if (!anchorTaskId) return false;
  const outputDependencies = plan.dependencies.filter(
    (dependency) =>
      dependency.task_id === task.task_id &&
      dependency.dependency_type === "requires_output",
  );
  return (
    outputDependencies.length === 1 &&
    outputDependencies[0]!.depends_on_task_id === anchorTaskId
  );
}

/**
 * video 的静态 fallback 必须等于同段唯一 anchor：
 * - 显式 static_fallback_task_id 存在时，必须精确等于该 anchor；
 *   错误显式引用（跨段/support/不存在）不能被依赖图掩盖。
 * - 无论显式引用是否存在，requires_output 依赖必须恰好一条且指向该 anchor，
 *   保证 task parameters 与 dependency graph 表达同一素材来源。
 */
function hasValidStaticFallback(
  videoTask: AssetTask,
  plan: AssetPlan,
  anchorsBySegment: ReadonlyMap<string, string>,
) {
  const anchorTaskId = anchorsBySegment.get(videoTask.source_segment_id ?? "");
  if (!anchorTaskId) return false;
  const explicit =
    typeof videoTask.parameters.static_fallback_task_id === "string"
      ? videoTask.parameters.static_fallback_task_id
      : null;
  if (explicit !== null && explicit !== anchorTaskId) return false;
  return hasExactSingleAnchorOutputBinding(videoTask, plan, anchorsBySegment);
}

/**
 * render_motion_cue 必须绑定同段唯一 anchor：
 * source_image_task_id 与唯一的 requires_output 依赖都必须精确指向该 anchor。
 */
function hasMotionCueSameAnchorBinding(
  motionTask: AssetTask,
  plan: AssetPlan,
  anchorsBySegment: ReadonlyMap<string, string>,
) {
  const anchorTaskId = anchorsBySegment.get(motionTask.source_segment_id ?? "");
  if (!anchorTaskId) return false;
  const sourceTaskId =
    typeof motionTask.parameters.source_image_task_id === "string"
      ? motionTask.parameters.source_image_task_id
      : null;
  if (sourceTaskId !== anchorTaskId) return false;
  return hasExactSingleAnchorOutputBinding(motionTask, plan, anchorsBySegment);
}

/**
 * 统计每段 anchor 任务：数量必须恰好 1。0 个由 video/motion 绑定检查兜底报错；
 * 超过 1 个直接报 anchor_duplicate（任何绑定都不再可信）。
 */
function buildAnchorsBySegment(
  plan: AssetPlan,
): { anchorsBySegment: Map<string, string>; duplicateSegments: string[] } {
  const anchorsBySegment = new Map<string, string>();
  const anchorCountBySegment = new Map<string, number>();
  for (const task of plan.tasks) {
    if (
      task.task_type === "image_still" &&
      task.parameters.image_role === "anchor" &&
      task.source_segment_id !== null
    ) {
      anchorCountBySegment.set(
        task.source_segment_id,
        (anchorCountBySegment.get(task.source_segment_id) ?? 0) + 1,
      );
      anchorsBySegment.set(task.source_segment_id, task.task_id);
    }
  }
  const duplicateSegments = [...anchorCountBySegment.entries()]
    .filter(([, count]) => count > 1)
    .map(([segmentId]) => segmentId);
  return { anchorsBySegment, duplicateSegments };
}

function hasNonEmptyRiskNotes(task: AssetTask) {
  return task.risk_notes.some((note) => note.trim().length > 0);
}

const AUDIO_INPUT_TAG_KEYS = new Set([
  "sfx_tags",
  "bgm_style_tags",
  "mood_tags",
  "style_tags",
]);

function hasAudioInputContract(task: AssetTask): boolean {
  if (task.prompt_draft && task.prompt_draft.trim().length > 0) {
    return true;
  }
  for (const [key, value] of Object.entries(task.parameters)) {
    if (AUDIO_INPUT_TAG_KEYS.has(key)) {
      if (Array.isArray(value) && value.length > 0) return true;
      if (typeof value === "string" && value.trim().length > 0) return true;
    }
  }
  return false;
}

export function validateAssetPlan(input: {
  storyboardRecordId: string;
  scriptRecordId: string;
  topicPackageId: string;
  storyboard: StoryboardPlan;
  scriptText: string;
  plan: AssetPlan;
  /**
   * S2-2A 任务 5：resolver 输出的每段最终视觉路线（可选）。
   * 提供时对每段做机械路线核对：API route 缺锚点/video/motion、Remotion route
   * 规划 video 都直接报硬错误；不提供时保持纯结构校验（legacy 调用兼容）。
   */
  segmentVisualRoutes?: ReadonlyMap<string, ResolvedSegmentVisualRoute>;
}): AssetPlanningValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const repairHints: AssetPlanningRepairHint[] = [];
  const { plan } = input;

  if (plan.source_storyboard_record_id !== input.storyboardRecordId) {
    pushUnique(errors, "asset_plan_source_storyboard_mismatch");
  }
  if (plan.source_script_record_id !== input.scriptRecordId) {
    pushUnique(errors, "asset_plan_source_script_mismatch");
  }
  if (plan.source_topic_package_id !== input.topicPackageId) {
    pushUnique(errors, "asset_plan_source_topic_mismatch");
  }

  const segmentIds = new Set(
    input.storyboard.segments.map((segment) => segment.segment_id),
  );
  const taskIds = new Set<string>();
  const duplicateTaskIds = new Set<string>();
  for (const task of plan.tasks) {
    if (taskIds.has(task.task_id)) {
      duplicateTaskIds.add(task.task_id);
    }
    taskIds.add(task.task_id);

    if (task.order < 0 || task.order >= plan.tasks.length) {
      pushUnique(errors, "asset_task_order_invalid");
    }

    if (task.source_segment_id === null) {
      if (!NULL_SEGMENT_ALLOWED_TASK_TYPES.has(task.task_type)) {
        pushUnique(errors, "asset_task_source_segment_invalid");
      }
    } else if (!segmentIds.has(task.source_segment_id)) {
      pushUnique(errors, "asset_task_source_segment_invalid");
    }

    if (
      (task.task_type === "image_still" || task.task_type === "video_clip") &&
      (!task.prompt_draft || task.prompt_draft.trim().length === 0)
    ) {
      pushUnique(errors, "asset_visual_prompt_missing");
      pushRepairHint(repairHints, task, "prompt_draft");
    }

    if (VISUAL_TASK_TYPES.has(task.task_type) && !hasNonEmptyRiskNotes(task)) {
      pushUnique(errors, "asset_visual_risk_notes_missing");
      pushRepairHint(repairHints, task, "risk_notes");
    }
  }

  if (duplicateTaskIds.size > 0) {
    pushUnique(errors, "asset_task_id_duplicate");
  }

  const sortedOrders = plan.tasks.map((task) => task.order).sort((a, b) => a - b);
  for (let index = 0; index < sortedOrders.length; index += 1) {
    if (sortedOrders[index] !== index) {
      pushUnique(errors, "asset_task_order_invalid");
      break;
    }
  }

  for (const dependency of plan.dependencies) {
    if (
      !taskIds.has(dependency.task_id) ||
      !taskIds.has(dependency.depends_on_task_id)
    ) {
      pushUnique(errors, "asset_dependency_task_missing");
    }
  }

  if (hasDependencyCycle(plan, taskIds)) {
    pushUnique(errors, "asset_dependency_cycle_detected");
  }

  const ttsCoverage = getTtsCoverage(input.scriptText, plan);
  // TTS 覆盖率：LLM 切 chunk 时会做语义微调（标点、断句），字符级精确匹配
  // 受限于 LLM 固有能力。低于阈值只记 warning，不再报 error 强制 regen
  // （regen 不会显著改善字符级覆盖，反而让整个流程卡死）。
  // 严重缺失（chunk 的 script_excerpt 在原文中找不到）仍视为可恢复 error。
  if (ttsCoverage.hasMissingExcerpt) {
    pushUnique(errors, "asset_tts_script_coverage_missing");
  } else {
    for (const chunkId of ttsCoverage.driftedChunkIds) {
      pushUnique(warnings, `asset_tts_excerpt_drift:${chunkId}`);
    }
    if (ttsCoverage.coverageRatio < 0.90) {
      pushUnique(
        warnings,
        `asset_tts_script_coverage_low:${ttsCoverage.coverageRatio.toFixed(2)}`,
      );
    }
  }

  const tasksById = getTaskById(plan);
  // 任务 5 整改：先确定每段唯一 anchor；重复 anchor 直接硬失败，
  // 后续 video/motion 的精确绑定只信任唯一 anchor。
  const { anchorsBySegment, duplicateSegments } = buildAnchorsBySegment(plan);
  for (const segmentId of duplicateSegments) {
    pushUnique(errors, "asset_segment_anchor_duplicate");
    void segmentId;
  }
  for (const dependency of plan.dependencies) {
    if (dependency.dependency_type === "requires_timing") {
      const upstream = tasksById.get(dependency.depends_on_task_id);
      if (upstream && !TIMING_SOURCE_ALLOWED_TASK_TYPES.has(upstream.task_type)) {
        pushUnique(errors, "asset_dependency_timing_source_invalid");
      }
    }
  }

  for (const task of plan.tasks) {
    if (
      task.task_type === "subtitle_track" &&
      !hasSubtitleTtsTimingDependency(task, plan, tasksById)
    ) {
      pushUnique(errors, "asset_subtitle_missing_tts_dependency");
    }

    if (
      task.task_type === "video_clip" &&
      !hasValidStaticFallback(task, plan, anchorsBySegment)
    ) {
      pushUnique(errors, "asset_video_missing_static_fallback");
      pushRepairHint(repairHints, task, "static_fallback_task_id");
    }

    if (
      task.task_type === "render_motion_cue" &&
      !hasMotionCueSameAnchorBinding(task, plan, anchorsBySegment)
    ) {
      pushUnique(errors, "asset_motion_cue_binding_invalid");
      pushRepairHint(repairHints, task, "source_image_task_id");
    }

    if (
      (task.task_type === "sfx_cue" || task.task_type === "bgm_cue") &&
      !hasAudioInputContract(task)
    ) {
      pushUnique(warnings, `asset_audio_cue_no_input_contract:${task.task_id}`);
    }
  }

  // S2-2A 任务 5：resolver 路线核对（机械合同检查，不做语义判断）。
  // API route 段必须同时有锚点图、video_clip 与 render_motion_cue；
  // Remotion route 段必须只有锚点图 + render_motion_cue。
  if (input.segmentVisualRoutes) {
    for (const segment of input.storyboard.segments) {
      const routeEntry = input.segmentVisualRoutes.get(segment.segment_id);
      if (!routeEntry) continue;
      const segmentTasks = plan.tasks.filter(
        (task) => task.source_segment_id === segment.segment_id,
      );
      const hasAnchor = segmentTasks.some(
        (task) =>
          task.task_type === "image_still" &&
          task.parameters.image_role === "anchor",
      );
      const videoCount = segmentTasks.filter(
        (task) => task.task_type === "video_clip",
      ).length;
      const motionCount = segmentTasks.filter(
        (task) => task.task_type === "render_motion_cue",
      ).length;
      if (!hasAnchor) {
        pushUnique(errors, "asset_segment_anchor_missing");
      }
      const routeViolated =
        routeEntry.resolved_route === "api_video"
          ? videoCount === 0 || motionCount === 0
          : motionCount === 0 || videoCount > 0;
      if (routeViolated) {
        pushUnique(errors, "asset_segment_visual_route_violation");
      }
    }
  }

  const hasVideoClip = plan.tasks.some((task) => task.task_type === "video_clip");
  if (!hasVideoClip && plan.global_production_notes.length <= 1) {
    pushUnique(warnings, "asset_plan_zero_video_clip_without_explanation");
  }

  return AssetPlanningValidationResultSchema.parse({
    stage: "asset_planning_local_validation",
    decision: errors.length > 0 ? "regen_once" : "pass",
    errors,
    warnings,
    metrics: {
      task_count: plan.tasks.length,
      dependency_count: plan.dependencies.length,
      tts_coverage_ratio: ttsCoverage.coverageRatio,
      tts_covered_char_count: ttsCoverage.coveredCharCount,
      script_char_count: input.scriptText.length,
      repair_hints: repairHints,
    },
  });
}
