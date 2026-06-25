import {
  StoryboardPlan,
  type ScriptDraftPackage,
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
  if ("risk_notes" in segment || !("riskNotes" in segment)) {
    return segment;
  }

  const { riskNotes, ...rest } = segment;
  return {
    ...rest,
    risk_notes: riskNotes,
  };
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

  return createOpenAiCompatibleProvider({
    profile: "main",
  });
}

function createStubStoryboardPlannerProvider(): StructuredPromptProvider {
  return {
    async invokeStructuredPrompt<T>(
      request: StructuredPromptInvocation,
    ): Promise<T> {
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
    .split(/(?<=[。！？!?；;])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

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
