import type {
  AssetPlan,
  AssetPlanningValidationResult,
  AssetTask,
  StoryboardPlan,
} from "../../../../shared/src/index.js";
import { AssetPlanningValidationResult as AssetPlanningValidationResultSchema } from "../../../../shared/src/index.js";

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
  for (const chunk of plan.tts_plan.chunks) {
    const start = scriptText.indexOf(chunk.script_excerpt);
    if (start === -1) {
      return {
        coveredCharCount: 0,
        coverageRatio: 0,
        hasMissingExcerpt: true,
      };
    }

    spans.push({
      start,
      end: start + chunk.script_excerpt.length,
    });
  }

  const coveredCharCount = sumCoveredChars(spans);
  return {
    coveredCharCount,
    coverageRatio: scriptText.length > 0 ? coveredCharCount / scriptText.length : 0,
    hasMissingExcerpt: false,
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

function hasStaticFallback(
  videoTask: AssetTask,
  plan: AssetPlan,
  tasksById: Map<string, AssetTask>,
) {
  const fallbackTaskId =
    typeof videoTask.parameters.static_fallback_task_id === "string"
      ? videoTask.parameters.static_fallback_task_id
      : null;
  if (fallbackTaskId && tasksById.get(fallbackTaskId)?.task_type === "image_still") {
    return true;
  }

  return plan.dependencies.some((dependency) => {
    const upstream = tasksById.get(dependency.depends_on_task_id);
    return (
      dependency.task_id === videoTask.task_id &&
      dependency.dependency_type === "requires_output" &&
      upstream?.task_type === "image_still"
    );
  });
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
  } else if (ttsCoverage.coverageRatio < 0.90) {
    pushUnique(
      warnings,
      `asset_tts_script_coverage_low:${ttsCoverage.coverageRatio.toFixed(2)}`,
    );
  }

  const tasksById = getTaskById(plan);
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
      !hasStaticFallback(task, plan, tasksById)
    ) {
      pushUnique(errors, "asset_video_missing_static_fallback");
      pushRepairHint(repairHints, task, "static_fallback_task_id");
    }

    if (
      (task.task_type === "sfx_cue" || task.task_type === "bgm_cue") &&
      !hasAudioInputContract(task)
    ) {
      pushUnique(warnings, `asset_audio_cue_no_input_contract:${task.task_id}`);
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
