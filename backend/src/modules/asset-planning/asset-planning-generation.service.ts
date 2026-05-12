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
import { createOpenAiCompatibleProvider } from "../../runtime/llm/openai-compatible-provider.js";
import type {
  StructuredPromptInvocation,
  StructuredPromptProvider,
} from "../../runtime/llm/provider-contract.js";
import { createPromptRegistry } from "../../runtime/prompts/prompt-registry.js";

const PROMPT_ID = "asset-planning.planner";

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

  const rawGlobalDraft = await gateway.invokeStructuredPrompt<unknown>({
    promptId: PROMPT_ID,
    input: buildGlobalPromptInput(input, audioSkeleton.tts_plan),
    interactionLogWriter: createTimedInteractionLogWriter(input.interactionLogWriter),
  });
  if (hasObjectKey(rawGlobalDraft, "tasks")) {
    throw new Error("asset_planning_global_draft_must_not_include_tasks");
  }
  const globalDraft = GlobalPlanningDraft.parse(rawGlobalDraft);

  const chunks = chunkStoryboardSegments(input.storyboard, input.chunkSize);
  const chunkDrafts = await mapWithConcurrency(
    chunks,
    normalizeChunkConcurrency(input.chunkConcurrency),
    async (segments, index) => {
      const rawChunkDraft = await gateway.invokeStructuredPrompt<unknown>({
        promptId: PROMPT_ID,
        input: buildChunkPromptInput(input, globalDraft, segments, index),
        interactionLogWriter: createTimedInteractionLogWriter(input.interactionLogWriter),
      });
      rejectForbiddenChunkTasks(rawChunkDraft);
      const chunkDraft = SegmentChunkPlanningDraft.parse(
        normalizeChunkDraftStructure(rawChunkDraft),
      );
      validateChunkDraft(chunkDraft, segments);
      return chunkDraft;
    },
  );

  return AssetPlan.parse(
    mergeAssetPlan(input, audioSkeleton, globalDraft, chunkDrafts),
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
    tasks: draft.tasks.map((task) => {
      if (!task || typeof task !== "object") {
        return task;
      }

      const taskRecord = task as Record<string, unknown>;
      if (taskRecord.manual_upload_policy !== null) {
        return task;
      }

      return {
        ...taskRecord,
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
      };
    }),
  };
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
        prompt_draft: taskDraft.prompt_draft,
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
    notes: [
      `visual_budget: ${JSON.stringify(globalDraft.visual_budget)}`,
      ...budgetNotes,
    ],
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

  return createOpenAiCompatibleProvider({
    profile: "main",
  });
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
