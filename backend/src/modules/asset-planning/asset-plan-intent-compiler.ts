import {
  AssetPlan as AssetPlanSchema,
  type AssetPlan,
  type AssetTask,
  type ResolvedSegmentVisualRoute,
  type ScriptDraftPackage,
  type StoryboardPlan,
} from "../../../../shared/src/index.js";
import { isDeepStrictEqual } from "node:util";
import type { SegmentAssetIntentBatchDraft } from "./segment-asset-intent.js";
import { enrichAssetVisualPrompt } from "./asset-plan-prompt-enrichment.js";
import { validateAssetPlan } from "./asset-planning-local-validator.js";

export interface GlobalPlanningCompilerDraft {
  art_bible: AssetPlan["art_bible"];
  visual_budget: AssetPlan["visual_budget"];
  downgrade_policy: AssetPlan["downgrade_policy"];
  global_audio_strategy: AssetPlan["global_audio_strategy"];
  manual_review_notes: string[];
}

export interface LocalAudioSkeleton {
  tts_plan: AssetPlan["tts_plan"];
  tasks: AssetTask[];
  dependencies: AssetPlan["dependencies"];
}

export interface CompiledIntentChunkInput {
  chunkIndex: number;
  inputSegmentIds: string[];
  draft: SegmentAssetIntentBatchDraft;
}

export interface AssetPlanCompilerInput {
  sourceIds: {
    storyboardRecordId: string;
    scriptRecordId: string;
    topicPackageId: string;
  };
  storyboard: StoryboardPlan;
  draft: ScriptDraftPackage;
  globalDraft: GlobalPlanningCompilerDraft;
  audioSkeleton: LocalAudioSkeleton;
  chunks: CompiledIntentChunkInput[];
  /**
   * S2-2A 任务 5：resolver 输出的每段最终视觉路线（编排输入，纯机械消费）。
   * compiler 不读取 api_video_suitability 做语义推导，只按路线核对意图组合。
   */
  segmentVisualRoutes: ReadonlyMap<string, ResolvedSegmentVisualRoute>;
}

export type AssetPlanCompilerAction =
  | {
      code: "visual_strategy_applied";
      segment_id: string;
      route: "api_video" | "remotion";
      reason_code: string;
    }
  | { code: "global_bgm_owner_bound"; segment_id: string };

export interface AssetPlanCompilerIssue {
  code: string;
  path?: Array<string | number>;
  segment_id?: string;
  task_id?: string;
  chunk_index?: number;
}

export class AssetPlanCompilerInvariantError extends Error {
  readonly code = "asset_plan_compiler_invariant_failed";

  constructor(readonly issues: AssetPlanCompilerIssue[]) {
    super("asset_plan_compiler_invariant_failed");
    this.name = "AssetPlanCompilerInvariantError";
  }

  toJSON() {
    return { name: this.name, code: this.code, issues: this.issues };
  }
}

type Intent = SegmentAssetIntentBatchDraft["segments"][number]["intents"][number];
type IntentKind = Intent["asset_kind"];

const KIND_ORDER: Record<IntentKind, number> = {
  image_still: 0,
  render_motion_cue: 1,
  video_clip: 2,
  sfx_cue: 3,
  bgm_cue: 4,
};

const PREFIX_BY_KIND: Record<IntentKind, string> = {
  image_still: "img",
  render_motion_cue: "motion",
  video_clip: "video",
  sfx_cue: "sfx",
  bgm_cue: "bgm",
};

interface NormalizedIntent {
  segment: StoryboardPlan["segments"][number];
  intent: Intent;
  ordinal: number;
}

function fail(issues: AssetPlanCompilerIssue[]): never {
  throw new AssetPlanCompilerInvariantError(issues);
}

function assertNever(value: never): never {
  throw new AssetPlanCompilerInvariantError([{ code: "unsupported_intent_kind" }]);
}

function validateInput(input: AssetPlanCompilerInput) {
  const issues: AssetPlanCompilerIssue[] = [];
  const orderedSegments = [...input.storyboard.segments].sort((left, right) => left.order - right.order);
  orderedSegments.forEach((segment, index) => {
    if (segment.order !== index) {
      issues.push({ code: "storyboard_order_invalid", path: ["storyboard", "segments", index, "order"], segment_id: segment.segment_id });
    }
  });
  const segmentIds = new Set(orderedSegments.map((segment) => segment.segment_id));
  if (segmentIds.size !== orderedSegments.length) {
    issues.push({ code: "storyboard_segment_id_duplicate", path: ["storyboard", "segments"] });
  }

  const chunkIndexes = input.chunks.map((chunk) => chunk.chunkIndex);
  const uniqueChunkIndexes = new Set(chunkIndexes);
  if (uniqueChunkIndexes.size !== chunkIndexes.length) {
    issues.push({ code: "chunk_index_duplicate", path: ["chunks"] });
  }
  const sortedChunkIndexes = [...uniqueChunkIndexes].sort((a, b) => a - b);
  if (sortedChunkIndexes.some((chunkIndex, index) => chunkIndex !== index)) {
    issues.push({ code: "chunk_index_sequence_invalid", path: ["chunks"] });
  }

  const coverage = new Map<string, number>();
  for (const [arrayIndex, chunk] of input.chunks.entries()) {
    const draftIds = chunk.draft.segments.map((entry) => entry.source_segment_id);
    if (
      chunk.inputSegmentIds.length !== draftIds.length ||
      chunk.inputSegmentIds.some((segmentId, index) => segmentId !== draftIds[index])
    ) {
      issues.push({ code: "chunk_segment_sequence_mismatch", path: ["chunks", arrayIndex], chunk_index: chunk.chunkIndex });
    }
    for (const segmentId of draftIds) {
      if (!segmentIds.has(segmentId)) {
        issues.push({ code: "unknown_segment", path: ["chunks", arrayIndex, "draft", "segments"], segment_id: segmentId, chunk_index: chunk.chunkIndex });
      }
      coverage.set(segmentId, (coverage.get(segmentId) ?? 0) + 1);
    }
    for (const segmentId of chunk.inputSegmentIds) {
      if (!segmentIds.has(segmentId)) {
        issues.push({ code: "unknown_segment", path: ["chunks", arrayIndex, "inputSegmentIds"], segment_id: segmentId, chunk_index: chunk.chunkIndex });
      }
    }
  }
  for (const segment of orderedSegments) {
    const count = coverage.get(segment.segment_id) ?? 0;
    if (count === 0) issues.push({ code: "missing_segment", segment_id: segment.segment_id });
    if (count > 1) issues.push({ code: "duplicate_segment", segment_id: segment.segment_id });
  }
  // S2-2A 任务 5：按 resolver 输出的最终路线机械核对意图组合。
  // compiler 不得从 api_video_suitability 重新推导路线，缺路线直接拒绝。
  const intentCounts = new Map<string, { video: number; motion: number }>();
  for (const chunk of input.chunks) {
    for (const entry of chunk.draft.segments) {
      const counts = intentCounts.get(entry.source_segment_id) ?? { video: 0, motion: 0 };
      counts.video += entry.intents.filter((intent) => intent.asset_kind === "video_clip").length;
      counts.motion += entry.intents.filter((intent) => intent.asset_kind === "render_motion_cue").length;
      intentCounts.set(entry.source_segment_id, counts);
    }
  }
  for (const segment of orderedSegments) {
    const routeEntry = input.segmentVisualRoutes.get(segment.segment_id);
    if (!routeEntry) {
      issues.push({ code: "visual_route_missing", segment_id: segment.segment_id });
      continue;
    }
    const counts = intentCounts.get(segment.segment_id) ?? { video: 0, motion: 0 };
    const routeViolated =
      routeEntry.resolved_route === "api_video"
        ? counts.video === 0 || counts.motion === 0
        : counts.motion === 0 || counts.video > 0;
    if (routeViolated) {
      issues.push({ code: "visual_strategy_mismatch", segment_id: segment.segment_id });
    }
  }
  for (const segmentId of input.segmentVisualRoutes.keys()) {
    if (!segmentIds.has(segmentId)) {
      issues.push({ code: "visual_route_unknown_segment", segment_id: segmentId });
    }
  }

  const expectedChunkIds = orderedSegments.map((_, index) =>
    `tts_${String(index + 1).padStart(3, "0")}`);
  const expectedTtsPlan: LocalAudioSkeleton["tts_plan"] = {
    voice_profile_id: "voice_default_male_storyteller",
    estimated_total_duration_sec: Math.max(1, input.draft.estimated_duration_sec),
    chunking_strategy: "segment_boundary",
    chunks: orderedSegments.map((segment, index) => ({
      chunk_id: expectedChunkIds[index]!,
      order: index,
      script_excerpt: segment.script_excerpt,
      estimated_duration_sec: Math.max(1, segment.end_hint_sec - segment.start_hint_sec),
    })),
  };
  const noUpload = {
    allowed: false,
    required: false,
    accepted_file_types: [],
    acceptance_notes: [],
  };
  const expectedTasks: LocalAudioSkeleton["tasks"] = [
    {
      task_id: "tts_001", order: 0, task_type: "tts_audio", source_segment_id: null,
      source_excerpt: input.draft.script_text, production_intent: "生成全片口播音频",
      recommended_mode: "auto", provider_hint: "default_tts", prompt_draft: null,
      parameters: { voice_profile_id: expectedTtsPlan.voice_profile_id, chunk_ids: expectedChunkIds },
      manual_upload_policy: noUpload, risk_notes: [], cost_tier: "low", initial_status: "planned",
    },
    {
      task_id: "subtitle_001", order: 1, task_type: "subtitle_track", source_segment_id: null,
      source_excerpt: input.draft.script_text, production_intent: "根据 TTS 时间戳生成字幕轨",
      recommended_mode: "auto", provider_hint: null, prompt_draft: null,
      parameters: { format: "srt", source_tts_task_id: "tts_001" },
      manual_upload_policy: noUpload, risk_notes: [], cost_tier: "free", initial_status: "planned",
    },
  ];
  const expectedDependencies: LocalAudioSkeleton["dependencies"] = [{
    dependency_id: "dep_subtitle_001_after_tts_001",
    task_id: "subtitle_001",
    depends_on_task_id: "tts_001",
    dependency_type: "requires_timing",
  }];
  if (!isDeepStrictEqual(input.audioSkeleton.tts_plan, expectedTtsPlan)) {
    issues.push({ code: "audio_skeleton_mismatch", path: ["audioSkeleton", "tts_plan"] });
  }
  if (!isDeepStrictEqual(input.audioSkeleton.tasks, expectedTasks)) {
    issues.push({ code: "audio_skeleton_mismatch", path: ["audioSkeleton", "tasks"] });
  }
  if (!isDeepStrictEqual(input.audioSkeleton.dependencies, expectedDependencies)) {
    issues.push({ code: "audio_skeleton_mismatch", path: ["audioSkeleton", "dependencies"] });
  }
  if (issues.length > 0) fail(issues);
  return orderedSegments;
}

function normalizeIntents(input: AssetPlanCompilerInput, orderedSegments: StoryboardPlan["segments"]): NormalizedIntent[] {
  const entries = new Map(input.chunks.flatMap((chunk) => chunk.draft.segments.map((entry) => [entry.source_segment_id, entry] as const)));
  const normalized: NormalizedIntent[] = [];
  for (const segment of orderedSegments) {
    const entry = entries.get(segment.segment_id)!;
    const ordinalByKind = new Map<IntentKind, number>();
    entry.intents.forEach((intent) => {
      const ordinal = (ordinalByKind.get(intent.asset_kind) ?? 0) + 1;
      ordinalByKind.set(intent.asset_kind, ordinal);
      normalized.push({ segment, intent, ordinal });
    });
  }
  return normalized.sort((left, right) =>
    left.segment.order - right.segment.order ||
    KIND_ORDER[left.intent.asset_kind] - KIND_ORDER[right.intent.asset_kind] ||
    left.ordinal - right.ordinal,
  );
}

function taskId(item: NormalizedIntent) {
  return `${PREFIX_BY_KIND[item.intent.asset_kind]}_s${String(item.segment.order).padStart(3, "0")}_${String(item.ordinal).padStart(2, "0")}`;
}

function manualPolicy(kind: IntentKind): AssetTask["manual_upload_policy"] {
  switch (kind) {
    case "image_still": return { allowed: true, required: false, accepted_file_types: ["image/png", "image/jpeg"], acceptance_notes: ["上传文件需符合画幅与时代一致性要求"] };
    case "video_clip": return { allowed: true, required: false, accepted_file_types: ["video/mp4", "video/quicktime"], acceptance_notes: ["上传文件需符合画幅与镜头连续性要求"] };
    case "render_motion_cue": return { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] };
    case "sfx_cue":
    case "bgm_cue": return { allowed: true, required: false, accepted_file_types: ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/aac", "audio/ogg"], acceptance_notes: ["上传文件需可被本地音频管线解码"] };
    default: return assertNever(kind);
  }
}

function taskPolicy(kind: IntentKind): Pick<AssetTask, "recommended_mode" | "provider_hint" | "cost_tier" | "initial_status"> {
  switch (kind) {
    case "image_still": return { recommended_mode: "manual_allowed", provider_hint: null, cost_tier: "low", initial_status: "planned" };
    case "video_clip": return { recommended_mode: "manual_allowed", provider_hint: null, cost_tier: "high", initial_status: "planned" };
    case "render_motion_cue": return { recommended_mode: "auto", provider_hint: null, cost_tier: "free", initial_status: "planned" };
    case "sfx_cue": return { recommended_mode: "auto", provider_hint: null, cost_tier: "low", initial_status: "planned" };
    case "bgm_cue": return { recommended_mode: "auto", provider_hint: null, cost_tier: "low", initial_status: "planned" };
    default: return assertNever(kind);
  }
}

function motionRecipe(hint: StoryboardPlan["segments"][number]["motion_hint"]): string {
  switch (hint) {
    case "static": return "static";
    case "push_in": return "push_in";
    case "pull_back": return "pull_back";
    case "pan": return "pan";
    default: return assertNever(hint);
  }
}

function createTask(item: NormalizedIntent, anchorId: string | undefined, globalDraft: GlobalPlanningCompilerDraft, order: number): AssetTask {
  const { intent, segment } = item;
  let promptDraft: string | null = null;
  let parameters: Record<string, unknown>;
  switch (intent.asset_kind) {
    case "image_still":
      promptDraft = enrichAssetVisualPrompt({ taskType: "image_still", promptDraft: intent.image_prompt, sourceSegmentId: segment.segment_id, storyboardSegments: [segment], artBible: globalDraft.art_bible });
      parameters = { image_role: intent.image_role, support_reason: intent.support_reason, video_prompt_reserve: intent.video_prompt_reserve, aspect_ratio: "9:16", size: "1080*1920", negative_prompt: globalDraft.art_bible.global_negative_prompts.join(", ") };
      break;
    case "video_clip":
      if (!anchorId) fail([{ code: "visual_anchor_missing", segment_id: segment.segment_id, task_id: taskId(item) }]);
      promptDraft = enrichAssetVisualPrompt({ taskType: "video_clip", promptDraft: intent.video_prompt, sourceSegmentId: segment.segment_id, storyboardSegments: [segment], artBible: globalDraft.art_bible });
      parameters = { why_static_insufficient: intent.why_static_insufficient, static_fallback_task_id: anchorId, duration_sec: Math.max(1, segment.end_hint_sec - segment.start_hint_sec), resolution: "1080P" };
      break;
    case "render_motion_cue":
      if (!anchorId) fail([{ code: "visual_anchor_missing", segment_id: segment.segment_id, task_id: taskId(item) }]);
      parameters = { recipe_type: motionRecipe(segment.motion_hint), source_image_task_id: anchorId };
      break;
    case "sfx_cue":
      parameters = { required_tags: intent.required_tags, sfx_tags: intent.required_tags, mood_tags: intent.mood_tags, selection_label: intent.selection_label, timing_basis: intent.timing_basis, library_item_id: null };
      break;
    case "bgm_cue":
      parameters = { required_tags: intent.required_tags, bgm_style_tags: intent.required_tags, mood_tags: intent.mood_tags, selection_label: intent.selection_label, timing_basis: intent.timing_basis, scope: intent.scope, segment_ids: intent.segment_ids, volume: intent.volume, fade_in_sec: intent.fade_in_sec, fade_out_sec: intent.fade_out_sec, library_item_id: null };
      break;
    default: return assertNever(intent);
  }
  return {
    task_id: taskId(item), order, task_type: intent.asset_kind, source_segment_id: segment.segment_id,
    source_excerpt: segment.script_excerpt, production_intent: intent.production_intent,
    ...taskPolicy(intent.asset_kind), prompt_draft: promptDraft, parameters,
    manual_upload_policy: manualPolicy(intent.asset_kind), risk_notes: [...intent.risk_notes],
  };
}

function dependencyId(task: string, upstream: string, type: AssetPlan["dependencies"][number]["dependency_type"]) {
  return `dep_${task}_after_${upstream}_${type}`;
}

function summarizeCost(tasks: AssetTask[], notes: string[]): AssetPlan["cost_summary"] {
  const byType: Record<string, number> = {};
  const byCostTier: Record<string, number> = { free: 0, low: 0, medium: 0, high: 0 };
  tasks.forEach((task) => {
    byType[task.task_type] = (byType[task.task_type] ?? 0) + 1;
    byCostTier[task.cost_tier] = (byCostTier[task.cost_tier] ?? 0) + 1;
  });
  return { total_tasks: tasks.length, by_type: byType, by_cost_tier: byCostTier, estimated_provider_calls: tasks.filter((task) => ["tts_audio", "image_still", "video_clip"].includes(task.task_type)).length, notes };
}

export function compileAssetPlanFromIntents(input: AssetPlanCompilerInput): { plan: AssetPlan; actions: AssetPlanCompilerAction[] } {
  const orderedSegments = validateInput(input);
  const normalized = normalizeIntents(input, orderedSegments);
  const firstSegmentId = orderedSegments[0]!.segment_id;
  const globalBgms = normalized.filter((item) => item.intent.asset_kind === "bgm_cue" && item.intent.scope === "global");
  if (globalBgms.length !== 1 || globalBgms[0]!.segment.segment_id !== firstSegmentId) {
    fail([{ code: "global_bgm_owner_invalid", segment_id: firstSegmentId }]);
  }
  const anchors = new Map<string, string>();
  for (const item of normalized) {
    if (item.intent.asset_kind === "image_still" && item.intent.image_role === "anchor") {
      if (anchors.has(item.segment.segment_id)) fail([{ code: "visual_anchor_duplicate", segment_id: item.segment.segment_id }]);
      anchors.set(item.segment.segment_id, taskId(item));
    }
  }
  for (const segment of orderedSegments) {
    if (!anchors.has(segment.segment_id)) fail([{ code: "visual_anchor_missing", segment_id: segment.segment_id }]);
  }

  const tasks = [...structuredClone(input.audioSkeleton.tasks)];
  normalized.forEach((item) => tasks.push(createTask(item, anchors.get(item.segment.segment_id), input.globalDraft, tasks.length)));
  const ids = new Set(tasks.map((task) => task.task_id));
  if (ids.size !== tasks.length) fail([{ code: "task_id_collision" }]);

  const dependencies = structuredClone(input.audioSkeleton.dependencies);
  const addDependency = (task: string, upstream: string, type: AssetPlan["dependencies"][number]["dependency_type"]) => {
    const dependency_id = dependencyId(task, upstream, type);
    if (!ids.has(task) || !ids.has(upstream) || task === upstream) fail([{ code: "dependency_endpoint_invalid", task_id: task }]);
    if (!dependencies.some((dependency) => dependency.task_id === task && dependency.depends_on_task_id === upstream && dependency.dependency_type === type)) {
      dependencies.push({ dependency_id, task_id: task, depends_on_task_id: upstream, dependency_type: type });
    }
  };
  for (const task of tasks.slice(input.audioSkeleton.tasks.length)) {
    const anchor = task.source_segment_id ? anchors.get(task.source_segment_id) : undefined;
    if ((task.task_type === "video_clip" || task.task_type === "render_motion_cue") && anchor) addDependency(task.task_id, anchor, "requires_output");
    if ((task.task_type === "sfx_cue" || task.task_type === "bgm_cue") && task.parameters.timing_basis === "tts") addDependency(task.task_id, "tts_001", "requires_timing");
  }
  const dependencyKeys = dependencies.map((dependency) => `${dependency.task_id}\0${dependency.depends_on_task_id}\0${dependency.dependency_type}`);
  if (new Set(dependencyKeys).size !== dependencyKeys.length || new Set(dependencies.map((dependency) => dependency.dependency_id)).size !== dependencies.length) fail([{ code: "dependency_duplicate" }]);

  const segmentOrder = new Map(orderedSegments.map((segment) => [segment.segment_id, segment.order]));
  const budgetNotes = [...input.chunks]
    .sort((left, right) =>
      Math.min(...left.inputSegmentIds.map((segmentId) => segmentOrder.get(segmentId)!)) -
      Math.min(...right.inputSegmentIds.map((segmentId) => segmentOrder.get(segmentId)!)))
    .flatMap((chunk) => chunk.draft.budget_notes);
  const actions: AssetPlanCompilerAction[] = [
    ...orderedSegments.map((segment) => {
      const routeEntry = input.segmentVisualRoutes.get(segment.segment_id)!;
      return {
        code: "visual_strategy_applied" as const,
        segment_id: segment.segment_id,
        route: routeEntry.resolved_route,
        reason_code: routeEntry.reason_code,
      };
    }),
    { code: "global_bgm_owner_bound", segment_id: firstSegmentId },
  ];
  const candidate = {
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: input.sourceIds.storyboardRecordId,
    source_script_record_id: input.sourceIds.scriptRecordId,
    source_topic_package_id: input.sourceIds.topicPackageId,
    art_bible: input.globalDraft.art_bible,
    visual_budget: input.globalDraft.visual_budget,
    downgrade_policy: input.globalDraft.downgrade_policy,
    global_audio_strategy: input.globalDraft.global_audio_strategy,
    tts_plan: input.audioSkeleton.tts_plan,
    tasks,
    dependencies,
    cost_summary: summarizeCost(tasks, budgetNotes),
    global_production_notes: ["TTS 与字幕任务由本地服务确定性创建。", ...input.globalDraft.manual_review_notes],
  };
  const parsed = AssetPlanSchema.safeParse(candidate);
  if (!parsed.success) {
    fail(parsed.error.issues.map((issue) => ({
      code: "compiled_plan_schema_invalid",
      path: issue.path.flatMap((part) => typeof part === "string" || typeof part === "number" ? [part] : []),
    })));
  }
  const validation = validateAssetPlan({
    plan: parsed.data,
    storyboard: input.storyboard,
    scriptText: input.draft.script_text,
    storyboardRecordId: input.sourceIds.storyboardRecordId,
    scriptRecordId: input.sourceIds.scriptRecordId,
    topicPackageId: input.sourceIds.topicPackageId,
  });
  if (validation.errors.length > 0) {
    fail(validation.errors.map((code) => ({ code })));
  }
  return { plan: parsed.data, actions };
}
