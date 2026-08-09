import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { recommendTopicCandidatesWithTrace } from "../../../backend/src/modules/topic/topic-recommendation.service.js";
import type { TopicCandidateLibraryRepository } from "../../../backend/src/modules/topic/topic-candidate-library.repository.js";
import type { LlmGateway } from "../../../backend/src/runtime/llm/llm-gateway.js";
import { LlmOutputError } from "../../../backend/src/runtime/llm/llm-output-error.js";
import { getProjectStorageProfile } from "../../../backend/src/runtime/trace/project-storage.js";

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

function expectNormalizedFilterContract(
  input: Record<string, unknown>,
  expectedFilter: Record<string, unknown>,
) {
  expect(input).not.toHaveProperty("filters");
  expect(input).toMatchObject({
    topic_filter: expectedFilter,
    topic_filter_fingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
  });
}

describe("topic recommendation filter service trace", () => {
  it("writes meaningful filter diagnostics through the real project run path", async () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "topic-filter-diagnostics-"));
    const previousStorageRoot = process.env.STORAGE_ROOT_DIR;
    process.env.STORAGE_ROOT_DIR = tempRoot;

    try {
      const db = createDbClient();
      const project = await createProject(db, {
        name: "Filtered Recommendation Diagnostics",
      });
      const { gateway } = createCapturingGateway(4);
      const { repository } = createFallbackRepository();

      const result = await recommendTopicCandidatesWithTrace(
        db,
        {
          ...seedInput,
          filters: {
            period_range: {
              start_id: "tang",
              end_id: "song_liao_xia_jin",
              included_period_ids: [
                "tang",
                "five_dynasties_ten_kingdoms",
                "song_liao_xia_jin",
              ],
            },
          },
        },
        {
          projectId: project.id,
          llmGateway: gateway,
          topicCandidateLibraryRepository: repository,
        },
      );

      const runId = String(
        (result.trace as unknown as Record<string, unknown>).run_id,
      );
      const profile = getProjectStorageProfile(project);
      const markdown = readFileSync(
        resolve(profile.topic_runs_dir, runId, "recommendation-diagnostics.md"),
        "utf8",
      );

      expect(markdown).toContain("## Filter");
      expect(markdown).toMatch(/- filter_fingerprint: [a-f0-9]{16}/);
      expect(markdown).toContain("- normalized_filter:");
      expect(markdown).toContain("- filter_match_status: full");
      expect(markdown).toContain("- filter_match_shortfall: 0");
      expect(markdown).toContain("唐、五代十国、宋辽夏金");
    } finally {
      if (previousStorageRoot === undefined) {
        delete process.env.STORAGE_ROOT_DIR;
      } else {
        process.env.STORAGE_ROOT_DIR = previousStorageRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("omits the Filter section from an auto-only project diagnostics file", async () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "topic-auto-diagnostics-"));
    const previousStorageRoot = process.env.STORAGE_ROOT_DIR;
    process.env.STORAGE_ROOT_DIR = tempRoot;

    try {
      const db = createDbClient();
      const project = await createProject(db, {
        name: "Auto Recommendation Diagnostics",
      });
      const { gateway } = createCapturingGateway(4);
      const { repository } = createFallbackRepository();

      const result = await recommendTopicCandidatesWithTrace(
        db,
        {
          ...seedInput,
          filters: { storytelling_lens: "auto" },
        },
        {
          projectId: project.id,
          llmGateway: gateway,
          topicCandidateLibraryRepository: repository,
        },
      );

      const runId = String(
        (result.trace as unknown as Record<string, unknown>).run_id,
      );
      const profile = getProjectStorageProfile(project);
      const markdown = readFileSync(
        resolve(profile.topic_runs_dir, runId, "recommendation-diagnostics.md"),
        "utf8",
      );

      expect(markdown).not.toContain("## Filter");
      expect(markdown).not.toContain("filter_fingerprint");
    } finally {
      if (previousStorageRoot === undefined) {
        delete process.env.STORAGE_ROOT_DIR;
      } else {
        process.env.STORAGE_ROOT_DIR = previousStorageRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("writes filter diagnostics when a project recommendation degrades on LLM output", async () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "topic-error-diagnostics-"));
    const previousStorageRoot = process.env.STORAGE_ROOT_DIR;
    process.env.STORAGE_ROOT_DIR = tempRoot;

    try {
      const db = createDbClient();
      const project = await createProject(db, {
        name: "Degraded Recommendation Diagnostics",
      });
      const gateway: LlmGateway = {
        invokeStructuredPrompt: vi.fn(async () => {
          throw new LlmOutputError("topic_candidate_schema_invalid", {
            cause: "invalid candidate payload",
          });
        }),
        invokeStrictStructured: vi.fn(async () => {
          throw new Error("selector should not run");
        }),
      };

      const result = await recommendTopicCandidatesWithTrace(
        db,
        {
          ...seedInput,
          filters: { central_actor_type: "civil_official" },
        },
        { projectId: project.id, llmGateway: gateway },
      );

      const runId = String(
        (result.trace as unknown as Record<string, unknown>).run_id,
      );
      const profile = getProjectStorageProfile(project);
      const markdown = readFileSync(
        resolve(profile.topic_runs_dir, runId, "recommendation-diagnostics.md"),
        "utf8",
      );

      expect(markdown).toContain("## Filter");
      expect(markdown).toMatch(/- filter_fingerprint: [a-f0-9]{16}/);
      expect(markdown).toContain("- normalized_filter:");
      expect(markdown).toContain("- filter_match_status: insufficient");
      expect(markdown).toContain("- filter_match_shortfall: 4");
    } finally {
      if (previousStorageRoot === undefined) {
        delete process.env.STORAGE_ROOT_DIR;
      } else {
        process.env.STORAGE_ROOT_DIR = previousStorageRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("reports a full match for meaningful filters", async () => {
    const db = createDbClient();
    const { gateway } = createCapturingGateway(4);
    const { repository } = createFallbackRepository();

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        ...seedInput,
        filters: {
          period_range: {
            start_id: "tang",
            end_id: "song_liao_xia_jin",
            included_period_ids: [
              "tang",
              "five_dynasties_ten_kingdoms",
              "song_liao_xia_jin",
            ],
          },
          event_domain: "diplomacy_relations",
          central_actor_type: "religious_actor",
          storytelling_lens: "aftermath",
        },
      },
      {
        llmGateway: gateway,
        topicCandidateLibraryRepository: repository,
      },
    );

    expect(result.diagnostics).toMatchObject({
      filter_fingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
      normalized_filter: {
        period_range: {
          start_id: "tang",
          end_id: "song_liao_xia_jin",
          included_period_ids: [
            "tang",
            "five_dynasties_ten_kingdoms",
            "song_liao_xia_jin",
          ],
        },
        event_domain: "diplomacy_relations",
        central_actor_type: "religious_actor",
        storytelling_lens: "aftermath",
      },
      filter_effect_summary:
        "时期：唐、五代十国、宋辽夏金；事件领域：外交交涉；主角类型：宗教人物；讲述视角：后果追踪",
      filter_match_status: "full",
      filter_match_shortfall: 0,
    });
    expect(result.diagnostics.filter_effect_summary).not.toMatch(
      /diplomacy_relations|religious_actor|aftermath/,
    );
  });

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

    expect(builderInputs).toHaveLength(1);
    for (const builderInput of builderInputs) {
      expectNormalizedFilterContract(builderInput, {
        event_domain: "military_warfare",
        storytelling_lens: "turning_point",
        exclude_terms: ["folklore", "legend"],
      });
    }
    expect(listBySeed).not.toHaveBeenCalled();
    expect(result.candidates.map((candidate) => candidate.title)).toEqual([
      "generated-event-1",
    ]);

    const round = db.recommendationRounds.get("project-filtered")?.at(-1);
    expect(round).toMatchObject({
      filterFingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
      filterJson: {
        event_domain: "military_warfare",
        storytelling_lens: "turning_point",
        exclude_terms: ["folklore", "legend"],
      },
    });
    expect(round?.candidates).toEqual([
      expect.objectContaining({
        filterFingerprint: round?.filterFingerprint,
      }),
    ]);
    const cacheRecords = [...db.candidateCache.values()];
    expect(cacheRecords.length).toBeGreaterThan(0);
    expect(cacheRecords.every(
      (candidate) => candidate.filterFingerprint === round?.filterFingerprint,
    )).toBe(true);
    expect(result.diagnostics).toMatchObject({
      filter_fingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
      normalized_filter: {
        event_domain: "military_warfare",
        storytelling_lens: "turning_point",
        exclude_terms: ["folklore", "legend"],
      },
      filter_match_status: "insufficient",
      filter_match_shortfall: 3,
    });
    expect(result.diagnostics.checks).toContainEqual(
      expect.objectContaining({ code: "topic_candidate_slots_insufficient" }),
    );
  });

  it("keeps normalized filters in a field-repair recommendation seed", async () => {
    const db = createDbClient();
    const builderInputs: Array<Record<string, unknown>> = [];
    const promptIds: string[] = [];
    const invokeStructuredPrompt = vi.fn(async (options) => {
      promptIds.push(options.promptId);
      builderInputs.push(options.input as Record<string, unknown>);
      if (builderInputs.length === 1) {
        return [{
          event_identity: "incomplete-event",
          viral_rubric: generatedCandidate.viral_rubric,
        }] as never;
      }

      return [{
        ...generatedCandidate,
        event_identity: "repaired-event",
        title: "repaired-event",
      }] as never;
    });
    const gateway: LlmGateway = {
      invokeStructuredPrompt,
      invokeStrictStructured: vi.fn(async () => {
        throw new Error("selector should not run for an insufficient pool");
      }),
    };
    const { repository } = createFallbackRepository();

    await recommendTopicCandidatesWithTrace(
      db,
      {
        ...seedInput,
        filters: {
          event_domain: "law_justice",
          storytelling_lens: "origins_analysis",
        },
      },
      {
        projectId: "project-filtered-field-repair",
        llmGateway: gateway,
        topicCandidateLibraryRepository: repository,
      },
    );

    expect(builderInputs).toHaveLength(2);
    expect(promptIds).toEqual([
      "topic.candidate-builder",
      "topic.candidate-builder-repair",
    ]);
    for (const builderInput of builderInputs) {
      expect(builderInput).not.toHaveProperty("filters");
    }

    const repairInput = builderInputs[1];
    expect(repairInput).toHaveProperty("recommendation_seed");
    const recommendationSeed = repairInput?.recommendation_seed as
      | Record<string, unknown>
      | undefined;
    expect(recommendationSeed).toBeDefined();
    expectNormalizedFilterContract(recommendationSeed!, {
      event_domain: "law_justice",
      storytelling_lens: "origins_analysis",
    });
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
    expect(builderInputs).toHaveLength(2);
    expect(listBySeed).toHaveBeenCalledTimes(1);
    expect(result.candidates.map((candidate) => candidate.title)).toEqual([
      "generated-event-1",
      "fallback-event",
    ]);
    const round = db.recommendationRounds.get("project-unfiltered")?.at(-1);
    expect(round?.filterFingerprint).toBeUndefined();
    expect(round?.filterJson).toBeUndefined();
    expect(round?.candidates.every((candidate) => candidate.filterFingerprint === undefined))
      .toBe(true);
    expect([...db.candidateCache.values()].every(
      (candidate) => candidate.filterFingerprint === undefined,
    )).toBe(true);
    expect(result.diagnostics).not.toHaveProperty("filter_fingerprint");
    expect(result.diagnostics).not.toHaveProperty("normalized_filter");
    expect(result.diagnostics).not.toHaveProperty("filter_effect_summary");
    expect(result.diagnostics).not.toHaveProperty("filter_match_status");
    expect(result.diagnostics).not.toHaveProperty("filter_match_shortfall");
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

  it("keeps filter diagnostics when LLM output validation degrades to an empty result", async () => {
    const db = createDbClient();
    const gateway: LlmGateway = {
      invokeStructuredPrompt: vi.fn(async () => {
        throw new LlmOutputError("topic_candidate_schema_invalid", {
          cause: "invalid candidate payload",
        });
      }),
      invokeStrictStructured: vi.fn(async () => {
        throw new Error("selector should not run");
      }),
    };

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        ...seedInput,
        filters: { central_actor_type: "civil_official" },
      },
      { llmGateway: gateway },
    );

    expect(result.candidates).toEqual([]);
    expect(result.diagnostics).toMatchObject({
      filter_fingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
      normalized_filter: { central_actor_type: "civil_official" },
      filter_match_status: "insufficient",
      filter_match_shortfall: 4,
    });
    expect(result.diagnostics.checks).toContainEqual(
      expect.objectContaining({ code: "topic_candidate_slots_insufficient" }),
    );
  });
});
