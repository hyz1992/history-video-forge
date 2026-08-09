import { TopicCandidateCard } from "../../../../shared/src/index.js";
import type { DbClient } from "../../db/client.js";
import { saveCachedCandidate } from "../../modules/cache/candidate-cache.repository.js";
import type { BuildTopicCandidatesInput } from "../../modules/topic/topic-candidate.builder.js";
import type { GraphTraceNodeSummary } from "./graph-trace.js";
import { parseLlmOutput } from "../llm/llm-output-error.js";
import { buildEventIdentityFingerprint, normalizeEventIdentityValue } from "../../modules/topic/event-normalizer.js";

export const TOPIC_CANDIDATE_TARGET_COUNT = 4;
export const TOPIC_RAW_CANDIDATE_POOL_TARGET_COUNT = 8;

export interface TopicRecommendationGraphDependencies {
  invokeStructuredPrompt: <T>(input: {
    promptId: string;
    input: unknown;
  }) => Promise<T>;
}

interface CandidateFieldIssue {
  candidate_index: number;
  event_identity: string;
  missing_fields: string[];
  raw_candidate: Record<string, unknown>;
}

export interface TopicRecommendationGraphRuntime {
  db: DbClient;
  input: BuildTopicCandidatesInput;
  projectId?: string | null;
  candidates: ReturnType<typeof TopicCandidateCard.parse>[];
  traceNodes: GraphTraceNodeSummary[];
  repairTriggered: boolean;
  slotsInsufficient: boolean;
  builderRepairTriggered: boolean;
  builderRepairPassed: boolean;
  pendingFieldRepair: boolean;
  builderDegraded: boolean;
  pendingFieldIssues: CandidateFieldIssue[];
  pendingRawBuilderCandidates: Record<string, unknown>[];
}

/**
 * 从 graph runtime input 中解析有效目标数量（缺省回退常量）。
 * 自定义入口通过 BuildTopicCandidatesInput.target_candidate_count / final_candidate_count
 * 注入；不传时等价三 tab 共用 8→4。
 */
function resolveRawCandidateTargetCount(
  runtime: TopicRecommendationGraphRuntime,
): number {
  return (
    runtime.input.target_candidate_count ?? TOPIC_RAW_CANDIDATE_POOL_TARGET_COUNT
  );
}

function resolveFinalCandidateCount(
  runtime: TopicRecommendationGraphRuntime,
): number {
  return runtime.input.final_candidate_count ?? TOPIC_CANDIDATE_TARGET_COUNT;
}

async function persistTopicCandidates(
  runtime: TopicRecommendationGraphRuntime,
  candidates: ReturnType<typeof TopicCandidateCard.parse>[],
) {
  for (const candidate of candidates) {
    await saveCachedCandidate(runtime.db, {
      projectId: runtime.projectId ?? null,
      eventIdentity: candidate.event_identity,
      fingerprint: buildEventIdentityFingerprint({
        eventIdentity: normalizeEventIdentityValue(candidate.event_identity),
        angle: candidate.one_line_angle,
      }),
      filterFingerprint: runtime.input.topic_filter_fingerprint,
      oneLineAngle: candidate.one_line_angle,
      familyLabel: candidate.family_label,
      scopeLabel: candidate.scope_label,
      viralRubricJson: candidate.viral_rubric,
      estimatedDurationBandJson: candidate.estimated_duration_band,
      strongScene: candidate.strong_scene,
      coreConflict: candidate.core_conflict,
      mustCoverPreviewJson: candidate.must_cover_preview,
    });
  }
}

function collectCandidateFieldIssues(
  candidate: Record<string, unknown>,
): string[] {
  const parsedCandidate = TopicCandidateCard.safeParse(candidate);
  if (parsedCandidate.success) {
    return [];
  }

  const rubricMetadata =
    candidate.viral_rubric && typeof candidate.viral_rubric === "object"
      ? (candidate.viral_rubric as Record<string, unknown>)
      : null;
  const repairRequiredFields = new Set([
    "event_identity",
    "title",
    "one_line_angle",
    "family_label",
    "scope_label",
    "viral_rubric",
  ]);

  return [
    ...new Set(
      parsedCandidate.error.issues
        .map((issue) => issue.path[0])
        .filter((path): path is string => typeof path === "string" && path.length > 0)
        .filter((path) => repairRequiredFields.has(path))
        .filter((path) => {
          if (path === "family_label") {
            return !(
              (typeof candidate.family_label === "string" && candidate.family_label) ||
              (typeof rubricMetadata?.family_label === "string" &&
                rubricMetadata.family_label)
            );
          }

          if (path === "scope_label") {
            return !(
              (typeof candidate.scope_label === "string" && candidate.scope_label) ||
              (typeof rubricMetadata?.scope_label === "string" &&
                rubricMetadata.scope_label)
            );
          }

          if (path === "viral_rubric") {
            return !candidate.viral_rubric;
          }

          return true;
        }),
    ),
  ];
}

function normalizeTopicCandidateOutputs(rawOutput: unknown): unknown[] {
  if (Array.isArray(rawOutput)) {
    return rawOutput;
  }

  if (!rawOutput || typeof rawOutput !== "object") {
    throw new TypeError("topic_candidate_output_not_array");
  }

  const outputRecord = rawOutput as Record<string, unknown>;
  if (Array.isArray(outputRecord.candidates)) {
    return outputRecord.candidates;
  }

  if (Array.isArray(outputRecord.topic_candidates)) {
    return outputRecord.topic_candidates;
  }

  for (const value of Object.values(outputRecord)) {
    if (isCandidateRecordArray(value)) {
      return value;
    }
  }

  return [];
}

function isCandidateRecordArray(value: unknown): value is unknown[] {
  return (
    Array.isArray(value) &&
    value.some(
      (item) => !!item && typeof item === "object" && !Array.isArray(item),
    )
  );
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function completeMustCoverPreview(
  preview: string[],
  runtime: TopicRecommendationGraphRuntime,
  description: string,
): string[] {
  const normalizedPreview = uniqueStrings(preview);
  if (normalizedPreview.length >= 3) {
    return normalizedPreview;
  }

  return uniqueStrings([
    ...normalizedPreview,
    runtime.input.strongScene.trim(),
    ...(runtime.input.canonicalQuotes ?? []).map((quote) => quote.trim()),
    runtime.input.coreConflict.trim(),
    description.trim(),
  ].filter((item) => item.length > 0)).slice(0, 3);
}

function normalizeTopicCandidateCard(
  candidate: Record<string, unknown>,
  runtime: TopicRecommendationGraphRuntime,
) {
  const parsedCandidate = TopicCandidateCard.safeParse(candidate);
  if (parsedCandidate.success) {
    return {
      ...parsedCandidate.data,
      must_cover_preview: completeMustCoverPreview(
        parsedCandidate.data.must_cover_preview,
        runtime,
        parsedCandidate.data.one_line_angle,
      ),
    };
  }

  const rubricMetadata =
    candidate.viral_rubric && typeof candidate.viral_rubric === "object"
      ? (candidate.viral_rubric as Record<string, unknown>)
      : null;

  const description =
    typeof candidate.one_line_angle === "string" && candidate.one_line_angle
      ? candidate.one_line_angle
      : typeof candidate.description === "string"
      ? candidate.description
      : typeof candidate.summary === "string"
        ? candidate.summary
        : `${runtime.input.canonicalName}具备进入 topic 候选的讲述张力。`;
  const formalMustCoverPreview = normalizeStringArray(candidate.must_cover_preview);
  const normalizedKeyElements = normalizeStringArray(candidate.key_elements);
  const coreElements = normalizeStringArray(candidate.core_elements);
  const keyElements =
    formalMustCoverPreview.length > 0
      ? formalMustCoverPreview
      : normalizedKeyElements.length > 0
        ? normalizedKeyElements
        : coreElements;
  const viralRubric = normalizeViralRubric(candidate.viral_rubric);

  return parseLlmOutput(
    TopicCandidateCard,
    {
      event_identity:
        typeof candidate.event_identity === "string" && candidate.event_identity
          ? candidate.event_identity
          : runtime.input.canonicalName,
      title:
        typeof candidate.title === "string" && candidate.title
          ? candidate.title
          : runtime.input.canonicalName,
      one_line_angle: description,
      family_label:
        typeof candidate.family_label === "string" && candidate.family_label
          ? candidate.family_label
          : typeof rubricMetadata?.family_label === "string" &&
              rubricMetadata.family_label
            ? rubricMetadata.family_label
          : "通用安全槽位",
      scope_label:
        typeof candidate.scope_label === "string" && candidate.scope_label && candidate.scope_label !== "—"
          ? candidate.scope_label
          : typeof rubricMetadata?.scope_label === "string" &&
              rubricMetadata.scope_label
            ? rubricMetadata.scope_label
          : "—",
      estimated_duration_band: "medium",
      why_this_now: typeof candidate.why_this_now === "string" && candidate.why_this_now
        ? candidate.why_this_now
        : "该事件具备可讲张力，适合进入文案阶段。",
      core_conflict: typeof candidate.core_conflict === "string" && candidate.core_conflict
        ? candidate.core_conflict
        : `${runtime.input.canonicalName}中的关键人物在极端压力下做出不可逆的选择，由此引发的连锁反应改变了局势走向。`,
      strong_scene: typeof candidate.strong_scene === "string" && candidate.strong_scene
        ? candidate.strong_scene
        : `${runtime.input.canonicalName}的核心场面涉及决定性时刻的关键选择。`,
      must_cover_preview: completeMustCoverPreview(
        keyElements,
        runtime,
        description,
      ),
      risk_hints: ["真实模型候选已做最小合同归一化"],
      source_hint: typeof candidate.source_hint === "string" && candidate.source_hint
        ? candidate.source_hint
        : "基于历史共识推定",
      recent_usage_hint: typeof candidate.recent_usage_hint === "string" && candidate.recent_usage_hint
        ? candidate.recent_usage_hint
        : "近期未使用",
      viral_rubric: viralRubric,
    },
    "topic_candidate_card_schema_invalid",
  );
}

function normalizeViralRubric(rawRubric: unknown) {
  if (!rawRubric || typeof rawRubric !== "object") {
    return {
      hook_power: "medium",
      novelty_gap: "medium",
      emotion_gap: "medium",
      share_impulse: "medium",
      visual_promise: "medium",
    } as const;
  }

  const rubric = rawRubric as Record<string, unknown>;
  if (
    typeof rubric.hook_power === "string" &&
    typeof rubric.novelty_gap === "string" &&
    typeof rubric.emotion_gap === "string" &&
    typeof rubric.share_impulse === "string" &&
    typeof rubric.visual_promise === "string"
  ) {
    return rubric;
  }

  return {
    hook_power: toRubricLevel(rubric.hook_power ?? rubric.conflict_intensity),
    novelty_gap: toRubricLevel(
      rubric.novelty_gap ??
        rubric.historical_significance ??
        rubric.drama_score,
    ),
    emotion_gap: toRubricLevel(
      rubric.emotion_gap ??
        rubric.cultural_resonance ??
        rubric.conflict_intensity,
    ),
    share_impulse: toRubricLevel(
      rubric.share_impulse ??
        rubric.shareability_score ??
        rubric.dialogue_sharpness,
    ),
    visual_promise: toRubricLevel(
      rubric.visual_promise ??
        rubric.dialogue_sharpness ??
        rubric.drama_score,
    ),
  } as const;
}

function toRubricLevel(value: unknown): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }

  if (typeof value === "number") {
    if (value >= 8) {
      return "high";
    }
    if (value >= 5) {
      return "medium";
    }
    return "low";
  }

  return "medium";
}

async function applyRuntimeCandidates(input: {
  rawOutput: unknown;
  runtime: TopicRecommendationGraphRuntime;
  append: boolean;
}) {
  const { rawOutput, runtime, append } = input;
  const runtimeCandidates = normalizeTopicCandidateOutputs(rawOutput)
    .filter(
      (candidate): candidate is Record<string, unknown> =>
        !!candidate && typeof candidate === "object" && !Array.isArray(candidate),
    );
  const normalizedCandidates = runtimeCandidates
    .map((candidate) => normalizeTopicCandidateCard(candidate, runtime))
    .slice(0, resolveRawCandidateTargetCount(runtime));
  const fieldIssues = runtimeCandidates
    .map((candidate, index) => {
      const missingFields = collectCandidateFieldIssues(candidate);
      if (missingFields.length === 0) {
        return null;
      }

      return {
        candidate_index: index,
        event_identity:
          typeof candidate.event_identity === "string" && candidate.event_identity
            ? candidate.event_identity
            : runtime.input.canonicalName,
        missing_fields: missingFields,
        raw_candidate: candidate,
      } satisfies CandidateFieldIssue;
    })
    .filter((issue): issue is CandidateFieldIssue => issue !== null);

  if (!append) {
    runtime.pendingRawBuilderCandidates = runtimeCandidates.slice(
      0,
      resolveRawCandidateTargetCount(runtime),
    );
    runtime.pendingFieldIssues = fieldIssues;
    runtime.pendingFieldRepair = fieldIssues.length > 0;
    runtime.candidates = normalizedCandidates;
    return {
      fieldIssues,
    };
  }

  const existingFingerprints = new Set(
    runtime.candidates.map((candidate) =>
      buildEventIdentityFingerprint({ eventIdentity: candidate.event_identity, angle: candidate.one_line_angle }),
    ),
  );
  const repairCandidates = normalizedCandidates.filter((candidate) => {
    const fingerprint = buildEventIdentityFingerprint({ eventIdentity: candidate.event_identity, angle: candidate.one_line_angle });
    if (existingFingerprints.has(fingerprint)) {
      return false;
    }
    existingFingerprints.add(fingerprint);
    return true;
  });
  const availableSlots =
    resolveRawCandidateTargetCount(runtime) - runtime.candidates.length;
  const nextCandidates = repairCandidates.slice(0, Math.max(availableSlots, 0));

  runtime.candidates = [...runtime.candidates, ...nextCandidates];
  return {
    fieldIssues,
  };
}

function createTraceNode(
  runtime: TopicRecommendationGraphRuntime,
  node_name: "topic-candidate-generate" | "topic-candidate-repair",
): GraphTraceNodeSummary {
  const node = {
    node_name,
    input_ref: `topic-event:${runtime.input.canonicalName}`,
    output_ref: `topic-candidate-list:${runtime.candidates.length}`,
    failure_reason: null,
  };

  runtime.traceNodes.push(node);

  return node;
}

export function createTopicRecommendationNodes(input: {
  runtime: TopicRecommendationGraphRuntime;
  dependencies: TopicRecommendationGraphDependencies;
}) {
  const { runtime, dependencies } = input;

  return {
    async topicCandidateGenerate() {
      const rawOutput = await dependencies.invokeStructuredPrompt<unknown>({
        promptId: "topic.candidate-builder",
        input: runtime.input,
      });
      await applyRuntimeCandidates({
        rawOutput,
        runtime,
        append: false,
      });
      runtime.slotsInsufficient =
        runtime.candidates.length < resolveRawCandidateTargetCount(runtime);
      const node = createTraceNode(runtime, "topic-candidate-generate");
      const shouldRepair =
        runtime.pendingFieldRepair ||
        (!runtime.input.topic_filter && runtime.slotsInsufficient);

      if (!shouldRepair) {
        await persistTopicCandidates(
          runtime,
          runtime.candidates.slice(0, resolveFinalCandidateCount(runtime)),
        );
      }

      return {
        ...node,
        should_repair: shouldRepair,
      };
    },
    async topicCandidateRepair() {
      runtime.repairTriggered = true;

      if (runtime.pendingFieldRepair) {
        runtime.builderRepairTriggered = true;
        const rawOutput = await dependencies.invokeStructuredPrompt<unknown>({
          promptId: "topic.candidate-builder-repair",
          input: {
            recommendation_seed: runtime.input,
            recent_event_memory:
              (runtime.input as BuildTopicCandidatesInput & {
                recent_event_memory?: unknown[];
              }).recent_event_memory ?? [],
            raw_builder_candidates: runtime.pendingRawBuilderCandidates,
            missing_fields_by_candidate: runtime.pendingFieldIssues.map((issue) => ({
              candidate_index: issue.candidate_index,
              event_identity: issue.event_identity,
              missing_fields: issue.missing_fields,
            })),
          },
        });
        const repairResult = await applyRuntimeCandidates({
          rawOutput,
          runtime,
          append: false,
        });
        runtime.builderDegraded = repairResult.fieldIssues.length > 0;
        runtime.builderRepairPassed = repairResult.fieldIssues.length === 0;
        runtime.pendingFieldRepair = false;
      } else {
        const rawOutput = await dependencies.invokeStructuredPrompt<unknown>({
          promptId: "topic.candidate-builder",
          input: runtime.input,
        });
        await applyRuntimeCandidates({
          rawOutput,
          runtime,
          append: true,
        });
      }

      await persistTopicCandidates(
        runtime,
        runtime.candidates.slice(0, resolveFinalCandidateCount(runtime)),
      );
      runtime.slotsInsufficient =
        runtime.candidates.length < resolveRawCandidateTargetCount(runtime);
      const node = createTraceNode(runtime, "topic-candidate-repair");

      return {
        ...node,
        should_repair: false,
      };
    },
  };
}
