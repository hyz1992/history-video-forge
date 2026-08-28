import {
  ScriptDraftPackage,
  StoryboardPlan,
  apiQualityToDashscopeResolution,
  resolveGenerationConfiguration,
  type AssetPlan,
  type AssetPlanningValidationResult,
  type ResolvedSegmentVisualRoute,
} from "../../../../shared/src/index.js";
import { decodeStoredStoryboardPlan } from "../storyboard/storyboard-plan-compatibility.js";
import { resolveSystemGenerationConstraints } from "../generation-config/system-constraints.js";
import { getProjectGenerationConfiguration } from "../generation-config/generation-config.repository.js";
import type {
  DbClient,
  ProjectRecord,
  ScriptRecord,
  StoryboardRecord,
  TopicPackageRecord,
} from "../../db/client";
import {
  createCompositeInteractionLogWriter,
  persistProjectRunArtifacts,
  sanitizeAssetPlanningIntentChunkDiagnostic,
  sanitizeAssetPlanningResilienceDiagnostic,
  type TraceLogWriter,
} from "../../runtime/trace/project-storage.js";
import { createBillingInteractionLogWriter, type LlmBillingContext } from "../generation-cost/llm-billing-writer.js";
import { LlmOutputError } from "../../runtime/llm/llm-output-error.js";
import { ExternalServiceError } from "../../runtime/llm/external-errors.js";
import { getValidatedRuntimeEnv } from "../../config/env.js";
import {
  generateAssetPlan,
  type AssetPlanningResilienceEvent,
  type IntentChunkSettledEvent,
} from "./asset-planning-generation.service";
import { LegacyChunkResilienceError } from "./legacy-chunk-resilience.js";
import { validateAssetPlan } from "./asset-planning-local-validator";
import { repairAssetPlanStructure } from "./asset-planning-structural-repair.service";
import { saveAssetPlanRecord } from "./asset-plan-record.repository";
import {
  AssetPlanCompilerInvariantError,
  type AssetPlanCompilerIssue,
} from "./asset-plan-intent-compiler.js";

export interface RunAssetPlanningGenerationInput {
  db: DbClient;
  project: ProjectRecord;
  /** 演示/测试态：与 storyboard 快照一致的真实系统约束来源。 */
  demoMode: boolean;
  /** S2-2A 任务 9B：付费 quote 绑定 run 的计费上下文（LLM 记账）；免 quote 路径不传。 */
  billingContext?: LlmBillingContext;
  /**
   * S2-2B：画风 preset 冻结参数（来自运行快照 resolved_creative.art_style）。
   * 执行端只消费快照冻结值，绝不重新读取注册表当前版本（外部审查 P1-3）。
   */
  artStylePreset?: {
    preset_id: string;
    preset_version: string;
    resolved_params: {
      visual_tone_hint: string;
      global_prompt_prefix: string;
      global_negative_prompts: string[];
      style_keywords: string[];
      era_style_hint: string | null;
    };
  } | null;
}

function writeTraceErrorSafely(writer: TraceLogWriter, message: string) {
  try {
    writer.writeError(message);
  } catch {
    console.warn("[asset-planning] trace_error_writer_failed");
  }
}

const NOOP_TRACE_LOG_WRITER: TraceLogWriter = {
  write() {},
  writeError() {},
  writeDiagnostic() {},
};

function createTraceLogWriterSafely(input: {
  project: ProjectRecord;
  runId: string;
  billingContext?: LlmBillingContext;
}): TraceLogWriter {
  try {
    const plainWriter = createCompositeInteractionLogWriter({
      project: input.project,
      phase: "asset_planning",
      runId: input.runId,
    });
    // 9B：付费 quote 绑定 run 的 writer 包计费包装（LLM interaction 记账）
    return input.billingContext
      ? (createBillingInteractionLogWriter({
          billing: input.billingContext,
          inner: plainWriter,
          interactionRunId: input.runId,
        }) as TraceLogWriter)
      : plainWriter;
  } catch {
    console.warn("[asset-planning] trace_writer_initialization_failed");
    return NOOP_TRACE_LOG_WRITER;
  }
}

function persistRunDiagnosticsSafely(input: {
  project: ProjectRecord;
  runId: string;
  traceSummary: Record<string, unknown>;
  runtimeDiagnostics: Record<string, unknown>;
}) {
  try {
    persistProjectRunArtifacts({
      project: input.project,
      phase: "asset_planning",
      runId: input.runId,
      traceSummary: input.traceSummary,
      runtimeDiagnostics: input.runtimeDiagnostics,
    });
  } catch {
    console.warn("[asset-planning] run_diagnostics_persistence_failed");
  }
}

function mapScriptDraft(record: ScriptRecord) {
  return ScriptDraftPackage.parse({
    script_text: record.scriptText,
    estimated_duration_sec: record.estimatedDurationSec,
    beat_trace: record.beatTraceJson,
    quote_trace: record.quoteTraceJson,
    opening_span: record.openingSpan,
    ending_span: record.endingSpan,
  });
}

function mapTopicBoundaryContext(record: TopicPackageRecord) {
  return {
    title: record.title,
    selected_angle: record.selectedAngle,
    family_label: record.familyLabel,
    scope_label: record.scopeLabel,
    core_conflict: record.coreConflict,
    strong_scene: record.strongScene,
    forbidden_expansions: record.forbiddenExpansionsJson,
    risk_hints: record.riskHintsJson,
    source_anchor_refs: record.sourceAnchorRefsJson,
    canonical_quotes: record.canonicalQuotesJson,
    narrative_tension_map: record.narrativeTensionMapJson,
  };
}

function buildTraceSummary(input: {
  runId: string;
  validationDecision: string;
  regenerated: boolean;
  planStructuralRepairUsed: boolean;
  staleSourceDetected: boolean;
}) {
  const now = new Date().toISOString();
  const steps = [
    "asset-planning-generate",
    "asset-planning-local-audio-skeleton",
    "asset-planning-global-plan",
    "asset-planning-segment-chunk-plan",
    "asset-planning-local-merge",
  ].map((stepName) => ({
    step_name: stepName,
    phase: "asset_planning",
    status: "succeeded",
    started_at: now,
    ended_at: now,
    duration_ms: 0,
  }));

  if (input.regenerated) {
    steps.push({
      step_name: "asset-planning-regenerate",
      phase: "asset_planning",
      status: "succeeded",
      started_at: now,
      ended_at: now,
      duration_ms: 0,
    });
  }

  if (input.planStructuralRepairUsed) {
    steps.push({
      step_name: "asset-planning-structural-repair",
      phase: "asset_planning",
      status: "succeeded",
      started_at: now,
      ended_at: now,
      duration_ms: 0,
    });
  }

  steps.push({
    step_name: "asset-planning-local-validate",
    phase: "asset_planning",
    status: input.validationDecision === "pass" ? "succeeded" : "failed",
    started_at: now,
    ended_at: now,
    duration_ms: 0,
  });

  if (input.staleSourceDetected) {
    steps.push({
      step_name: "asset-planning-source-recheck",
      phase: "asset_planning",
      status: "failed",
      started_at: now,
      ended_at: now,
      duration_ms: 0,
    });
  }

  return {
    phase: "asset_planning",
    run_id: input.runId,
    nodes: [
      {
        node_name: "asset-planning-generate",
        input_ref: "active-storyboard:current",
        output_ref: "asset-plan:candidate",
        failure_reason: null,
      },
      {
        node_name: "asset-planning-local-validate",
        input_ref: "asset-plan:candidate",
        output_ref: "asset-planning-local-validation:current",
        failure_reason:
          input.validationDecision === "pass"
            ? null
            : "asset_plan_local_validation_failed",
      },
      {
        node_name: "asset-planning-source-recheck",
        input_ref: "active-storyboard:current",
        output_ref: "asset-plan-activation:current",
        failure_reason: input.staleSourceDetected
          ? "stale_asset_plan_source"
          : null,
      },
    ],
    steps,
  };
}

function buildRuntimeDiagnostics(input: {
  validationDecision: string;
  validationErrors: string[];
  regenerated: boolean;
  planStructuralRepairUsed: boolean;
  staleSourceDetected: boolean;
  globalStructure?: ReturnType<typeof aggregateGlobalStructureEvents>;
  globalStructureFailureCode?: string;
  includeLocalValidation?: boolean;
  intentChunkDiagnostics?: Record<string, unknown>;
}) {
  const checks = input.includeLocalValidation === false
    ? []
    : [
        {
          code:
            input.validationDecision === "pass"
              ? "asset_planning_local_validation_passed"
              : "asset_planning_local_validation_failed",
          level: input.validationDecision === "pass" ? "info" : "error",
        },
        ...input.validationErrors.map((error) => ({
          code: error,
          level: "error",
        })),
      ];

  if (input.regenerated) {
    checks.push({
      code: "asset_planning_regen_once",
      level: "warning",
    });
  }

  if (input.planStructuralRepairUsed) {
    checks.push({
      code: "asset_planning_plan_structural_repair_used",
      level: "warning",
    });
  }

  if (input.staleSourceDetected) {
    checks.push({
      code: "asset_planning_stale_source_detected",
      level: "error",
    });
  }

  if (input.globalStructure?.global_structure_normalization_used) {
    checks.push({
      code: "asset_global_structure_normalization_used",
      level: "warning",
    });
  }
  if (input.globalStructure?.global_plan_mode_contamination_normalized) {
    checks.push({
      code: "asset_global_plan_mode_contamination_normalized",
      level: "warning",
    });
  }
  if (input.globalStructure?.global_structural_repair_used) {
    checks.push({
      code: "asset_global_structural_repair_used",
      level: "warning",
    });
  }
  if (input.globalStructureFailureCode) {
    checks.push({
      code: input.globalStructureFailureCode,
      level: "error",
    });
  }
  if (input.globalStructure?.legacy_chunk_patch_coercion_used) {
    checks.push({
      code: "asset_legacy_chunk_patch_coerced",
      level: "warning",
    });
  }
  if (input.globalStructure?.legacy_chunk_patch_coercion_failed) {
    checks.push({
      code: "asset_legacy_chunk_patch_coercion_failed",
      level: "error",
    });
  }
  if (input.globalStructure?.legacy_audio_timing_rebind_used) {
    checks.push({
      code: "asset_legacy_audio_timing_rebound",
      level: "warning",
    });
  }
  if (input.globalStructure?.legacy_audio_timing_rebind_failed) {
    checks.push({
      code: "asset_legacy_audio_timing_rebind_ambiguous",
      level: "error",
    });
  }

  return {
    checks: checks.filter(
      (check, index, all) =>
        all.findIndex((candidate) => candidate.code === check.code) === index,
    ),
    ...(input.intentChunkDiagnostics
      ? { intent_chunk_diagnostics: input.intentChunkDiagnostics }
      : {}),
  };
}

function aggregateGlobalStructureEvents(events: AssetPlanningResilienceEvent[]) {
  const normalizationActions = events.flatMap((event) =>
    event.type === "normalization_applied" ? event.actions : [],
  );
  const normalizedPaths = [
    ...new Set(
      normalizationActions
        .filter((action) => action.type === "default_inserted")
        .map((action) => sanitizeGlobalPath(action.path)),
    ),
  ].sort();
  const chunkPatchActions = events.flatMap((event) =>
    event.type === "legacy_chunk_patch_coerced" ? event.actions : [],
  );
  const chunkPatchIssues = events.flatMap((event) =>
    event.type === "legacy_chunk_patch_coercion_failed" ? event.issues : [],
  );
  const chunkPatchIssuePaths = [
    ...new Set(chunkPatchIssues.map((issue) => sanitizeGlobalPath(issue.path))),
  ].sort();
  const timingActions = events.flatMap((event) =>
    event.type === "legacy_audio_timing_canonicalized" ? event.actions : [],
  );
  const timingIssues = events.flatMap((event) =>
    event.type === "legacy_audio_timing_canonicalization_failed"
      ? event.issues
      : [],
  );
  const timingIssuePaths = [
    ...new Set(timingIssues.map((issue) => sanitizeGlobalPath(issue.path))),
  ].sort();
  return {
    global_structure_normalization_used: normalizationActions.length > 0,
    global_structure_normalized_paths: normalizedPaths.slice(0, 50),
    global_structure_normalized_path_count: normalizedPaths.length,
    global_structure_paths_truncated: normalizedPaths.length > 50,
    global_plan_mode_contamination_normalized: normalizationActions.some(
      (action) => action.type === "forbidden_chunk_key_removed",
    ),
    global_structural_repair_used: events.some(
      (event) => event.type === "repair_started",
    ),
    legacy_chunk_patch_coercion_used: chunkPatchActions.length > 0,
    legacy_chunk_patch_action_types: [
      ...new Set(chunkPatchActions.map((action) => action.type)),
    ].sort(),
    legacy_chunk_patch_action_count: chunkPatchActions.length,
    legacy_chunk_patch_coercion_failed: chunkPatchIssues.length > 0,
    legacy_chunk_patch_issue_paths: chunkPatchIssuePaths.slice(0, 20),
    legacy_chunk_patch_issue_count: chunkPatchIssues.length,
    legacy_chunk_patch_issues_truncated: chunkPatchIssuePaths.length > 20,
    legacy_audio_timing_rebind_used: timingActions.some(
      (action) => action.type === "audio_timing_rebound",
    ),
    legacy_audio_timing_rebind_count: timingActions.filter(
      (action) => action.type === "audio_timing_rebound",
    ).length,
    legacy_audio_timing_rebind_failed: timingIssues.length > 0,
    legacy_audio_timing_issue_paths: timingIssuePaths.slice(0, 20),
    legacy_audio_timing_issue_count: timingIssues.length,
    legacy_audio_timing_issues_truncated: timingIssuePaths.length > 20,
  };
}

function formatIssuePath(path: Array<string | number>) {
  if (path.length === 0) return "<root>";
  return path.reduce<string>((formatted, segment) => {
    if (typeof segment === "number") return `${formatted}[${segment}]`;
    return formatted ? `${formatted}.${segment}` : segment;
  }, "");
}

const SAFE_COMPILER_ISSUE_CODES = new Set([
  "storyboard_order_invalid",
  "storyboard_segment_id_duplicate",
  "chunk_index_duplicate",
  "chunk_index_sequence_invalid",
  "chunk_segment_sequence_mismatch",
  "unknown_segment",
  "missing_segment",
  "duplicate_segment",
  "visual_strategy_mismatch",
  "audio_skeleton_mismatch",
  "unsupported_intent_kind",
  "global_bgm_owner_invalid",
  "visual_anchor_duplicate",
  "visual_anchor_missing",
  "task_id_collision",
  "dependency_endpoint_invalid",
  "dependency_duplicate",
  "compiled_plan_schema_invalid",
  "asset_audio_cue_no_input_contract",
  "asset_dependency_cycle_detected",
  "asset_dependency_task_missing",
  "asset_dependency_timing_source_invalid",
  "asset_plan_source_script_mismatch",
  "asset_plan_source_storyboard_mismatch",
  "asset_plan_source_topic_mismatch",
  "asset_plan_zero_video_clip_without_explanation",
  "asset_subtitle_missing_tts_dependency",
  "asset_task_id_duplicate",
  "asset_task_order_invalid",
  "asset_task_source_segment_invalid",
  "asset_tts_excerpt_drift",
  "asset_tts_script_coverage_low",
  "asset_tts_script_coverage_missing",
  "asset_video_missing_static_fallback",
  "asset_visual_prompt_missing",
  "asset_visual_risk_notes_missing",
]);

const ASSET_PLANNING_ERROR_CODES = new Set([
  "asset_segment_intent_invalid",
  "asset_global_plan_schema_invalid",
  "asset_global_plan_structural_repair_failed",
  "asset_chunk_plan_schema_invalid",
  "asset_chunk_forbidden_task_type_violated",
  "asset_chunk_task_segment_out_of_scope_violated",
  "asset_chunk_support_image_reason_missing_violated",
  "asset_chunk_anchor_image_budget_exceeded_violated",
  "asset_chunk_dependency_local_id_missing_violated",
  "asset_plan_schema_invalid",
  "asset_legacy_chunk_patch_coercion_failed",
  "asset_legacy_audio_timing_rebind_ambiguous",
  "asset_plan_compiler_invariant_failed",
  // 2026-08-25：provider 限流失败透传为 rate_limited（前端可显示"LLM 限流"）
  "rate_limited",
  "internal_server_error",
]);

function classifyAssetPlanningErrorCode(error: unknown): string {
  if (
    error instanceof LlmOutputError ||
    error instanceof LegacyChunkResilienceError ||
    error instanceof AssetPlanCompilerInvariantError ||
    // 2026-08-26：provider 异常（限流/超时/服务不可用等）按 code 透传，
    // 避免 chunk 限流失败被降级为笼统的 internal_server_error
    error instanceof ExternalServiceError
  ) {
    return ASSET_PLANNING_ERROR_CODES.has(error.code)
      ? error.code
      : "internal_server_error";
  }
  return "internal_server_error";
}

const SAFE_COMPILER_PATH_FIELDS = new Set([
  "sourceIds", "storyboardRecordId", "scriptRecordId", "topicPackageId",
  "storyboard", "segments", "segment_id", "order", "draft", "globalDraft",
  "audioSkeleton", "tts_plan", "tasks", "dependencies", "chunks",
  "chunkIndex", "inputSegmentIds", "planning_mode", "source_segment_id",
  "intents", "asset_kind", "task_id", "dependency_id", "depends_on_task_id",
  "dependency_type", "segmentVisualRoutes", "resolved_route", "reason_code",
  "route", "art_bible",
  "visual_budget", "downgrade_policy", "global_audio_strategy",
]);

function redactCompilerInvariantIssues(
  issues: AssetPlanCompilerIssue[],
) {
  const redacted = issues.slice(0, 50).map((issue) => ({
    code: SAFE_COMPILER_ISSUE_CODES.has(issue.code) ? issue.code : "compiler_invariant_issue",
    path: formatIssuePath((issue.path ?? []).slice(0, 12).map((part) => {
      if (typeof part === "string") {
        return SAFE_COMPILER_PATH_FIELDS.has(part) ? part : "$unknown";
      }
      return Number.isSafeInteger(part) && part >= 0 ? part : "$index";
    })),
  }));
  return {
    issue_count: issues.length,
    issues_truncated:
      issues.length > 50 ||
      new Set(redacted.map((issue) => issue.code)).size > 20 ||
      new Set(redacted.map((issue) => issue.path)).size > 20,
    issue_codes: [...new Set(redacted.map((issue) => issue.code))].sort().slice(0, 20),
    issue_paths: [...new Set(redacted.map((issue) => issue.path))].sort().slice(0, 20),
  };
}

function extractIssuePaths(error: unknown) {
  if (!(error instanceof LlmOutputError) || error.cause === undefined) return [];
  const cause = error.cause as Record<string, unknown>;
  const collections = [
    cause.initial_issues,
    cause.patch_issues,
    cause.final_issues,
  ];
  const paths = collections.flatMap((collection) =>
    Array.isArray(collection)
      ? collection.flatMap((issue) => {
          if (typeof issue !== "object" || issue === null) return [];
          const path = (issue as Record<string, unknown>).path;
          if (!Array.isArray(path)) return [];
          if (
            !path.every(
              (part) => typeof part === "string" || typeof part === "number",
            )
          ) return [];
          return [sanitizeGlobalPath(path)];
        })
      : [],
  );
  return [...new Set(paths)].sort().slice(0, 20);
}

const SAFE_GLOBAL_PATH_FIELDS = new Set([
  "plan_version", "characters", "locations", "visual_rules", "audio_rules",
  "visual_style", "continuity_rules", "negative_constraints", "bgm_plan",
  "global_ambience", "global_sfx_policy", "chunk_id", "tasks",
  "dependencies", "budget_notes", "depends_on_task_id", "dependency_type",
  "patch_fields", "risk_notes", "art_bible", "props", "consistency_notes",
]);

function sanitizeGlobalPath(path: unknown): string {
  if (Array.isArray(path)) {
    const parts = path.slice(0, 12).map((part) => {
      if (typeof part === "number") {
        return Number.isSafeInteger(part) && part >= 0 ? part : "$index";
      }
      return typeof part === "string" && SAFE_GLOBAL_PATH_FIELDS.has(part)
        ? part
        : "$unknown";
    });
    return formatIssuePath(parts);
  }
  if (typeof path !== "string") return "$unknown";
  const parts = path.match(/[^.\[\]]+|\d+/g) ?? [];
  return formatIssuePath(
    parts.slice(0, 12).map((part) =>
      /^\d+$/.test(part)
        ? Number(part)
        : SAFE_GLOBAL_PATH_FIELDS.has(part)
          ? part
          : "$unknown",
    ),
  );
}

function summarizeIssues(collections: unknown[][]) {
  const issues = collections.flat();
  const paths = issues.flatMap((issue) => {
    if (typeof issue !== "object" || issue === null) return [];
    const path = (issue as Record<string, unknown>).path;
    return path === undefined ? [] : [sanitizeGlobalPath(path)];
  });
  const uniquePaths = [...new Set(paths)].sort();
  return {
    issue_count: issues.length,
    issue_paths: uniquePaths.slice(0, 20),
    issues_truncated: uniquePaths.length > 20,
  };
}

function summarizeGlobalStructureEvent(
  event: AssetPlanningResilienceEvent,
): Record<string, unknown> {
  if (event.type.startsWith("legacy_")) {
    return sanitizeAssetPlanningResilienceDiagnostic(event);
  }
  switch (event.type) {
    case "normalization_applied": {
      const actionTypes = [
        ...new Set(
          event.actions.map((action) =>
            action.type === "default_inserted" ||
            action.type === "forbidden_chunk_key_removed"
              ? action.type
              : "normalization_action",
          ),
        ),
      ].sort();
      const actionPaths = [
        ...new Set(event.actions.map((action) => sanitizeGlobalPath(action.path))),
      ].sort();
      return {
        type: event.type,
        action_count: event.actions.length,
        action_types: actionTypes.slice(0, 20),
        action_paths: actionPaths.slice(0, 20),
        actions_truncated: actionPaths.length > 20,
      };
    }
    case "repair_started":
      return { type: event.type, ...summarizeIssues([event.issues]) };
    case "repair_failed":
      return {
        type: event.type,
        ...summarizeIssues([
          event.initial_issues,
          event.patch_issues,
          event.final_issues,
        ]),
      };
    case "repair_provider_failed":
      return {
        type: event.type,
        error_code: "asset_global_structural_repair_provider_failed",
      };
    case "repair_succeeded":
      return { type: event.type };
    default:
      return { type: "global_structure_event" };
  }
}

function buildResilienceFailureTracePayload(input: {
  errorCode: string;
  globalStructure: ReturnType<typeof aggregateGlobalStructureEvents>;
}): Record<string, unknown> | undefined {
  const isResilienceFailure =
    input.globalStructure.legacy_chunk_patch_coercion_failed ||
    input.globalStructure.legacy_audio_timing_rebind_failed;
  if (!isResilienceFailure) return undefined;

  const issuePaths = [
    ...new Set([
      ...input.globalStructure.legacy_chunk_patch_issue_paths,
      ...input.globalStructure.legacy_audio_timing_issue_paths,
    ]),
  ].sort();
  const issueCount =
    input.globalStructure.legacy_chunk_patch_issue_count +
    input.globalStructure.legacy_audio_timing_issue_count;

  return {
    error_code: input.errorCode,
    failure_class: "deterministic_resilience",
    issue_count: issueCount,
    issue_paths: issuePaths.slice(0, 20),
    issues_truncated:
      input.globalStructure.legacy_chunk_patch_issues_truncated ||
      input.globalStructure.legacy_audio_timing_issues_truncated ||
      issuePaths.length > 20,
  };
}

function isStaleSource(input: {
  db: DbClient;
  projectId: string;
  capturedStoryboardRecordId: string;
  capturedScriptRecordId: string;
}) {
  const currentProject = input.db.projects.get(input.projectId);
  if (!currentProject) {
    return true;
  }
  if (currentProject.activeStoryboardRecordId !== input.capturedStoryboardRecordId) {
    return true;
  }

  const currentStoryboard = input.db.storyboardRecords.get(
    input.capturedStoryboardRecordId,
  );
  return currentStoryboard?.scriptRecordId !== input.capturedScriptRecordId;
}

function buildValidationInput(input: {
  storyboardRecord: StoryboardRecord;
  scriptRecord: ScriptRecord;
  topicPackage: TopicPackageRecord;
  storyboard: StoryboardPlan;
  plan: AssetPlan;
  segmentVisualRoutes: ReadonlyMap<string, ResolvedSegmentVisualRoute>;
}) {
  return {
    storyboardRecordId: input.storyboardRecord.id,
    scriptRecordId: input.scriptRecord.id,
    topicPackageId: input.topicPackage.id,
    storyboard: input.storyboard,
    scriptText: input.scriptRecord.scriptText,
    plan: input.plan,
    segmentVisualRoutes: input.segmentVisualRoutes,
  };
}

export async function runAssetPlanningGeneration(
  input: RunAssetPlanningGenerationInput,
) {
  const generationMode = getValidatedRuntimeEnv().assetPlanningGenerationMode;
  if (!input.project.activeStoryboardRecordId) {
    return {
      statusCode: 409,
      body: {
        error: "active_storyboard_missing",
      },
    };
  }

  const storyboardRecord = input.db.storyboardRecords.get(
    input.project.activeStoryboardRecordId,
  );
  if (!storyboardRecord) {
    return {
      statusCode: 404,
      body: {
        error: "storyboard_record_not_found",
      },
    };
  }

  const scriptRecord = input.db.scriptRecords.get(storyboardRecord.scriptRecordId);
  const topicPackage = input.db.topicPackages.get(storyboardRecord.topicPackageId);
  if (!scriptRecord || !topicPackage) {
    return {
      statusCode: 404,
      body: {
        error: "source_record_not_found",
      },
    };
  }

  // S2-2A 任务 4：旧 StoryboardPlan 必须先经兼容解码器读取，
  // 禁止让 legacy visual_strategy_preference 进入新 prompt 或正式下游合同。
  const storyboardDecoded = decodeStoredStoryboardPlan(storyboardRecord.planJson);
  if (!storyboardDecoded.ok) {
    return {
      statusCode: 500,
      body: {
        error: "storyboard_plan_invalid",
        detail: storyboardDecoded.error,
      },
    };
  }
  const storyboard = storyboardDecoded.value.plan;
  const draft = mapScriptDraft(scriptRecord);
  const topicBoundaryContext = mapTopicBoundaryContext(topicPackage);

  // S2-2A 任务 5：与 storyboard 快照同源的 resolver 解析，产出每段最终视觉路线。
  // 解析失败是权威错误（配置损坏/catalog 缺失/固定模型不可用），必须在调用 LLM、
  // 创建 AssetPlanRecord 之前结构化失败退出，不得伪造 Remotion 路线吞掉
  // all_api_video、显式 API override 或 capability 错误。
  const routeOverrides = [...input.db.storyboardSegmentOverrides.values()].filter(
    (o) => o.storyboardRecordId === storyboardRecord.id,
  );
  const configResult = await getProjectGenerationConfiguration(
    input.db,
    input.project.id,
    input.project.ownerId,
  );
  const routeResolution = resolveGenerationConfiguration({
    projectConfiguration: configResult.configuration,
    projectConfigurationRevision: configResult.revision,
    sourceUserPreferenceRevision: configResult.sourceUserPreferenceRevision,
    systemConstraints: resolveSystemGenerationConstraints(input.demoMode),
    providerModelCatalog: [...input.db.providerModelCatalog.values()].map((entry) => ({
      provider_model_id: entry.id,
      capability: entry.capability,
      provider_key: entry.providerKey,
      model_id: entry.modelId,
      model_version: entry.modelVersion,
      status: entry.status,
      is_default: entry.isDefault,
    })),
    operation: "asset_plan.generate",
    segmentInputs: storyboard.segments.map((s) => ({
      segment_id: s.segment_id,
      api_video_suitability: s.api_video_suitability,
    })),
    segmentOverrides: Object.fromEntries(
      routeOverrides.map((o) => [o.segmentId, o.strategyOverride]),
    ),
  });
  if (!routeResolution.ok) {
    // 透传 resolver 的公开安全字段（code/capability/segment_id 均无凭据细节），
    // 便于后续 UI 精确提示失败原因。
    return {
      statusCode: 500,
      body: {
        error: "asset_plan_route_resolution_failed",
        detail: routeResolution.error.message,
        reason_code: routeResolution.error.code,
        ...(routeResolution.error.capability
          ? { capability: routeResolution.error.capability }
          : {}),
        ...(routeResolution.error.segment_id
          ? { segment_id: routeResolution.error.segment_id }
          : {}),
      },
    };
  }
  const segmentVisualRoutes = new Map<string, ResolvedSegmentVisualRoute>();
  for (const route of routeResolution.value.segment_visual_routes) {
    segmentVisualRoutes.set(route.segment_id, route);
  }

  const runId = `asset_plan_run_${input.db.generateId()}`;
  const interactionLogWriter = createTraceLogWriterSafely({
    project: input.project,
    runId,
    billingContext: input.billingContext,
  });
  const previousActiveAssetPlanRecordId = input.project.activeAssetPlanRecordId;
  const previousProjectStatus = input.project.status;
  const previousProjectUpdatedAt = input.project.updatedAt;
  const globalStructureEvents: AssetPlanningResilienceEvent[] = [];
  const intentChunkEvents: Array<Record<string, unknown>> = [];
  const onGlobalStructureEvent = async (event: AssetPlanningResilienceEvent) => {
    globalStructureEvents.push(event);
    try {
      interactionLogWriter.writeDiagnostic(
        event.type.startsWith("legacy_")
          ? "asset-planning.resilience"
          : "asset-planning.global-structure",
        summarizeGlobalStructureEvent(event),
      );
    } catch {
      console.warn("[asset-planning] global_structure_diagnostic_write_failed");
    }
  };
  const onIntentChunkSettled = async (event: IntentChunkSettledEvent) => {
    const sanitized = sanitizeAssetPlanningIntentChunkDiagnostic({
      chunks: [structuredClone(event)],
    });
    const chunk = Array.isArray(sanitized.chunks)
      ? sanitized.chunks[0]
      : undefined;
    if (chunk && typeof chunk === "object") {
      const safeChunk = chunk as Record<string, unknown>;
      const chunkIndex = safeChunk.chunk_index;
      const existingIndex = intentChunkEvents.findIndex(
        (candidate) => candidate.chunk_index === chunkIndex,
      );
      if (existingIndex >= 0) intentChunkEvents[existingIndex] = safeChunk;
      else intentChunkEvents.push(safeChunk);
      intentChunkEvents.sort(
        (left, right) => Number(left.chunk_index) - Number(right.chunk_index),
      );
    }
    try {
      interactionLogWriter.writeDiagnostic(
        "asset-planning.intent-chunks",
        sanitizeAssetPlanningIntentChunkDiagnostic({ chunks: intentChunkEvents }),
      );
    } catch {
      console.warn("[asset-planning] intent_chunk_diagnostic_write_failed");
    }
  };
  const getIntentChunkDiagnostics = () =>
    sanitizeAssetPlanningIntentChunkDiagnostic({ chunks: intentChunkEvents });
  let generatingRecord:
    | Awaited<ReturnType<typeof saveAssetPlanRecord>>
    | undefined;
  let activationProjectSnapshot:
    | Pick<
        ProjectRecord,
        | "status"
        | "activeAssetPlanRecordId"
        | "activeAssetManifestRecordId"
        | "activeComposeRecordId"
        | "activeRenderJobRecordId"
        | "activePublishPackageRecordId"
        | "latestAssetPlanRunTraceJson"
        | "latestAssetsRunTraceJson"
        | "latestComposeRunTraceJson"
        | "latestRenderRunTraceJson"
        | "updatedAt"
      >
    | undefined;
  let acceptProgressUpdates = true;
  let progressWriteChain: Promise<void> = Promise.resolve();

  try {
    // Save preliminary record BEFORE plan generation so refresh shows generating state
    generatingRecord = await saveAssetPlanRecord(input.db, {
      projectId: input.project.id,
      topicPackageId: topicPackage.id,
      scriptRecordId: scriptRecord.id,
      storyboardRecordId: storyboardRecord.id,
      planJson: { plan_version: "asset_plan_v1" as const, characters: [], locations: [], tasks: [], visual_rules: {}, audio_rules: {} } as unknown as AssetPlan,
      validationResultJson: { stage: "asset_planning_local_validation" as const, decision: "pass" as const, errors: [], warnings: [], metrics: {} } as AssetPlanningValidationResult,
      executionStateJson: { generating: true, run_id: runId, repair_used: false, regenerate_used: false },
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
    });
    input.project.status = "asset_plan_generating";
    await input.db.firstAggregateWriter?.syncProject(input.project);

    const onProgress = (progress: import("./asset-planning-generation.service.js").AssetPlanGenerationProgress) => {
      if (!acceptProgressUpdates || !generatingRecord) return;
      const record = generatingRecord;
      const queuedWrite = progressWriteChain.then(async () => {
        if (!acceptProgressUpdates) return;
        try {
          await saveAssetPlanRecord(input.db, {
          id: record.id,
          projectId: record.projectId,
          topicPackageId: record.topicPackageId,
          scriptRecordId: record.scriptRecordId,
          storyboardRecordId: record.storyboardRecordId,
          planJson: record.planJson,
          validationResultJson: record.validationResultJson,
          executionStateJson: {
            generating: true,
            run_id: runId,
            repair_used: false,
            regenerate_used: false,
            progress_phase: progress.phase,
            progress_completed_chunks: progress.completed_chunks,
            progress_total_chunks: progress.total_chunks,
            progress_total_segments: progress.total_segments,
          },
          graphTraceSummaryJson: record.graphTraceSummaryJson,
          runtimeDiagnosticsJson: record.runtimeDiagnosticsJson,
          createdAt: record.createdAt,
          });
        } catch {
          writeTraceErrorSafely(
            interactionLogWriter,
            JSON.stringify({ error_code: "asset_plan_progress_save_failed" }),
          );
        }
      });
      progressWriteChain = queuedWrite;
      return queuedWrite;
    };

    let plan = await generateAssetPlan({
    sourceStoryboardRecordId: storyboardRecord.id,
    sourceScriptRecordId: scriptRecord.id,
    sourceTopicPackageId: topicPackage.id,
    storyboard,
    draft,
    topicBoundaryContext,
    generationMode,
    segmentVisualRoutes,
    interactionLogWriter,
    onProgress,
    onGlobalStructureEvent,
    onIntentChunkSettled,
    artStylePreset: input.artStylePreset ?? null,
    // S2-2C（详细设计 §6.1）：单一真相源——从 billingContext.resolved 派生
    snapshotCapabilities: input.billingContext?.resolved.resolved_capabilities,
    // 2026-08-28：video_clip 分辨率从快照 api_quality 机械映射（修复点：
    // 编译器原硬编码 1080P，执行绕过用户配置且与计价档位脱节）
    videoResolution: apiQualityToDashscopeResolution(
      (
        input.billingContext?.resolved as { effective?: { video?: { api_quality?: string } } }
      )?.effective?.video?.api_quality,
    ),
  });
  let localValidation = validateAssetPlan(
    buildValidationInput({
      storyboardRecord,
      scriptRecord,
      topicPackage,
      storyboard,
      plan,
      segmentVisualRoutes,
    }),
  );
  let regenerated = false;
  let planStructuralRepairUsed = false;

  if (
    generationMode === "intent_compiler" &&
    localValidation.decision !== "pass"
  ) {
    throw new AssetPlanCompilerInvariantError(
      localValidation.errors.map((code) => ({ code })),
    );
  }

  if (
    generationMode === "legacy" &&
    localValidation.decision === "regen_once"
  ) {
    const repairResult = await repairAssetPlanStructure({
      plan,
      validation: localValidation,
      storyboard,
      interactionLogWriter,
      snapshotCapabilities: input.billingContext?.resolved.resolved_capabilities,
    });
    plan = repairResult.plan;
    planStructuralRepairUsed = repairResult.repairUsed;
    if (planStructuralRepairUsed) {
      localValidation = validateAssetPlan(
        buildValidationInput({
          storyboardRecord,
          scriptRecord,
          topicPackage,
          storyboard,
          plan,
          segmentVisualRoutes,
        }),
      );
    }
  }

  let staleSourceDetected = false;
  let graphTraceSummary = buildTraceSummary({
    runId,
    validationDecision: localValidation.decision,
    regenerated,
    planStructuralRepairUsed,
    staleSourceDetected,
  });
  let runtimeDiagnostics = buildRuntimeDiagnostics({
    validationDecision: localValidation.decision,
    validationErrors: localValidation.errors,
    regenerated,
    planStructuralRepairUsed,
    staleSourceDetected,
    globalStructure: aggregateGlobalStructureEvents(globalStructureEvents),
    intentChunkDiagnostics: getIntentChunkDiagnostics(),
  });
  const intentChunkDiagnostics = getIntentChunkDiagnostics();
  const executionState = {
    regenerate_used: regenerated,
    plan_structural_repair_used: planStructuralRepairUsed,
    ...aggregateGlobalStructureEvents(globalStructureEvents),
    intent_chunk_diagnostics: intentChunkDiagnostics,
  };
  acceptProgressUpdates = false;
  await progressWriteChain;

  if (localValidation.decision !== "pass") {
    // Clean up generating state — validation failed
    await saveAssetPlanRecord(input.db, {
      id: generatingRecord.id,
      projectId: generatingRecord.projectId,
      topicPackageId: generatingRecord.topicPackageId,
      scriptRecordId: generatingRecord.scriptRecordId,
      storyboardRecordId: generatingRecord.storyboardRecordId,
      planJson: plan,
      validationResultJson: localValidation,
      executionStateJson: {
        ...executionState,
        generating: false,
        run_id: runId,
        error: "asset_plan_local_validation_failed",
      },
      graphTraceSummaryJson: graphTraceSummary,
      runtimeDiagnosticsJson: runtimeDiagnostics,
      createdAt: generatingRecord.createdAt,
    });
    input.project.activeAssetPlanRecordId = previousActiveAssetPlanRecordId;
    input.project.status = previousActiveAssetPlanRecordId ? "asset_plan_ready" : "storyboard_ready";
    input.project.updatedAt = new Date();
    await input.db.firstAggregateWriter?.syncProject(input.project);
    persistRunDiagnosticsSafely({
      project: input.project,
      runId,
      traceSummary: graphTraceSummary as unknown as Record<string, unknown>,
      runtimeDiagnostics: runtimeDiagnostics as unknown as Record<string, unknown>,
    });
    return {
      statusCode: 422,
      body: {
        error: "asset_plan_local_validation_failed",
        project_id: input.project.id,
        run_mode: "sync_runtime",
        source_storyboard_record_id: storyboardRecord.id,
        source_script_record_id: scriptRecord.id,
        source_topic_package_id: topicPackage.id,
        plan,
        local_validation: localValidation,
        execution_state: executionState,
        graph_trace_summary: graphTraceSummary,
        runtime_diagnostics: runtimeDiagnostics,
      },
    };
  }

  staleSourceDetected = isStaleSource({
    db: input.db,
    projectId: input.project.id,
    capturedStoryboardRecordId: storyboardRecord.id,
    capturedScriptRecordId: scriptRecord.id,
  });
  if (staleSourceDetected) {
    // Clean up generating state — stale source, delete the placeholder record
    input.db.assetPlanRecords.delete(generatingRecord.id);
    input.project.activeAssetPlanRecordId = previousActiveAssetPlanRecordId;
    input.project.status = previousActiveAssetPlanRecordId ? "asset_plan_ready" : "storyboard_ready";
    input.project.updatedAt = new Date();
    await input.db.firstAggregateWriter?.syncProject(input.project);
    graphTraceSummary = buildTraceSummary({
      runId,
      validationDecision: localValidation.decision,
      regenerated,
      planStructuralRepairUsed,
      staleSourceDetected,
    });
    runtimeDiagnostics = buildRuntimeDiagnostics({
      validationDecision: localValidation.decision,
      validationErrors: localValidation.errors,
      regenerated,
      planStructuralRepairUsed,
      staleSourceDetected,
      globalStructure: aggregateGlobalStructureEvents(globalStructureEvents),
      intentChunkDiagnostics: getIntentChunkDiagnostics(),
    });
    persistRunDiagnosticsSafely({
      project: input.project,
      runId,
      traceSummary: graphTraceSummary as unknown as Record<string, unknown>,
      runtimeDiagnostics: runtimeDiagnostics as unknown as Record<string, unknown>,
    });

    return {
      statusCode: 409,
      body: {
        error: "stale_asset_plan_source",
        project_id: input.project.id,
        run_mode: "sync_runtime",
        source_storyboard_record_id: storyboardRecord.id,
        source_script_record_id: scriptRecord.id,
        source_topic_package_id: topicPackage.id,
        plan,
        local_validation: localValidation,
        execution_state: executionState,
        graph_trace_summary: graphTraceSummary,
        runtime_diagnostics: runtimeDiagnostics,
      },
    };
  }

  const assetPlanRecord = await saveAssetPlanRecord(input.db, {
    id: generatingRecord.id,
    projectId: input.project.id,
    topicPackageId: topicPackage.id,
    scriptRecordId: scriptRecord.id,
    storyboardRecordId: storyboardRecord.id,
    planJson: plan,
    validationResultJson: localValidation,
    executionStateJson: executionState,
    graphTraceSummaryJson: graphTraceSummary,
    runtimeDiagnosticsJson: runtimeDiagnostics,
  });

  activationProjectSnapshot = {
    status: previousProjectStatus,
    activeAssetPlanRecordId: input.project.activeAssetPlanRecordId,
    activeAssetManifestRecordId: input.project.activeAssetManifestRecordId,
    activeComposeRecordId: input.project.activeComposeRecordId,
    activeRenderJobRecordId: input.project.activeRenderJobRecordId,
    activePublishPackageRecordId: input.project.activePublishPackageRecordId,
    latestAssetPlanRunTraceJson: input.project.latestAssetPlanRunTraceJson,
    latestAssetsRunTraceJson: input.project.latestAssetsRunTraceJson,
    latestComposeRunTraceJson: input.project.latestComposeRunTraceJson,
    latestRenderRunTraceJson: input.project.latestRenderRunTraceJson,
    updatedAt: previousProjectUpdatedAt,
  };
  input.project.activeAssetPlanRecordId = assetPlanRecord.id;
  input.project.activeAssetManifestRecordId = null;
  input.project.activeComposeRecordId = null;
  input.project.activeRenderJobRecordId = null;
  input.project.latestAssetPlanRunTraceJson =
    graphTraceSummary as unknown as Record<string, unknown>;
  input.project.latestAssetsRunTraceJson = null;
  input.project.latestComposeRunTraceJson = null;
  input.project.latestRenderRunTraceJson = null;
  input.project.status = "asset_plan_ready";
  input.project.updatedAt = new Date();
  await input.db.secondAggregateWriter?.activateAssetPlan(input.project, assetPlanRecord);
  persistRunDiagnosticsSafely({
    project: input.project,
    runId,
    traceSummary: graphTraceSummary as unknown as Record<string, unknown>,
    runtimeDiagnostics: runtimeDiagnostics as unknown as Record<string, unknown>,
  });

  return {
    statusCode: 200,
    body: {
      project_id: input.project.id,
      run_mode: "sync_runtime",
      asset_plan_record_id: assetPlanRecord.id,
      source_storyboard_record_id: storyboardRecord.id,
      source_script_record_id: scriptRecord.id,
      source_topic_package_id: topicPackage.id,
      plan,
      local_validation: localValidation,
      execution_state: executionState,
      graph_trace_summary: graphTraceSummary,
      runtime_diagnostics: runtimeDiagnostics,
    },
  };
  } catch (error) {
    acceptProgressUpdates = false;
    await progressWriteChain;
    const errorCode = classifyAssetPlanningErrorCode(error);
    const compilerInvariantFailure =
      error instanceof AssetPlanCompilerInvariantError
        ? redactCompilerInvariantIssues(error.issues)
        : undefined;
    const globalStructure = aggregateGlobalStructureEvents(globalStructureEvents);
    const intentChunkDiagnostics = getIntentChunkDiagnostics();
    const globalStructureFailureCode = globalStructureEvents.some(
      (event) => event.type === "repair_provider_failed",
    )
      ? "asset_global_structural_repair_provider_failed"
      : globalStructureEvents.some((event) => event.type === "repair_failed") ||
          errorCode === "asset_global_plan_structural_repair_failed"
        ? "asset_global_structural_repair_failed"
        : undefined;
    const failureDiagnostics = {
      ...buildRuntimeDiagnostics({
        validationDecision: "pass",
        validationErrors: [],
        regenerated: false,
        planStructuralRepairUsed: false,
        staleSourceDetected: false,
        globalStructure,
        globalStructureFailureCode,
        includeLocalValidation: false,
        intentChunkDiagnostics,
      }),
      ...(compilerInvariantFailure
        ? { compiler_invariant_failure: compilerInvariantFailure }
        : {}),
    };
    const failureExecutionState = {
      ...globalStructure,
      generating: false,
      run_id: runId,
      error: errorCode,
      intent_chunk_diagnostics: intentChunkDiagnostics,
    };
    const failureTraceSummary = {
      ...buildTraceSummary({
        runId,
        validationDecision: "failed_before_validation",
        regenerated: false,
        planStructuralRepairUsed: false,
        staleSourceDetected: false,
      }),
      error_code: errorCode,
    };

    // Clean up generating state — unexpected error
    if (generatingRecord) {
      await saveAssetPlanRecord(input.db, {
        id: generatingRecord.id,
        projectId: generatingRecord.projectId,
        topicPackageId: generatingRecord.topicPackageId,
        scriptRecordId: generatingRecord.scriptRecordId,
        storyboardRecordId: generatingRecord.storyboardRecordId,
        planJson: generatingRecord.planJson,
        validationResultJson: generatingRecord.validationResultJson,
        executionStateJson: {
          ...failureExecutionState,
        },
        graphTraceSummaryJson: failureTraceSummary,
        runtimeDiagnosticsJson: failureDiagnostics,
        createdAt: generatingRecord.createdAt,
      }).catch(() => {
        // 关键：清理失败时一定要记录，避免静默吞错让记录卡在 generating: true
        console.error("[asset-planning] generating_state_cleanup_failed");
        writeTraceErrorSafely(
          interactionLogWriter,
          JSON.stringify({
            error_code: "asset_plan_generating_state_cleanup_failed",
          }),
        );
      });
    }
    // 状态回退（2026-08-26 加固）：无条件回退到生成前状态，绝不把
    // asset_plan_generating 写回。入口快照存在时恢复它，但其 status 若已是
    // generating（历史失败滚动继承的脏状态）按 active 记录推导回退——
    // 避免一次失败卡住后所有后续失败都继承 generating。
    const fallbackStatus =
      previousProjectStatus === "asset_plan_generating"
        ? previousActiveAssetPlanRecordId
          ? "asset_plan_ready"
          : "storyboard_ready"
        : previousProjectStatus;
    if (activationProjectSnapshot) {
      Object.assign(input.project, {
        ...activationProjectSnapshot,
        status: fallbackStatus,
      });
      input.project.updatedAt = new Date();
    } else {
      input.project.activeAssetPlanRecordId = previousActiveAssetPlanRecordId;
      input.project.status = fallbackStatus;
      input.project.updatedAt = new Date();
    }
    // 失败 trace 同步到项目级（与成功路径对称），快照即可暴露 failure_reason
    input.project.latestAssetPlanRunTraceJson = failureTraceSummary as never;
    await input.db.firstAggregateWriter?.syncProject(input.project).catch(() => {
      console.warn("[asset-planning] project_sync_failed");
    });
    persistRunDiagnosticsSafely({
      project: input.project,
      runId,
      traceSummary: failureTraceSummary,
      runtimeDiagnostics: failureDiagnostics,
    });
    const resilienceFailureTracePayload = buildResilienceFailureTracePayload({
      errorCode,
      globalStructure,
    });
    if (compilerInvariantFailure) {
      writeTraceErrorSafely(
        interactionLogWriter,
        JSON.stringify({
          error_code: "asset_plan_compiler_invariant_failed",
          compiler_invariant_failure: compilerInvariantFailure,
        }),
      );
    } else if (resilienceFailureTracePayload) {
      writeTraceErrorSafely(
        interactionLogWriter,
        JSON.stringify(resilienceFailureTracePayload, null, 2),
      );
    } else {
      writeTraceErrorSafely(
        interactionLogWriter,
        JSON.stringify({
          error_code: errorCode,
          ...(errorCode === "asset_global_plan_structural_repair_failed"
            ? { issue_paths: extractIssuePaths(error) }
            : {}),
        }),
      );
    }
    return {
      statusCode: 500,
      body: {
        error: errorCode,
        repair_used: globalStructure.global_structural_repair_used,
        ...(errorCode === "asset_global_plan_structural_repair_failed"
          ? { issue_paths: extractIssuePaths(error) }
          : {}),
        ...(error instanceof LegacyChunkResilienceError
          ? {
              failure_class: "deterministic_resilience",
              issue_count: error.issues.length,
              issue_paths: [
                ...new Set(
                  error.issues.map((issue) => formatIssuePath(issue.path)),
                ),
              ]
                .sort()
                .slice(0, 20),
            }
          : {}),
      },
    };
  }
}
