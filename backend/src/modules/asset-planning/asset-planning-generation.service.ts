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
import type { LlmInteractionLogWriter } from "../../runtime/llm/interaction-log.js";
import { createTierAwareProviderFromEnv } from "../../runtime/llm/tier-aware-provider-factory.js";
import type {
  StructuredPromptInvocation,
  StructuredPromptProvider,
} from "../../runtime/llm/provider-contract.js";
import { createPromptRegistry } from "../../runtime/prompts/prompt-registry.js";

const PROMPT_ID = "asset-planning.planner";
const STRUCTURAL_REPAIR_PROMPT_ID = "asset-planning.asset-structural-repair";

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
  regenerationContext?: {
    reason: "asset_planning_local_validation_regen_once";
    errors: string[];
    metrics: Record<string, unknown>;
  };
}

const ManualUploadPolicyDraft = z
  .object({
    allowed: z.boolean(),
    required: z.boolean(),
    accepted_file_types: z.array(z.string().min(1)),
    acceptance_notes: z.array(z.string().min(1)),
  })
  .strict();

const GlobalPlanningDraft = z
  .object({
    planning_mode: z.literal("global"),
    art_bible: ProjectArtBible,
    visual_budget: z.record(z.string(), z.unknown()),
    downgrade_policy: z.record(z.string(), z.unknown()),
    global_audio_strategy: z.record(z.string(), z.unknown()),
    manual_review_notes: z.array(z.string().min(1)),
  })
  .strict();

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

const ChunkTaskStructuralPatch = z
  .object({
    local_task_id: z.string().min(1),
    recommended_mode: z
      .enum(["auto", "manual_allowed", "manual_preferred", "placeholder_only"])
      .optional(),
    provider_hint: z.string().min(1).nullable().optional(),
    prompt_draft: z.string().min(1).nullable().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
    manual_upload_policy: ManualUploadPolicyDraft.optional(),
    risk_notes: z.array(z.string().min(1)).optional(),
    cost_tier: z.enum(["free", "low", "medium", "high"]).optional(),
  })
  .strict();

const ChunkDependencyStructuralPatch = z
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

const SegmentChunkStructuralPatch = z
  .object({
    patch_type: z.literal("segment_chunk_structural_patch"),
    task_patches: z.array(ChunkTaskStructuralPatch),
    dependency_patches: z.array(ChunkDependencyStructuralPatch),
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
  .strict();

type GlobalPlanningDraft = z.infer<typeof GlobalPlanningDraft>;
type SegmentChunkPlanningDraft = z.infer<typeof SegmentChunkPlanningDraft>;
type ChunkTaskDraft = z.infer<typeof ChunkTaskDraft>;
type SegmentChunkStructuralPatch = z.infer<typeof SegmentChunkStructuralPatch>;

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
  if (hasObjectKey(rawGlobalDraft, "tasks")) {
    throw new Error("asset_planning_global_draft_must_not_include_tasks");
  }
  const globalDraft = GlobalPlanningDraft.parse(rawGlobalDraft);

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

  return AssetPlan.parse(
    mergeAssetPlan(input, audioSkeleton, globalDraft, chunkDrafts),
  );
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

function hasObjectKey(value: unknown, key: string) {
  return Boolean(value && typeof value === "object" && key in value);
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
    throw new Error("asset_planning_chunk_draft_forbidden_task_type");
  }
}

async function parseOrRepairChunkDraft(input: {
  gateway: LlmGateway;
  interactionLogWriter: LlmInteractionLogWriter | undefined;
  rawChunkDraft: unknown;
  chunkPromptInput: ReturnType<typeof buildChunkPromptInput>;
  segments: StoryboardPlan["segments"];
}): Promise<SegmentChunkPlanningDraft> {
  try {
    return parseAndValidateChunkDraft(input.rawChunkDraft, input.segments);
  } catch (error) {
    if (!(error instanceof z.ZodError)) {
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
      const patch = SegmentChunkStructuralPatch.parse(repairedPatch);
      const patchedChunkDraft = applyChunkStructuralPatch(
        input.rawChunkDraft,
        patch,
      );
      return parseAndValidateChunkDraft(patchedChunkDraft, input.segments);
    } catch {
      throw error;
    }
  }
}

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
  patch: SegmentChunkStructuralPatch,
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

function buildLocalAudioSkeleton(input: GenerateAssetPlanInput) {
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
      throw new Error("asset_planning_chunk_task_segment_out_of_scope");
    }

    if (task.task_type === "image_still") {
      const imageRole = task.parameters.image_role;
      if (imageRole === "support") {
        const reason = task.parameters.support_reason;
        if (typeof reason !== "string" || reason.trim().length === 0) {
          throw new Error("asset_planning_support_image_reason_missing");
        }
      } else {
        anchorImageCountBySegment.set(
          task.source_segment_id,
          (anchorImageCountBySegment.get(task.source_segment_id) ?? 0) + 1,
        );
      }
    }
  }

  for (const count of anchorImageCountBySegment.values()) {
    if (count > 1) {
      throw new Error("asset_planning_anchor_image_budget_exceeded");
    }
  }

  for (const dependency of chunkDraft.dependencies) {
    if (
      !localIds.has(dependency.task_local_id) ||
      !localIds.has(dependency.depends_on_local_task_id)
    ) {
      throw new Error("asset_planning_chunk_dependency_local_id_missing");
    }
  }
}

/**
 * For image_still tasks, look up the source storyboard segment and
 * append ArtBible character visual descriptions when the segment
 * references those characters.  This gives every image prompt a
 * stable character anchor without changing the LLM prompt.
 */
function enrichPromptWithCharacterAnchor(
  taskDraft: ChunkTaskDraft,
  storyboardSegments: StoryboardPlan["segments"],
  artBible: GlobalPlanningDraft["art_bible"],
): string | null {
  if (taskDraft.task_type !== "image_still" || !taskDraft.prompt_draft) {
    return taskDraft.prompt_draft;
  }

  const segment = storyboardSegments.find(
    (seg) => seg.segment_id === taskDraft.source_segment_id,
  );
  if (!segment) {
    return taskDraft.prompt_draft;
  }

  /**
   * Match characters using visual fields only, not script_excerpt.
   * script_excerpt may name characters that the narration references but
   * the shot does not actually show — injecting them would pollute the
   * image prompt with off-screen figures.
   */
  const segmentText = [
    segment.scene_description ?? "",
    ...(segment.visual_elements ?? []),
  ].join(" ");

  const matchedChars = artBible.characters.filter((c) =>
    segmentText.includes(c.label),
  );

  if (matchedChars.length === 0) {
    return taskDraft.prompt_draft;
  }

  const anchors = matchedChars
    .map((c) => `${c.label}：${c.visual_description}`)
    .join("；");

  return `${taskDraft.prompt_draft}\n[角色锚点] ${anchors}`;
}

/**
 * Append generic visual negative constraints to image/video prompts
 * so every visual prompt starts with stable era/anachronism guards.
 * These are fixed production contracts, not LLM-generated suggestions.
 */
const VISUAL_CONSTRAINT_BASE =
  "写实历史质感，建筑、发型、服饰、器物、文字形制必须符合%s背景，无现代物品、无现代建筑、无民国/近代造型、无动漫风、无奇幻特效、无游戏质感";

function enrichPromptWithVisualConstraints(
  taskDraft: ChunkTaskDraft,
  eraStyle?: string | null,
): string | null {
  if (
    (taskDraft.task_type !== "image_still" && taskDraft.task_type !== "video_clip") ||
    !taskDraft.prompt_draft
  ) {
    return taskDraft.prompt_draft;
  }

  const era = (eraStyle ?? "").trim() || "当前项目朝代";
  const constraint = VISUAL_CONSTRAINT_BASE.replace("%s", era);
  const prompt = taskDraft.prompt_draft;
  // Check against the base pattern to avoid duplication
  if (/写实历史质感，建筑、发型、服饰、器物、文字形制必须符合/.test(prompt)) {
    return prompt;
  }

  return `${prompt}\n【视觉约束】${constraint}。`;
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
        prompt_draft: enrichPromptWithVisualConstraints({
          ...taskDraft,
          prompt_draft: enrichPromptWithCharacterAnchor(
            taskDraft,
            input.storyboard.segments,
            globalDraft.art_bible,
          ),
        }, globalDraft.art_bible.era_style),
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
