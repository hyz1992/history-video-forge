import { TopicCandidateCard } from "../../../../shared/src/index.js";
import type { DbClient } from "../../db/client.js";
import { saveCachedCandidate } from "../../modules/cache/candidate-cache.repository.js";
import type { BuildTopicCandidatesInput } from "../../modules/topic/topic-candidate.builder.js";

export interface TopicRecommendationGraphDependencies {
  invokeStructuredPrompt: <T>(input: {
    promptId: string;
    input: BuildTopicCandidatesInput;
  }) => Promise<T>;
}

export interface TopicRecommendationGraphRuntime {
  db: DbClient;
  input: BuildTopicCandidatesInput;
  projectId?: string | null;
  candidates: ReturnType<typeof TopicCandidateCard.parse>[];
}

function buildCandidateFingerprint(
  canonicalName: string,
  oneLineAngle: string,
): string {
  return `${canonicalName}::${oneLineAngle}`;
}

function normalizeTopicCandidateOutputs(rawOutput: unknown): unknown[] {
  if (Array.isArray(rawOutput)) {
    return rawOutput;
  }

  if (!rawOutput || typeof rawOutput !== "object") {
    throw new TypeError("topic_candidate_output_not_array");
  }

  for (const value of Object.values(rawOutput)) {
    if (Array.isArray(value)) {
      return value;
    }
  }

  throw new TypeError("topic_candidate_output_not_array");
}

function normalizeTopicCandidateCard(
  candidate: Record<string, unknown>,
  runtime: TopicRecommendationGraphRuntime,
) {
  if ("one_line_angle" in candidate) {
    return TopicCandidateCard.parse(candidate);
  }

  const description =
    typeof candidate.description === "string"
      ? candidate.description
      : typeof candidate.summary === "string"
        ? candidate.summary
        : `${runtime.input.canonicalName}具备进入 topic 候选的讲述张力。`;
  const keyElements = Array.isArray(candidate.key_elements)
    ? candidate.key_elements
    : Array.isArray(candidate.core_elements)
      ? candidate.core_elements
      : [];
  const viralRubric = normalizeViralRubric(candidate.viral_rubric);

  return TopicCandidateCard.parse({
    title:
      typeof candidate.title === "string" && candidate.title
        ? candidate.title
        : runtime.input.canonicalName,
    one_line_angle: description,
    family_label:
      typeof candidate.family_label === "string" && candidate.family_label
        ? candidate.family_label
        : "通用安全槽位",
    scope_label:
      typeof candidate.scope_label === "string" && candidate.scope_label
        ? candidate.scope_label
        : "单事件",
    estimated_duration_band: "medium",
    why_this_now: `${runtime.input.recentUsageHint}，且当前具备可讲张力。`,
    core_conflict: runtime.input.coreConflict,
    strong_scene: runtime.input.strongScene,
    must_cover_preview: keyElements.filter(
      (item): item is string => typeof item === "string" && item.length > 0,
    ),
    risk_hints: ["真实模型候选已做最小合同归一化"],
    source_hint: runtime.input.sourceHint,
    recent_usage_hint: runtime.input.recentUsageHint,
    viral_rubric: viralRubric,
  });
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
      const runtimeCandidates = normalizeTopicCandidateOutputs(rawOutput);
      const candidates = runtimeCandidates.map((candidate) =>
        normalizeTopicCandidateCard(
          candidate as Record<string, unknown>,
          runtime,
        ),
      );

      for (const candidate of candidates) {
        await saveCachedCandidate(runtime.db, {
          projectId: runtime.projectId ?? null,
          fingerprint: buildCandidateFingerprint(
            runtime.input.canonicalName,
            candidate.one_line_angle,
          ),
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

      runtime.candidates = candidates;

      return {
        node_name: "topic-candidate-generate" as const,
        input_ref: `topic-event:${runtime.input.canonicalName}`,
        output_ref: `topic-candidate-list:${candidates.length}`,
        failure_reason: null,
      };
    },
  };
}
