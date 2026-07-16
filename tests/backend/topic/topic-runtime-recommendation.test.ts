import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { TopicCandidateCard } from "../../../shared/src/index.js";
import { buildTestAuth } from "../auth/test-utils.js";
import { createDbClient } from "../../../backend/src/db/client.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import * as topicRecommendationServiceModule from "../../../backend/src/modules/topic/topic-recommendation.service.js";
import { saveCachedCandidate } from "../../../backend/src/modules/cache/candidate-cache.repository.js";
import { normalizeEventInput } from "../../../backend/src/modules/topic/event-normalizer.js";
import { createTopicCandidateLibraryRepository } from "../../../backend/src/modules/topic/topic-candidate-library.repository.js";
import { parseTopicCandidateLibraryJsonDocument } from "../../../backend/src/modules/topic/topic-candidate-library-json.codec.js";
import { buildTopicCandidateLibraryDirectory } from "../../../backend/src/modules/topic/topic-candidate-library.path.js";
import {
  createLlmGateway as createBaseLlmGateway,
  type InvokeStrictStructuredOptions,
  type InvokeStructuredPromptOptions,
  type LlmGateway,
} from "../../../backend/src/runtime/llm/llm-gateway.js";
import {
  createOpenAiCompatibleProvider,
  type OpenAiCompatibleInvokeRequest,
} from "../../../backend/src/runtime/llm/openai-compatible-provider.js";
import { createPromptRegistry } from "../../../backend/src/runtime/prompts/prompt-registry.js";
import type {
  StrictStructuredInvocation,
  StructuredPromptInvocation,
  StructuredPromptProvider,
} from "../../../backend/src/runtime/llm/provider-contract.js";
import { getProjectStorageProfile } from "../../../backend/src/runtime/trace/project-storage.js";
import {
  parseStrictSelectorDecision,
  recommendTopicCandidates,
  recommendTopicCandidatesWithTrace,
} from "../../../backend/src/modules/topic/topic-recommendation.service.js";

const runtimeCandidate = {
  event_identity: "鏅忓瓙浣挎",
  title: "晏子使楚",
  one_line_angle: "晏子使楚真正抓人的，不是出使本身，而是当场连续顶回压场。",
  family_label: "外交压场型",
  scope_label: "单事件",
  estimated_duration_band: "medium",
  why_this_now: "近期未出现同 event_id，且当前具备可讲张力。",
  core_conflict: "楚王当众压场，晏子必须当场顶回。",
  strong_scene: "楚王连续压场，晏子一句句顶回去。",
  must_cover_preview: ["楚王连续压场，晏子一句句顶回去。"],
  risk_hints: ["避免扩成下游阶段对象"],
  source_hint: "《晏子春秋》",
  recent_usage_hint: "近期未出现同 event_id",
  viral_rubric: {
    hook_power: "high",
    novelty_gap: "high",
    emotion_gap: "high",
    share_impulse: "high",
    visual_promise: "high",
  },
};

type SelectorApiInput = {
  selector_pool?: Array<{ candidate_id: string }>;
  review_pool?: Array<{ candidate_id: string; title: string }>;
  missing_fields_by_candidate?: Array<{ missing_fields: string[] }>;
};

type LightReviewIssue =
  | "none"
  | "actor_role_mismatch"
  | "action_event_mismatch"
  | "cause_outcome_mismatch"
  | "scope_boundary_mismatch"
  | "language_contamination"
  | "overclaim_or_ambiguity";

function createRuntimeCandidate(title: string, angle: string) {
  return {
    ...runtimeCandidate,
    event_identity: title,
    title,
    one_line_angle: angle,
  };
}

function createSelectorScorecard(candidateId: string, qualityRank: number) {
  return {
    candidate_id: candidateId,
    quality_rank: qualityRank,
    quality_score: Math.max(1, 100 - qualityRank),
    deductions: [
      {
        axis: "angle_freshness",
        points_lost: qualityRank,
        reason: `rank ${qualityRank} deduction`,
      },
    ],
    risk_summary: `rank ${qualityRank} risk`,
    consistency_status: "pass",
    primary_consistency_issue: "none",
    consistency_note: "标题、切口和三段推进互相支持",
  };
}

function createCompactSelectorScorecard(candidateId: string, qualityRank: number) {
  return {
    candidate_id: candidateId,
    quality_rank: qualityRank,
    quality_score: Math.max(1, 100 - qualityRank),
    deductions: [
      {
        axis: "angle_freshness",
        points_lost: qualityRank,
        reason: `rank ${qualityRank} deduction`,
      },
    ],
    risk_summary: `rank ${qualityRank} risk`,
    consistency_issue: "none",
  };
}

function createCompactSelectorDecision(...candidateIds: string[]) {
  return {
    ranked_candidates: candidateIds.map((candidateId, index) =>
      createCompactSelectorScorecard(candidateId, index + 1),
    ),
    consistency_risk_notes: [] as Array<{
      candidate_id: string;
      note: string;
    }>,
  };
}

function createSelectorDecision(...candidateIds: string[]) {
  return createCompactSelectorDecision(...candidateIds);
}

function createSelectorDecisionFromPool(
  selectorPool: Array<{ candidate_id: string }>,
  preferredCandidateIds: string[] = [],
) {
  const poolIds = selectorPool.map((candidate) => candidate.candidate_id);
  const orderedIds = [
    ...preferredCandidateIds,
    ...poolIds.filter((candidateId) => !preferredCandidateIds.includes(candidateId)),
  ];

  return createSelectorDecision(...orderedIds);
}

function createIncompleteBuilderCandidate(eventIdentity: string) {
  return {
    event_identity: eventIdentity,
    viral_rubric: runtimeCandidate.viral_rubric,
  };
}

function envelope(payload: unknown) {
  const content = typeof payload === "string" ? payload : JSON.stringify(payload);
  return { rawOutput: content, content, metadata: {} };
}

function createGatewayWithSelectorResponses(
  builderOutputs: Array<unknown>,
  selectorOutputs?: Array<unknown>,
) {
  let builderCallIndex = 0;
  let selectorCallIndex = 0;
  const invokeApi = vi.fn(async (request: OpenAiCompatibleInvokeRequest) => {
    const { operationName } = request;
    const input = request.input as SelectorApiInput;

    if (operationName === "topic.light-review") {
      return envelope(createLightReviewDecision(input.review_pool ?? []));
    }

    if (operationName === "topic.selector") {
      const selectedIds =
        selectorOutputs?.[selectorCallIndex] ??
        (input.selector_pool ?? [])
          .map((candidate) => candidate.candidate_id);
      selectorCallIndex += 1;
      return envelope(
        typeof selectedIds === "string"
          ? selectedIds
          : Array.isArray(selectedIds)
            ? createSelectorDecisionFromPool(input.selector_pool ?? [], selectedIds)
            : selectedIds,
      );
    }

    const builderOutput =
      builderOutputs[builderCallIndex] ?? builderOutputs[builderOutputs.length - 1];
    builderCallIndex += 1;

    return envelope(builderOutput);
  });
  const defaultGateway = createLlmGateway({
    registry: createPromptRegistry(),
    provider: createOpenAiCompatibleProvider({
      model: "glm-4.5",
      invokeApi,
    }),
  });
  const gateway = {
    invokeStructuredPrompt: <T>(options: InvokeStructuredPromptOptions) =>
      defaultGateway.invokeStructuredPrompt<T>(options),
  } as LlmGateway;

  return {
    gateway,
    invokeApi,
  };
}

function createLightReviewDecision(
  reviewPool: Array<{ candidate_id: string }>,
  issueByCandidateId: Record<string, LightReviewIssue> = {},
) {
  return {
    candidate_reviews: reviewPool.map((candidate) => {
      const consistencyIssue =
        issueByCandidateId[candidate.candidate_id] ?? issueByCandidateId["*"] ?? "none";

      return {
        candidate_id: candidate.candidate_id,
        consistency_issue: consistencyIssue,
        note: consistencyIssue === "none" ? "" : `${consistencyIssue} review risk`,
      };
    }),
  };
}

function createLlmGateway(
  options: Parameters<typeof createBaseLlmGateway>[0],
): LlmGateway {
  const gateway = createBaseLlmGateway(options);

  return {
    invokeStructuredPrompt: <T>(request: InvokeStructuredPromptOptions) => {
      if (request.promptId === "topic.light-review") {
        const reviewInput = request.input as SelectorApiInput;
        return Promise.resolve(
          createLightReviewDecision(reviewInput.review_pool ?? []) as T,
        );
      }

      return gateway.invokeStructuredPrompt<T>(request);
    },
    invokeStrictStructured: <T>(request: InvokeStrictStructuredOptions<T>) => {
      if (request.promptId === "topic.light-review") {
        const reviewInput = request.input as SelectorApiInput;
        return Promise.resolve(
          request.parse(createLightReviewDecision(reviewInput.review_pool ?? [])),
        );
      }

      return gateway.invokeStrictStructured<T>(request);
    },
  };
}

function createGatewayWithLightReviewResponses(input: {
  builderOutputs: unknown[];
  reviewIssueMaps?: Array<Record<string, LightReviewIssue>>;
}) {
  let builderCallIndex = 0;
  let reviewCallIndex = 0;
  const operationNames: string[] = [];
  const reviewInputs: SelectorApiInput[] = [];
  const invokeStructuredPrompt = vi.fn(
    async <T>(options: InvokeStructuredPromptOptions): Promise<T> => {
      const promptId = options.promptId;
      operationNames.push(promptId);

      if (promptId === "topic.light-review") {
        const reviewInput = options.input as SelectorApiInput;
        reviewInputs.push(reviewInput);
        const decision = createLightReviewDecision(
          reviewInput.review_pool ?? [],
          input.reviewIssueMaps?.[reviewCallIndex] ?? {},
        );
        reviewCallIndex += 1;
        return decision as T;
      }

      const builderOutput = input.builderOutputs[builderCallIndex];
      builderCallIndex += 1;
      return builderOutput as T;
    },
  );
  const invokeStrictStructured = vi.fn(
    async <T>(options: InvokeStrictStructuredOptions<T>): Promise<T> => {
      operationNames.push(options.promptId);
      if (options.promptId !== "topic.light-review") {
        throw new Error(`unexpected strict prompt: ${options.promptId}`);
      }

      const reviewInput = options.input as SelectorApiInput;
      reviewInputs.push(reviewInput);
      const decision = createLightReviewDecision(
        reviewInput.review_pool ?? [],
        input.reviewIssueMaps?.[reviewCallIndex] ?? {},
      );
      reviewCallIndex += 1;
      return options.parse(decision);
    },
  );
  const gateway: LlmGateway = {
    invokeStructuredPrompt,
    invokeStrictStructured,
  };

  return {
    gateway,
    operationNames,
    reviewInputs,
    invokeStructuredPrompt,
    invokeStrictStructured,
  };
}

function uniqueEventFingerprints(
  candidates: Array<{ title: string; one_line_angle: string }>,
) {
  return [
    ...new Set(
      candidates.map((candidate) =>
        `${candidate.title.trim()}::${candidate.one_line_angle.trim()}`,
      ),
    ),
  ];
}

function uniqueEventIdentities(
  candidates: Array<{ normalized_event_identity: string }>,
) {
  return [
    ...new Set(
      candidates.map((candidate) => candidate.normalized_event_identity.trim()),
    ),
  ];
}

async function seedRecentEventUsage(
  db: ReturnType<typeof createDbClient>,
  canonicalName: string,
  projectId = "project-1",
) {
  const normalized = await normalizeEventInput(db, {
    rawInput: canonicalName,
    sourceType: "system_recommendation",
  });

  await saveCachedCandidate(db, {
    projectId,
    eventRegistryEntryId: normalized.event.id,
    fingerprint: `${canonicalName.trim()}::recent-usage`,
    oneLineAngle: "recently used candidate angle",
    familyLabel: runtimeCandidate.family_label,
    scopeLabel: runtimeCandidate.scope_label,
    viralRubricJson: runtimeCandidate.viral_rubric,
    estimatedDurationBandJson: runtimeCandidate.estimated_duration_band,
    strongScene: runtimeCandidate.strong_scene,
    coreConflict: runtimeCandidate.core_conflict,
    mustCoverPreviewJson: runtimeCandidate.must_cover_preview,
  });
}

async function seedRawCandidateCacheEntry(
  db: ReturnType<typeof createDbClient>,
  canonicalName: string,
  angle: string,
  projectId = "project-1",
) {
  await saveCachedCandidate(db, {
    projectId,
    fingerprint: `${canonicalName.trim().toLowerCase()}::${angle.trim().toLowerCase()}`,
    oneLineAngle: angle,
    familyLabel: runtimeCandidate.family_label,
    scopeLabel: runtimeCandidate.scope_label,
    viralRubricJson: runtimeCandidate.viral_rubric,
    estimatedDurationBandJson: runtimeCandidate.estimated_duration_band,
    strongScene: runtimeCandidate.strong_scene,
    coreConflict: runtimeCandidate.core_conflict,
    mustCoverPreviewJson: runtimeCandidate.must_cover_preview,
  });
}

describe("topic runtime recommendation", () => {
  it("derives the existing internal scorecard from compact selector verdicts", () => {
    const decision = createCompactSelectorDecision(
      "selector_candidate_1",
      "selector_candidate_2",
    );
    Object.assign(decision.ranked_candidates[1], {
      consistency_issue: "actor_role_mismatch",
    });
    decision.consistency_risk_notes.push({
      candidate_id: "selector_candidate_2",
      note: "标题把执行者写成了结果承担者",
    });

    const result = parseStrictSelectorDecision(decision);

    expect(result.ranked_candidates).toEqual([
      expect.objectContaining({
        consistency_status: "pass",
        primary_consistency_issue: "none",
        consistency_note: "",
      }),
      expect.objectContaining({
        consistency_status: "risk",
        primary_consistency_issue: "actor_role_mismatch",
        consistency_note: "标题把执行者写成了结果承担者",
      }),
    ]);
  });

  it.each([
    ["consistency_issue"],
  ])("rejects compact selector scorecards missing %s", (missingField) => {
    const scorecard = {
      ...createCompactSelectorScorecard("selector_candidate_1", 1),
    } as Record<string, unknown>;
    delete scorecard[missingField];

    expect(() =>
      parseStrictSelectorDecision({
        ranked_candidates: [scorecard],
        consistency_risk_notes: [],
      }),
    ).toThrow("strict_selector_bad_scorecard");
  });

  it("rejects compact selector verdicts without the required risk note array", () => {
    expect(() =>
      parseStrictSelectorDecision({
        ranked_candidates: [
          createCompactSelectorScorecard("selector_candidate_1", 1),
        ],
      }),
    ).toThrow("topic_selector_strict_schema_failed");
  });

  it("rejects invalid compact selector issue values", () => {
    expect(() =>
      parseStrictSelectorDecision({
        ranked_candidates: [
          {
            ...createCompactSelectorScorecard("selector_candidate_1", 1),
            consistency_issue: "invented_issue",
          },
        ],
        consistency_risk_notes: [],
      }),
    ).toThrow("strict_selector_bad_scorecard");
  });

  it.each([
    ["risk without note", [], "selector_candidate_1", "actor_role_mismatch"],
    [
      "pass with note",
      [{ candidate_id: "selector_candidate_1", note: "冗余说明" }],
      "selector_candidate_1",
      "none",
    ],
    [
      "note for unknown verdict",
      [{ candidate_id: "selector_candidate_999", note: "未知候选" }],
      "selector_candidate_1",
      "none",
    ],
    [
      "empty risk note",
      [{ candidate_id: "selector_candidate_1", note: "   " }],
      "selector_candidate_1",
      "actor_role_mismatch",
    ],
  ])("rejects %s", (_label, notes, candidateId, issue) => {
    expect(() =>
      parseStrictSelectorDecision({
        ranked_candidates: [
          {
            ...createCompactSelectorScorecard(candidateId, 1),
            consistency_issue: issue,
          },
        ],
        consistency_risk_notes: notes,
      }),
    ).toThrow("strict_selector_bad_scorecard");
  });

  it("rejects duplicate risk note ids", () => {
    expect(() =>
      parseStrictSelectorDecision({
        ranked_candidates: [
          {
            ...createCompactSelectorScorecard("selector_candidate_1", 1),
            consistency_issue: "actor_role_mismatch",
          },
        ],
        consistency_risk_notes: [
          { candidate_id: "selector_candidate_1", note: "第一条" },
          { candidate_id: "selector_candidate_1", note: "第二条" },
        ],
      }),
    ).toThrow("strict_selector_bad_scorecard");
  });

  it.each([
    ["duplicate candidate ids", ["selector_candidate_1", "selector_candidate_1"], [1, 2]],
    ["duplicate quality ranks", ["selector_candidate_1", "selector_candidate_2"], [1, 1]],
    ["non-contiguous quality ranks", ["selector_candidate_1", "selector_candidate_2"], [1, 3]],
  ])("rejects %s", (_label, candidateIds, qualityRanks) => {
    expect(() =>
      parseStrictSelectorDecision({
        ranked_candidates: candidateIds.map((candidateId, index) => ({
          ...createCompactSelectorScorecard(candidateId, qualityRanks[index]!),
          quality_rank: qualityRanks[index],
        })),
        consistency_risk_notes: [],
      }),
    ).toThrow("strict_selector_bad_scorecard");
  });

  it("rejects the legacy three-field provider verdict", () => {
    expect(() =>
      parseStrictSelectorDecision({
        ranked_candidates: [createSelectorScorecard("selector_candidate_1", 1)],
        consistency_risk_notes: [],
      }),
    ).toThrow("strict_selector_bad_scorecard");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("uses topic.light-review instead of topic.selector on the normal path", async () => {
    const db = createDbClient();
    const { gateway, operationNames, reviewInputs } =
      createGatewayWithLightReviewResponses({
        builderOutputs: [[
          createRuntimeCandidate("event-a", "angle-a"),
          createRuntimeCandidate("event-b", "angle-b"),
          createRuntimeCandidate("event-c", "angle-c"),
          createRuntimeCandidate("event-d", "angle-d"),
        ]],
      });

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "normal light review path",
        coreConflict: "all four candidates are internally consistent",
        strongScene: "the four candidates reach the light review together",
        sourceHint: "test",
        recentUsageHint: "none",
      },
      { llmGateway: gateway },
    );

    expect(result.candidates).toHaveLength(4);
    expect(operationNames).toEqual([
      "topic.candidate-builder",
      "topic.light-review",
    ]);
    expect(operationNames).not.toContain("topic.selector");
    expect(reviewInputs[0]?.review_pool).toHaveLength(4);
    expect(result.selector_trace).toBeNull();
    expect(result.review_trace).toMatchObject({
      reviewed_candidate_ids: [
        "selector_candidate_1",
        "selector_candidate_2",
        "selector_candidate_3",
        "selector_candidate_4",
      ],
      accepted_candidate_ids: [
        "selector_candidate_1",
        "selector_candidate_2",
        "selector_candidate_3",
        "selector_candidate_4",
      ],
      rejected_candidates: [],
      refill_attempts: 0,
      initial_candidate_count: 4,
      initial_review_pass_count: 4,
      refill_triggered: false,
      refill_candidate_count: 0,
      refill_review_pass_count: 0,
      final_candidate_count: 4,
      zero_eligible_candidate: false,
    });
    expect(result.diagnostics.candidate_preview_trace?.reviewed_candidates).toHaveLength(4);
  });

  it("uses the target strict tool for topic.light-review", async () => {
    const db = createDbClient();
    const structuredRequests: StructuredPromptInvocation[] = [];
    const strictRequests: StrictStructuredInvocation<unknown>[] = [];
    const builderCandidates = [
      createRuntimeCandidate("event-a", "angle-a"),
      createRuntimeCandidate("event-b", "angle-b"),
      createRuntimeCandidate("event-c", "angle-c"),
      createRuntimeCandidate("event-d", "angle-d"),
    ];
    const provider: StructuredPromptProvider = {
      async invokeStructuredPrompt<T>(request: StructuredPromptInvocation): Promise<T> {
        structuredRequests.push(request);
        return builderCandidates as T;
      },
      async invokeStrictStructured<T>(request: StrictStructuredInvocation<T>): Promise<T> {
        strictRequests.push(request as StrictStructuredInvocation<unknown>);
        const reviewPool = (request.input as SelectorApiInput).review_pool ?? [];
        return request.parse(createLightReviewDecision(reviewPool));
      },
    };
    const gateway = createBaseLlmGateway({
      registry: createPromptRegistry(),
      provider,
    });

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "strict light review contract",
        coreConflict: "the target review tool must cover all candidates",
        strongScene: "the provider receives the named review function",
        sourceHint: "test",
        recentUsageHint: "none",
      },
      { llmGateway: gateway },
    );

    expect(result.candidates).toHaveLength(4);
    expect(structuredRequests.map((request) => [
      request.operationName,
      request.prompt.metadata.id,
    ])).toEqual([["topic.candidate-builder", "topic.candidate-builder"]]);
    expect(strictRequests).toHaveLength(1);
    expect(strictRequests[0]).toMatchObject({
      operationName: "topic.light-review",
      prompt: { metadata: { id: "topic.light-review" } },
      schema: { name: "review_topic_candidates" },
      options: {
        strategy: "tool_call",
        toolChoice: "target_function",
      },
    });
  });

  it("falls back once to structured topic.light-review on strict capability errors", async () => {
    const db = createDbClient();
    const structuredRequests: StructuredPromptInvocation[] = [];
    const strictRequests: StrictStructuredInvocation<unknown>[] = [];
    const builderCandidates = [
      createRuntimeCandidate("event-a", "angle-a"),
      createRuntimeCandidate("event-b", "angle-b"),
      createRuntimeCandidate("event-c", "angle-c"),
      createRuntimeCandidate("event-d", "angle-d"),
    ];
    const provider: StructuredPromptProvider = {
      async invokeStructuredPrompt<T>(request: StructuredPromptInvocation): Promise<T> {
        structuredRequests.push(request);
        if (request.operationName === "topic.light-review") {
          const reviewPool = (request.input as SelectorApiInput).review_pool ?? [];
          return createLightReviewDecision(reviewPool) as T;
        }
        return builderCandidates as T;
      },
      async invokeStrictStructured<T>(request: StrictStructuredInvocation<T>): Promise<T> {
        strictRequests.push(request as StrictStructuredInvocation<unknown>);
        throw new Error("strict_structured_target_tool_mismatch");
      },
    };
    const gateway = createBaseLlmGateway({
      registry: createPromptRegistry(),
      provider,
    });

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "controlled structured fallback",
        coreConflict: "a strict capability error may trigger exactly one fallback",
        strongScene: "the fallback keeps the same light-review operation",
        sourceHint: "test",
        recentUsageHint: "none",
      },
      { llmGateway: gateway },
    );

    expect(result.candidates).toHaveLength(4);
    expect(strictRequests).toHaveLength(1);
    expect(structuredRequests.map((request) => [
      request.operationName,
      request.prompt.metadata.id,
    ])).toEqual([
      ["topic.candidate-builder", "topic.candidate-builder"],
      ["topic.light-review", "topic.light-review"],
    ]);
    expect(structuredRequests.some(
      (request) => request.operationName === "topic.selector",
    )).toBe(false);
  });

  it("refills once and reviews only new candidates", async () => {
    const db = createDbClient();
    const { gateway, operationNames, reviewInputs } =
      createGatewayWithLightReviewResponses({
        builderOutputs: [
          [
            createRuntimeCandidate("event-a", "angle-a"),
            createRuntimeCandidate("event-b", "angle-b"),
            createRuntimeCandidate("event-c", "angle-c"),
            createRuntimeCandidate("event-d", "angle-d"),
          ],
          [
            createRuntimeCandidate("event-a", "angle-a-duplicate"),
            createRuntimeCandidate("event-b", "angle-b-duplicate"),
            createRuntimeCandidate("event-e", "angle-e"),
            createRuntimeCandidate("event-f", "angle-f"),
          ],
        ],
        reviewIssueMaps: [
          {
            selector_candidate_3: "actor_role_mismatch",
            selector_candidate_4: "cause_outcome_mismatch",
          },
          {},
        ],
      });

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "refill only the missing eligible slots",
        coreConflict: "two initial candidates fail the semantic review",
        strongScene: "the second builder call supplies two new events",
        sourceHint: "test",
        recentUsageHint: "none",
      },
      { llmGateway: gateway },
    );

    expect(result.candidates.map((candidate) => candidate.title)).toEqual([
      "event-a",
      "event-b",
      "event-e",
      "event-f",
    ]);
    expect(operationNames.filter((name) => name === "topic.candidate-builder")).toHaveLength(2);
    expect(operationNames.filter((name) => name === "topic.light-review")).toHaveLength(2);
    expect(reviewInputs).toHaveLength(2);
    expect(reviewInputs[1]?.review_pool?.map((candidate) => candidate.title)).toEqual([
      "event-e",
      "event-f",
    ]);
    expect(result.review_trace.refill_attempts).toBe(1);
    expect(result.review_trace).toMatchObject({
      initial_candidate_count: 4,
      initial_review_pass_count: 2,
      refill_triggered: true,
      refill_candidate_count: 2,
      refill_review_pass_count: 2,
      final_candidate_count: 4,
      zero_eligible_candidate: false,
    });
  });

  it("returns existing eligible candidates after refill still falls short", async () => {
    const db = createDbClient();
    const { gateway } = createGatewayWithLightReviewResponses({
      builderOutputs: [
        [
          createRuntimeCandidate("event-a", "angle-a"),
          createRuntimeCandidate("event-b", "angle-b"),
          createRuntimeCandidate("event-c", "angle-c"),
          createRuntimeCandidate("event-d", "angle-d"),
        ],
        [
          createRuntimeCandidate("event-e", "angle-e"),
          createRuntimeCandidate("event-f", "angle-f"),
          createRuntimeCandidate("event-g", "angle-g"),
          createRuntimeCandidate("event-h", "angle-h"),
        ],
      ],
      reviewIssueMaps: [
        {
          selector_candidate_2: "actor_role_mismatch",
          selector_candidate_3: "action_event_mismatch",
          selector_candidate_4: "scope_boundary_mismatch",
        },
        { "*": "overclaim_or_ambiguity" },
      ],
    });

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "keep the one eligible candidate after refill risks",
        coreConflict: "partial success must not become a batch failure",
        strongScene: "only the first candidate survives both review rounds",
        sourceHint: "test",
        recentUsageHint: "none",
      },
      { llmGateway: gateway, projectId: "project-1" },
    );

    expect(result.candidates.map((candidate) => candidate.title)).toEqual(["event-a"]);
    expect(result.review_trace.accepted_candidate_ids).toEqual(["selector_candidate_1"]);
    expect(result.review_trace).toMatchObject({
      initial_candidate_count: 4,
      initial_review_pass_count: 1,
      refill_triggered: true,
      refill_candidate_count: 3,
      refill_review_pass_count: 0,
      final_candidate_count: 1,
      zero_eligible_candidate: false,
    });
    expect(db.recommendationRounds.get("project-1")?.[0]?.candidates).toEqual([
      expect.objectContaining({ eventIdentity: "event-a", title: "event-a" }),
    ]);
    const persistedCandidates = [...db.candidateCache.values()].filter(
      (candidate) => candidate.eventRegistryEntryId,
    );
    expect(persistedCandidates).toEqual([
      expect.objectContaining({ eventIdentity: "event-a" }),
    ]);
    expect(persistedCandidates.map((candidate) => candidate.eventIdentity)).not.toEqual(
      expect.arrayContaining([
        "event-b",
        "event-c",
        "event-d",
        "event-e",
        "event-f",
        "event-g",
        "event-h",
      ]),
    );
  });

  it("preserves an accepted same-event angle when refill mixes in other events", async () => {
    const db = createDbClient();
    const { gateway, reviewInputs } = createGatewayWithLightReviewResponses({
      builderOutputs: [
        [
          createRuntimeCandidate("shared-event", "angle-a"),
          createRuntimeCandidate("shared-event", "angle-b"),
          createRuntimeCandidate("shared-event", "angle-c"),
          createRuntimeCandidate("shared-event", "angle-d"),
        ],
        [
          createRuntimeCandidate("shared-event", "angle-e"),
          createRuntimeCandidate("event-b", "angle-b"),
          createRuntimeCandidate("event-c", "angle-c"),
          createRuntimeCandidate("event-d", "angle-d"),
        ],
      ],
      reviewIssueMaps: [
        {
          selector_candidate_1: "actor_role_mismatch",
          selector_candidate_2: "action_event_mismatch",
          selector_candidate_3: "scope_boundary_mismatch",
        },
        { "*": "overclaim_or_ambiguity" },
      ],
    });

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "shared-event",
        summary: "keep an accepted angle stable across refill",
        coreConflict: "mixed refill events must not rewrite the initial pool",
        strongScene: "the fourth initial angle remains eligible",
        sourceHint: "test",
        recentUsageHint: "none",
      },
      { llmGateway: gateway },
    );

    expect(result.candidates.map((candidate) => candidate.one_line_angle)).toEqual([
      "angle-d",
    ]);
    expect(result.review_trace.accepted_candidate_ids).toEqual([
      "selector_candidate_4",
    ]);
    expect(reviewInputs[1]?.review_pool?.map((candidate) => candidate.title)).toEqual([
      "event-b",
      "event-c",
      "event-d",
    ]);
  });

  it("does not reopen a multi-event initial identity during same-event refill", async () => {
    const db = createDbClient();
    const { gateway, reviewInputs } = createGatewayWithLightReviewResponses({
      builderOutputs: [
        [
          createRuntimeCandidate("event-a", "angle-a"),
          createRuntimeCandidate("event-b", "angle-b"),
          createRuntimeCandidate("event-c", "angle-c"),
          createRuntimeCandidate("event-d", "angle-d"),
        ],
        [
          createRuntimeCandidate("event-a", "angle-a-2"),
          createRuntimeCandidate("event-a", "angle-a-3"),
          createRuntimeCandidate("event-a", "angle-a-4"),
          createRuntimeCandidate("event-a", "angle-a-5"),
        ],
      ],
      reviewIssueMaps: [
        {
          selector_candidate_2: "actor_role_mismatch",
          selector_candidate_3: "action_event_mismatch",
          selector_candidate_4: "scope_boundary_mismatch",
        },
      ],
    });

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "multi-event-seed",
        summary: "refill must stay deduplicated against the initial identities",
        coreConflict: "new angles cannot reopen an initial event in a multi-event pool",
        strongScene: "only the accepted initial event remains",
        sourceHint: "test",
        recentUsageHint: "none",
      },
      { llmGateway: gateway },
    );

    expect(result.candidates.map((candidate) => candidate.title)).toEqual([
      "event-a",
    ]);
    expect(result.review_trace.refill_candidate_count).toBe(0);
    expect(reviewInputs).toHaveLength(1);
  });

  it("throws only when no eligible candidate remains after refill", async () => {
    const db = createDbClient();
    const { gateway, operationNames } = createGatewayWithLightReviewResponses({
      builderOutputs: [
        [
          createRuntimeCandidate("event-a", "angle-a"),
          createRuntimeCandidate("event-b", "angle-b"),
          createRuntimeCandidate("event-c", "angle-c"),
          createRuntimeCandidate("event-d", "angle-d"),
        ],
        [
          createRuntimeCandidate("event-e", "angle-e"),
          createRuntimeCandidate("event-f", "angle-f"),
          createRuntimeCandidate("event-g", "angle-g"),
          createRuntimeCandidate("event-h", "angle-h"),
        ],
      ],
      reviewIssueMaps: [
        { "*": "actor_role_mismatch" },
        { "*": "cause_outcome_mismatch" },
      ],
    });

    const recommendation = recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "all candidates fail both review rounds",
        coreConflict: "zero eligible candidates must fail closed",
        strongScene: "neither review round admits a candidate",
        sourceHint: "test",
        recentUsageHint: "none",
      },
      { llmGateway: gateway },
    );
    await expect(recommendation).rejects.toMatchObject({
      message: "topic_review_no_eligible_candidates",
      review_trace: {
        initial_candidate_count: 4,
        initial_review_pass_count: 0,
        refill_triggered: true,
        refill_candidate_count: 4,
        refill_review_pass_count: 0,
        final_candidate_count: 0,
        zero_eligible_candidate: true,
      },
    });
    expect(operationNames.filter((name) => name === "topic.candidate-builder")).toHaveLength(2);
    expect(operationNames.filter((name) => name === "topic.light-review")).toHaveLength(2);
  });

  it("persists raw, selector pool, and final selected candidates into the topic candidate library", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Topic Candidate Library Persistence",
    });
    const tempRootDir = mkdtempSync(resolve(tmpdir(), "topic-candidate-library-runtime-"));
    const repository = createTopicCandidateLibraryRepository({
      rootDir: tempRootDir,
    });
    const { gateway } = createGatewayWithSelectorResponses([
      [
        createRuntimeCandidate("event-a", "angle-a"),
        createRuntimeCandidate("event-b", "angle-b"),
        createRuntimeCandidate("event-c", "angle-c"),
        createRuntimeCandidate("event-d", "angle-d"),
        createRuntimeCandidate("event-e", "angle-e"),
        createRuntimeCandidate("event-f", "angle-f"),
        createRuntimeCandidate("event-g", "angle-g"),
        createRuntimeCandidate("event-h", "angle-h"),
      ],
    ]);

    try {
      await recommendTopicCandidatesWithTrace(
        db,
        {
          canonicalName: "Han Court Showdown",
          familyHint: "History Diplomacy",
          summary: "persist candidates into the text library after one recommendation round",
          coreConflict: "raw, selector pool, and final candidates should all be archived",
          strongScene: "the runtime should write candidate documents after recommendation completes",
          sourceHint: "test",
          recentUsageHint: "no recent repeats",
        },
        {
          llmGateway: gateway,
          projectId: project.id,
          topicCandidateLibraryRepository: repository,
        },
      );

      const seedDirectory = buildTopicCandidateLibraryDirectory({
        rootDir: tempRootDir,
        seedFamily: "History Diplomacy",
        seedProfile: "Han Court Showdown",
      });
      const directoryEntries = readdirSync(seedDirectory).sort();
      const candidatesJsonPath = resolve(seedDirectory, "candidates.json");
      const document = parseTopicCandidateLibraryJsonDocument(
        readFileSync(candidatesJsonPath, "utf8"),
      );

      expect(directoryEntries).toEqual(["candidates.json"]);
      expect(existsSync(candidatesJsonPath)).toBe(true);
      expect(document.seed_family).toBe("History Diplomacy");
      expect(document.seed_profile).toBe("Han Court Showdown");
      expect(document.candidates).toHaveLength(12);
      expect(document.candidates.filter((record) => record.status === "raw_generated")).toHaveLength(4);
      expect(document.candidates.filter((record) => record.status === "selector_pool")).toHaveLength(4);
      expect(document.candidates.filter((record) => record.status === "final_selected")).toHaveLength(4);
      expect(document.candidates.every((record) => record.source_project_id === project.id)).toBe(true);
    } finally {
      rmSync(tempRootDir, {
        recursive: true,
        force: true,
      });
    }
  });

  it("only reads same family/profile fallback_ready candidates into selector pool", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Topic Candidate Library Fallback",
    });
    const tempRootDir = mkdtempSync(resolve(tmpdir(), "topic-candidate-library-fallback-"));
    const repository = createTopicCandidateLibraryRepository({
      rootDir: tempRootDir,
    });
    const { gateway } = createGatewayWithSelectorResponses(
      [[
        createRuntimeCandidate("event-a", "angle-a"),
        createRuntimeCandidate("event-b", "angle-b"),
        createRuntimeCandidate("event-c", "angle-c"),
        createRuntimeCandidate("event-a", "angle-a-duplicate-2"),
        createRuntimeCandidate("event-a", "angle-a-duplicate-3"),
        createRuntimeCandidate("event-b", "angle-b-duplicate-1"),
        createRuntimeCandidate("event-b", "angle-b-duplicate-2"),
        createRuntimeCandidate("event-b", "angle-b-duplicate-3"),
      ]],
      [["selector_candidate_1", "selector_candidate_2", "selector_candidate_3", "fallback_candidate_1"]],
    );

    await repository.save({
      candidateId: "fallback-allowed",
      seedFamily: "History Diplomacy",
      seedProfile: "Han Court Showdown",
      status: "fallback_ready",
      sourceProjectId: "project-1",
      sourceTopicRunId: "topic-run-1",
      eventIdentity: "event-fallback",
      title: "fallback-allowed-title",
      oneLineAngle: "fallback-allowed-angle",
      familyLabel: "外交压场型",
      scopeLabel: "单事件",
    });
    await repository.save({
      candidateId: "fallback-other-family",
      seedFamily: "Battle Reversal",
      seedProfile: "Han Court Showdown",
      status: "fallback_ready",
      sourceProjectId: "project-1",
      sourceTopicRunId: "topic-run-1",
      eventIdentity: "event-other-family",
      title: "fallback-other-family-title",
      oneLineAngle: "fallback-other-family-angle",
      familyLabel: "战场翻盘型",
      scopeLabel: "单事件",
    });
    await repository.save({
      candidateId: "fallback-other-profile",
      seedFamily: "History Diplomacy",
      seedProfile: "Tang Frontier Defense",
      status: "fallback_ready",
      sourceProjectId: "project-1",
      sourceTopicRunId: "topic-run-1",
      eventIdentity: "event-other-profile",
      title: "fallback-other-profile-title",
      oneLineAngle: "fallback-other-profile-angle",
      familyLabel: "外交压场型",
      scopeLabel: "单事件",
    });
    await repository.save({
      candidateId: "unused-same-seed",
      seedFamily: "History Diplomacy",
      seedProfile: "Han Court Showdown",
      status: "unused",
      sourceProjectId: "project-1",
      sourceTopicRunId: "topic-run-1",
      eventIdentity: "event-unused",
      title: "unused-same-seed-title",
      oneLineAngle: "unused-same-seed-angle",
      familyLabel: "外交压场型",
      scopeLabel: "单事件",
    });

    try {
      const result = await recommendTopicCandidatesWithTrace(
        db,
        {
          canonicalName: "Han Court Showdown",
          familyHint: "History Diplomacy",
          summary: "selector should receive fallback_ready candidates from the same family/profile only",
          coreConflict: "fallback candidates must stay inside the selector instead of directly replacing final output",
          strongScene: "the selector pool should be expanded by one controlled fallback candidate",
          sourceHint: "test",
          recentUsageHint: "no recent repeats",
        },
        {
          llmGateway: gateway,
          projectId: project.id,
          topicCandidateLibraryRepository: repository,
        },
      );

      const returnedSelectorTitles =
        result.selector_pool?.map((candidate) => candidate.title) ?? [];

      expect(returnedSelectorTitles).toContain("fallback-allowed-title");
      expect(returnedSelectorTitles).not.toContain("fallback-other-family-title");
      expect(returnedSelectorTitles).not.toContain("fallback-other-profile-title");
      expect(returnedSelectorTitles).not.toContain("unused-same-seed-title");
      expect(result.candidates.map((candidate) => candidate.title)).toEqual([
        "event-a",
        "event-b",
        "event-c",
        "fallback-allowed-title",
      ]);
      expect(result.review_trace.accepted_candidate_ids).toEqual([
        "selector_candidate_1",
        "selector_candidate_2",
        "selector_candidate_3",
        "fallback_candidate_1",
      ]);
    } finally {
      rmSync(tempRootDir, {
        recursive: true,
        force: true,
      });
    }
  });

  it("rejects malformed topic recommendation payloads missing seed fields", async () => {
    const app = buildApp();
    const auth = buildTestAuth();
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Malformed Recommendation Payload",
      },
      auth,
    });
    const projectId = projectResponse.json().project_id as string;

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/recommendations`,
      payload: {
        canonical_name: "",
        summary: "楚王在公开场合连续压场，晏子当场顶回去。",
      },
      auth,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "invalid_topic_recommendation_seed",
      invalid_fields: expect.arrayContaining([
        "canonical_name",
        "core_conflict",
        "strong_scene",
        "source_hint",
        "recent_usage_hint",
        "tags",
      ]),
    });
  });

  it("normalizes each recommended candidate into its own event identity instead of reusing the seed identity", async () => {
    vi.spyOn(topicRecommendationServiceModule, "recommendTopicCandidatesWithTrace").mockResolvedValue({
      candidates: [
        createRuntimeCandidate("晏子使楚", "第一槽位"),
        createRuntimeCandidate("张巡守城", "第二槽位"),
        createRuntimeCandidate("于谦守京", "第三槽位"),
      ],
      diagnostics: {
        checks: [],
      },
      trace: {
        run_id: "topic-run-test",
      },
      topic_run: {
        project_id: "project-1",
        round_id: "topic-run-test",
        round_index: 1,
        previous_round_count: 0,
      },
    } as any);

    const app = buildApp();
    const auth = buildTestAuth();
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Candidate Event Identity",
      },
      auth,
    });
    const projectId = projectResponse.json().project_id as string;

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/recommendations`,
      payload: {
        canonical_name: "魏晋至唐宋：均衡叙事历史事件推荐",
        summary: "围绕魏晋至唐宋寻找适合直接进入文案阶段的主题。",
        core_conflict: "重点筛选冲突关系清晰的历史事件。",
        strong_scene: "优先寻找能快速建立场面压迫感的关键场景。",
        source_hint: "魏晋至唐宋相关史事与人物记载",
        recent_usage_hint: "魏晋至唐宋范围内近期未重复的候选优先",
        tags: ["medieval", "balanced", "system_recommendation"],
      },
      auth,
    });

    expect(response.statusCode).toBe(200);

    const storedCandidates = [
      ...(app.topicCandidateStore.get(projectId)?.candidatesById.values() ?? []),
    ];
    expect(storedCandidates).toHaveLength(3);
    expect(storedCandidates.map((candidate) => candidate.event.canonicalName)).toEqual([
      "晏子使楚",
      "张巡守城",
      "于谦守京",
    ]);
    expect(new Set(storedCandidates.map((candidate) => candidate.event.id)).size).toBe(3);
    expect(response.json().event_id).toBe(storedCandidates[0]?.event.id);
  });

  it("drives candidate generation through the formal prompt registry and caches runtime fields", async () => {
    const db = createDbClient();
    const { gateway, invokeApi } = createGatewayWithSelectorResponses([
      [
        createRuntimeCandidate("晏子使楚", "第一槽位"),
        createRuntimeCandidate("张巡守城", "第二槽位"),
        createRuntimeCandidate("于谦守京", "第三槽位"),
        createRuntimeCandidate("李牧守边", "第四槽位"),
        createRuntimeCandidate("冯异定关中", "第五槽位"),
        createRuntimeCandidate("寇准守澶渊", "第六槽位"),
        createRuntimeCandidate("卫青奇袭", "第七槽位"),
        createRuntimeCandidate("岳飞郾城", "第八槽位"),
      ],
    ]);

    const candidates = await (recommendTopicCandidates as any)(
      db,
      {
        canonicalName: "晏子使楚",
        summary: "楚王在公开场合连续压场，晏子当场顶回去。",
        coreConflict: "楚王当众压场，晏子必须当场顶回。",
        strongScene: "楚王连续压场，晏子一句句顶回去。",
        sourceHint: "《晏子春秋》",
        recentUsageHint: "近期未出现同 event_id",
        tags: ["diplomacy", "court", "humiliation", "showdown"],
      },
      {
        llmGateway: gateway,
      },
    );

    expect(invokeApi).toHaveBeenCalledTimes(1);
    expect(invokeApi).toHaveBeenCalledWith(
      expect.objectContaining({
        operationName: "topic.candidate-builder",
        thinking: "disabled",
        prompt: expect.objectContaining({
          metadata: expect.objectContaining({
            id: "topic.candidate-builder",
            language: "zh-CN",
          }),
        }),
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(candidates).toHaveLength(4);
    expect(() => TopicCandidateCard.parse(candidates[0])).not.toThrow();

    const cacheRecords = [...db.candidateCache.values()];
    expect(cacheRecords).toHaveLength(4);
    expect(cacheRecords[0]).toMatchObject({
      oneLineAngle: "第一槽位",
      familyLabel: runtimeCandidate.family_label,
      scopeLabel: runtimeCandidate.scope_label,
      coreConflict: runtimeCandidate.core_conflict,
      strongScene: runtimeCandidate.strong_scene,
    });
    expect(cacheRecords[0]).not.toHaveProperty("title");
  });

  it("keeps the four-item builder output as the reviewed delivery pool", async () => {
    const db = createDbClient();
    const { gateway } = createGatewayWithSelectorResponses([
      [
        createRuntimeCandidate("event-a", "angle-a"),
        createRuntimeCandidate("event-b", "angle-b"),
        createRuntimeCandidate("event-c", "angle-c"),
        createRuntimeCandidate("event-d", "angle-d"),
        createRuntimeCandidate("event-e", "angle-e"),
        createRuntimeCandidate("event-f", "angle-f"),
        createRuntimeCandidate("event-g", "angle-g"),
        createRuntimeCandidate("event-h", "angle-h"),
      ],
    ]);

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "builder should preserve a larger raw pool for downstream selection",
        coreConflict: "raw pool must stay larger than the final delivered set",
        strongScene: "the selector stage needs more than three raw candidates to choose from",
        sourceHint: "test",
        recentUsageHint: "no recent repeats",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    expect(result.raw_candidates).toHaveLength(4);
    expect(result.candidates).toHaveLength(4);
  });

  it("keeps builder event_identity in raw_candidates", async () => {
    const db = createDbClient();
    const { gateway } = createGatewayWithSelectorResponses([
      [
        createRuntimeCandidate("event-a", "angle-a"),
        createRuntimeCandidate("event-b", "angle-b"),
        createRuntimeCandidate("event-c", "angle-c"),
        createRuntimeCandidate("event-d", "angle-d"),
        createRuntimeCandidate("event-e", "angle-e"),
        createRuntimeCandidate("event-f", "angle-f"),
        createRuntimeCandidate("event-g", "angle-g"),
        createRuntimeCandidate("event-h", "angle-h"),
      ],
    ]);

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "builder event identity should remain visible in the raw candidate pool",
        coreConflict: "the runtime must not drop event identity before post-processing",
        strongScene: "raw candidates should preserve builder-declared event identity",
        sourceHint: "test",
        recentUsageHint: "no recent repeats",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    expect(result.raw_candidates[0]).toHaveProperty("event_identity", "event-a");
  });


  it("triggers topic.candidate-builder-repair when builder omits required TopicCandidateCard fields", async () => {
    const db = createDbClient();
    const repairedCandidates = [
      createRuntimeCandidate("event-a", "angle-a"),
      createRuntimeCandidate("event-b", "angle-b"),
      createRuntimeCandidate("event-c", "angle-c"),
      createRuntimeCandidate("event-d", "angle-d"),
      createRuntimeCandidate("event-e", "angle-e"),
      createRuntimeCandidate("event-f", "angle-f"),
      createRuntimeCandidate("event-g", "angle-g"),
      createRuntimeCandidate("event-h", "angle-h"),
    ];
    const invokeApi = vi.fn(
      async (request: OpenAiCompatibleInvokeRequest) => {
        const { operationName } = request;
        const input = request.input as SelectorApiInput;

        if (operationName === "topic.selector") {
          return envelope(
            createSelectorDecisionFromPool(input.selector_pool ?? []),
          );
        }

        if (operationName === "topic.candidate-builder-repair") {
          return envelope(repairedCandidates);
        }

        return envelope([
          createIncompleteBuilderCandidate("event-a"),
          createIncompleteBuilderCandidate("event-b"),
          createIncompleteBuilderCandidate("event-c"),
          createIncompleteBuilderCandidate("event-d"),
          createIncompleteBuilderCandidate("event-e"),
          createIncompleteBuilderCandidate("event-f"),
          createIncompleteBuilderCandidate("event-g"),
          createIncompleteBuilderCandidate("event-h"),
        ]);
      },
    );
    const gateway = createLlmGateway({
      registry: createPromptRegistry(),
      provider: createOpenAiCompatibleProvider({
        model: "glm-4.5",
        invokeApi,
      }),
    });

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "builder repair should fill missing topic candidate fields",
        coreConflict: "missing fields should stay on the builder side",
        strongScene: "repair must complete the same candidates instead of reopening discovery",
        sourceHint: "test",
        recentUsageHint: "no recent repeats",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    expect(invokeApi).toHaveBeenCalledWith(
      expect.objectContaining({
        operationName: "topic.candidate-builder-repair",
        input: expect.objectContaining({
          missing_fields_by_candidate: expect.arrayContaining([
            expect.objectContaining({
              missing_fields: expect.arrayContaining([
                "title",
                "one_line_angle",
                "family_label",
              ]),
            }),
          ]),
        }),
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.candidates.map((candidate) => candidate.title)).toEqual([
      "event-a",
      "event-b",
      "event-c",
      "event-d",
    ]);
    expect(result.diagnostics.checks).toContainEqual(
      expect.objectContaining({
        code: "topic_candidate_builder_repair_triggered",
        level: "info",
      }),
    );
    expect(result.diagnostics.checks).toContainEqual(
      expect.objectContaining({
        code: "topic_candidate_builder_repair_passed",
        level: "info",
      }),
    );
  });

  it("keeps serving fallback candidates and marks diagnostics degraded when builder repair still leaves required fields missing", async () => {
    const db = createDbClient();
    const invokeApi = vi.fn(
      async (request: OpenAiCompatibleInvokeRequest) => {
        const { operationName } = request;
        const input = request.input as SelectorApiInput;

        if (operationName === "topic.selector") {
          return envelope(
            createSelectorDecisionFromPool(input.selector_pool ?? []),
          );
        }

        return envelope([
          createIncompleteBuilderCandidate("event-a"),
          createIncompleteBuilderCandidate("event-b"),
          createIncompleteBuilderCandidate("event-c"),
          createIncompleteBuilderCandidate("event-d"),
          createIncompleteBuilderCandidate("event-e"),
          createIncompleteBuilderCandidate("event-f"),
          createIncompleteBuilderCandidate("event-g"),
          createIncompleteBuilderCandidate("event-h"),
        ]);
      },
    );
    const gateway = createLlmGateway({
      registry: createPromptRegistry(),
      provider: createOpenAiCompatibleProvider({
        model: "glm-4.5",
        invokeApi,
      }),
    });

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "repair should not hard-fail when the builder still omits required fields",
        coreConflict: "fallback must keep the user flow alive",
        strongScene: "builder repair returns the same incomplete candidates again",
        sourceHint: "test",
        recentUsageHint: "no recent repeats",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    expect(result.candidates).toHaveLength(4);
    expect(result.candidates[0]?.title).toBe("seed-a");
    expect(result.diagnostics.checks).toContainEqual(
      expect.objectContaining({
        code: "topic_candidate_builder_degraded",
        level: "warning",
      }),
    );
    expect(result.diagnostics.checks).toContainEqual(
      expect.objectContaining({
        code: "topic_candidate_builder_repair_triggered",
        level: "info",
      }),
    );
  });

  it("repairs minimally malformed runtime output before validating TopicCandidateCard", async () => {
    const db = createDbClient();
    const { gateway, invokeApi } = createGatewayWithSelectorResponses([
      `\`\`\`json
[
  ${JSON.stringify(createRuntimeCandidate("晏子使楚", "第一槽位"))},
  ${JSON.stringify(createRuntimeCandidate("张巡守城", "第二槽位"))},
  ${JSON.stringify(createRuntimeCandidate("于谦守京", "第三槽位"))},
  ${JSON.stringify(createRuntimeCandidate("李牧守边", "第四槽位"))},
  ${JSON.stringify(createRuntimeCandidate("冯异定关中", "第五槽位"))},
  ${JSON.stringify(createRuntimeCandidate("寇准守澶渊", "第六槽位"))},
  ${JSON.stringify(createRuntimeCandidate("卫青奇袭", "第七槽位"))},
  ${JSON.stringify(createRuntimeCandidate("岳飞郾城", "第八槽位"))}
]
\`\`\``,
    ]);

    const candidates = await (recommendTopicCandidates as any)(
      db,
      {
        canonicalName: "晏子使楚",
        summary: "楚王在公开场合连续压场，晏子当场顶回去。",
        coreConflict: "楚王当众压场，晏子必须当场顶回。",
        strongScene: "楚王连续压场，晏子一句句顶回去。",
        sourceHint: "《晏子春秋》",
        recentUsageHint: "近期未出现同 event_id",
      },
      {
        llmGateway: gateway,
      },
    );

    expect(invokeApi).toHaveBeenCalledTimes(1);
    expect(() => TopicCandidateCard.parse(candidates[0])).not.toThrow();
  });

  it("performs a single repair call when the first runtime response contains fewer than three candidates", async () => {
    const db = createDbClient();
    const { gateway, invokeApi } = createGatewayWithSelectorResponses([
      [createRuntimeCandidate("晏子使楚", "第一槽位")],
      [
          createRuntimeCandidate("张巡守城", "第二槽位"),
          createRuntimeCandidate("于谦守京", "第三槽位"),
        ],
      ],
      [["selector_candidate_1", "selector_candidate_2", "selector_candidate_3", "selector_candidate_4"]],
    );

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "晏子使楚",
        summary: "楚王在公开场合连续压场，晏子当场顶回去。",
        coreConflict: "楚王当众压场，晏子必须当场顶回。",
        strongScene: "楚王连续压场，晏子一句句顶回去。",
        sourceHint: "《晏子春秋》",
        recentUsageHint: "近期未出现同 event_id",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    expect(invokeApi).toHaveBeenCalledTimes(2);
    expect(result.candidates).toHaveLength(3);
    expect(result.review_trace.refill_attempts).toBe(1);
    expect(result.diagnostics.checks).toContainEqual(
      expect.objectContaining({
        code: "topic_candidate_slots_insufficient",
      }),
    );
  });

  it("returns explicit diagnostics when the repair call still cannot fill all three slots", async () => {
    const db = createDbClient();
    const invokeApi = vi
      .fn()
      .mockResolvedValueOnce(
        envelope([createRuntimeCandidate("晏子使楚", "第一槽位")]),
      )
      .mockResolvedValueOnce(envelope([]));
    const gateway = createLlmGateway({
      registry: createPromptRegistry(),
      provider: createOpenAiCompatibleProvider({
        model: "glm-4.5",
        invokeApi,
      }),
    });

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "晏子使楚",
        summary: "楚王在公开场合连续压场，晏子当场顶回去。",
        coreConflict: "楚王当众压场，晏子必须当场顶回。",
        strongScene: "楚王连续压场，晏子一句句顶回去。",
        sourceHint: "《晏子春秋》",
        recentUsageHint: "近期未出现同 event_id",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    expect(invokeApi).toHaveBeenCalledTimes(2);
    expect(result.candidates).toHaveLength(1);
    expect(result.diagnostics.checks).toContainEqual(
      expect.objectContaining({
        code: "topic_candidate_slots_insufficient",
        level: "info",
      }),
    );
  });

  it("filters duplicate event identities from a single open-discovery recommendation round", async () => {
    const db = createDbClient();
    const invokeApi = vi.fn(async () =>
      envelope([
        createRuntimeCandidate("event-a", "shared-angle"),
        createRuntimeCandidate("event-a", "shared-angle"),
        createRuntimeCandidate("event-b", "fresh-angle"),
      ]),
    );
    const gateway = createLlmGateway({
      registry: createPromptRegistry(),
      provider: createOpenAiCompatibleProvider({
        model: "glm-4.5",
        invokeApi,
      }),
    });

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "single-round duplicate filtering",
        coreConflict: "the same event and angle should not occupy two slots",
        strongScene: "duplicate outputs must be removed locally before ranking",
        sourceHint: "test",
        recentUsageHint: "no duplicate slots",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    expect(uniqueEventFingerprints(result.candidates)).toHaveLength(
      result.candidates.length,
    );
    expect(result.diagnostics.checks).toContainEqual(
      expect.objectContaining({
        code: "topic_candidate_duplicate_removed",
        reason: expect.any(String),
      }),
    );
  });

  it("only keeps one entry per normalized event identity in the selector pool", async () => {
    const db = createDbClient();
    const { gateway } = createGatewayWithSelectorResponses([
      [
        createRuntimeCandidate("event-a", "angle-a"),
        createRuntimeCandidate("event-a", "angle-a-alt"),
        createRuntimeCandidate("event-b", "angle-b"),
        createRuntimeCandidate("event-c", "angle-c"),
        createRuntimeCandidate("event-d", "angle-d"),
        createRuntimeCandidate("event-e", "angle-e"),
        createRuntimeCandidate("event-f", "angle-f"),
        createRuntimeCandidate("event-g", "angle-g"),
      ],
    ]);

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "selector pool should deduplicate by normalized event identity",
        coreConflict: "the selector pool must not keep multiple entries for the same event",
        strongScene: "identity deduplication should happen before selector input is constructed",
        sourceHint: "test",
        recentUsageHint: "no duplicate event identities",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    expect(uniqueEventIdentities(result.selector_pool)).toHaveLength(
      result.selector_pool.length,
    );
    expect(result.selector_pool.map((candidate) => candidate.candidate_id)).toEqual([
      "selector_candidate_1",
      "selector_candidate_3",
      "selector_candidate_4",
    ]);
  });

  it("deduplicates selector_pool by explicit event_identity instead of title-derived identity", async () => {
    const db = createDbClient();
    const { gateway } = createGatewayWithSelectorResponses([
      [
        { ...createRuntimeCandidate("title-a-v1", "angle-a"), event_identity: "event-a" },
        { ...createRuntimeCandidate("title-a-v2", "angle-a-alt"), event_identity: "event-a" },
        { ...createRuntimeCandidate("title-b", "angle-b"), event_identity: "event-b" },
        { ...createRuntimeCandidate("title-c", "angle-c"), event_identity: "event-c" },
        { ...createRuntimeCandidate("title-d", "angle-d"), event_identity: "event-d" },
        { ...createRuntimeCandidate("title-e", "angle-e"), event_identity: "event-e" },
        { ...createRuntimeCandidate("title-f", "angle-f"), event_identity: "event-f" },
        { ...createRuntimeCandidate("title-g", "angle-g"), event_identity: "event-g" },
      ],
    ]);

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "selector pool should deduplicate by explicit event identity",
        coreConflict: "different titles with the same event identity must collapse into one slot",
        strongScene: "local post-processing should trust the declared event identity instead of deriving from title",
        sourceHint: "test",
        recentUsageHint: "avoid duplicate explicit identities",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    expect(result.selector_pool.filter((candidate) => candidate.normalized_event_identity === "event-a")).toHaveLength(1);
  });

  it("keeps multiple same-event candidates when a single-event seed only varies the angle", async () => {
    const db = createDbClient();
    const { gateway } = createGatewayWithSelectorResponses(
      [[
        { ...createRuntimeCandidate("event-a-title-1", "angle-a-1"), event_identity: "event-a" },
        { ...createRuntimeCandidate("event-a-title-2", "angle-a-2"), event_identity: "event-a" },
        { ...createRuntimeCandidate("event-a-title-3", "angle-a-3"), event_identity: "event-a" },
        { ...createRuntimeCandidate("event-a-title-4", "angle-a-4"), event_identity: "event-a" },
        { ...createRuntimeCandidate("event-a-title-5", "angle-a-5"), event_identity: "event-a" },
        { ...createRuntimeCandidate("event-a-title-6", "angle-a-6"), event_identity: "event-a" },
        { ...createRuntimeCandidate("event-a-title-7", "angle-a-7"), event_identity: "event-a" },
        { ...createRuntimeCandidate("event-a-title-8", "angle-a-8"), event_identity: "event-a" },
      ]],
      [["selector_candidate_1"]],
    );

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "event-a",
        summary: "single-event seeds should keep multiple angles in the selector pool",
        coreConflict: "angle variation should stay selectable instead of collapsing to one slot",
        strongScene: "the same event is being opened from multiple distinct angles",
        sourceHint: "test",
        recentUsageHint: "single-event focus mode",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    expect(result.selector_pool).toHaveLength(4);
    expect(result.candidates).toHaveLength(4);
    expect(result.selector_pool.every((candidate) => candidate.normalized_event_identity === "event-a")).toBe(true);
    expect(result.diagnostics.checks).not.toContainEqual(
      expect.objectContaining({
        code: "topic_candidate_slots_insufficient",
      }),
    );
  });

  it("keeps same-event duplicate angle diagnostics readable", async () => {
    const db = createDbClient();
    const { gateway } = createGatewayWithSelectorResponses(
      [[
        { ...createRuntimeCandidate("event-a-title-1", "angle-a-1"), event_identity: "event-a" },
        { ...createRuntimeCandidate("event-a-title-2", "angle-a-1"), event_identity: "event-a" },
        { ...createRuntimeCandidate("event-a-title-3", "angle-a-3"), event_identity: "event-a" },
        { ...createRuntimeCandidate("event-a-title-4", "angle-a-4"), event_identity: "event-a" },
        { ...createRuntimeCandidate("event-a-title-5", "angle-a-5"), event_identity: "event-a" },
        { ...createRuntimeCandidate("event-a-title-6", "angle-a-6"), event_identity: "event-a" },
        { ...createRuntimeCandidate("event-a-title-7", "angle-a-7"), event_identity: "event-a" },
        { ...createRuntimeCandidate("event-a-title-8", "angle-a-8"), event_identity: "event-a" },
      ]],
      [["selector_candidate_1"]],
    );

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "event-a",
        summary: "single-event seeds may still duplicate one angle",
        coreConflict: "duplicate angle diagnostics should stay readable",
        strongScene: "same event with one repeated angle",
        sourceHint: "test",
        recentUsageHint: "single-event focus mode",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    const duplicateDiagnostic = result.diagnostics.checks.find(
      (check) => check.code === "topic_candidate_duplicate_removed",
    );

    expect(duplicateDiagnostic?.reason).toContain(
      "event-a-title-2｜angle-a-1 与已保留候选切口完全重复",
    );
    expect(duplicateDiagnostic?.reason).not.toContain("锝");
    expect(duplicateDiagnostic?.reason).not.toContain("candidate.one_line_angle");
  });

  it("keeps explicit event_identity visible in selector outputs", async () => {
    const db = createDbClient();
    const { gateway } = createGatewayWithSelectorResponses([
      [
        { ...createRuntimeCandidate("title-a", "angle-a"), event_identity: "event-a" },
        { ...createRuntimeCandidate("title-b", "angle-b"), event_identity: "event-b" },
        { ...createRuntimeCandidate("title-c", "angle-c"), event_identity: "event-c" },
        { ...createRuntimeCandidate("title-d", "angle-d"), event_identity: "event-d" },
        { ...createRuntimeCandidate("title-e", "angle-e"), event_identity: "event-e" },
        { ...createRuntimeCandidate("title-f", "angle-f"), event_identity: "event-f" },
        { ...createRuntimeCandidate("title-g", "angle-g"), event_identity: "event-g" },
        { ...createRuntimeCandidate("title-h", "angle-h"), event_identity: "event-h" },
      ],
    ]);

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "selector outputs should expose explicit event identity",
        coreConflict: "explicit event identity should stay visible after selector pool preparation",
        strongScene: "event identity must not disappear into normalized-only fields",
        sourceHint: "test",
        recentUsageHint: "none",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    expect(result.selector_pool[0]).toHaveProperty("event_identity", "event-a");
  });

  it("includes fatigue metadata for selector instead of directly finalizing the top 3", async () => {
    const db = createDbClient();
    await seedRecentEventUsage(db, "event-a");
    const { gateway } = createGatewayWithSelectorResponses([
      [
        createRuntimeCandidate("event-a", "angle-a"),
        createRuntimeCandidate("event-b", "angle-b"),
        createRuntimeCandidate("event-c", "angle-c"),
        createRuntimeCandidate("event-d", "angle-d"),
        createRuntimeCandidate("event-e", "angle-e"),
        createRuntimeCandidate("event-f", "angle-f"),
        createRuntimeCandidate("event-g", "angle-g"),
        createRuntimeCandidate("event-h", "angle-h"),
      ],
    ]);

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "selector pool should carry fatigue metadata",
        coreConflict: "fatigue annotations belong to selector input preparation",
        strongScene: "recently used events should be marked before final semantic selection",
        sourceHint: "test",
        recentUsageHint: "avoid the just-used event",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    expect(result.selector_pool[0]).toMatchObject({
      fatigue_score: expect.any(Number),
      recently_seen: expect.any(Boolean),
      core_conflict: runtimeCandidate.core_conflict,
      strong_scene: runtimeCandidate.strong_scene,
      must_cover_preview: expect.arrayContaining(runtimeCandidate.must_cover_preview),
      risk_hints: runtimeCandidate.risk_hints,
      viral_rubric: runtimeCandidate.viral_rubric,
    });
  });

  it("applies fatigue when the same explicit event_identity appears in recent history", async () => {
    const db = createDbClient();
    const { gateway } = createGatewayWithSelectorResponses(
      [
        [
          { ...createRuntimeCandidate("title-a-v1", "angle-a"), event_identity: "event-a" },
          { ...createRuntimeCandidate("title-b-v1", "angle-b"), event_identity: "event-b" },
          { ...createRuntimeCandidate("title-c-v1", "angle-c"), event_identity: "event-c" },
          { ...createRuntimeCandidate("title-d-v1", "angle-d"), event_identity: "event-d" },
          { ...createRuntimeCandidate("title-e-v1", "angle-e"), event_identity: "event-e" },
          { ...createRuntimeCandidate("title-f-v1", "angle-f"), event_identity: "event-f" },
          { ...createRuntimeCandidate("title-g-v1", "angle-g"), event_identity: "event-g" },
          { ...createRuntimeCandidate("title-h-v1", "angle-h"), event_identity: "event-h" },
        ],
        [
          { ...createRuntimeCandidate("title-a-v2", "angle-a-2"), event_identity: "event-a" },
          { ...createRuntimeCandidate("title-e-v2", "angle-e-2"), event_identity: "event-e" },
          { ...createRuntimeCandidate("title-f-v2", "angle-f-2"), event_identity: "event-f" },
          { ...createRuntimeCandidate("title-g-v2", "angle-g-2"), event_identity: "event-g" },
          { ...createRuntimeCandidate("title-b-v2", "angle-b-2"), event_identity: "event-b" },
          { ...createRuntimeCandidate("title-c-v2", "angle-c-2"), event_identity: "event-c" },
          { ...createRuntimeCandidate("title-d-v2", "angle-d-2"), event_identity: "event-d" },
          { ...createRuntimeCandidate("title-h-v2", "angle-h-2"), event_identity: "event-h" },
        ],
      ],
      [
        ["selector_candidate_1", "selector_candidate_2", "selector_candidate_3", "selector_candidate_4"],
        ["selector_candidate_2", "selector_candidate_3", "selector_candidate_4", "selector_candidate_5"],
      ],
    );

    await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "first round establishes explicit event identity history",
        coreConflict: "first-round event identities should become precise fatigue input",
        strongScene: "project history should remember the declared event identity",
        sourceHint: "test",
        recentUsageHint: "first round has no fatigue",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    db.candidateCache.clear();

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "second round validates explicit event identity fatigue",
        coreConflict: "the same event identity should be penalized even when the title changes",
        strongScene: "cross-round fatigue should follow explicit identity rather than title packaging",
        sourceHint: "test",
        recentUsageHint: "second round should avoid the previous event identity",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    expect(result.diagnostics.checks).toContainEqual(
      expect.objectContaining({
        code: "topic_candidate_fatigue_penalty_applied",
      }),
    );
    expect(result.candidates[0]?.title).toBe("title-e-v2");
  });
















  it("demotes recently used events through a fatigue penalty before returning final candidates", async () => {
    const db = createDbClient();
    await seedRecentEventUsage(db, "event-a");
    const { gateway } = createGatewayWithSelectorResponses([
      [
        createRuntimeCandidate("event-a", "angle-a"),
        createRuntimeCandidate("event-b", "angle-b"),
        createRuntimeCandidate("event-c", "angle-c"),
        createRuntimeCandidate("event-d", "angle-d"),
        createRuntimeCandidate("event-e", "angle-e"),
        createRuntimeCandidate("event-f", "angle-f"),
        createRuntimeCandidate("event-g", "angle-g"),
        createRuntimeCandidate("event-h", "angle-h"),
      ],
    ]);

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "recent final candidates should be demoted",
        coreConflict: "fatigue should lower the priority of the recently kept event",
        strongScene: "the freshest candidate should rise ahead of the repeated event",
        sourceHint: "test",
        recentUsageHint: "avoid the just-used event",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    expect(result.diagnostics.checks).toContainEqual(
      expect.objectContaining({
        code: "topic_candidate_fatigue_penalty_applied",
      }),
    );
    expect(result.candidates[0]?.title).toBe("event-b");
  });

  it("applies fatigue even when the recent cache record and recommendation start share the same millisecond", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-29T00:00:00.000Z"));

    const db = createDbClient();
    await seedRecentEventUsage(db, "event-a");
    const { gateway } = createGatewayWithSelectorResponses([
      [
        createRuntimeCandidate("event-a", "angle-a"),
        createRuntimeCandidate("event-b", "angle-b"),
        createRuntimeCandidate("event-c", "angle-c"),
        createRuntimeCandidate("event-d", "angle-d"),
        createRuntimeCandidate("event-e", "angle-e"),
        createRuntimeCandidate("event-f", "angle-f"),
        createRuntimeCandidate("event-g", "angle-g"),
        createRuntimeCandidate("event-h", "angle-h"),
      ],
    ]);

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "same-millisecond history should still count as prior fatigue input",
        coreConflict: "strict timestamp cutoffs must not drop immediately previous cache history",
        strongScene: "the recently used event should still be demoted at equal-millisecond boundaries",
        sourceHint: "test",
        recentUsageHint: "equal timestamp boundary",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    expect(result.diagnostics.checks).toContainEqual(
      expect.objectContaining({
        code: "topic_candidate_fatigue_penalty_applied",
      }),
    );
    expect(result.candidates[0]?.title).toBe("event-b");
  });

  it("ignores raw cache entries when building the fatigue baseline", async () => {
    const db = createDbClient();
    await seedRawCandidateCacheEntry(db, "event-a", "angle-a");
    const { gateway } = createGatewayWithSelectorResponses([
      [
        createRuntimeCandidate("event-a", "angle-a"),
        createRuntimeCandidate("event-b", "angle-b"),
        createRuntimeCandidate("event-c", "angle-c"),
        createRuntimeCandidate("event-d", "angle-d"),
        createRuntimeCandidate("event-e", "angle-e"),
        createRuntimeCandidate("event-f", "angle-f"),
        createRuntimeCandidate("event-g", "angle-g"),
        createRuntimeCandidate("event-h", "angle-h"),
      ],
    ]);

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "raw cache should not affect fatigue baseline",
        coreConflict: "raw cache entries must not be mixed with final kept history",
        strongScene: "the same event should stay first when only raw cache exists",
        sourceHint: "test",
        recentUsageHint: "no fatigue expected from raw cache",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    expect(result.diagnostics.checks).not.toContainEqual(
      expect.objectContaining({
        code: "topic_candidate_fatigue_penalty_applied",
      }),
    );
    expect(result.candidates[0]?.title).toBe("event-a");
  });

  it("uses project round history for fatigue even after candidate cache is cleared", async () => {
    const db = createDbClient();
    const { gateway } = createGatewayWithSelectorResponses(
      [
        [
          createRuntimeCandidate("event-a", "angle-a"),
          createRuntimeCandidate("event-a", "angle-a-alt-1"),
          createRuntimeCandidate("event-a", "angle-a-alt-2"),
          createRuntimeCandidate("event-a", "angle-a-alt-3"),
          createRuntimeCandidate("event-a", "angle-a-alt-4"),
          createRuntimeCandidate("event-a", "angle-a-alt-5"),
          createRuntimeCandidate("event-a", "angle-a-alt-6"),
          createRuntimeCandidate("event-a", "angle-a-alt-7"),
        ],
        [
          createRuntimeCandidate("event-a", "angle-a"),
          createRuntimeCandidate("event-b", "angle-b"),
          createRuntimeCandidate("event-c", "angle-c"),
          createRuntimeCandidate("event-d", "angle-d"),
          createRuntimeCandidate("event-e", "angle-e"),
          createRuntimeCandidate("event-f", "angle-f"),
          createRuntimeCandidate("event-g", "angle-g"),
          createRuntimeCandidate("event-h", "angle-h"),
        ],
      ],
      [
        ["selector_candidate_2", "selector_candidate_3", "selector_candidate_4"],
      ],
    );

    await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "first round establishes project history",
        coreConflict: "first-round kept candidates should become round-to-round fatigue input",
        strongScene: "project history must survive beyond immediate cache state",
        sourceHint: "test",
        recentUsageHint: "first round has no fatigue",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    db.candidateCache.clear();

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "second round validates round-to-round fatigue",
        coreConflict: "project round history should still demote the previous event",
        strongScene: "cache removal must not erase round-to-round fatigue memory",
        sourceHint: "test",
        recentUsageHint: "second round should avoid the previous event",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    expect(result.diagnostics.checks).toContainEqual(
      expect.objectContaining({
        code: "topic_candidate_fatigue_penalty_applied",
      }),
    );
    expect(result.candidates[0]?.title).toBe("event-b");
  });

  it("fails clearly when runtime output cannot be repaired into TopicCandidateCard", async () => {
    const db = createDbClient();
    const gateway = createLlmGateway({
      registry: createPromptRegistry(),
      provider: createOpenAiCompatibleProvider({
        model: "glm-4.5",
        invokeApi: vi.fn(async () => envelope("not-json")),
      }),
    });

    await expect(
      Promise.resolve().then(() =>
        (recommendTopicCandidates as any)(
          db,
          {
            canonicalName: "晏子使楚",
            summary: "楚王在公开场合连续压场，晏子当场顶回去。",
            coreConflict: "楚王当众压场，晏子必须当场顶回。",
            strongScene: "楚王连续压场，晏子一句句顶回去。",
            sourceHint: "《晏子春秋》",
            recentUsageHint: "近期未出现同 event_id",
          },
          {
            llmGateway: gateway,
          },
        ),
      ),
    ).rejects.toMatchObject({
      name: "ExternalServiceError",
      code: "invalid_response",
      operation: "topic.candidate-builder",
    });
  });

  it("emits project-scoped topic run metadata when the same project generates multiple rounds", async () => {
    const db = createDbClient();
    const invokeApi = vi.fn(async () => envelope([runtimeCandidate]));
    const gateway = createLlmGateway({
      registry: createPromptRegistry(),
      provider: createOpenAiCompatibleProvider({
        model: "glm-4.5",
        invokeApi,
      }),
    });

    const firstRun = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "晏子使楚",
        summary: "第一轮生成。",
        coreConflict: "楚王当众压场，晏子必须当场顶回。",
        strongScene: "楚王连续压场，晏子一句句顶回去。",
        sourceHint: "《晏子春秋》",
        recentUsageHint: "第一次运行",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    const secondRun = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "晏子使楚",
        summary: "第二轮生成。",
        coreConflict: "同一项目再次生成候选。",
        strongScene: "第二轮生成结束后仍能查看上一轮。",
        sourceHint: "《晏子春秋》",
        recentUsageHint: "第二次运行",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    expect((firstRun as any).topic_run).toMatchObject({
      project_id: "project-1",
      round_index: 1,
    });
    expect((secondRun as any).topic_run).toMatchObject({
      project_id: "project-1",
      round_index: 2,
      previous_round_count: 1,
    });
  });

  it("writes recommendation diagnostics outside llm-interactions using a stable markdown contract", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Topic Runtime Diagnostics",
    });
    const invokeApi = vi.fn(async () =>
      envelope([
        createRuntimeCandidate("event-a", "shared-angle"),
        createRuntimeCandidate("event-a", "shared-angle"),
        createRuntimeCandidate("event-b", "fresh-angle"),
      ]),
    );
    const gateway = createLlmGateway({
      registry: createPromptRegistry(),
      provider: createOpenAiCompatibleProvider({
        model: "glm-4.5",
        invokeApi,
      }),
    });

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "topic run writes runtime artifacts",
        coreConflict: "diagnostics should not masquerade as llm interactions",
        strongScene: "duplicate filtering should be readable without depending on numbered filenames",
        sourceHint: "test",
        recentUsageHint: "none",
      },
      {
        llmGateway: gateway,
        projectId: project.id,
      },
    );

    const profile = getProjectStorageProfile(project);
    const runId = String((result.trace as unknown as Record<string, unknown>).run_id);
    const runDir = resolve(process.cwd(), profile.topic_runs_dir, runId);
    const llmInteractionsDir = resolve(runDir, "llm-interactions");
    const llmInteractionFiles = readdirSync(llmInteractionsDir);
    const diagnosticsLogPath = resolve(runDir, "recommendation-diagnostics.md");

    expect(llmInteractionFiles).toContain("01-topic.candidate-builder.md");
    expect(llmInteractionFiles.some((name) => name.includes("diagnostics"))).toBe(false);
    expect(existsSync(diagnosticsLogPath)).toBe(true);

    const diagnosticsLogContent = readFileSync(diagnosticsLogPath, "utf8");
    expect(diagnosticsLogContent).toContain("topic_candidate_duplicate_removed");
    expect(diagnosticsLogContent).toContain("event-a");
    expect(diagnosticsLogContent).toContain("event_identity");
    expect(diagnosticsLogContent).not.toContain("# LLM 交互日志");
    expect(diagnosticsLogContent).not.toContain("prompt_id:");
  });

  it("writes the selector final candidates into recommendation diagnostics", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Topic Final Candidate Diagnostics",
    });
    const { gateway } = createGatewayWithSelectorResponses(
      [[
        createRuntimeCandidate("event-a", "angle-a"),
        createRuntimeCandidate("event-b", "angle-b"),
        createRuntimeCandidate("event-c", "angle-c"),
        createRuntimeCandidate("event-d", "angle-d"),
        createRuntimeCandidate("event-e", "angle-e"),
        createRuntimeCandidate("event-f", "angle-f"),
        createRuntimeCandidate("event-g", "angle-g"),
        createRuntimeCandidate("event-h", "angle-h"),
      ]],
      [[
        "selector_candidate_5",
        "selector_candidate_6",
        "selector_candidate_7",
        "selector_candidate_8",
      ]],
    );

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-final-diagnostics",
        summary: "recommendation diagnostics should match the selector result",
        coreConflict: "the final candidate truth source must not use builder order",
        strongScene: "the selector promotes the last four candidates",
        sourceHint: "test",
        recentUsageHint: "none",
      },
      {
        llmGateway: gateway,
        projectId: project.id,
      },
    );

    const profile = getProjectStorageProfile(project);
    const runId = String((result.trace as unknown as Record<string, unknown>).run_id);
    const diagnosticsLogContent = readFileSync(
      resolve(process.cwd(), profile.topic_runs_dir, runId, "recommendation-diagnostics.md"),
      "utf8",
    );
    const candidatesSection = diagnosticsLogContent.match(
      /## Candidates\n\n([\s\S]*?)(?:\n\n## Notes|\n?$)/,
    )?.[1];

    expect(candidatesSection).toBeDefined();
    expect(candidatesSection?.split("\n")).toEqual([
      "- event_identity=event-a | event-a | angle-a",
      "- event_identity=event-b | event-b | angle-b",
      "- event_identity=event-c | event-c | angle-c",
      "- event_identity=event-d | event-d | angle-d",
    ]);
  });

  it("writes builder repair diagnostics into recommendation-diagnostics markdown", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Topic Builder Repair Diagnostics",
    });
    const repairedCandidates = [
      createRuntimeCandidate("event-a", "angle-a"),
      createRuntimeCandidate("event-b", "angle-b"),
      createRuntimeCandidate("event-c", "angle-c"),
      createRuntimeCandidate("event-d", "angle-d"),
      createRuntimeCandidate("event-e", "angle-e"),
      createRuntimeCandidate("event-f", "angle-f"),
      createRuntimeCandidate("event-g", "angle-g"),
      createRuntimeCandidate("event-h", "angle-h"),
    ];
    const invokeApi = vi.fn(
      async (request: OpenAiCompatibleInvokeRequest) => {
        const { operationName } = request;
        const input = request.input as SelectorApiInput;

      if (operationName === "topic.selector") {
        return envelope(
          createSelectorDecisionFromPool(input.selector_pool ?? []),
        );
      }

      if (operationName === "topic.candidate-builder-repair") {
        return envelope(repairedCandidates);
      }

      return envelope([
        createIncompleteBuilderCandidate("event-a"),
        createIncompleteBuilderCandidate("event-b"),
        createIncompleteBuilderCandidate("event-c"),
        createIncompleteBuilderCandidate("event-d"),
        createIncompleteBuilderCandidate("event-e"),
        createIncompleteBuilderCandidate("event-f"),
        createIncompleteBuilderCandidate("event-g"),
        createIncompleteBuilderCandidate("event-h"),
      ]);
    });
    const gateway = createLlmGateway({
      registry: createPromptRegistry(),
      provider: createOpenAiCompatibleProvider({
        model: "glm-4.5",
        invokeApi,
      }),
    });

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "builder repair diagnostics should be visible in recommendation markdown",
        coreConflict: "field completeness repair must leave observable diagnostics",
        strongScene: "builder omits required fields and repair fills them once",
        sourceHint: "test",
        recentUsageHint: "none",
      },
      {
        llmGateway: gateway,
        projectId: project.id,
      },
    );

    const profile = getProjectStorageProfile(project);
    const runId = String((result.trace as unknown as Record<string, unknown>).run_id);
    const runDir = resolve(process.cwd(), profile.topic_runs_dir, runId);
    const diagnosticsLogPath = resolve(runDir, "recommendation-diagnostics.md");
    const diagnosticsLogContent = readFileSync(diagnosticsLogPath, "utf8");

    expect(diagnosticsLogContent).toContain("topic_candidate_builder_repair_triggered");
    expect(diagnosticsLogContent).toContain("topic_candidate_builder_repair_passed");
    expect(diagnosticsLogContent).not.toContain("topic_candidate_builder_degraded");
  });


  it("sends recent_event_memory to topic.candidate-builder on later rounds", async () => {
    const db = createDbClient();
    const { gateway, invokeApi } = createGatewayWithSelectorResponses(
      [
        [
          createRuntimeCandidate("event-a", "angle-a"),
          createRuntimeCandidate("event-b", "angle-b"),
          createRuntimeCandidate("event-c", "angle-c"),
          createRuntimeCandidate("event-d", "angle-d"),
          createRuntimeCandidate("event-e", "angle-e"),
          createRuntimeCandidate("event-f", "angle-f"),
          createRuntimeCandidate("event-g", "angle-g"),
          createRuntimeCandidate("event-h", "angle-h"),
        ],
        [
          createRuntimeCandidate("event-a-2", "angle-a-2"),
          createRuntimeCandidate("event-b-2", "angle-b-2"),
          createRuntimeCandidate("event-c-2", "angle-c-2"),
          createRuntimeCandidate("event-d-2", "angle-d-2"),
          createRuntimeCandidate("event-e-2", "angle-e-2"),
          createRuntimeCandidate("event-f-2", "angle-f-2"),
          createRuntimeCandidate("event-g-2", "angle-g-2"),
          createRuntimeCandidate("event-h-2", "angle-h-2"),
        ],
      ],
      [
        ["selector_candidate_1", "selector_candidate_2", "selector_candidate_3", "selector_candidate_4"],
        ["selector_candidate_2", "selector_candidate_3", "selector_candidate_4", "selector_candidate_5"],
      ],
    );

    await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "first round establishes recent event memory for builder",
        coreConflict: "builder should later see prior selected events",
        strongScene: "the first round fills project history",
        sourceHint: "test",
        recentUsageHint: "first round",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "second round should send recent event memory to builder",
        coreConflict: "builder input should include prior selected events",
        strongScene: "recent event memory must be present before open discovery",
        sourceHint: "test",
        recentUsageHint: "second round",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    const builderCalls = invokeApi.mock.calls.filter(
      ([request]) => request.operationName === "topic.candidate-builder",
    );
    const secondBuilderInput = builderCalls[1]?.[0]?.input as
      | { recent_event_memory?: Array<{ event_identity: string }> }
      | undefined;

    expect(secondBuilderInput?.recent_event_memory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_identity: "event-a",
        }),
      ]),
    );
  });


  it("records builder recent event memory in llm interaction trace", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Topic Builder Recent Memory Trace",
    });
    const { gateway } = createGatewayWithSelectorResponses(
      [
        [
          createRuntimeCandidate("event-a", "angle-a"),
          createRuntimeCandidate("event-b", "angle-b"),
          createRuntimeCandidate("event-c", "angle-c"),
          createRuntimeCandidate("event-d", "angle-d"),
          createRuntimeCandidate("event-e", "angle-e"),
          createRuntimeCandidate("event-f", "angle-f"),
          createRuntimeCandidate("event-g", "angle-g"),
          createRuntimeCandidate("event-h", "angle-h"),
        ],
        [
          createRuntimeCandidate("event-a-2", "angle-a-2"),
          createRuntimeCandidate("event-b-2", "angle-b-2"),
          createRuntimeCandidate("event-c-2", "angle-c-2"),
          createRuntimeCandidate("event-d-2", "angle-d-2"),
          createRuntimeCandidate("event-e-2", "angle-e-2"),
          createRuntimeCandidate("event-f-2", "angle-f-2"),
          createRuntimeCandidate("event-g-2", "angle-g-2"),
          createRuntimeCandidate("event-h-2", "angle-h-2"),
        ],
      ],
      [
        ["selector_candidate_1", "selector_candidate_2", "selector_candidate_3", "selector_candidate_4"],
        ["selector_candidate_2", "selector_candidate_3", "selector_candidate_4", "selector_candidate_5"],
      ],
    );

    await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "first round establishes recent event memory for builder trace",
        coreConflict: "builder trace should later show prior selected events",
        strongScene: "the first round fills project history",
        sourceHint: "test",
        recentUsageHint: "first round",
      },
      {
        llmGateway: gateway,
        projectId: project.id,
      },
    );

    const secondRun = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "second round should write recent event memory into builder trace",
        coreConflict: "builder trace should show the recent event memory it consumed",
        strongScene: "trace inspection should expose builder recent event memory clearly",
        sourceHint: "test",
        recentUsageHint: "second round",
      },
      {
        llmGateway: gateway,
        projectId: project.id,
      },
    );

    const profile = getProjectStorageProfile(project);
    const runId = String((secondRun.trace as unknown as Record<string, unknown>).run_id);
    const builderLogPath = resolve(
      process.cwd(),
      profile.topic_runs_dir,
      runId,
      "llm-interactions",
      "01-topic.candidate-builder.md",
    );

    expect(existsSync(builderLogPath)).toBe(true);

    const builderLogContent = readFileSync(builderLogPath, "utf8");
    expect(builderLogContent).toContain("recent_event_memory");
    expect(builderLogContent).toContain("event-a");
  });

  it("preserves prior selected title and angle in builder recent_event_memory for identity reuse", async () => {
    const db = createDbClient();
    const { gateway, invokeApi } = createGatewayWithSelectorResponses(
      [
        [
          {
            ...createRuntimeCandidate(
              "黑斯廷斯战役：诺曼征服英格兰的关键转折",
              "诺曼征服英格兰的决定性一战",
            ),
            event_identity: "黑斯廷斯战役",
          },
          {
            ...createRuntimeCandidate(
              "《大宪章》签署：王权与贵族的权力博弈",
              "限制王权的关键文书时刻",
            ),
            event_identity: "《大宪章》签署",
          },
          {
            ...createRuntimeCandidate(
              "黑死病爆发：中世纪欧洲的灾难与变革",
              "人口崩塌如何重塑欧洲社会",
            ),
            event_identity: "黑死病欧洲大流行",
          },
          createRuntimeCandidate("event-d", "angle-d"),
          createRuntimeCandidate("event-e", "angle-e"),
          createRuntimeCandidate("event-f", "angle-f"),
          createRuntimeCandidate("event-g", "angle-g"),
          createRuntimeCandidate("event-h", "angle-h"),
        ],
        [
          createRuntimeCandidate("event-a-2", "angle-a-2"),
          createRuntimeCandidate("event-b-2", "angle-b-2"),
          createRuntimeCandidate("event-c-2", "angle-c-2"),
          createRuntimeCandidate("event-d-2", "angle-d-2"),
          createRuntimeCandidate("event-e-2", "angle-e-2"),
          createRuntimeCandidate("event-f-2", "angle-f-2"),
          createRuntimeCandidate("event-g-2", "angle-g-2"),
          createRuntimeCandidate("event-h-2", "angle-h-2"),
        ],
      ],
      [
        ["selector_candidate_1", "selector_candidate_2", "selector_candidate_3", "selector_candidate_4"],
        ["selector_candidate_2", "selector_candidate_3", "selector_candidate_4", "selector_candidate_5"],
      ],
    );

    await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "first round establishes realistic recent event memory",
        coreConflict: "builder should later see the actual selected title and angle",
        strongScene: "the first round stores final selections for later builder reuse",
        sourceHint: "test",
        recentUsageHint: "first round",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "second round should receive prior selected title and angle",
        coreConflict: "builder memory should preserve the prior title packaging context",
        strongScene: "recent event memory should carry the actual title and angle",
        sourceHint: "test",
        recentUsageHint: "second round",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    const builderCalls = invokeApi.mock.calls.filter(
      ([request]) => request.operationName === "topic.candidate-builder",
    );
    const secondBuilderInput = builderCalls[1]?.[0]?.input as
      | {
          recent_event_memory?: Array<{
            event_identity: string;
            title: string;
            one_line_angle: string;
          }>;
        }
      | undefined;

    expect(secondBuilderInput?.recent_event_memory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_identity: "黑斯廷斯战役",
          title: "黑斯廷斯战役：诺曼征服英格兰的关键转折",
          one_line_angle: "诺曼征服英格兰的决定性一战",
        }),
      ]),
    );
  });

  it("documents builder identity reuse checks in the topic diversity inspection notes", () => {
    const notesPath = resolve(
      process.cwd(),
      "docs",
      "records",
      "2026-04-30-topic-recommendation-diversity-notes.md",
    );

    const notesContent = readFileSync(notesPath, "utf8");

    expect(notesContent).toContain("检查 builder 是否复用了近期 identity");
    expect(notesContent).toContain("01-topic.candidate-builder.md");
    expect(notesContent).toContain("topic_candidate_builder_repair_triggered");
    expect(notesContent).toContain("topic_candidate_builder_repair_passed");
    expect(notesContent).toContain("topic_candidate_builder_degraded");
    expect(notesContent).toContain("topic-candidate-library");
    expect(notesContent).toContain("fallback_ready");
    expect(notesContent).toContain("raw_generated");
    expect(notesContent).toContain("unused");
    expect(notesContent).toContain("expired");
  });


  it("preserves formal must_cover_preview while normalizing hybrid builder candidates", async () => {
    const db = createDbClient();
    const mustCoverPreview = [
      "The envoy enters a hostile court before the ruler speaks.",
      "The ruler turns the exchange into public humiliation.",
      "The answer forces the room to absorb the political cost.",
    ];
    const { gateway } = createGatewayWithSelectorResponses([
      [
        {
          event_identity: "hybrid-event",
          title: "Hybrid Event",
          one_line_angle: "A public answer turns pressure back on the ruler.",
          must_cover_preview: mustCoverPreview,
          viral_rubric: {
            family_label: "外交压场型",
            scope_label: "单事件",
            historical_significance: "high",
            cultural_resonance: "high",
            shareability_score: "medium",
            drama_score: "high",
            dialogue_sharpness: "medium",
          },
        },
        createRuntimeCandidate("event-b", "angle-b"),
        createRuntimeCandidate("event-c", "angle-c"),
        createRuntimeCandidate("event-d", "angle-d"),
        createRuntimeCandidate("event-e", "angle-e"),
        createRuntimeCandidate("event-f", "angle-f"),
        createRuntimeCandidate("event-g", "angle-g"),
        createRuntimeCandidate("event-h", "angle-h"),
      ],
    ]);

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "hybrid builder output may already contain script-ready beats",
        coreConflict: "normalization should preserve formal script material",
        strongScene: "the first candidate carries must_cover_preview directly",
        sourceHint: "test",
        recentUsageHint: "hybrid builder output",
      },
      {
        llmGateway: gateway,
      },
    );

    expect(result.raw_candidates[0]?.must_cover_preview).toEqual(
      mustCoverPreview,
    );
  });

  it("fills empty must_cover_preview without prioritizing summary prose", async () => {
    const db = createDbClient();
    const { gateway } = createGatewayWithSelectorResponses([
      [
        {
          ...createRuntimeCandidate("event-a", "angle-a"),
          must_cover_preview: [],
        },
        createRuntimeCandidate("event-b", "angle-b"),
        createRuntimeCandidate("event-c", "angle-c"),
        createRuntimeCandidate("event-d", "angle-d"),
        createRuntimeCandidate("event-e", "angle-e"),
        createRuntimeCandidate("event-f", "angle-f"),
        createRuntimeCandidate("event-g", "angle-g"),
        createRuntimeCandidate("event-h", "angle-h"),
      ],
    ]);

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "the seed starts with a public standoff",
        coreConflict: "the protagonist must answer pressure in front of everyone",
        strongScene: "the room goes silent after the public answer",
        sourceHint: "test",
        recentUsageHint: "empty preview from builder",
        canonicalQuotes: [
          "first quote anchor",
          "second quote anchor",
        ],
      },
      {
        llmGateway: gateway,
      },
    );

    expect(result.raw_candidates[0]?.must_cover_preview).toEqual([
      "the room goes silent after the public answer",
      "first quote anchor",
      "second quote anchor",
    ]);
    expect(result.raw_candidates[0]?.must_cover_preview).not.toContain(
      "the seed starts with a public standoff",
    );
  });

  it("repairs hybrid builder candidates that expose one_line_angle before the full TopicCandidateCard contract", async () => {
    const db = createDbClient();
    const { gateway } = createGatewayWithSelectorResponses([
      [
        {
          event_identity: "黑死病",
          title: "黑死病：欧洲社会的崩塌与重生",
          one_line_angle: "人口崩塌如何重塑欧洲社会",
          viral_rubric: {
            family_label: "瘟疫冲击型",
            scope_label: "单事件",
            historical_significance: "high",
            cultural_resonance: "high",
            shareability_score: "medium",
            drama_score: "high",
            dialogue_sharpness: "medium",
          },
        },
        createRuntimeCandidate("event-b", "angle-b"),
        createRuntimeCandidate("event-c", "angle-c"),
        createRuntimeCandidate("event-d", "angle-d"),
        createRuntimeCandidate("event-e", "angle-e"),
        createRuntimeCandidate("event-f", "angle-f"),
        createRuntimeCandidate("event-g", "angle-g"),
        createRuntimeCandidate("event-h", "angle-h"),
      ],
    ]);

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "中世纪欧洲重大历史事件",
        summary: "测试真实 builder 混合返回结构的最小修复。",
        coreConflict: "builder 先给出 angle，但还没补齐完整合同字段。",
        strongScene: "候选本身可用，但当前 runtime 不能直接 parse。",
        sourceHint: "test",
        recentUsageHint: "hybrid builder output",
      },
      {
        llmGateway: gateway,
      },
    );

    expect(result.raw_candidates[0]).toMatchObject({
      event_identity: "黑死病",
      title: "黑死病：欧洲社会的崩塌与重生",
      one_line_angle: "人口崩塌如何重塑欧洲社会",
      family_label: "瘟疫冲击型",
      scope_label: "单事件",
    });
    expect(result.candidates).toHaveLength(4);
  });
});
