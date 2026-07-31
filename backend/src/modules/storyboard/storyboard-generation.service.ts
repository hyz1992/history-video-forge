import {
  StoryboardPlan,
  StoryboardSegment,
  type ScriptDraftPackage,
} from "../../../../shared/src/index.js";
import { env, getValidatedRuntimeEnv } from "../../config/env.js";
import { createHash } from "node:crypto";
import { createLlmGateway, type LlmGateway } from "../../runtime/llm/llm-gateway.js";
import type { LlmInteractionLogWriter } from "../../runtime/llm/interaction-log.js";
import { createTierAwareProviderFromEnv } from "../../runtime/llm/tier-aware-provider-factory.js";
import type {
  StructuredPromptInvocation,
  StructuredPromptProvider,
} from "../../runtime/llm/provider-contract.js";
import { createPromptRegistry } from "../../runtime/prompts/prompt-registry.js";

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
  sourceScriptRecordId: string;
  sourceTopicPackageId: string;
  draft: ScriptDraftPackage;
  topicBoundaryContext: TopicBoundaryContext;
  llmGateway?: LlmGateway;
  interactionLogWriter?: LlmInteractionLogWriter;
  regenerationContext?: {
    reason: "storyboard_local_validation_regen_once";
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
  };

  if (!input.regenerationContext) {
    return promptInput;
  }

  return {
    ...promptInput,
    regeneration_context: input.regenerationContext,
  };
}

export async function generateStoryboardPlan(input: GenerateStoryboardPlanInput) {
  const gateway = input.llmGateway ?? createStoryboardPlannerGateway();
  const rawPlan = await gateway.invokeStructuredPrompt<unknown>({
    promptId: "storyboard.planner",
    input: buildStoryboardPlannerPromptInput(input),
    interactionLogWriter: input.interactionLogWriter,
  });

  return StoryboardPlan.parse(normalizeStoryboardPlan(rawPlan, input));
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
  plan: StoryboardPlan;
  targetSegmentId: string;
  userFeedback: string;
  llmGateway?: LlmGateway;
  interactionLogWriter?: LlmInteractionLogWriter;
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
  const gateway = input.llmGateway ?? createStoryboardPlannerGateway();

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
  };

  const rawSegment = await gateway.invokeStructuredPrompt<unknown>({
    promptId: "storyboard.segment-regen",
    input: promptInput,
    interactionLogWriter: input.interactionLogWriter,
  });

  const merged = mergeSegmentWithLocks(targetSegment, rawSegment);
  return StoryboardSegment.parse(merged);
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

function createStoryboardPlannerGateway(): LlmGateway {
  const provider =
    env.llm.provider === "stub"
      ? createStubStoryboardPlannerProvider()
      : createValidatedStoryboardPlannerProvider();

  return createLlmGateway({
    registry: createPromptRegistry(),
    provider,
  });
}

function createValidatedStoryboardPlannerProvider(): StructuredPromptProvider {
  getValidatedRuntimeEnv();

  return createTierAwareProviderFromEnv();
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
      visual_strategy_preference: null,
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
