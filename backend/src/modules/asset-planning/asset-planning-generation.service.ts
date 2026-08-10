import { z } from "zod";

import {
  AssetPlan,
  ProjectArtBible,
  type AssetTask,
  type ScriptDraftPackage,
  type StoryboardPlan,
} from "../../../../shared/src/index.js";
import { env, getValidatedRuntimeEnv } from "../../config/env.js";
import { createLlmGateway, type LlmGateway } from "../../runtime/llm/llm-gateway.js";
import { ExternalServiceError } from "../../runtime/llm/external-errors.js";
import type { LlmInteractionLogWriter } from "../../runtime/llm/interaction-log.js";
import { parseLlmOutput, LlmOutputError } from "../../runtime/llm/llm-output-error.js";
import { createTierAwareProviderFromEnv } from "../../runtime/llm/tier-aware-provider-factory.js";
import type {
  StructuredPromptInvocation,
  StructuredPromptProvider,
} from "../../runtime/llm/provider-contract.js";
import { createPromptRegistry } from "../../runtime/prompts/prompt-registry.js";
import {
  applyGlobalPlanningStructuralPatch,
  GlobalPlanningStructuralPatch,
  GlobalPlanningStructuralPatchError,
  normalizeGlobalPlanningDraftStructure,
  type GlobalDraftNormalizationAction,
} from "./global-planning-draft-resilience.js";
import {
  canonicalizeLegacyAudioTiming,
  coerceLegacyChunkStructuralPatch,
  LegacyChunkResilienceError,
  type LegacyAudioTimingIssue,
  type LegacyChunkResilienceAction,
  type SegmentChunkStructuralPatch as SegmentChunkStructuralPatchType,
} from "./legacy-chunk-resilience.js";
import { enrichAssetVisualPrompt } from "./asset-plan-prompt-enrichment.js";
import type { LocalAudioSkeleton } from "./asset-plan-intent-compiler.js";

const PROMPT_ID = "asset-planning.planner";
const STRUCTURAL_REPAIR_PROMPT_ID = "asset-planning.asset-structural-repair";
const GLOBAL_STRUCTURAL_REPAIR_PROMPT_ID =
  "asset-planning.global-structural-repair";

export interface AssetPlanningTopicBoundaryContext {
  title: string;
  selected_angle: string;
  family_label: string;
  scope_label: string;
  core_conflict: string;
  strong_scene: string;
  forbidden_expansions: unknown[];
  risk_hints: unknown[];
  source_anchor_refs: unknown[];
  canonical_quotes: unknown[];
  narrative_tension_map: Record<string, unknown>;
}

export interface AssetPlanGenerationProgress {
  phase: "global_plan" | "chunks";
  completed_chunks: number;
  total_chunks: number;
  total_segments: number;
}

export type AssetPlanningResilienceEvent =
  | {
      type: "normalization_applied";
      actions: GlobalDraftNormalizationAction[];
    }
  | {
      type: "repair_started";
      issues: GlobalPlanningSchemaIssue[];
    }
  | { type: "repair_succeeded" }
  | {
      type: "repair_failed";
      initial_issues: unknown[];
      patch_issues: unknown[];
      final_issues: unknown[];
    }
  | {
      type: "repair_provider_failed";
      error_code: string;
    }
  | {
      type: "legacy_chunk_patch_coerced";
      actions: LegacyChunkResilienceAction[];
    }
  | {
      type: "legacy_chunk_patch_coercion_failed";
      error_code: "asset_legacy_chunk_patch_coercion_failed";
      issues: Array<{
        code: string;
        path: Array<string | number>;
      }>;
    }
  | {
      type: "legacy_audio_timing_canonicalized";
      actions: LegacyChunkResilienceAction[];
    }
  | {
      type: "legacy_audio_timing_canonicalization_failed";
      error_code: "asset_legacy_audio_timing_rebind_ambiguous";
      issues: LegacyAudioTimingIssue[];
    };

export type GlobalDraftStructureEvent = AssetPlanningResilienceEvent;

export interface GenerateAssetPlanInput {
  sourceStoryboardRecordId: string;
  sourceScriptRecordId: string;
  sourceTopicPackageId: string;
  storyboard: StoryboardPlan;
  draft: ScriptDraftPackage;
  topicBoundaryContext: AssetPlanningTopicBoundaryContext;
  llmGateway?: LlmGateway;
  interactionLogWriter?: LlmInteractionLogWriter;
  chunkSize?: number;
  chunkConcurrency?: number;
  onProgress?: (progress: AssetPlanGenerationProgress) => void | Promise<void>;
  onGlobalStructureEvent?: (
    event: AssetPlanningResilienceEvent,
  ) => void | Promise<void>;
  regenerationContext?: {
    reason: "asset_planning_local_validation_regen_once";
    errors: string[];
    metrics: Record<string, unknown>;
  };
}

const ManualUploadPolicyDraft = z
  .object({
    allowed: z.boolean().default(false),
    required: z.boolean().default(false),
    accepted_file_types: z.array(z.string().min(1)).default([]),
    acceptance_notes: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .default({ allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] });

const GlobalPlanningDraft = z
  .object({
    planning_mode: z.literal("global"),
    art_bible: ProjectArtBible,
    visual_budget: z.record(z.string(), z.unknown()),
    downgrade_policy: z.record(z.string(), z.unknown()),
    global_audio_strategy: z.record(z.string(), z.unknown()),
    manual_review_notes: z.array(z.string().min(1)),
  })
  .passthrough();

const ChunkTaskDraft = z
  .object({
    local_task_id: z.string().min(1),
    task_type: z.enum([
      "image_still",
      "video_clip",
      "sfx_cue",
      "bgm_cue",
      "render_motion_cue",
    ]),
    source_segment_id: z.string().min(1),
    source_excerpt: z.string().min(1),
    production_intent: z.string().min(1),
    recommended_mode: z.enum([
      "auto",
      "manual_allowed",
      "manual_preferred",
      "placeholder_only",
    ]),
    provider_hint: z.string().min(1).nullable(),
    prompt_draft: z.string().min(1).nullable(),
    parameters: z.record(z.string(), z.unknown()),
    manual_upload_policy: ManualUploadPolicyDraft,
    risk_notes: z.array(z.string().min(1)),
    cost_tier: z.enum(["free", "low", "medium", "high"]),
  })
  .strict();

const ChunkDependencyDraft = z
  .object({
    local_dependency_id: z.string().min(1),
    task_local_id: z.string().min(1),
    depends_on_local_task_id: z.string().min(1),
    dependency_type: z.enum([
      "requires_output",
      "requires_timing",
      "requires_selection",
    ]),
  })
  .strict();

const SegmentChunkPlanningDraft = z
  .object({
    planning_mode: z.literal("segment_chunk"),
    chunk_id: z.string().min(1),
    tasks: z.array(ChunkTaskDraft),
    dependencies: z.array(ChunkDependencyDraft),
    budget_notes: z.array(z.string().min(1)),
  })
  .passthrough();

type GlobalPlanningDraft = z.infer<typeof GlobalPlanningDraft>;
type SegmentChunkPlanningDraft = z.infer<typeof SegmentChunkPlanningDraft>;
type ChunkTaskDraft = z.infer<typeof ChunkTaskDraft>;

interface GlobalPlanningSchemaIssue {
  code: string;
  path: Array<string | number>;
  message: string;
}

export interface GlobalPlanningStructuralRepairInput {
  normalized_draft: unknown;
  schema_issues: GlobalPlanningSchemaIssue[];
  allowed_repair_paths: Array<Array<string | number>>;
  repair_context: {
    topic_boundary_context?: AssetPlanningTopicBoundaryContext;
    storyboard_visual_projection?: Array<{
      segment_id: string;
      narrative_role: string;
      scene_description: string;
      visual_elements: string[];
    }>;
  };
}

interface LocalTaskMapping {
  chunkIndex: number;
  localTaskId: string;
  globalTaskId: string;
}

export async function generateAssetPlan(
  input: GenerateAssetPlanInput,
): Promise<AssetPlan> {
  const gateway = input.llmGateway ?? createAssetPlannerGateway();
  const audioSkeleton = buildLocalAudioSkeleton(input);
  const totalSegments = input.storyboard.segments.length;

  const rawGlobalDraft = await invokePlanningPromptWithSafetyRetry({
    gateway,
    promptId: PROMPT_ID,
    promptInput: buildGlobalPromptInput(input, audioSkeleton.tts_plan),
    interactionLogWriter: input.interactionLogWriter,
  });
  const globalDraft = await parseOrRepairGlobalDraft({
    gateway,
    input,
    rawGlobalDraft,
  });

  const chunks = chunkStoryboardSegments(input.storyboard, input.chunkSize);
  const totalChunks = chunks.length;

  let completedChunks = 0;
  const chunkDrafts = await mapWithConcurrency(
    chunks,
    normalizeChunkConcurrency(input.chunkConcurrency),
    async (segments, index) => {
      const chunkPromptInput = buildChunkPromptInput(
        input,
        globalDraft,
        segments,
        index,
      );
      const rawChunkDraft = await invokePlanningPromptWithSafetyRetry({
        gateway,
        promptId: PROMPT_ID,
        promptInput: chunkPromptInput,
        interactionLogWriter: input.interactionLogWriter,
      });
      const result = parseOrRepairChunkDraft({
        gateway,
        interactionLogWriter: input.interactionLogWriter,
        rawChunkDraft,
        chunkPromptInput,
        segments,
        onResilienceEvent: input.onGlobalStructureEvent,
      });
      completedChunks += 1;
      await input.onProgress?.({
        phase: "chunks",
        completed_chunks: completedChunks,
        total_chunks: totalChunks,
        total_segments: totalSegments,
      });
      return result;
    },
  );

  const mergedPlan = parseLlmOutput(
    AssetPlan,
    mergeAssetPlan(input, audioSkeleton, globalDraft, chunkDrafts),
    "asset_plan_schema_invalid",
  );
  try {
    const canonicalized = canonicalizeLegacyAudioTiming(mergedPlan);
    if (canonicalized.actions.length > 0) {
      await emitGlobalStructureEventSafely(input.onGlobalStructureEvent, {
        type: "legacy_audio_timing_canonicalized",
        actions: canonicalized.actions,
      });
    }
    return canonicalized.plan;
  } catch (error) {
    if (error instanceof LegacyChunkResilienceError) {
      await emitGlobalStructureEventSafely(input.onGlobalStructureEvent, {
        type: "legacy_audio_timing_canonicalization_failed",
        error_code: error.code,
        issues: error.issues,
      });
    }
    throw error;
  }
}

function pathsEqual(
  left: Array<string | number>,
  right: Array<string | number>,
) {
  return (
    left.length === right.length &&
    left.every((segment, index) => segment === right[index])
  );
}

function needsBroadRepairContext(path: Array<string | number>) {
  return [
    [],
    ["art_bible"],
    ["art_bible", "characters"],
    ["art_bible", "locations"],
    ["art_bible", "props"],
  ].some((candidate) => pathsEqual(path, candidate));
}

export function buildGlobalPlanningStructuralRepairInput(input: {
  normalizedDraft: unknown;
  issues: GlobalPlanningSchemaIssue[];
  topicBoundaryContext: AssetPlanningTopicBoundaryContext;
  storyboard: StoryboardPlan;
}): GlobalPlanningStructuralRepairInput {
  const schemaIssues = input.issues.map((issue) => ({
    code: issue.code,
    path: [...issue.path],
    message: issue.message,
  }));
  const allowedRepairPaths = Array.from(
    new Map(
      schemaIssues.map((issue) => [JSON.stringify(issue.path), [...issue.path]]),
    ).values(),
  );
  const includeContext = allowedRepairPaths.some(needsBroadRepairContext);

  return {
    normalized_draft: input.normalizedDraft,
    schema_issues: schemaIssues,
    allowed_repair_paths: allowedRepairPaths,
    repair_context: includeContext
      ? {
          topic_boundary_context: input.topicBoundaryContext,
          storyboard_visual_projection: input.storyboard.segments.map(
            (segment) => ({
              segment_id: segment.segment_id,
              narrative_role: segment.narrative_role,
              scene_description: segment.scene_description,
              visual_elements: segment.visual_elements,
            }),
          ),
        }
      : {},
  };
}

async function emitGlobalStructureEventSafely(
  callback: GenerateAssetPlanInput["onGlobalStructureEvent"],
  event: GlobalDraftStructureEvent,
): Promise<void> {
  if (!callback) return;
  try {
    await callback(structuredClone(event));
  } catch (error) {
    console.warn(
      `[asset-planning] global_structure_event_callback_failed:${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function toGlobalPlanningSchemaIssues(
  issues: z.ZodIssue[],
): GlobalPlanningSchemaIssue[] {
  return issues.map((issue) => ({
    code: issue.code,
    path: [...issue.path],
    message: issue.message,
  }));
}

function parseGlobalPlanningDraftCandidate(value: unknown):
  | { success: true; data: GlobalPlanningDraft }
  | { success: false; issues: GlobalPlanningSchemaIssue[] } {
  try {
    return {
      success: true,
      data: parseLlmOutput(
        GlobalPlanningDraft,
        value,
        "asset_global_plan_schema_invalid",
      ),
    };
  } catch (error) {
    if (
      !(error instanceof LlmOutputError) ||
      error.code !== "asset_global_plan_schema_invalid"
    ) {
      throw error;
    }
    if (!Array.isArray(error.cause)) {
      throw error;
    }
    return {
      success: false,
      issues: toGlobalPlanningSchemaIssues(error.cause as z.ZodIssue[]),
    };
  }
}

function serializeGlobalRepairFailure(error: unknown): unknown[] {
  if (error instanceof z.ZodError) return error.issues;
  if (error instanceof GlobalPlanningStructuralPatchError) {
    return error.issues;
  }
  if (error instanceof Error) {
    return [{ name: error.name, message: error.message }];
  }
  return [{ message: String(error) }];
}

async function parseOrRepairGlobalDraft(input: {
  gateway: LlmGateway;
  input: GenerateAssetPlanInput;
  rawGlobalDraft: unknown;
}): Promise<GlobalPlanningDraft> {
  const normalized = normalizeGlobalPlanningDraftStructure(
    input.rawGlobalDraft,
  );
  if (normalized.actions.length > 0) {
    await emitGlobalStructureEventSafely(input.input.onGlobalStructureEvent, {
      type: "normalization_applied",
      actions: normalized.actions,
    });
  }

  const initialResult = parseGlobalPlanningDraftCandidate(normalized.value);
  if (initialResult.success) return initialResult.data;

  const initialIssues = initialResult.issues;
  await emitGlobalStructureEventSafely(input.input.onGlobalStructureEvent, {
    type: "repair_started",
    issues: initialIssues,
  });
  const repairInput = buildGlobalPlanningStructuralRepairInput({
    normalizedDraft: normalized.value,
    issues: initialIssues,
    topicBoundaryContext: input.input.topicBoundaryContext,
    storyboard: input.input.storyboard,
  });

  let rawPatch: unknown;
  try {
    rawPatch = await input.gateway.invokeStructuredPrompt<unknown>({
      promptId: GLOBAL_STRUCTURAL_REPAIR_PROMPT_ID,
      operationName: GLOBAL_STRUCTURAL_REPAIR_PROMPT_ID,
      input: repairInput,
      options: { maxAttempts: 2 },
      interactionLogWriter: createTimedInteractionLogWriter(
        input.input.interactionLogWriter,
      ),
    });
  } catch (error) {
    if (error instanceof ExternalServiceError) {
      await emitGlobalStructureEventSafely(input.input.onGlobalStructureEvent, {
        type: "repair_provider_failed",
        error_code: error.code,
      });
    }
    throw error;
  }

  let patchIssues: unknown[] = [];
  let finalIssues: unknown[] = [];
  try {
    const patch = GlobalPlanningStructuralPatch.parse(rawPatch);
    const patchedDraft = applyGlobalPlanningStructuralPatch({
      draft: normalized.value,
      patch,
      allowedRepairPaths: repairInput.allowed_repair_paths,
    });
    const normalizedPatchedDraft = normalizeGlobalPlanningDraftStructure(
      patchedDraft,
    );
    if (normalizedPatchedDraft.actions.length > 0) {
      await emitGlobalStructureEventSafely(input.input.onGlobalStructureEvent, {
        type: "normalization_applied",
        actions: normalizedPatchedDraft.actions,
      });
    }
    const finalResult = parseGlobalPlanningDraftCandidate(
      normalizedPatchedDraft.value,
    );
    if (!finalResult.success) {
      finalIssues = finalResult.issues;
    } else {
      await emitGlobalStructureEventSafely(input.input.onGlobalStructureEvent, {
        type: "repair_succeeded",
      });
      return finalResult.data;
    }
  } catch (error) {
    if (
      !(error instanceof z.ZodError) &&
      !(error instanceof GlobalPlanningStructuralPatchError)
    ) {
      throw error;
    }
    patchIssues = serializeGlobalRepairFailure(error);
  }

  const failure = {
    initial_issues: initialIssues,
    patch_issues: patchIssues,
    final_issues: finalIssues,
  };
  await emitGlobalStructureEventSafely(input.input.onGlobalStructureEvent, {
    type: "repair_failed",
    ...failure,
  });
  throw new LlmOutputError("asset_global_plan_structural_repair_failed", {
    cause: failure,
  });
}

async function invokePlanningPromptWithSafetyRetry(input: {
  gateway: LlmGateway;
  promptId: string;
  promptInput: Record<string, unknown>;
  interactionLogWriter: LlmInteractionLogWriter | undefined;
}): Promise<unknown> {
  try {
    return await input.gateway.invokeStructuredPrompt<unknown>({
      promptId: input.promptId,
      input: input.promptInput,
      interactionLogWriter: createTimedInteractionLogWriter(
        input.interactionLogWriter,
      ),
    });
  } catch (error) {
    if (!isProviderContentFilterError(error)) {
      throw error;
    }

    try {
      return await input.gateway.invokeStructuredPrompt<unknown>({
        promptId: input.promptId,
        input: {
          ...input.promptInput,
          safety_retry_context: {
            reason: "provider_content_filter",
            instruction:
              "改用远景、剪影、道具、尘土、旗帜、人物反应表达冲突，避免血腥、穿刺、尸体、咽喉等直接表述。",
          },
        },
        interactionLogWriter: createTimedInteractionLogWriter(
          input.interactionLogWriter,
        ),
      });
    } catch {
      throw error;
    }
  }
}

function isProviderContentFilterError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const record = error as Record<string, unknown>;
  const code = record.code;
  const status = record.status ?? record.statusCode;
  const message = error instanceof Error ? error.message : "";
  const codeText = typeof code === "string" ? code : String(code ?? "");
  const statusMatches =
    status === undefined || status === 400 || status === "400";

  return (
    statusMatches &&
    (code === 1301 ||
      code === "1301" ||
      /content[_ -]?filter/i.test(codeText) ||
      /content[_ -]?filter/i.test(message))
  );
}

function createTimedInteractionLogWriter(
  writer: LlmInteractionLogWriter | undefined,
): LlmInteractionLogWriter | undefined {
  if (!writer) {
    return undefined;
  }

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  return {
    write(entry) {
      const finishedAtMs = Date.now();
      return writer.write({
        ...entry,
        timing: {
          startedAt,
          finishedAt: new Date(finishedAtMs).toISOString(),
          durationMs: Math.max(0, finishedAtMs - startedAtMs),
        },
      });
    },
  };
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  worker: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  const safeConcurrency = normalizeChunkConcurrency(concurrency);
  const results: TOutput[] = new Array(items.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(
        items[currentIndex] as TInput,
        currentIndex,
      );
    }
  }

  const workerCount = Math.min(safeConcurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runNext()));
  return results;
}

function normalizeChunkConcurrency(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) {
    return 4;
  }

  return Math.min(4, Math.max(1, Math.floor(value)));
}

function rejectForbiddenChunkTasks(rawChunkDraft: unknown) {
  if (!rawChunkDraft || typeof rawChunkDraft !== "object") {
    return;
  }

  const tasks = (rawChunkDraft as Record<string, unknown>).tasks;
  if (!Array.isArray(tasks)) {
    return;
  }

  if (
    tasks.some((task) => {
      if (!task || typeof task !== "object") {
        return false;
      }
      const taskType = (task as Record<string, unknown>).task_type;
      return taskType === "tts_audio" || taskType === "subtitle_track";
    })
  ) {
    throw new LlmOutputError("asset_chunk_forbidden_task_type_violated", {
      cause: "chunk draft 包含 tts_audio 或 subtitle_track 任务（这些由本地服务确定性创建）",
    });
  }
}

async function parseOrRepairChunkDraft(input: {
  gateway: LlmGateway;
  interactionLogWriter: LlmInteractionLogWriter | undefined;
  rawChunkDraft: unknown;
  chunkPromptInput: ReturnType<typeof buildChunkPromptInput>;
  segments: StoryboardPlan["segments"];
  onResilienceEvent: GenerateAssetPlanInput["onGlobalStructureEvent"];
}): Promise<SegmentChunkPlanningDraft> {
  try {
    return parseAndValidateChunkDraft(input.rawChunkDraft, input.segments);
  } catch (error) {
    // 决定是否值得调用 LLM 修复：
    // - ZodError：结构错误（字段缺失、类型错误），LLM 可以重新输出
    // - 可修复的业务错误（segment 越界等）：LLM 知道边界后可以重新输出
    // 其他未知错误（编程 bug）不修复，直接抛出
    const isZodError = error instanceof z.ZodError;
    const isRepairableBusinessError =
      error instanceof LlmOutputError &&
      CHUNK_REPAIRABLE_BUSINESS_ERRORS.has(error.code);

    if (!isZodError && !isRepairableBusinessError) {
      throw error;
    }

    const repairedPatch = await input.gateway.invokeStructuredPrompt<unknown>({
      promptId: STRUCTURAL_REPAIR_PROMPT_ID,
      input: {
        repair_mode: "segment_chunk_structural_patch",
        chunk: input.chunkPromptInput.chunk,
        storyboard_segments: input.segments,
        art_bible: input.chunkPromptInput.art_bible,
        raw_task_summaries: summarizeRawChunkTasks(input.rawChunkDraft),
        raw_dependency_summaries: summarizeRawChunkDependencies(input.rawChunkDraft),
        structural_errors: serializeStructuralError(error),
      },
      interactionLogWriter: createTimedInteractionLogWriter(input.interactionLogWriter),
    });

    try {
      let coercedPatch: ReturnType<typeof coerceLegacyChunkStructuralPatch>;
      try {
        coercedPatch = coerceLegacyChunkStructuralPatch(repairedPatch);
      } catch (coercionError) {
        if (coercionError instanceof z.ZodError) {
          await emitGlobalStructureEventSafely(input.onResilienceEvent, {
            type: "legacy_chunk_patch_coercion_failed",
            error_code: "asset_legacy_chunk_patch_coercion_failed",
            issues: coercionError.issues.map((issue) => ({
              code: issue.code,
              path: [...issue.path],
            })),
          });
        }
        throw coercionError;
      }
      if (coercedPatch.actions.length > 0) {
        await emitGlobalStructureEventSafely(input.onResilienceEvent, {
          type: "legacy_chunk_patch_coerced",
          actions: coercedPatch.actions,
        });
      }
      const patch = coercedPatch.patch;
      const patchedChunkDraft = applyChunkStructuralPatch(
        input.rawChunkDraft,
        patch,
      );
      return parseAndValidateChunkDraft(patchedChunkDraft, input.segments);
    } catch (repairError) {
      // 修复仍失败 → 抛包装错误（保留诊断信息）。LlmInteractionLogWriter 没有
      // writeError 方法，用 console.warn 兜底（trace.md 已由外层记录详细错误）。
      console.warn(
        `[chunk-repair] chunk_structural_repair_failed:${repairError instanceof Error ? repairError.message : String(repairError)}`,
      );
      // 原始 error 是 ZodError（结构错）→ 包装为 asset_chunk_plan_schema_invalid；
      // 已是 LlmOutputError（5c 后的业务错）→ 原样抛；
      // 其他未知错误（编程 bug）→ 原样抛。
      if (error instanceof z.ZodError) {
        throw new LlmOutputError("asset_chunk_plan_schema_invalid", {
          cause: error.issues,
        });
      }
      throw error;
    }
  }
}

// 已知可以通过 LLM 修复的 chunk 业务错误（按 LlmOutputError.code 匹配）
const CHUNK_REPAIRABLE_BUSINESS_ERRORS = new Set([
  "asset_chunk_task_segment_out_of_scope_violated",
  "asset_chunk_support_image_reason_missing_violated",
  "asset_chunk_anchor_image_budget_exceeded_violated",
  "asset_chunk_dependency_local_id_missing_violated",
]);

function parseAndValidateChunkDraft(
  rawChunkDraft: unknown,
  segments: StoryboardPlan["segments"],
): SegmentChunkPlanningDraft {
  rejectForbiddenChunkTasks(rawChunkDraft);
  const chunkDraft = SegmentChunkPlanningDraft.parse(
    normalizeChunkDraftStructure(rawChunkDraft),
  );
  validateChunkDraft(chunkDraft, segments);
  return chunkDraft;
}

function serializeStructuralError(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues;
  }

  if (error instanceof LlmOutputError) {
    return [
      {
        code: error.code,
        cause: error.cause,
      },
    ];
  }

  if (error instanceof Error) {
    return [
      {
        message: error.message,
      },
    ];
  }

  return [
    {
      message: String(error),
    },
  ];
}

function normalizeChunkDraftStructure(rawChunkDraft: unknown): unknown {
  if (!rawChunkDraft || typeof rawChunkDraft !== "object") {
    return rawChunkDraft;
  }

  const draft = rawChunkDraft as Record<string, unknown>;
  if (!Array.isArray(draft.tasks)) {
    return rawChunkDraft;
  }

  return {
    ...draft,
    dependencies: Array.isArray(draft.dependencies) ? draft.dependencies : [],
    budget_notes: Array.isArray(draft.budget_notes) ? draft.budget_notes : [],
    tasks: draft.tasks.map(normalizeChunkTaskStructure),
  };
}

function normalizeChunkTaskStructure(task: unknown): unknown {
  if (!task || typeof task !== "object") {
    return task;
  }

  const taskRecord = task as Record<string, unknown>;
  return {
    ...taskRecord,
    provider_hint: "provider_hint" in taskRecord ? taskRecord.provider_hint : null,
    prompt_draft: "prompt_draft" in taskRecord ? taskRecord.prompt_draft : null,
    parameters: "parameters" in taskRecord ? taskRecord.parameters : {},
    manual_upload_policy: taskRecord.manual_upload_policy ?? {
      allowed: false,
      required: false,
      accepted_file_types: [],
      acceptance_notes: [],
    },
    risk_notes: "risk_notes" in taskRecord ? taskRecord.risk_notes : [],
  };
}

function summarizeRawChunkTasks(rawChunkDraft: unknown) {
  if (!rawChunkDraft || typeof rawChunkDraft !== "object") {
    return [];
  }

  const tasks = (rawChunkDraft as Record<string, unknown>).tasks;
  if (!Array.isArray(tasks)) {
    return [];
  }

  return tasks.map((task) => {
    if (!task || typeof task !== "object") {
      return task;
    }

    const record = task as Record<string, unknown>;
    return {
      local_task_id: record.local_task_id,
      task_type: record.task_type,
      source_segment_id: record.source_segment_id,
      production_intent: record.production_intent,
      recommended_mode: record.recommended_mode,
      provider_hint: record.provider_hint,
      has_prompt_draft:
        typeof record.prompt_draft === "string" &&
        record.prompt_draft.trim().length > 0,
      has_risk_notes:
        Array.isArray(record.risk_notes) && record.risk_notes.length > 0,
      cost_tier: record.cost_tier,
    };
  });
}

function summarizeRawChunkDependencies(rawChunkDraft: unknown) {
  if (!rawChunkDraft || typeof rawChunkDraft !== "object") {
    return [];
  }

  const dependencies = (rawChunkDraft as Record<string, unknown>).dependencies;
  if (!Array.isArray(dependencies)) {
    return [];
  }

  return dependencies.map((dependency) => {
    if (!dependency || typeof dependency !== "object") {
      return dependency;
    }

    const record = dependency as Record<string, unknown>;
    return {
      local_dependency_id: record.local_dependency_id,
      task_local_id: record.task_local_id,
      depends_on_local_task_id: record.depends_on_local_task_id,
      dependency_type: record.dependency_type,
    };
  });
}

function applyChunkStructuralPatch(
  rawChunkDraft: unknown,
  patch: SegmentChunkStructuralPatchType,
) {
  if (!rawChunkDraft || typeof rawChunkDraft !== "object") {
    return rawChunkDraft;
  }

  const draft = rawChunkDraft as Record<string, unknown>;
  const tasks = Array.isArray(draft.tasks) ? draft.tasks : [];
  const localIds = new Set(
    tasks
      .filter((task) => task && typeof task === "object")
      .map((task) => (task as Record<string, unknown>).local_task_id)
      .filter((localTaskId): localTaskId is string => typeof localTaskId === "string"),
  );
  for (const taskPatch of patch.task_patches) {
    if (!localIds.has(taskPatch.local_task_id)) {
      throw new Error("asset_planning_chunk_patch_task_missing");
    }
  }
  for (const dependencyPatch of patch.dependency_patches) {
    if (
      !localIds.has(dependencyPatch.task_local_id) ||
      !localIds.has(dependencyPatch.depends_on_local_task_id)
    ) {
      throw new Error("asset_planning_chunk_patch_dependency_task_missing");
    }
  }

  const patchedTasks = tasks.map((task) => {
    if (!task || typeof task !== "object") {
      return task;
    }

    const taskRecord = task as Record<string, unknown>;
    const localTaskId = taskRecord.local_task_id;
    const taskPatch = patch.task_patches.find(
      (candidate) => candidate.local_task_id === localTaskId,
    );
    if (!taskPatch) {
      return taskRecord;
    }

    const { local_task_id: _localTaskId, parameters, ...restPatch } = taskPatch;
    const definedPatch = Object.fromEntries(
      Object.entries(restPatch).filter(([, value]) => value !== undefined),
    );
    return {
      ...taskRecord,
      ...definedPatch,
      ...(parameters === undefined
        ? {}
        : {
            parameters: {
              ...(isRecord(taskRecord.parameters) ? taskRecord.parameters : {}),
              ...parameters,
            },
          }),
    };
  });

  return {
    ...draft,
    tasks: patchedTasks,
    dependencies: [
      ...(Array.isArray(draft.dependencies) ? draft.dependencies : []),
      ...patch.dependency_patches,
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function buildGlobalPromptInput(
  input: GenerateAssetPlanInput,
  ttsPlan: AssetPlan["tts_plan"],
) {
  const promptInput = {
    planning_mode: "global",
    source_storyboard_record_id: input.sourceStoryboardRecordId,
    source_script_record_id: input.sourceScriptRecordId,
    source_topic_package_id: input.sourceTopicPackageId,
    storyboard: input.storyboard,
    draft: input.draft,
    topic_boundary_context: input.topicBoundaryContext,
    local_tts_plan: ttsPlan,
  };

  if (!input.regenerationContext) {
    return promptInput;
  }

  return {
    ...promptInput,
    regeneration_context: input.regenerationContext,
  };
}

function buildChunkPromptInput(
  input: GenerateAssetPlanInput,
  globalDraft: GlobalPlanningDraft,
  segments: StoryboardPlan["segments"],
  chunkIndex: number,
) {
  const segmentIds = segments.map((segment) => segment.segment_id);
  return {
    planning_mode: "segment_chunk",
    source_storyboard_record_id: input.sourceStoryboardRecordId,
    source_script_record_id: input.sourceScriptRecordId,
    source_topic_package_id: input.sourceTopicPackageId,
    topic_boundary_context: input.topicBoundaryContext,
    art_bible: globalDraft.art_bible,
    visual_budget: globalDraft.visual_budget,
    downgrade_policy: globalDraft.downgrade_policy,
    global_audio_strategy: globalDraft.global_audio_strategy,
    storyboard: input.storyboard,
    draft: input.draft,
    chunk: {
      chunk_id: `chunk_${String(chunkIndex + 1).padStart(3, "0")}`,
      segment_ids: segmentIds,
      segments,
    },
    regeneration_context: input.regenerationContext ?? null,
  };
}

function buildLocalAudioSkeleton(input: GenerateAssetPlanInput): LocalAudioSkeleton {
  const ttsChunks = input.storyboard.segments.map((segment, index) => ({
    chunk_id: `tts_${String(index + 1).padStart(3, "0")}`,
    order: index,
    script_excerpt: segment.script_excerpt,
    estimated_duration_sec: Math.max(
      1,
      segment.end_hint_sec - segment.start_hint_sec,
    ),
  }));
  const ttsPlan: AssetPlan["tts_plan"] = {
    voice_profile_id: "voice_default_male_storyteller",
    estimated_total_duration_sec: Math.max(1, input.draft.estimated_duration_sec),
    chunking_strategy: "segment_boundary",
    chunks: ttsChunks,
  };

  const ttsTask: AssetTask = {
    task_id: "tts_001",
    order: 0,
    task_type: "tts_audio",
    source_segment_id: null,
    source_excerpt: input.draft.script_text,
    production_intent: "生成全片口播音频",
    recommended_mode: "auto",
    provider_hint: "default_tts",
    prompt_draft: null,
    parameters: {
      voice_profile_id: ttsPlan.voice_profile_id,
      chunk_ids: ttsChunks.map((chunk) => chunk.chunk_id),
    },
    manual_upload_policy: {
      allowed: false,
      required: false,
      accepted_file_types: [],
      acceptance_notes: [],
    },
    risk_notes: [],
    cost_tier: "low",
    initial_status: "planned",
  };
  const subtitleTask: AssetTask = {
    task_id: "subtitle_001",
    order: 1,
    task_type: "subtitle_track",
    source_segment_id: null,
    source_excerpt: input.draft.script_text,
    production_intent: "根据 TTS 时间戳生成字幕轨",
    recommended_mode: "auto",
    provider_hint: null,
    prompt_draft: null,
    parameters: {
      format: "srt",
      source_tts_task_id: ttsTask.task_id,
    },
    manual_upload_policy: {
      allowed: false,
      required: false,
      accepted_file_types: [],
      acceptance_notes: [],
    },
    risk_notes: [],
    cost_tier: "free",
    initial_status: "planned",
  };

  const dependencies: AssetPlan["dependencies"] = [
    {
      dependency_id: "dep_subtitle_001_after_tts_001",
      task_id: subtitleTask.task_id,
      depends_on_task_id: ttsTask.task_id,
      dependency_type: "requires_timing",
    },
  ];

  return {
    tts_plan: ttsPlan,
    tasks: [ttsTask, subtitleTask],
    dependencies,
  };
}

function chunkStoryboardSegments(
  storyboard: StoryboardPlan,
  requestedChunkSize = 2,
) {
  const chunkSize = Math.min(3, Math.max(1, requestedChunkSize));
  const chunks: StoryboardPlan["segments"][] = [];
  for (let index = 0; index < storyboard.segments.length; index += chunkSize) {
    chunks.push(storyboard.segments.slice(index, index + chunkSize));
  }
  return chunks;
}

function validateChunkDraft(
  chunkDraft: SegmentChunkPlanningDraft,
  segments: StoryboardPlan["segments"],
) {
  const segmentIds = new Set(segments.map((segment) => segment.segment_id));
  const localIds = new Set(chunkDraft.tasks.map((task) => task.local_task_id));
  const anchorImageCountBySegment = new Map<string, number>();

  for (const task of chunkDraft.tasks) {
    if (!segmentIds.has(task.source_segment_id)) {
      throw new LlmOutputError("asset_chunk_task_segment_out_of_scope_violated", {
        cause: { local_task_id: task.local_task_id, source_segment_id: task.source_segment_id },
      });
    }

    if (task.task_type === "image_still") {
      const imageRole = task.parameters.image_role;
      if (imageRole === "support") {
        const reason = task.parameters.support_reason;
        if (typeof reason !== "string" || reason.trim().length === 0) {
          throw new LlmOutputError("asset_chunk_support_image_reason_missing_violated", {
            cause: { local_task_id: task.local_task_id },
          });
        }
      } else {
        anchorImageCountBySegment.set(
          task.source_segment_id,
          (anchorImageCountBySegment.get(task.source_segment_id) ?? 0) + 1,
        );
      }
    }
  }

  for (const [segmentId, count] of anchorImageCountBySegment) {
    if (count > 1) {
      throw new LlmOutputError("asset_chunk_anchor_image_budget_exceeded_violated", {
        cause: { source_segment_id: segmentId, anchor_image_count: count },
      });
    }
  }

  for (const dependency of chunkDraft.dependencies) {
    if (
      !localIds.has(dependency.task_local_id) ||
      !localIds.has(dependency.depends_on_local_task_id)
    ) {
      throw new LlmOutputError("asset_chunk_dependency_local_id_missing_violated", {
        cause: {
          local_dependency_id: dependency.local_dependency_id,
          task_local_id: dependency.task_local_id,
          depends_on_local_task_id: dependency.depends_on_local_task_id,
        },
      });
    }
  }
}

function mergeAssetPlan(
  input: GenerateAssetPlanInput,
  audioSkeleton: ReturnType<typeof buildLocalAudioSkeleton>,
  globalDraft: GlobalPlanningDraft,
  chunkDrafts: SegmentChunkPlanningDraft[],
) {
  const localMappings: LocalTaskMapping[] = [];
  const tasks: AssetTask[] = [...audioSkeleton.tasks];

  for (const [chunkIndex, chunkDraft] of chunkDrafts.entries()) {
    const localToGlobal = new Map(
      chunkDraft.tasks.map((taskDraft, taskIndex) => [
        taskDraft.local_task_id,
        buildGlobalTaskId(taskDraft, tasks.length + taskIndex + 1),
      ]),
    );
    for (const taskDraft of chunkDraft.tasks) {
      const globalTaskId = localToGlobal.get(taskDraft.local_task_id);
      if (!globalTaskId) {
        throw new Error("asset_planning_task_local_id_mapping_missing");
      }
      localMappings.push({
        chunkIndex,
        localTaskId: taskDraft.local_task_id,
        globalTaskId,
      });
      tasks.push({
        task_id: globalTaskId,
        order: tasks.length,
        task_type: taskDraft.task_type,
        source_segment_id: taskDraft.source_segment_id,
        source_excerpt: taskDraft.source_excerpt,
        production_intent: taskDraft.production_intent,
        recommended_mode: taskDraft.recommended_mode,
        provider_hint: taskDraft.provider_hint,
        prompt_draft: enrichAssetVisualPrompt({
          taskType: taskDraft.task_type,
          promptDraft: taskDraft.prompt_draft,
          sourceSegmentId: taskDraft.source_segment_id,
          storyboardSegments: input.storyboard.segments,
          artBible: globalDraft.art_bible,
        }),
        parameters: rewriteTaskParameterLocalIds(taskDraft.parameters, localToGlobal),
        manual_upload_policy: taskDraft.manual_upload_policy,
        risk_notes: rewriteLocalTaskIdsInTextList(taskDraft.risk_notes, localToGlobal),
        cost_tier: taskDraft.cost_tier,
        initial_status: "planned",
      });
    }
  }

  const dependencies = [...audioSkeleton.dependencies];
  for (const [chunkIndex, chunkDraft] of chunkDrafts.entries()) {
    const localToGlobal = new Map(
      localMappings
        .filter((mapping) => mapping.chunkIndex === chunkIndex)
        .map((mapping) => [mapping.localTaskId, mapping.globalTaskId]),
    );
    for (const dependency of chunkDraft.dependencies) {
      dependencies.push({
        dependency_id: `dep_${dependencies.length + 1}_${dependency.local_dependency_id}`,
        task_id: localToGlobal.get(dependency.task_local_id) ?? dependency.task_local_id,
        depends_on_task_id:
          localToGlobal.get(dependency.depends_on_local_task_id) ??
          dependency.depends_on_local_task_id,
        dependency_type: dependency.dependency_type,
      });
    }
  }

  const budgetNotes = chunkDrafts.flatMap((chunkDraft, chunkIndex) => {
    const localToGlobal = new Map(
      localMappings
        .filter((mapping) => mapping.chunkIndex === chunkIndex)
        .map((mapping) => [mapping.localTaskId, mapping.globalTaskId]),
    );
    return rewriteLocalTaskIdsInTextList(chunkDraft.budget_notes, localToGlobal);
  });
  const costSummary = buildCostSummary(tasks, globalDraft, budgetNotes);

  return {
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: input.sourceStoryboardRecordId,
    source_script_record_id: input.sourceScriptRecordId,
    source_topic_package_id: input.sourceTopicPackageId,
    art_bible: globalDraft.art_bible,
    visual_budget: globalDraft.visual_budget,
    downgrade_policy: globalDraft.downgrade_policy,
    global_audio_strategy: globalDraft.global_audio_strategy,
    tts_plan: audioSkeleton.tts_plan,
    tasks,
    dependencies,
    cost_summary: costSummary,
    global_production_notes: [
      "TTS 与字幕任务由本地服务确定性创建，LLM 不输出 tts_audio 或 subtitle_track。",
      ...globalDraft.manual_review_notes,
    ],
  };
}

function rewriteTaskParameterLocalIds(
  parameters: Record<string, unknown>,
  localToGlobal: Map<string, string>,
) {
  const staticFallbackTaskId = parameters.static_fallback_task_id;
  if (typeof staticFallbackTaskId !== "string") {
    return parameters;
  }

  const globalTaskId = localToGlobal.get(staticFallbackTaskId);
  if (!globalTaskId) {
    return parameters;
  }

  return {
    ...parameters,
    static_fallback_task_id: globalTaskId,
  };
}

function rewriteLocalTaskIdsInTextList(
  textList: string[],
  localToGlobal: Map<string, string>,
) {
  return textList.map((text) => rewriteLocalTaskIdsInText(text, localToGlobal));
}

function rewriteLocalTaskIdsInText(
  text: string,
  localToGlobal: Map<string, string>,
) {
  let rewritten = text;
  for (const [localTaskId, globalTaskId] of localToGlobal) {
    rewritten = rewritten.replaceAll(localTaskId, globalTaskId);
  }
  return rewritten;
}

function buildGlobalTaskId(taskDraft: ChunkTaskDraft, sequence: number) {
  const prefixByType: Record<ChunkTaskDraft["task_type"], string> = {
    image_still: "img",
    video_clip: "video",
    sfx_cue: "sfx",
    bgm_cue: "bgm",
    render_motion_cue: "motion",
  };
  return `${prefixByType[taskDraft.task_type]}_${String(sequence).padStart(3, "0")}`;
}

function buildCostSummary(
  tasks: AssetTask[],
  globalDraft: GlobalPlanningDraft,
  budgetNotes: string[],
) {
  const byType: Record<string, number> = {};
  const byCostTier: Record<string, number> = {
    free: 0,
    low: 0,
    medium: 0,
    high: 0,
  };
  for (const task of tasks) {
    byType[task.task_type] = (byType[task.task_type] ?? 0) + 1;
    byCostTier[task.cost_tier] = (byCostTier[task.cost_tier] ?? 0) + 1;
  }

  return {
    total_tasks: tasks.length,
    by_type: byType,
    by_cost_tier: byCostTier,
    estimated_provider_calls: tasks.filter((task) =>
      ["tts_audio", "image_still", "video_clip"].includes(task.task_type),
    ).length,
    notes: budgetNotes,
  };
}

function createAssetPlannerGateway(): LlmGateway {
  const provider =
    env.llm.provider === "stub"
      ? createStubAssetPlannerProvider()
      : createValidatedAssetPlannerProvider();

  return createLlmGateway({
    registry: createPromptRegistry(),
    provider,
  });
}

function createValidatedAssetPlannerProvider(): StructuredPromptProvider {
  getValidatedRuntimeEnv();

  return createTierAwareProviderFromEnv();
}

function createStubAssetPlannerProvider(): StructuredPromptProvider {
  return {
    async invokeStructuredPrompt<T>(
      request: StructuredPromptInvocation,
    ): Promise<T> {
      throw new Error(
        `asset_planning_stub_provider_requires_test_gateway:${request.operationName}`,
      );
    },
  };
}
