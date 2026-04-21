import { describe, expect, it, vi } from "vitest";

import { TopicCandidateCard } from "../../../shared/src/index.js";
import { createDbClient } from "../../../backend/src/db/client.js";
import { createLlmGateway } from "../../../backend/src/runtime/llm/llm-gateway.js";
import { createOpenAiCompatibleProvider } from "../../../backend/src/runtime/llm/openai-compatible-provider.js";
import { createPromptRegistry } from "../../../backend/src/runtime/prompts/prompt-registry.js";
import {
  recommendTopicCandidates,
  recommendTopicCandidatesWithTrace,
} from "../../../backend/src/modules/topic/topic-recommendation.service.js";

const runtimeCandidate = {
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
    title,
    one_line_angle: angle,
  };
}

describe("topic runtime recommendation", () => {
  it("drives candidate generation through the formal prompt registry and caches runtime fields", async () => {
    const db = createDbClient();
    const invokeApi = vi.fn(async () =>
      JSON.stringify([
        createRuntimeCandidate("晏子使楚", "第一槽位"),
        createRuntimeCandidate("张巡守城", "第二槽位"),
        createRuntimeCandidate("于谦守京", "第三槽位"),
      ]),
    );
    const gateway = createLlmGateway({
      registry: createPromptRegistry(),
      provider: createOpenAiCompatibleProvider({
        model: "glm-4.5",
        invokeApi,
      }),
    });

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

  it("repairs minimally malformed runtime output before validating TopicCandidateCard", async () => {
    const db = createDbClient();
    const invokeApi = vi.fn(
      async () => `\`\`\`json
[
  ${JSON.stringify(createRuntimeCandidate("晏子使楚", "第一槽位"))},
  ${JSON.stringify(createRuntimeCandidate("张巡守城", "第二槽位"))},
  ${JSON.stringify(createRuntimeCandidate("于谦守京", "第三槽位"))}
]
\`\`\``,
    );
    const gateway = createLlmGateway({
      registry: createPromptRegistry(),
      provider: createOpenAiCompatibleProvider({
        model: "glm-4.5",
        invokeApi,
      }),
    });

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
    const invokeApi = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify([createRuntimeCandidate("晏子使楚", "第一槽位")]),
      )
      .mockResolvedValueOnce(
        JSON.stringify([
          createRuntimeCandidate("张巡守城", "第二槽位"),
          createRuntimeCandidate("于谦守京", "第三槽位"),
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
});
