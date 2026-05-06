import { describe, expect, it, vi } from "vitest";

const { invokeStructuredPromptMock } = vi.hoisted(() => ({
  invokeStructuredPromptMock: vi.fn(),
}));

const runtimeCandidate = {
  event_identity: "晏子使楚",
  title: "晏子使楚",
  one_line_angle: "运行时返回的角度，不应再走 deterministic builder。",
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

function mockTopicRuntimeResponses(builderOutputs: unknown[]) {
  let builderCallIndex = 0;
  invokeStructuredPromptMock.mockImplementation(async ({ operationName }) => {
    if (operationName === "topic.selector") {
      return {
        selected_candidate_ids: [
          "selector_candidate_1",
          "selector_candidate_2",
          "selector_candidate_3",
        ],
      };
    }

    const output =
      builderOutputs[Math.min(builderCallIndex, builderOutputs.length - 1)];
    builderCallIndex += 1;
    return output;
  });
}

vi.mock("../../../backend/src/config/env.js", () => ({
  env: {
    nodeEnv: "test",
    databaseUrl: "file:./test.db",
    promptAssetsDir: process.cwd().replace(/\\/g, "/") + "/harness/prompts",
    llm: {
      provider: "openai",
      baseUrl: "https://llm.example.test/v1",
      apiKey: "test-key",
      model: "glm-4.5",
      structuredModel: "glm-4.5",
      timeoutMs: 45000,
    },
  },
}));
vi.mock("../../../backend/src/modules/topic/topic-candidate.builder.js", () => ({
  buildTopicCandidates: vi.fn(() => {
    throw new Error("deterministic builder should not be called by runtime api path");
  }),
}));

vi.mock("../../../backend/src/runtime/llm/openai-compatible-provider.js", () => ({
  createOpenAiCompatibleProvider: vi.fn(() => ({
    invokeStructuredPrompt: invokeStructuredPromptMock,
  })),
}));

import { buildApp } from "../../../backend/src/app.js";

describe("topic api runtime", () => {
  it("uses the runtime path for topic recommendations while preserving the frozen api shape", async () => {
    invokeStructuredPromptMock.mockReset();
    mockTopicRuntimeResponses([
      [
        createRuntimeCandidate("晏子使楚", "第一槽位"),
        createRuntimeCandidate("张巡守城", "第二槽位"),
        createRuntimeCandidate("于谦守京", "第三槽位"),
      ],
    ]);

    const app = buildApp();
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Runtime Recommendation Flow",
      },
    });
    const projectId = projectResponse.json().project_id as string;

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/recommendations`,
      payload: {
        canonical_name: "晏子使楚",
        summary: "楚王在公开场合连续压场，晏子当场顶回去。",
        core_conflict: "楚王当众压场，晏子必须当场顶回。",
        strong_scene: "楚王连续压场，晏子一句句顶回去。",
        source_hint: "《晏子春秋》",
        recent_usage_hint: "近期未出现同 event_id",
        tags: ["diplomacy", "court", "humiliation", "showdown"],
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body).toMatchObject({
      project_id: projectId,
      event_id: expect.any(String),
    });
    expect(body.candidates).toHaveLength(3);
    expect(body.candidates[0]).toMatchObject({
      candidate_id: expect.any(String),
      title: "晏子使楚",
      one_line_angle: "第一槽位",
      family_label: "外交压场型",
      scope_label: "单事件",
      viral_rubric: runtimeCandidate.viral_rubric,
    });
  });

  it("carries must_cover_preview from recommendation into confirmed topic package", async () => {
    const mustCoverPreview = [
      "The envoy steps into a court arranged to shame him.",
      "The ruler presses the insult in front of the whole room.",
      "The answer turns the insult into a cost for the ruler.",
    ];
    invokeStructuredPromptMock.mockReset();
    mockTopicRuntimeResponses([
      [
        {
          ...createRuntimeCandidate(
            "Yanzi Envoy",
            "The answer flips public pressure.",
          ),
          event_identity: "yanzi-envoy",
          must_cover_preview: mustCoverPreview,
        },
        {
          ...createRuntimeCandidate(
            "Zhang Xun Defense",
            "The city holds under pressure.",
          ),
          event_identity: "zhang-xun-defense",
        },
        {
          ...createRuntimeCandidate(
            "Yu Qian Capital",
            "The court must choose whether to stand.",
          ),
          event_identity: "yu-qian-capital",
        },
      ],
    ]);

    const app = buildApp();
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Must Cover Preview Flow",
      },
    });
    const projectId = projectResponse.json().project_id as string;

    const recommendationResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/recommendations`,
      payload: {
        canonical_name: "晏子使楚",
        summary: "楚王在公开场合连续压场，晏子当场顶回去。",
        core_conflict: "楚王当众压场，晏子必须当场顶回。",
        strong_scene: "楚王连续压场，晏子一句句顶回去。",
        source_hint: "《晏子春秋》",
        recent_usage_hint: "近期未出现同 event_id",
        tags: ["diplomacy", "court", "humiliation", "showdown"],
      },
    });

    expect(recommendationResponse.statusCode).toBe(200);
    const recommendationBody = recommendationResponse.json();
    const candidateId = recommendationBody.candidates[0].candidate_id as string;

    expect(
      recommendationBody.current_round.candidates[0].must_cover_preview,
    ).toEqual(mustCoverPreview);

    const confirmResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/candidates/${candidateId}/confirm`,
    });

    expect(confirmResponse.statusCode).toBe(200);
    expect(confirmResponse.json().topic_package.must_include_beats).toEqual(
      mustCoverPreview,
    );
  });

  it("repairs to three slots and exposes diagnostics when the initial runtime output is insufficient", async () => {
    invokeStructuredPromptMock.mockReset();
    mockTopicRuntimeResponses([
      [createRuntimeCandidate("晏子使楚", "第一槽位")],
      [
        createRuntimeCandidate("张巡守城", "第二槽位"),
        createRuntimeCandidate("于谦守京", "第三槽位"),
      ],
    ]);

    const app = buildApp();
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Runtime Recommendation Flow",
      },
    });
    const projectId = projectResponse.json().project_id as string;

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/recommendations`,
      payload: {
        canonical_name: "晏子使楚",
        summary: "楚王在公开场合连续压场，晏子当场顶回去。",
        core_conflict: "楚王当众压场，晏子必须当场顶回。",
        strong_scene: "楚王连续压场，晏子一句句顶回去。",
        source_hint: "《晏子春秋》",
        recent_usage_hint: "近期未出现同 event_id",
        tags: ["diplomacy", "court", "humiliation", "showdown"],
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.candidates).toHaveLength(3);
    expect(body.runtime_diagnostics.checks).toContainEqual(
      expect.objectContaining({
        code: "topic_candidate_repair_triggered",
      }),
    );
    const builderCalls = invokeStructuredPromptMock.mock.calls.filter(
      ([request]) => request.operationName !== "topic.selector",
    );
    expect(builderCalls).toHaveLength(2);
  });

  it("returns project-scoped current and historical topic rounds after multiple recommendation runs", async () => {
    invokeStructuredPromptMock.mockReset();
    mockTopicRuntimeResponses([
      [
        createRuntimeCandidate("晏子使楚", "第一槽位"),
        createRuntimeCandidate("张巡守城", "第二槽位"),
        createRuntimeCandidate("于谦守京", "第三槽位"),
      ],
    ]);

    const app = buildApp();
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Topic Round History",
      },
    });
    const projectId = projectResponse.json().project_id as string;

    await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/recommendations`,
      payload: {
        canonical_name: "晏子使楚",
        summary: "楚王在公开场合连续压场，晏子当场顶回去。",
        core_conflict: "楚王当众压场，晏子必须当场顶回。",
        strong_scene: "楚王连续压场，晏子一句句顶回去。",
        source_hint: "《晏子春秋》",
        recent_usage_hint: "近期未出现同 event_id",
        tags: ["diplomacy", "court", "humiliation", "showdown"],
      },
    });

    const secondResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/recommendations`,
      payload: {
        canonical_name: "晏子使楚",
        summary: "第二次运行，用于测试项目内多轮候选历史。",
        core_conflict: "同一项目下连续生成两轮候选。",
        strong_scene: "第二轮生成结束后仍能看到上一轮。",
        source_hint: "《晏子春秋》",
        recent_usage_hint: "同一项目再次生成",
        tags: ["diplomacy", "history"],
      },
    });

    expect(secondResponse.statusCode).toBe(200);

    const body = secondResponse.json();
    expect(body).toMatchObject({
      project_id: projectId,
      current_round: {
        round_id: expect.any(String),
        candidates: expect.any(Array),
      },
      history_rounds: expect.any(Array),
    });
    expect(body.current_round.candidates).toHaveLength(3);
    expect(body.history_rounds).toHaveLength(1);
    expect(body.history_rounds[0]).toMatchObject({
      round_id: expect.any(String),
      candidates: expect.any(Array),
    });
    expect(body.history_rounds[0].candidates).toHaveLength(3);
  });
});
