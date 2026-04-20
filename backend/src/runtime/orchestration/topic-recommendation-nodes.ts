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

export function createTopicRecommendationNodes(input: {
  runtime: TopicRecommendationGraphRuntime;
  dependencies: TopicRecommendationGraphDependencies;
}) {
  const { runtime, dependencies } = input;

  return {
    async topicCandidateGenerate() {
      const runtimeCandidates = await dependencies.invokeStructuredPrompt<unknown[]>({
        promptId: "topic.candidate-builder",
        input: runtime.input,
      });
      const candidates = runtimeCandidates.map((candidate) =>
        TopicCandidateCard.parse(candidate),
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
