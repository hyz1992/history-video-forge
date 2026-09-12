import {
  StoryboardPlan,
  StoryboardSegment,
  type ResolvedCapabilityMap,
  type ScriptDraftPackage,
} from "../../../../shared/src/index.js";
import { StoryboardSegmentV2 } from "../../../../shared/src/storyboard/storyboard-plan-v2.schema.js";
import { z } from "zod";
import { env, getValidatedRuntimeEnv } from "../../config/env.js";
import { createHash } from "node:crypto";
import { createLlmGateway, type LlmGateway } from "../../runtime/llm/llm-gateway.js";
import type { LlmInteractionLogWriter } from "../../runtime/llm/interaction-log.js";
import { LlmOutputError, parseLlmOutput } from "../../runtime/llm/llm-output-error.js";
import { createTierAwareProviderFromEnv } from "../../runtime/llm/tier-aware-provider-factory.js";
import type {
  StructuredPromptInvocation,
  StructuredPromptProvider,
} from "../../runtime/llm/provider-contract.js";
import { createPromptRegistry } from "../../runtime/prompts/prompt-registry.js";

import { projectStoryboardTiming, validateStoryboardTiming, StoryboardBoundaryError, type StoryboardTimingContext } from "./storyboard-timing-projector.js";
import { verifyStoryboardNarrationContext } from "./storyboard-narration-context.js";

export interface TopicBoundaryContext {
  title: string;
  selected_angle: string;
  core_conflict: string;
  strong_scene: string;
  forbidden_expansions: unknown[];
  risk_hints: unknown[];
  source_anchor_refs: unknown[];
  canonical_quotes: unknown[];
  narrative_tension_map: Record<string, unknown>;
}

export interface GenerateStoryboardPlanInput {
  narrationTiming?: StoryboardTimingContext;
  sourceScriptRecordId: string;
  sourceTopicPackageId: string;
  draft: ScriptDraftPackage;
  topicBoundaryContext: TopicBoundaryContext;
  llmGateway?: LlmGateway;
  interactionLogWriter?: LlmInteractionLogWriter;
  /**
   * S2-2C（详细设计 §6.1）：快照冻结 capabilities（来源
   * `billingContext.resolved.resolved_capabilities` 只读引用）。
   */
  snapshotCapabilities?: ResolvedCapabilityMap;
  regenerationContext?: {
    reason: "storyboard_local_validation_regen_once" | "storyboard_narration_plan_invalid";
    errors: string[];
    metrics: Record<string, unknown>;
    user_feedback?: string;
  };
}

export function buildStoryboardPlannerPromptInput(
  input: GenerateStoryboardPlanInput,
) {
  const promptInput = {
    draft: input.draft,
    topic_boundary_context: input.topicBoundaryContext,
    source_script_record_id: input.sourceScriptRecordId,
    source_topic_package_id: input.sourceTopicPackageId,
    ...(input.narrationTiming ? { narration_timing: verifyStoryboardNarrationContext(input.narrationTiming, input.draft.script_text) } : {}),
  };

  if (!input.regenerationContext) {
    return promptInput;
  }

  return {
    ...promptInput,
    regeneration_context: input.regenerationContext,
  };
}

/** 重生触发面：LLM 输出反馈可修的错误类别。
 *  - StoryboardBoundaryError：边界类（漂移不可吸附/倒流/断链/order/覆盖）；
 *  - ZodError：schema 形状（缺必填字段/枚举非法/多余字段/重复 id 等）；
 *  - source/duration 抄写错误。
 *  narration 来源哈希不一致（narration_source_mismatch）是系统不变量，
 *  不是 LLM 输出问题，不重试。 */
const REGEN_WORTHY_SOURCE_ERRORS = new Set(["storyboard_source_mismatch", "storyboard_narration_duration_mismatch"]);
function isStoryboardPlanRegenWorthy(cause: unknown): boolean {
  if (cause instanceof StoryboardBoundaryError || cause instanceof z.ZodError) return true;
  return cause instanceof Error && REGEN_WORTHY_SOURCE_ERRORS.has(cause.message);
}
function formatStoryboardZodIssue(issue: z.ZodIssue): string {
  const path = issue.path;
  const segmentIndex = typeof path[1] === "number" ? path[1] : null;
  const field = path.length > 0 && typeof path.at(-1) === "string" ? path.at(-1)! : null;
  const where = segmentIndex !== null ? `第 ${segmentIndex + 1} 镜` : "计划";
  if (issue.code === "invalid_type" && issue.received === "undefined") return `${where}缺少必填字段 ${field}`;
  if (issue.code === "invalid_enum_value") return `${where}的 ${field} 值非法（收到 ${JSON.stringify(issue.received)}），必须使用规定枚举`;
  if (issue.code === "unrecognized_keys") return `${where}包含多余字段 ${issue.keys.join("、")}，不得输出 schema 之外的字段`;
  return `${where}输出不符合 schema：${issue.path.join(".")}（${issue.message}）`;
}
function storyboardPlanViolations(cause: unknown): string[] {
  if (cause instanceof StoryboardBoundaryError) return cause.violations;
  if (cause instanceof z.ZodError) return cause.issues.slice(0, 3).map(formatStoryboardZodIssue);
  if (cause instanceof Error && cause.message === "storyboard_source_mismatch") return ["source_script_record_id / source_topic_package_id 必须逐字复制输入值，不得改写"];
  if (cause instanceof Error && cause.message === "storyboard_narration_duration_mismatch") return ["不要输出 estimated_total_duration_sec（由运行时按边界派生）；如输出必须等于实测时长"];
  return [];
}

export async function generateStoryboardPlan(input: GenerateStoryboardPlanInput) {
  const narrationTiming = input.narrationTiming ? verifyStoryboardNarrationContext(input.narrationTiming, input.draft.script_text) : undefined;
  input = { ...input, narrationTiming };
  const gateway = input.llmGateway ?? createStoryboardPlannerGateway(input.snapshotCapabilities);
  // 边界合同违反（编号漂移无法吸附、时间倒流、链式断裂）、schema 形状错误
  // （缺字段/枚举非法/多余字段）与来源/时长抄写错误均带具体错误反馈重生一次：
  // 二次失败才拒绝。唯一不重试的是 narration 来源哈希不一致（系统不变量，
  // 且已被 context 验证在 LLM 调用前拦截）。
  const maxAttempts = narrationTiming ? 2 : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const rawPlan = await gateway.invokeStructuredPrompt<unknown>({
      promptId: "storyboard.planner",
      input: buildStoryboardPlannerPromptInput(input),
      interactionLogWriter: input.interactionLogWriter,
    });

    if (narrationTiming) {
      try {
        const plan = projectStoryboardTiming({ ...narrationTiming, plan: rawPlan });
        if (plan.source_script_record_id !== input.sourceScriptRecordId || plan.source_topic_package_id !== input.sourceTopicPackageId) throw new Error("storyboard_source_mismatch");
        return plan;
      } catch (cause) {
        if (attempt < maxAttempts && isStoryboardPlanRegenWorthy(cause)) {
          // 合并而非覆盖：run service 可能已传入本地校验重生上下文与用户反馈，
          // 内层重生的 reason 以 plan_invalid 为准，但保留外层 errors 与 user_feedback。
          input = { ...input, regenerationContext: {
            ...(input.regenerationContext ?? { metrics: {} }),
            reason: "storyboard_narration_plan_invalid",
            errors: [...(input.regenerationContext?.errors ?? []), ...storyboardPlanViolations(cause)],
          } };
          continue;
        }
        throw new LlmOutputError("storyboard_narration_plan_invalid", { cause });
      }
    }

    const normalized = normalizeStoryboardPlan(rawPlan, input);
    // 2026-09-05（时长校准）：LLM 按人类朗读语速常识排时间窗（本项目实测 3.9 字/秒），
    // 而 TTS 实际语速 5.33 字/秒，导致段预估系统性虚高（118s vs 脚本 82s，+44%）并
    // 一路传导到视频生成时长。时间窗与内容切分解耦：LLM 只负责切分与视觉意图，
    // 时间窗由本地按各段正文字符占比 × draft.estimated_duration_sec 确定性重算，
    // 总和恒等于脚本声明时长，误差收敛到脚本估算单点（82 vs 真实 86，≈5%）。
    const plan = recalculateSegmentTimings(normalized, input.draft.estimated_duration_sec);
    return parseLlmOutput(
      StoryboardPlan,
      plan,
      "storyboard_plan_schema_invalid",
    );
  }
  throw new LlmOutputError("storyboard_narration_plan_invalid");
}

/**
 * 按各段 script_excerpt 字符占比重算时间窗，总和恒等于 totalDurationSec。
 *
 * - 每段时长 = round(字符占比 × total)，且为剩余段预留每段最少 1s；末段
 *   吸收全部余数（总和恒等于 total，高偏斜分布不溢出）。
 *   buildDeterministicStoryboardPlan 的分配方式同构。
 * - estimated_total_duration_sec 一并覆盖为 total（不再采信 LLM 声明）。
 * - segments 缺失/为空/非对象时原样返回（交由 schema 校验报错）。
 */
export function recalculateSegmentTimings<T>(plan: T, totalDurationSec: number): T {
  if (!plan || typeof plan !== "object") return plan;
  const record = plan as Record<string, unknown>;
  // 先落局部变量：索引签名属性的类型收窄无法在后续属性访问中保持
  const rawSegments = record.segments;
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
    return plan;
  }
  const segmentCount = rawSegments.length;

  const total = Math.max(1, Math.round(totalDurationSec));
  const excerptChars = rawSegments.map((segment) => {
    if (!segment || typeof segment !== "object") return 0;
    const excerpt = String((segment as Record<string, unknown>).script_excerpt ?? "");
    return excerpt.replace(/\s/g, "").length;
  });
  const totalChars = excerptChars.reduce((sum, count) => sum + count, 0);

  let elapsed = 0;
  const segments = rawSegments.map((segment, index) => {
    const base =
      segment && typeof segment === "object"
        ? (segment as Record<string, unknown>)
        : {};
    const isLast = index === segmentCount - 1;
    const ratioShare =
      totalChars > 0 ? (excerptChars[index]! / totalChars) * total : total / segmentCount;
    // 非末段为剩余段预留每段最少 1s（高偏斜分布下独立 round 会提前耗尽预算，
    // 末段再被强制 1s 会让总和溢出）；末段严格吸收余数。
    const remainingSegments = segmentCount - index - 1;
    const duration = isLast
      ? Math.max(1, total - elapsed)
      : Math.max(1, Math.min(Math.round(ratioShare), total - elapsed - remainingSegments));
    const start = elapsed;
    const end = start + duration;
    elapsed = end;
    return { ...base, start_hint_sec: start, end_hint_sec: end };
  });

  return {
    ...record,
    segments,
    estimated_total_duration_sec: total,
  } as T;
}

function normalizeStoryboardPlan(
  rawPlan: unknown,
  input: GenerateStoryboardPlanInput,
) {
  if (!rawPlan || typeof rawPlan !== "object") {
    return rawPlan;
  }

  const record = rawPlan as Record<string, unknown>;
  const unwrapped =
    record.storyboard_plan &&
    typeof record.storyboard_plan === "object" &&
    !Array.isArray(record.storyboard_plan)
      ? (record.storyboard_plan as Record<string, unknown>)
      : record.StoryboardPlan &&
          typeof record.StoryboardPlan === "object" &&
          !Array.isArray(record.StoryboardPlan)
        ? (record.StoryboardPlan as Record<string, unknown>)
      : record;

  return {
    ...unwrapped,
    plan_version: unwrapped.plan_version ?? "storyboard_v1",
    source_script_record_id:
      unwrapped.source_script_record_id ?? input.sourceScriptRecordId,
    source_topic_package_id:
      unwrapped.source_topic_package_id ?? input.sourceTopicPackageId,
    estimated_total_duration_sec:
      unwrapped.estimated_total_duration_sec ?? input.draft.estimated_duration_sec,
    segments: Array.isArray(unwrapped.segments)
      ? unwrapped.segments.map(normalizeStoryboardSegment)
      : unwrapped.segments,
    global_visual_notes: Array.isArray(unwrapped.global_visual_notes)
      ? unwrapped.global_visual_notes
      : [],
  };
}

function normalizeStoryboardSegment(rawSegment: unknown) {
  if (!rawSegment || typeof rawSegment !== "object" || Array.isArray(rawSegment)) {
    return rawSegment;
  }

  const segment = rawSegment as Record<string, unknown>;
  const { riskNotes, linked_beats, linked_quotes, ...rest } = segment;

  // LLM 经常把 linked_beats / linked_quotes 写成"对象数组"（模仿 draft.beat_trace
  // 的结构），例如 [{ beat: "...", excerpt: "...", confidence: 0.95 }]。
  // 但 schema 期望的是字符串数组（beat 名字）。这里做容错扁平化：
  //   - 字符串原样保留
  //   - 对象取 beat / quote 字段（无则取 excerpt，再无则跳过）
  //   - 其他类型跳过
  // 真实事故项目 debeecaa-b1ee-43db-ae0c-ce31b013fb8f 就是因为这个未做容错，
  // StoryboardPlan.parse 直接抛 ZodError → internal_server_error → 无 regen 机会。
  const normalizedLinkedBeats = normalizeLinkedTraceArray(
    linked_beats,
    ["beat", "excerpt"],
  );
  const normalizedLinkedQuotes = normalizeLinkedTraceArray(
    linked_quotes,
    ["quote", "excerpt"],
  );

  return {
    ...rest,
    ...(riskNotes !== undefined ? { risk_notes: riskNotes } : {}),
    linked_beats: normalizedLinkedBeats,
    linked_quotes: normalizedLinkedQuotes,
  };
}

/**
 * 把 LLM 输出的 linked_beats / linked_quotes 数组规范化为非空字符串数组。
 *
 * - 字符串：trim 后非空则保留。
 * - 对象：按 preferredKeys 顺序取第一个非空字符串字段。
 * - number / boolean / null / 其他：跳过。
 * - undefined 输入（字段缺失）：返回空数组（让 schema 默认行为决定）。
 */
function normalizeLinkedTraceArray(
  value: unknown,
  preferredKeys: string[],
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (trimmed.length > 0) {
        out.push(trimmed);
      }
      continue;
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      for (const key of preferredKeys) {
        const v = record[key];
        if (typeof v === "string") {
          const trimmed = v.trim();
          if (trimmed.length > 0) {
            out.push(trimmed);
            break;
          }
        }
      }
    }
  }
  return out;
}

export interface RegenerateSingleSegmentInput {
  narrationTiming?: StoryboardTimingContext;
  plan: StoryboardPlan;
  targetSegmentId: string;
  userFeedback: string;
  llmGateway?: LlmGateway;
  interactionLogWriter?: LlmInteractionLogWriter;
  /**
   * S2-2C（详细设计 §6.1）：快照冻结 capabilities（来源
   * `billingContext.resolved.resolved_capabilities` 只读引用）。
   */
  snapshotCapabilities?: ResolvedCapabilityMap;
}

const SEGMENT_REGEN_LOCKED_FIELDS = [
  "segment_id",
  "order",
  "script_excerpt",
  "start_hint_sec",
  "end_hint_sec",
  "narrative_role",
  "linked_beats",
  "linked_quotes",
] as const;

export async function regenerateSingleSegment(
  input: RegenerateSingleSegmentInput,
) {
  const gateway = input.llmGateway ?? createStoryboardPlannerGateway(input.snapshotCapabilities);

  const narrationTiming = input.plan.plan_version === "storyboard_v2"
    ? verifyStoryboardNarrationContext(input.narrationTiming ?? { timingMap: null, narrationReference: null }) : undefined;
  if (narrationTiming) validateStoryboardTiming(input.plan, narrationTiming);
  const targetSegment = input.plan.segments.find(
    (s) => s.segment_id === input.targetSegmentId,
  );
  if (!targetSegment) {
    throw new Error(`segment_not_found: ${input.targetSegmentId}`);
  }

  const promptInput = {
    plan: input.plan,
    target_segment_id: input.targetSegmentId,
    current_segment: targetSegment,
    user_feedback: input.userFeedback,
    ...(narrationTiming ? { narration_timing: narrationTiming } : {}),
  };

  const rawSegment = await gateway.invokeStructuredPrompt<unknown>({
    promptId: "storyboard.segment-regen",
    input: promptInput,
    interactionLogWriter: input.interactionLogWriter,
  });

  if (narrationTiming) {
    const incoming = rawSegment && typeof rawSegment === "object" ? rawSegment as Record<string, unknown> : {};
    const visual = ["visual_intent", "scene_description", "visual_elements", "framing_hint", "content_type", "motion_hint", "editing_hint", "on_screen_text", "risk_notes", "api_video_suitability"];
    return parseLlmOutput(StoryboardSegmentV2, { ...targetSegment, ...Object.fromEntries(visual.filter(k => incoming[k] !== undefined).map(k => [k, incoming[k]])) }, "storyboard_segment_schema_invalid");
  }
  const merged = mergeSegmentWithLocks(targetSegment, rawSegment);
  return parseLlmOutput(
    StoryboardSegment,
    merged,
    "storyboard_segment_schema_invalid",
  );
}

function mergeSegmentWithLocks(
  original: Record<string, unknown>,
  raw: unknown,
): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return original;
  }

  const incoming = raw as Record<string, unknown>;
  const merged: Record<string, unknown> = {};

  for (const key of Object.keys(original)) {
    if ((SEGMENT_REGEN_LOCKED_FIELDS as readonly string[]).includes(key)) {
      merged[key] = original[key];
    } else if (key in incoming && incoming[key] !== undefined && incoming[key] !== null) {
      merged[key] = incoming[key];
    } else {
      merged[key] = original[key];
    }
  }

  return merged;
}

export function createStoryboardPlannerGateway(snapshotCapabilities?: ResolvedCapabilityMap): LlmGateway {
  const provider =
    env.llm.provider === "stub"
      ? createStubStoryboardPlannerProvider()
      : createValidatedStoryboardPlannerProvider(snapshotCapabilities);

  return createLlmGateway({
    registry: createPromptRegistry(),
    provider,
  });
}

function createValidatedStoryboardPlannerProvider(snapshotCapabilities?: ResolvedCapabilityMap): StructuredPromptProvider {
  getValidatedRuntimeEnv();

  return createTierAwareProviderFromEnv(
    snapshotCapabilities ? { snapshotCapabilities } : undefined,
  );
}

function createStubStoryboardPlannerProvider(): StructuredPromptProvider {
  return {
    async invokeStructuredPrompt<T>(
      request: StructuredPromptInvocation,
    ): Promise<T> {
      const promptId = request.prompt.metadata.id;

      if (promptId === "storyboard.segment-regen") {
        const input = request.input as Record<string, unknown>;
        const segment = (input.current_segment ?? {}) as T;

        await request.interactionLogWriter?.write({
          generatedAt: new Date().toISOString(),
          provider: "stub",
          model: "stub",
          operationName: request.operationName,
          promptId,
          promptStage: request.prompt.metadata.stage,
          promptLanguage: request.prompt.metadata.language,
          promptFilePath: request.prompt.filePath,
          promptSha256: createHash("sha256").update(request.prompt.body.trim()).digest("hex"),
          promptVersion: request.prompt.metadata.version,
          systemPrompt: request.prompt.body,
          input: request.input,
          rawOutput: JSON.stringify(segment, null, 2),
          parsedOutput: segment,
          errorMessage: null,
        });

        return segment;
      }

      const promptInput = request.input as ReturnType<
        typeof buildStoryboardPlannerPromptInput
      >;
      const plan = buildDeterministicStoryboardPlan(promptInput) as T;

      await request.interactionLogWriter?.write({
        generatedAt: new Date().toISOString(),
        provider: "stub",
        model: "stub",
        operationName: request.operationName,
        promptId: request.prompt.metadata.id,
        promptStage: request.prompt.metadata.stage,
        promptLanguage: request.prompt.metadata.language,
        promptFilePath: request.prompt.filePath,
        promptSha256: createHash("sha256").update(request.prompt.body.trim()).digest("hex"),
        promptVersion: request.prompt.metadata.version,
        systemPrompt: request.prompt.body,
        input: request.input,
        rawOutput: JSON.stringify(plan, null, 2),
        parsedOutput: plan,
        errorMessage: null,
      });

      return plan;
    },
  };
}

function buildDeterministicStoryboardPlan(
  input: ReturnType<typeof buildStoryboardPlannerPromptInput>,
) {
  if (input.narration_timing) return buildDeterministicNarrationStoryboard(input);
  const draft = input.draft;
  const excerpts = splitScriptIntoExcerpts(draft.script_text);
  const totalChars = Math.max(
    excerpts.reduce((sum, excerpt) => sum + excerpt.length, 0),
    1,
  );
  let elapsed = 0;

  const segments = excerpts.map((excerpt, index) => {
    const duration =
      index === excerpts.length - 1
        ? draft.estimated_duration_sec - elapsed
        : Math.max(
            1,
            Math.round(
              (excerpt.length / totalChars) * draft.estimated_duration_sec,
            ),
          );
    const start = elapsed;
    const end = Math.max(start + 1, start + duration);
    elapsed = end;

    return {
      segment_id: `sb_${String(index + 1).padStart(3, "0")}`,
      order: index,
      script_excerpt: excerpt,
      start_hint_sec: start,
      end_hint_sec: end,
      narrative_role: resolveNarrativeRole(index, excerpts.length),
      visual_intent: "让观众看清这一段压力如何推进。",
      scene_description: buildSceneDescription(input.topic_boundary_context, index),
      visual_elements: buildVisualElements(input.topic_boundary_context),
      framing_hint: index === 0 ? "wide" : index === excerpts.length - 1 ? "close" : "medium",
      content_type: "live_action",
      motion_hint: index === 0 ? "push_in" : "static",
      editing_hint: "single",
      on_screen_text: [],
      linked_beats: draft.beat_trace
        .filter((trace) => excerpt.includes(trace.excerpt) || excerpt.includes(trace.beat))
        .map((trace) => trace.beat),
      linked_quotes: draft.quote_trace
        .filter((trace) => excerpt.includes(trace.quote) || excerpt.includes(trace.excerpt))
        .map((trace) => trace.quote),
      risk_notes: [],
      // S2-2A 任务 4：stub 不判断适配度，统一 remotion_sufficient（静态图+运镜足够）
      api_video_suitability: "remotion_sufficient",
    };
  });

  for (const trace of draft.beat_trace) {
    if (segments.some((segment) => segment.linked_beats.includes(trace.beat))) {
      continue;
    }
    const segment = segments.find((candidate) =>
      candidate.script_excerpt.includes(trace.excerpt),
    );
    (segment ?? segments[0]).linked_beats.push(trace.beat);
  }

  for (const trace of draft.quote_trace) {
    if (segments.some((segment) => segment.linked_quotes.includes(trace.quote))) {
      continue;
    }
    const segment = segments.find((candidate) =>
      candidate.script_excerpt.includes(trace.excerpt),
    );
    (segment ?? segments.at(-1) ?? segments[0]).linked_quotes.push(trace.quote);
  }

  return {
    plan_version: "storyboard_v1",
    source_script_record_id: input.source_script_record_id,
    source_topic_package_id: input.source_topic_package_id,
    estimated_total_duration_sec: draft.estimated_duration_sec,
    segments,
    global_visual_notes: [],
  };
}

function splitScriptIntoExcerpts(scriptText: string) {
  const sentences = scriptText
    .match(/[^。！？?!；;]+[。！？?!；;]?\s*/gu)
    ?.filter((sentence) => sentence.trim().length > 0) ?? [];

  if (sentences.length <= 3) {
    return sentences.length > 0 ? sentences : [scriptText];
  }

  const targetCount = Math.min(8, Math.max(3, Math.ceil(sentences.length / 2)));
  const excerpts: string[] = [];
  for (let index = 0; index < sentences.length; index += 1) {
    const bucket = Math.floor((index / sentences.length) * targetCount);
    excerpts[bucket] = `${excerpts[bucket] ?? ""}${sentences[index]}`;
  }

  return excerpts.filter(Boolean);
}

function resolveNarrativeRole(index: number, total: number) {
  if (index === 0) {
    return "opening";
  }
  if (index === total - 1) {
    return "ending";
  }
  if (index >= total - 2) {
    return "peak";
  }
  return index % 2 === 0 ? "turn" : "pressure";
}

function buildSceneDescription(
  topicBoundaryContext: TopicBoundaryContext,
  index: number,
) {
  if (index === 0 && topicBoundaryContext.strong_scene.trim().length > 0) {
    return topicBoundaryContext.strong_scene;
  }

  return `${topicBoundaryContext.title}的关键场面按口播顺序展开，突出人物对峙和压力变化。`;
}

function buildVisualElements(topicBoundaryContext: TopicBoundaryContext) {
  const title = topicBoundaryContext.title.trim();
  const elements = [title || "历史人物", "场面压力"].filter(Boolean);
  return [...new Set(elements)];
}

function buildDeterministicNarrationStoryboard(input: ReturnType<typeof buildStoryboardPlannerPromptInput>) {
  const { timingMap } = input.narration_timing!;
  const last = timingMap.boundaries.length - 1;
  const cuts = [...new Set([0, Math.floor(last / 3), Math.floor(last * 2 / 3), last])];
  return { plan_version: "storyboard_v2", source_script_record_id: input.source_script_record_id,
    source_topic_package_id: input.source_topic_package_id, global_visual_notes: [],
    segments: cuts.slice(0, -1).map((cut, index) => ({ segment_id: "sb_" + (index + 1), order: index,
      start_boundary_id: timingMap.boundaries[cut]!.id, end_boundary_id: timingMap.boundaries[cuts[index + 1]!]!.id,
      narrative_role: resolveNarrativeRole(index, cuts.length - 1), visual_intent: "呈现当前段落的场景与动作。",
      scene_description: buildSceneDescription(input.topic_boundary_context, index), visual_elements: buildVisualElements(input.topic_boundary_context),
      framing_hint: "medium", content_type: "live_action", motion_hint: "static", editing_hint: "single", on_screen_text: [],
      linked_beats: index === 0 ? input.draft.beat_trace.map(t => t.beat) : [],
      linked_quotes: index === 0 ? input.draft.quote_trace.map(t => t.quote) : [], risk_notes: [], api_video_suitability: "remotion_sufficient" })) };
}
