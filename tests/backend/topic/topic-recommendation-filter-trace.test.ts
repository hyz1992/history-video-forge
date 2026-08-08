import { describe, expect, it, vi } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { recommendTopicCandidatesWithTrace } from "../../../backend/src/modules/topic/topic-recommendation.service.js";
import type { TopicCandidateLibraryRepository } from "../../../backend/src/modules/topic/topic-candidate-library.repository.js";
import type { LlmGateway } from "../../../backend/src/runtime/llm/llm-gateway.js";

const seedInput = {
  canonicalName: "medieval-history-recommendation",
  summary: "Recommend a focused historical event for narration.",
  coreConflict: "The event needs a clear conflict and consequence.",
  strongScene: "Prefer an event with a concrete decisive scene.",
  sourceHint: "Standard historical records",
  recentUsageHint: "Avoid recently selected events",
  tags: ["medieval", "system_recommendation"],
};

const generatedCandidate = {
  event_identity: "generated-event",
  title: "generated-event",
  one_line_angle: "A generated event angle",
  family_label: "power-decision",
  scope_label: "single-event",
  estimated_duration_band: "medium",
  why_this_now: "This event has not been used recently.",
  core_conflict: "A concrete conflict drives the decision.",
  strong_scene: "The decisive confrontation happens in public.",
  must_cover_preview: ["The decisive confrontation"],
  risk_hints: ["Verify chronology"],
  source_hint: "test source",
  recent_usage_hint: "not recently used",
  viral_rubric: {
    hook_power: "high",
    novelty_gap: "high",
    emotion_gap: "high",
    share_impulse: "high",
    visual_promise: "high",
  },
};

function createCapturingGateway(candidateCount = 1) {
  const builderInputs: Array<Record<string, unknown>> = [];
  const selectorInputs: Array<Record<string, unknown>> = [];
  const gateway: LlmGateway = {
    invokeStructuredPrompt: vi.fn(async (options) => {
      builderInputs.push(options.input as Record<string, unknown>);
      return Array.from({ length: candidateCount }, (_, index) => ({
        ...generatedCandidate,
        event_identity: `generated-event-${index + 1}`,
        title: `generated-event-${index + 1}`,
        one_line_angle: `Generated angle ${index + 1}`,
      })) as never;
    }),
    invokeStrictStructured: vi.fn(async (options) => {
      const input = options.input as Record<string, unknown>;
      selectorInputs.push(input);
      const selectorPool = input.selector_pool as Array<{ candidate_id: string }>;
      return {
        ranked_candidates: selectorPool.map((candidate, index) => ({
          candidate_id: candidate.candidate_id,
          quality_rank: index + 1,
          quality_score: 100 - index,
          deductions: [],
          risk_summary: "test ranking",
          consistency_issue: "none",
        })),
        consistency_risk_notes: [],
      } as never;
    }),
  };

  return { gateway, builderInputs, selectorInputs };
}

function createFallbackRepository() {
  const listBySeed = vi.fn(async () => [
    {
      candidateId: "fallback-1",
      seedFamily: "generic",
      seedProfile: "generic",
      status: "fallback_ready" as const,
      sourceProjectId: "source-project",
      sourceTopicRunId: "source-run",
      eventIdentity: "fallback-event",
      title: "fallback-event",
      oneLineAngle: "A fallback event angle",
    },
  ]);
  const repository: TopicCandidateLibraryRepository = {
    listBySeed,
    save: vi.fn(async () => undefined),
  };

  return { repository, listBySeed };
}

describe("topic recommendation filter service trace", () => {
  it("normalizes meaningful filters, sends one contract to builder, and disables fallback", async () => {
    const db = createDbClient();
    const { gateway, builderInputs } = createCapturingGateway();
    const { repository, listBySeed } = createFallbackRepository();

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        ...seedInput,
        filters: {
          event_domain: "military_warfare",
          storytelling_lens: "turning_point",
          exclude_terms: [" legend ", "folklore", "legend"],
        },
      },
      {
        projectId: "project-filtered",
        llmGateway: gateway,
        topicCandidateLibraryRepository: repository,
        disableFallback: false,
      },
    );

    expect(builderInputs.length).toBeGreaterThan(0);
    expect(builderInputs[0]).toMatchObject({
      topic_filter: {
        event_domain: "military_warfare",
        storytelling_lens: "turning_point",
        exclude_terms: ["folklore", "legend"],
      },
      topic_filter_fingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
    });
    expect(builderInputs[0]).not.toHaveProperty("filters");
    expect(listBySeed).not.toHaveBeenCalled();
    expect(result.candidates.map((candidate) => candidate.title)).toEqual([
      "generated-event-1",
    ]);
  });

  it("keeps the raw filters contract out of the selector prompt input", async () => {
    const db = createDbClient();
    const { gateway, selectorInputs } = createCapturingGateway(4);
    const { repository } = createFallbackRepository();

    await recommendTopicCandidatesWithTrace(
      db,
      {
        ...seedInput,
        filters: {
          event_domain: "political_power",
          storytelling_lens: "key_decision",
        },
      },
      {
        projectId: "project-filtered-selector",
        llmGateway: gateway,
        topicCandidateLibraryRepository: repository,
      },
    );

    expect(selectorInputs).toHaveLength(1);
    const recommendationSeed = selectorInputs[0]?.recommendation_seed as
      | Record<string, unknown>
      | undefined;
    expect(recommendationSeed).toMatchObject({
      topic_filter: {
        event_domain: "political_power",
        storytelling_lens: "key_decision",
      },
      topic_filter_fingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
    });
    expect(recommendationSeed).not.toHaveProperty("filters");
  });

  it.each([
    ["missing", undefined],
    ["empty", {}],
    ["auto only", { storytelling_lens: "auto" }],
    ["blank exclusions", { exclude_terms: [" "] }],
  ])("keeps %s filters equivalent to the legacy fallback behavior", async (_name, filters) => {
    const db = createDbClient();
    const { gateway, builderInputs } = createCapturingGateway();
    const { repository, listBySeed } = createFallbackRepository();
    const input = filters === undefined
      ? seedInput
      : { ...seedInput, filters };

    const result = await recommendTopicCandidatesWithTrace(db, input, {
      projectId: "project-unfiltered",
      llmGateway: gateway,
      topicCandidateLibraryRepository: repository,
    });

    expect(builderInputs[0]).not.toHaveProperty("filters");
    expect(builderInputs[0]).not.toHaveProperty("topic_filter");
    expect(builderInputs[0]).not.toHaveProperty("topic_filter_fingerprint");
    expect(listBySeed).toHaveBeenCalledTimes(1);
    expect(result.candidates.map((candidate) => candidate.title)).toEqual([
      "generated-event-1",
      "fallback-event",
    ]);
  });

  it("preserves an explicit fallback disable option for an auto-only filter", async () => {
    const db = createDbClient();
    const { gateway } = createCapturingGateway();
    const { repository, listBySeed } = createFallbackRepository();

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        ...seedInput,
        filters: { storytelling_lens: "auto" },
      },
      {
        projectId: "project-explicit-disable",
        llmGateway: gateway,
        topicCandidateLibraryRepository: repository,
        disableFallback: true,
      },
    );

    expect(listBySeed).not.toHaveBeenCalled();
    expect(result.candidates.map((candidate) => candidate.title)).toEqual([
      "generated-event-1",
    ]);
  });
});
