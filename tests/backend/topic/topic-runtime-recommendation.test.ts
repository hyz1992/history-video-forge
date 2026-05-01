import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { TopicCandidateCard } from "../../../shared/src/index.js";
import { createDbClient } from "../../../backend/src/db/client.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import * as topicRecommendationServiceModule from "../../../backend/src/modules/topic/topic-recommendation.service.js";
import { saveCachedCandidate } from "../../../backend/src/modules/cache/candidate-cache.repository.js";
import { normalizeEventInput } from "../../../backend/src/modules/topic/event-normalizer.js";
import { createLlmGateway } from "../../../backend/src/runtime/llm/llm-gateway.js";
import { createOpenAiCompatibleProvider } from "../../../backend/src/runtime/llm/openai-compatible-provider.js";
import { createPromptRegistry } from "../../../backend/src/runtime/prompts/prompt-registry.js";
import { getProjectStorageProfile } from "../../../backend/src/runtime/trace/project-storage.js";
import {
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

function createRuntimeCandidate(title: string, angle: string) {
  return {
    ...runtimeCandidate,
    event_identity: title,
    title,
    one_line_angle: angle,
  };
}

function createSelectorDecision(...candidateIds: string[]) {
  return {
    selected_candidate_ids: candidateIds,
  };
}

function createGatewayWithSelectorResponses(
  builderOutputs: Array<unknown>,
  selectorOutputs?: Array<unknown>,
) {
  let builderCallIndex = 0;
  let selectorCallIndex = 0;
  const invokeApi = vi.fn(async ({ operationName, input }: { operationName: string; input: { selector_pool?: Array<{ candidate_id: string }> } }) => {
    if (operationName === "topic.selector") {
      const selectedIds =
        selectorOutputs?.[selectorCallIndex] ??
        (input.selector_pool ?? [])
          .slice(0, 3)
          .map((candidate) => candidate.candidate_id);
      selectorCallIndex += 1;
      return typeof selectedIds === "string"
        ? selectedIds
        : Array.isArray(selectedIds)
          ? JSON.stringify(createSelectorDecision(...selectedIds))
          : JSON.stringify(selectedIds);
    }

    const builderOutput = builderOutputs[builderCallIndex];
    builderCallIndex += 1;

    return typeof builderOutput === "string"
      ? builderOutput
      : JSON.stringify(builderOutput);
  });
  const gateway = createLlmGateway({
    registry: createPromptRegistry(),
    provider: createOpenAiCompatibleProvider({
      model: "glm-4.5",
      invokeApi,
    }),
  });

  return {
    gateway,
    invokeApi,
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
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("rejects malformed topic recommendation payloads missing seed fields", async () => {
    const app = buildApp();
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Malformed Recommendation Payload",
      },
    });
    const projectId = projectResponse.json().project_id as string;

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/recommendations`,
      payload: {
        canonical_name: "",
        summary: "楚王在公开场合连续压场，晏子当场顶回去。",
      },
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
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Candidate Event Identity",
      },
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

    expect(invokeApi).toHaveBeenCalledTimes(2);
    expect(invokeApi).toHaveBeenCalledWith(
      expect.objectContaining({
        operationName: "topic.candidate-builder",
        prompt: expect.objectContaining({
          metadata: expect.objectContaining({
            id: "topic.candidate-builder",
            language: "zh-CN",
          }),
        }),
      }),
    );
    expect(candidates).toHaveLength(3);
    expect(() => TopicCandidateCard.parse(candidates[0])).not.toThrow();

    const cacheRecords = [...db.candidateCache.values()];
    expect(cacheRecords).toHaveLength(3);
    expect(cacheRecords[0]).toMatchObject({
      oneLineAngle: "第一槽位",
      familyLabel: runtimeCandidate.family_label,
      scopeLabel: runtimeCandidate.scope_label,
      coreConflict: runtimeCandidate.core_conflict,
      strongScene: runtimeCandidate.strong_scene,
    });
    expect(cacheRecords[0]).not.toHaveProperty("title");
  });

  it("keeps raw recommendation pool larger than final delivery size", async () => {
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

    expect(result.raw_candidates).toHaveLength(8);
    expect(result.candidates).toHaveLength(3);
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

    expect(invokeApi).toHaveBeenCalledTimes(2);
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
      [["selector_candidate_1", "selector_candidate_2", "selector_candidate_3"]],
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

    expect(invokeApi).toHaveBeenCalledTimes(3);
    expect(result.candidates).toHaveLength(3);
    expect(result.diagnostics.checks).toContainEqual(
      expect.objectContaining({
        code: "topic_candidate_repair_triggered",
      }),
    );
  });

  it("returns explicit diagnostics when the repair call still cannot fill all three slots", async () => {
    const db = createDbClient();
    const invokeApi = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify([createRuntimeCandidate("晏子使楚", "第一槽位")]),
      )
      .mockResolvedValueOnce(JSON.stringify([]));
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
        level: "error",
      }),
    );
  });

  it("filters duplicate event identities from a single open-discovery recommendation round", async () => {
    const db = createDbClient();
    const invokeApi = vi.fn(async () =>
      JSON.stringify([
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
          { ...createRuntimeCandidate("title-b-v2", "angle-b-2"), event_identity: "event-b" },
          { ...createRuntimeCandidate("title-c-v2", "angle-c-2"), event_identity: "event-c" },
          { ...createRuntimeCandidate("title-d-v2", "angle-d-2"), event_identity: "event-d" },
          { ...createRuntimeCandidate("title-e-v2", "angle-e-2"), event_identity: "event-e" },
          { ...createRuntimeCandidate("title-f-v2", "angle-f-2"), event_identity: "event-f" },
          { ...createRuntimeCandidate("title-g-v2", "angle-g-2"), event_identity: "event-g" },
          { ...createRuntimeCandidate("title-h-v2", "angle-h-2"), event_identity: "event-h" },
        ],
      ],
      [
        ["selector_candidate_1", "selector_candidate_2", "selector_candidate_3"],
        ["selector_candidate_2", "selector_candidate_3", "selector_candidate_4"],
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
    expect(result.candidates[0]?.title).toBe("title-b-v2");
  });

  it("asks topic.selector to choose final candidates from the selector pool", async () => {
    const db = createDbClient();
    const invokeApi = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify([
          createRuntimeCandidate("event-a", "angle-a"),
          createRuntimeCandidate("event-b", "angle-b"),
          createRuntimeCandidate("event-c", "angle-c"),
          createRuntimeCandidate("event-d", "angle-d"),
          createRuntimeCandidate("event-e", "angle-e"),
          createRuntimeCandidate("event-f", "angle-f"),
          createRuntimeCandidate("event-g", "angle-g"),
          createRuntimeCandidate("event-h", "angle-h"),
        ]),
      )
      .mockResolvedValueOnce(
        JSON.stringify(
          createSelectorDecision(
            "selector_candidate_4",
            "selector_candidate_2",
            "selector_candidate_6",
          ),
        ),
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
        summary: "selector should choose the final delivered candidates",
        coreConflict: "the final three should come from selector output rather than direct local truncation",
        strongScene: "selector picks a non-top-three combination from the prepared pool",
        sourceHint: "test",
        recentUsageHint: "none",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    expect(result.selector_trace).toBeDefined();
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.map((candidate) => candidate.title)).toEqual([
      "event-d",
      "event-b",
      "event-f",
    ]);
  });

  it("accepts selector outputs returned through the common answer field and trims extra valid ids", async () => {
    const db = createDbClient();
    const invokeApi = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify([
          createRuntimeCandidate("event-a", "angle-a"),
          createRuntimeCandidate("event-b", "angle-b"),
          createRuntimeCandidate("event-c", "angle-c"),
          createRuntimeCandidate("event-d", "angle-d"),
          createRuntimeCandidate("event-e", "angle-e"),
          createRuntimeCandidate("event-f", "angle-f"),
          createRuntimeCandidate("event-g", "angle-g"),
          createRuntimeCandidate("event-h", "angle-h"),
        ]),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          answer: [
            "selector_candidate_1",
            "selector_candidate_2",
            "selector_candidate_4",
            "selector_candidate_6",
          ],
        }),
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
        summary: "selector outputs may arrive through a generic answer field",
        coreConflict: "selector normalization must tolerate primary-provider response wrappers",
        strongScene: "the final candidates should still be resolved from ids inside answer",
        sourceHint: "test",
        recentUsageHint: "none",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    expect(result.candidates.map((candidate) => candidate.title)).toEqual([
      "event-a",
      "event-b",
      "event-d",
    ]);
  });

  it("accepts selector outputs returned through selected_candidates", async () => {
    const db = createDbClient();
    const invokeApi = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify([
          createRuntimeCandidate("event-a", "angle-a"),
          createRuntimeCandidate("event-b", "angle-b"),
          createRuntimeCandidate("event-c", "angle-c"),
          createRuntimeCandidate("event-d", "angle-d"),
          createRuntimeCandidate("event-e", "angle-e"),
          createRuntimeCandidate("event-f", "angle-f"),
          createRuntimeCandidate("event-g", "angle-g"),
          createRuntimeCandidate("event-h", "angle-h"),
        ]),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          selected_candidates: [
            "selector_candidate_1",
            "selector_candidate_2",
            "selector_candidate_5",
            "selector_candidate_6",
          ],
        }),
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
        summary: "selector outputs may also arrive through selected_candidates",
        coreConflict: "selector normalization must tolerate another real-provider wrapper",
        strongScene: "the final candidates should still be resolved from ids inside selected_candidates",
        sourceHint: "test",
        recentUsageHint: "none",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    expect(result.candidates.map((candidate) => candidate.title)).toEqual([
      "event-a",
      "event-b",
      "event-e",
    ]);
  });

  it("rejects selector outputs that reference unknown candidate ids", async () => {
    const db = createDbClient();
    const invokeApi = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify([
          createRuntimeCandidate("event-a", "angle-a"),
          createRuntimeCandidate("event-b", "angle-b"),
          createRuntimeCandidate("event-c", "angle-c"),
          createRuntimeCandidate("event-d", "angle-d"),
          createRuntimeCandidate("event-e", "angle-e"),
          createRuntimeCandidate("event-f", "angle-f"),
          createRuntimeCandidate("event-g", "angle-g"),
          createRuntimeCandidate("event-h", "angle-h"),
        ]),
      )
      .mockResolvedValueOnce(
        JSON.stringify(
          createSelectorDecision(
            "selector_candidate_1",
            "selector_candidate_999",
            "selector_candidate_3",
          ),
        ),
      );
    const gateway = createLlmGateway({
      registry: createPromptRegistry(),
      provider: createOpenAiCompatibleProvider({
        model: "glm-4.5",
        invokeApi,
      }),
    });

    await expect(
      recommendTopicCandidatesWithTrace(
        db,
        {
          canonicalName: "seed-a",
          summary: "invalid selector ids should fail loudly",
          coreConflict: "selector must not reference candidates outside the pool",
          strongScene: "unknown ids should be rejected before final candidates are published",
          sourceHint: "test",
          recentUsageHint: "none",
        },
        {
          llmGateway: gateway,
          projectId: "project-1",
        },
      ),
    ).rejects.toThrow("topic_selector_invalid_selection");
  });

  it("triggers one controlled repair when selector pool cannot supply three valid final picks", async () => {
    const db = createDbClient();
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
      ],
      [
        ["selector_candidate_4", "selector_candidate_2"],
        ["selector_candidate_6"],
      ],
    );

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "selector repair should backfill missing valid picks once",
        coreConflict: "the first selector pass returns too few valid ids",
        strongScene: "repair should fill the last missing slot without replacing the valid kept picks",
        sourceHint: "test",
        recentUsageHint: "none",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    expect(result.diagnostics.checks).toContainEqual(
      expect.objectContaining({ code: "topic_selector_repair_triggered" }),
    );
    expect(result.candidates.map((candidate) => candidate.title)).toEqual([
      "event-d",
      "event-b",
      "event-f",
    ]);
  });

  it("does not retry selector repairs indefinitely", async () => {
    const db = createDbClient();
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
      ],
      [
        ["selector_candidate_4", "selector_candidate_2"],
        ["selector_candidate_6"],
      ],
    );

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "selector repair should stop after one extra attempt",
        coreConflict: "repair count must stay bounded at one additional selector pass",
        strongScene: "the trace should show at most one repair attempt",
        sourceHint: "test",
        recentUsageHint: "none",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    expect(result.selector_trace?.repair_attempts ?? 0).toBeLessThanOrEqual(1);
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
    vi.useFakeTimers();
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
        invokeApi: vi.fn(async () => "not-json"),
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
    const invokeApi = vi.fn(async () => JSON.stringify([runtimeCandidate]));
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
      JSON.stringify([
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
    const runId = String((result.trace as Record<string, unknown>).run_id);
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

  it("sends recent_event_memory to topic.selector", async () => {
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
        ["selector_candidate_1", "selector_candidate_2", "selector_candidate_3"],
        ["selector_candidate_2", "selector_candidate_3", "selector_candidate_4"],
      ],
    );

    await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "first round establishes recent event memory",
        coreConflict: "selector should later see prior selected events",
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
        summary: "second round should send recent event memory to selector",
        coreConflict: "selector input should include prior selected events",
        strongScene: "recent event memory must be present before final selection",
        sourceHint: "test",
        recentUsageHint: "second round",
      },
      {
        llmGateway: gateway,
        projectId: "project-1",
      },
    );

    const selectorCalls = invokeApi.mock.calls.filter(
      ([request]) => request.operationName === "topic.selector",
    );
    const secondSelectorInput = selectorCalls[1]?.[0]?.input as
      | { recent_event_memory?: Array<{ event_identity: string }> }
      | undefined;

    expect(secondSelectorInput?.recent_event_memory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_identity: "event-a",
        }),
      ]),
    );
  });

  it("records selector recent event memory in llm interaction trace", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Topic Selector Recent Memory Trace",
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
        ["selector_candidate_1", "selector_candidate_2", "selector_candidate_3"],
        ["selector_candidate_2", "selector_candidate_3", "selector_candidate_4"],
      ],
    );

    await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "first round establishes recent event memory",
        coreConflict: "selector should later see prior selected events",
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
        summary: "second round should write recent event memory into selector trace",
        coreConflict: "selector trace should show the recent event memory it consumed",
        strongScene: "trace inspection should expose recent event memory clearly",
        sourceHint: "test",
        recentUsageHint: "second round",
      },
      {
        llmGateway: gateway,
        projectId: project.id,
      },
    );

    const profile = getProjectStorageProfile(project);
    const runId = String((secondRun.trace as Record<string, unknown>).run_id);
    const selectorLogPath = resolve(
      process.cwd(),
      profile.topic_runs_dir,
      runId,
      "llm-interactions",
      "02-topic.selector.md",
    );

    expect(existsSync(selectorLogPath)).toBe(true);

    const selectorLogContent = readFileSync(selectorLogPath, "utf8");
    expect(selectorLogContent).toContain("recent_event_memory");
    expect(selectorLogContent).toContain("event-a");
  });

  it("accepts selector repair outputs returned through answer.selected_candidates", async () => {
    const db = createDbClient();
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
      [
        ["selector_candidate_1", "selector_candidate_2"],
        {
          answer: {
            selected_candidates: ["selector_candidate_3"],
          },
        },
      ],
    );

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "selector repair may wrap ids under answer.selected_candidates",
        coreConflict: "repair output shape should still be accepted",
        strongScene: "the selector keeps two ids and repairs one missing slot",
        sourceHint: "test",
        recentUsageHint: "repair nested answer",
      },
      {
        llmGateway: gateway,
      },
    );

    expect(result.candidates.map((candidate) => candidate.title)).toEqual([
      "event-a",
      "event-b",
      "event-c",
    ]);
    expect(result.selector_trace).toMatchObject({
      selected_candidate_ids: [
        "selector_candidate_1",
        "selector_candidate_2",
        "selector_candidate_3",
      ],
      repair_attempts: 1,
    });
  });
});
