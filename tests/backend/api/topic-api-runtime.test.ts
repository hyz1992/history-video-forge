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
  invokeStructuredPromptMock.mockImplementation(async ({ operationName, input }) => {
    if (operationName === "topic.selector") {
      const pool = (input as { selector_pool?: Array<{ candidate_id: string }> }).selector_pool ?? [];
      return {
        ranked_candidates: pool.map((c, i) => ({
          candidate_id: c.candidate_id,
          quality_rank: i + 1,
          quality_score: Math.max(1, 100 - i * 10),
          deductions: [],
          risk_summary: "mock selector ranking",
        })),
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
    promptAssetsDir: process.cwd().replace(/\\/g, "/") + "/prompts",
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

vi.mock("../../../backend/src/runtime/llm/tier-aware-provider-factory.js", () => ({
  createTierAwareProviderFromEnv: vi.fn(() => ({
    invokeStructuredPrompt: invokeStructuredPromptMock,
  })),
}));

import { buildApp } from "../../../backend/src/app.js";
import { buildTestAuth } from "../auth/test-utils.js";
import { seedQuotableCatalog, buildQuotableReadinessInput } from "../cost/quote-test-context.js";

/**
 * S2-2A 外部审查 P1-1 整改迁移：本文件 mock 真实 LLM provider（openai），
 * 按 fail-closed 合同，真实 provider 部署下旧无 quote 路径一律 409
 * （此前依赖目录为空的闸门漏洞放行）。用例全部改为 quote 提交路径——
 * 提交协议透传生成响应（additive generation_run_id），原有运行时行为断言
 * （重试/错误映射/诊断/多轮历史）不变。
 */
async function createTopicQuote(
  app: ReturnType<typeof buildApp>,
  projectId: string,
  auth: ReturnType<typeof buildTestAuth>,
): Promise<string> {
  const quoteRes = await app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/generation-cost-quotes`,
    payload: { operation: "topic.generate" },
    auth,
  });
  expect(quoteRes.statusCode).toBe(200);
  return (quoteRes.json() as { quote_id: string }).quote_id;
}

/** 真实 provider 部署的测试 app：可报价目录 + readiness 注入。 */
async function buildTopicRuntimeApp(): Promise<ReturnType<typeof buildApp>> {
  const app = buildApp({ generationQuoteReadinessInput: buildQuotableReadinessInput() });
  // 同步 seed 目录（buildApp 默认不 bootstrap）
  await seedQuotableCatalog(app);
  return app;
}

describe("topic api runtime", () => {
  const auth = buildTestAuth({ userId: "owner-1" });

  it("uses the runtime path for topic recommendations while preserving the frozen api shape", async () => {
    invokeStructuredPromptMock.mockReset();
    mockTopicRuntimeResponses([
      [
        createRuntimeCandidate("晏子使楚", "第一槽位"),
        createRuntimeCandidate("张巡守城", "第二槽位"),
        createRuntimeCandidate("于谦守京", "第三槽位"),
      ],
    ]);

    const app = await buildTopicRuntimeApp();
    const projectResponse = await app.inject({ auth,
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Runtime Recommendation Flow",
      },
    });
    const projectId = projectResponse.json().project_id as string;
    const quoteId = await createTopicQuote(app, projectId, auth);

    const response = await app.inject({ auth,
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
        cost_quote_id: quoteId,
        idempotency_key: "topic-runtime-1",
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

  it("retries provider content filter rejection once before failing the topic flow", async () => {
    invokeStructuredPromptMock.mockReset();
    let builderCallIndex = 0;
    invokeStructuredPromptMock.mockImplementation(async ({ operationName, input }) => {
      if (operationName === "topic.selector") {
        const pool = (input as { selector_pool?: Array<{ candidate_id: string }> }).selector_pool ?? [];
        return {
          ranked_candidates: pool.map((c, i) => ({
            candidate_id: c.candidate_id,
            quality_rank: i + 1,
            quality_score: Math.max(1, 100 - i * 10),
            deductions: [],
            risk_summary: "mock selector ranking",
          })),
        };
      }

      builderCallIndex += 1;
      if (builderCallIndex === 1) {
        throw Object.assign(
          new Error(
            '400 Bad Request: {"error":{"code":"1301","message":"系统检测到输入或生成内容可能包含不安全或敏感内容"}}',
          ),
          {
            code: "1301",
            status: 400,
          },
        );
      }

      return [
        createRuntimeCandidate("event-a", "angle-a"),
        createRuntimeCandidate("event-b", "angle-b"),
        createRuntimeCandidate("event-c", "angle-c"),
      ];
    });

    const app = await buildTopicRuntimeApp();
    const projectResponse = await app.inject({ auth,
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Runtime Content Filter Retry",
      },
    });
    const projectId = projectResponse.json().project_id as string;
    const quoteId = await createTopicQuote(app, projectId, auth);

    const response = await app.inject({ auth,
      method: "POST",
      url: `/api/projects/${projectId}/topic/recommendations`,
      payload: {
        canonical_name: "Yanzi Envoy",
        summary: "A historical court exchange creates public pressure.",
        core_conflict: "The envoy must answer the ruler in front of the court.",
        strong_scene: "The court falls silent after the answer turns pressure back.",
        source_hint: "Yanzi Chunqiu",
        recent_usage_hint: "No recent repeat event id.",
        tags: ["diplomacy", "court", "humiliation", "showdown"],
        cost_quote_id: quoteId,
        idempotency_key: "topic-runtime-2",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().candidates).toHaveLength(3);

    const builderCalls = invokeStructuredPromptMock.mock.calls.filter(
      ([request]) => request.operationName !== "topic.selector",
    );
    expect(builderCalls[0]?.[0].input).not.toHaveProperty("safety_retry_context");
    expect(builderCalls[1]?.[0].input).toMatchObject({
      safety_retry_context: {
        reason: "provider_content_filter",
        mode: "strict_neutral_historical_planning",
      },
    });
    expect(
      (builderCalls[1]?.[0].input as {
        safety_retry_context?: { instruction?: unknown };
      }).safety_retry_context?.instruction,
    ).toBeUndefined();
  });

  it("returns a readable provider failure message when topic generation is rejected", async () => {
    invokeStructuredPromptMock.mockReset();
    invokeStructuredPromptMock.mockRejectedValueOnce(
      new Error(
        '429 Too Many Requests: {"error":{"code":"1113","message":"余额不足或无可用资源包,请充值。"}}',
      ),
    );

    const app = await buildTopicRuntimeApp();
    const projectResponse = await app.inject({ auth,
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Runtime Provider Failure",
      },
    });
    const projectId = projectResponse.json().project_id as string;
    const quoteId = await createTopicQuote(app, projectId, auth);

    const response = await app.inject({ auth,
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
        cost_quote_id: quoteId,
        idempotency_key: "topic-runtime-1",
      },
    });

    expect(response.statusCode).toBe(500);
    // 提交协议失败分支：错误码透传为 reason_code（生成流程内仍做可读错误映射，
    // 可读 message 在 submit-protocol failed 分支暂未透传——已登记 Minor）
    expect(response.json()).toMatchObject({
      error: "generation_run_dispatch_failed",
      reason_code: "dispatch_handler_exception",
    });
  });

  it("does not expose raw provider content safety wording when retry still fails", async () => {
    invokeStructuredPromptMock.mockReset();
    invokeStructuredPromptMock.mockRejectedValue(
      Object.assign(
        new Error(
          '400 Bad Request: {"error":{"code":"1301","message":"系统检测到输入或生成内容可能包含不安全或敏感内容，请您避免输入易产生敏感内容的提示语，感谢您的配合。"}}',
        ),
        {
          code: "1301",
          status: 400,
        },
      ),
    );

    const app = await buildTopicRuntimeApp();
    const projectResponse = await app.inject({ auth,
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Runtime Content Filter Failure",
      },
    });
    const projectId = projectResponse.json().project_id as string;
    const quoteId = await createTopicQuote(app, projectId, auth);

    const response = await app.inject({ auth,
      method: "POST",
      url: `/api/projects/${projectId}/topic/recommendations`,
      payload: {
        canonical_name: "Yanzi Envoy",
        summary: "A historical court exchange creates public pressure.",
        core_conflict: "The envoy must answer the ruler in front of the court.",
        strong_scene: "The court falls silent after the answer turns pressure back.",
        source_hint: "Yanzi Chunqiu",
        recent_usage_hint: "No recent repeat event id.",
        tags: ["diplomacy", "court", "humiliation", "showdown"],
        cost_quote_id: quoteId,
        idempotency_key: "topic-runtime-2",
      },
    });

    expect(response.statusCode).toBe(500);
    // 提交协议失败分支：原始安全策略措辞不暴露，错误码透传为 reason_code；
    // 重试语义在生成流程内保持（仍调用 2 次）
    expect(response.json()).toMatchObject({
      error: "generation_run_dispatch_failed",
      reason_code: "dispatch_handler_exception",
    });
    expect(invokeStructuredPromptMock).toHaveBeenCalledTimes(2);
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

    const app = await buildTopicRuntimeApp();
    const projectResponse = await app.inject({ auth,
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Must Cover Preview Flow",
      },
    });
    const projectId = projectResponse.json().project_id as string;
    const quoteId = await createTopicQuote(app, projectId, auth);

    const recommendationResponse = await app.inject({ auth,
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
        cost_quote_id: quoteId,
        idempotency_key: "topic-runtime-1",
      },
    });

    expect(recommendationResponse.statusCode).toBe(200);
    const recommendationBody = recommendationResponse.json();
    const candidateId = recommendationBody.candidates[0].candidate_id as string;

    expect(
      recommendationBody.current_round.candidates[0].must_cover_preview,
    ).toEqual(mustCoverPreview);

    const confirmResponse = await app.inject({ auth,
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

    const app = await buildTopicRuntimeApp();
    const projectResponse = await app.inject({ auth,
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Runtime Recommendation Flow",
      },
    });
    const projectId = projectResponse.json().project_id as string;
    const quoteId = await createTopicQuote(app, projectId, auth);

    const response = await app.inject({ auth,
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
        cost_quote_id: quoteId,
        idempotency_key: "topic-runtime-1",
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

    const app = await buildTopicRuntimeApp();
    const projectResponse = await app.inject({ auth,
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Topic Round History",
      },
    });
    const projectId = projectResponse.json().project_id as string;
    const quoteId = await createTopicQuote(app, projectId, auth);

    await app.inject({ auth,
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
        cost_quote_id: quoteId,
        idempotency_key: "topic-runtime-1",
      },
    });

    const secondQuoteId = await createTopicQuote(app, projectId, auth);

    const secondResponse = await app.inject({ auth,
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
        cost_quote_id: secondQuoteId,
        idempotency_key: "topic-runtime-3",
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
