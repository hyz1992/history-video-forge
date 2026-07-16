import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import { projectTopicSelectorPool } from "../../backend/src/modules/topic/topic-selector-prompt-projection.js";
import { TOPIC_SELECTOR_STRICT_SCHEMA } from "../../backend/src/modules/topic/topic-recommendation.service.js";
import { createOpenAiCompatibleProvider } from "../../backend/src/runtime/llm/openai-compatible-provider.js";
import {
  DEFAULT_TOPIC_SELECTOR_SEMANTIC_FIXTURE_SET_PATH,
  buildTopicSelectorSemanticReplayPlan,
  createTopicSelectorSemanticReplayLiveRunner,
  evaluateTopicSelectorSemanticFixture,
  getProductionConsistencyIssueSet,
  loadTopicSelectorSemanticFixtureSet,
  parseTopicSelectorSemanticReplayArgs,
  runTopicSelectorSemanticReplay,
  type TopicSelectorSemanticFixture,
} from "../../harness/scripts/runtime/topic-selector-semantic-replay.js";

const sandboxDirs: string[] = [];

function makeSandbox(label: string) {
  const dir = mkdtempSync(join(tmpdir(), `topic-selector-replay-${label}-`));
  sandboxDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of sandboxDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createProviderDecision(
  fixture: TopicSelectorSemanticFixture,
  issues: Record<string, string> = {},
) {
  const ranked_candidates = fixture.selector_input.selector_pool.map(
    (candidate, index) => ({
      candidate_id: candidate.candidate_id,
      quality_rank: index + 1,
      quality_score: 100 - index,
      deductions: [],
      risk_summary: "fixture risk summary",
      consistency_status:
        (issues[candidate.candidate_id] ?? "none") === "none" ? "pass" : "risk",
      primary_consistency_issue: issues[candidate.candidate_id] ?? "none",
      consistency_note:
        (issues[candidate.candidate_id] ?? "none") === "none"
          ? "fixture candidate fields are internally consistent"
          : `fixture note for ${candidate.candidate_id}`,
    }),
  );

  return {
    ranked_candidates,
  };
}

function createInternalDecision(
  fixture: TopicSelectorSemanticFixture,
  issues: Record<string, string> = {},
) {
  return {
    ranked_candidates: fixture.selector_input.selector_pool.map((candidate) => ({
      candidate_id: candidate.candidate_id,
      primary_consistency_issue: issues[candidate.candidate_id] ?? "none",
    })),
  };
}

function createObservation(fixtureId: string) {
  return {
    model: "glm-5.2",
    prompt_id: "topic.selector",
    prompt_sha256: "a".repeat(64),
    effective_request: {
      strategy: "tool_call",
      thinking: "disabled",
      toolChoice: "target_function",
      maxAttempts: 1,
    },
    attempt_count: 1,
    duration_ms: 10,
    usage: {
      prompt_tokens: 100,
      completion_tokens: 20,
      reasoning_tokens: 0,
    },
    finish_reason: "tool_calls",
    tool_arguments_chars: 100 + fixtureId.length,
    error_code: null,
  };
}

describe("topic selector semantic replay fixtures", () => {
  it("loads the two Task 17 selector inputs and their audited annotations", () => {
    const fixtures = loadTopicSelectorSemanticFixtureSet();

    expect(DEFAULT_TOPIC_SELECTOR_SEMANTIC_FIXTURE_SET_PATH).toBe(
      "harness/samples/topic-selector-semantic-replay/fixture-set.md",
    );
    expect(fixtures.map((item) => item.fixture_id)).toEqual([
      "task17-high-tension",
      "task17-balanced",
    ]);
    expect(
      fixtures.every((item) => item.selector_input.selector_pool.length === 8),
    ).toBe(true);

    expect(fixtures[0].source).toMatchObject({
      project_id: "5fda1609-63ed-4f0d-b47a-bb48038b3a6a",
      topic_run_id: "topic_run_3d8da9c7-aaaa-43f9-80fe-5cc5549ec95f",
      baseline_observation: "all_none",
    });
    expect(fixtures[0].annotations).toMatchObject([
      {
        candidate_id: "selector_candidate_7",
        expected_risk: true,
        expected_issue: "actor_role_mismatch",
      },
      {
        candidate_id: "selector_candidate_3",
        expected_risk: false,
        expected_issue: "none",
      },
    ]);

    expect(fixtures[1].source).toMatchObject({
      project_id: "3858fbdc-18c1-4095-ac72-55f9d4adb4b1",
      topic_run_id: "topic_run_f5a2648f-7ade-45b5-958d-ce4f8cab1e5c",
      baseline_observation: "all_none",
    });
    expect(fixtures[1].annotations).toMatchObject([
      {
        candidate_id: "selector_candidate_3",
        expected_risk: true,
        expected_issue: "overclaim_or_ambiguity",
      },
      {
        candidate_id: "selector_candidate_7",
        expected_risk: true,
        expected_issue: "overclaim_or_ambiguity",
      },
      {
        candidate_id: "selector_candidate_5",
        expected_risk: false,
        expected_issue: "none",
      },
    ]);

    const annotations = fixtures.flatMap((item) => item.annotations);
    expect(annotations.filter((item) => item.expected_risk)).toHaveLength(3);
    expect(annotations.filter((item) => !item.expected_risk)).toHaveLength(2);
    expect(annotations.every((item) => item.rationale.length > 0)).toBe(true);
  });

  it("reads the allowed issue labels from the production strict schema", () => {
    expect(getProductionConsistencyIssueSet()).toEqual(
      new Set([
        "none",
        "actor_role_mismatch",
        "action_event_mismatch",
        "cause_outcome_mismatch",
        "scope_boundary_mismatch",
        "language_contamination",
        "overclaim_or_ambiguity",
      ]),
    );
  });

  it("keeps every saved selector pool compatible with the production projection", () => {
    const fixtures = loadTopicSelectorSemanticFixtureSet();

    for (const fixture of fixtures) {
      const before = structuredClone(fixture.selector_input.selector_pool);
      const projected = projectTopicSelectorPool(
        fixture.selector_input.selector_pool.map((candidate) => ({
          ...candidate,
          normalized_event_identity: String(candidate.event_identity),
          viral_rubric: null,
          recently_seen: Number(candidate.fatigue_score) > 0,
        })) as never,
      );

      expect(projected).toEqual(fixture.selector_input.selector_pool);
      expect(fixture.selector_input.selector_pool).toEqual(before);
    }
  });
});

describe("topic selector semantic replay request guard", () => {
  it("builds a selector-only plan without spending requests", () => {
    expect(buildTopicSelectorSemanticReplayPlan()).toMatchObject({
      mode: "topic_selector_semantic_replay_plan",
      live: false,
      automated_gate: false,
      selector_only: true,
      fixture_set_path: DEFAULT_TOPIC_SELECTOR_SEMANTIC_FIXTURE_SET_PATH,
      fixture_count: 2,
      required_requests: 2,
      actual_requests: 0,
    });
    expect(buildTopicSelectorSemanticReplayPlan().required_checks).toContain(
      "不得使用本地字符串规则替代语义判断",
    );
  });

  it("keeps the default run offline and writes only a dry-run plan", async () => {
    const outputDir = makeSandbox("dry-run");
    let runnerCreated = 0;

    const result = await runTopicSelectorSemanticReplay(
      { outputDir },
      {
        createLiveRunner: (() => {
          runnerCreated += 1;
          throw new Error("live runner must not be created in dry-run");
        }) as never,
      },
    );

    expect(runnerCreated).toBe(0);
    expect(result).toMatchObject({ live: false, actual_requests: 0 });
    expect(existsSync(join(outputDir, "replay-plan.json"))).toBe(true);
    expect(existsSync(join(outputDir, "replay-summary.json"))).toBe(false);
    expect(JSON.parse(readFileSync(join(outputDir, "replay-plan.json"), "utf8")))
      .toMatchObject({ live: false, actual_requests: 0 });
  });

  it("parses both equals and separated live option forms", () => {
    expect(
      parseTopicSelectorSemanticReplayArgs([
        "--live",
        "--confirm-live",
        "--model=glm-5.2",
        "--max-requests",
        "2",
        "--max-cost-cny=1.5",
      ]),
    ).toMatchObject({
      live: true,
      confirmLive: true,
      model: "glm-5.2",
      maxRequests: 2,
      maxCostCny: 1.5,
    });
  });

  it.each([
    [
      "missing confirmation",
      { live: true, model: "glm-5.2", maxRequests: 2, maxCostCny: 1 },
      "topic_selector_semantic_replay_live_confirmation_required",
    ],
    [
      "missing model",
      { live: true, confirmLive: true, maxRequests: 2, maxCostCny: 1 },
      "topic_selector_semantic_replay_model_required",
    ],
    [
      "wrong model",
      {
        live: true,
        confirmLive: true,
        model: "glm-4",
        maxRequests: 2,
        maxCostCny: 1,
      },
      "topic_selector_semantic_replay_model_must_be_glm_5_2",
    ],
    [
      "insufficient request budget",
      {
        live: true,
        confirmLive: true,
        model: "glm-5.2",
        maxRequests: 1,
        maxCostCny: 1,
      },
      "topic_selector_semantic_replay_request_budget_must_equal_fixture_count",
    ],
    [
      "excess request budget",
      {
        live: true,
        confirmLive: true,
        model: "glm-5.2",
        maxRequests: 3,
        maxCostCny: 1,
      },
      "topic_selector_semantic_replay_request_budget_must_equal_fixture_count",
    ],
    [
      "missing cost declaration",
      {
        live: true,
        confirmLive: true,
        model: "glm-5.2",
        maxRequests: 2,
      },
      "topic_selector_semantic_replay_cost_budget_required",
    ],
  ])("rejects %s before creating the live runner", async (_label, input, code) => {
    let runnerCreated = 0;

    await expect(
      runTopicSelectorSemanticReplay(input, {
        createLiveRunner: (() => {
          runnerCreated += 1;
          throw new Error("runner should not be created");
        }) as never,
      }),
    ).rejects.toThrow(code);
    expect(runnerCreated).toBe(0);
  });

  it("loads fixtures before creating a live runner", async () => {
    let runnerCreated = 0;

    await expect(
      runTopicSelectorSemanticReplay(
        {
          live: true,
          confirmLive: true,
          model: "glm-5.2",
          maxRequests: 2,
          maxCostCny: 1,
          fixtureSetPath: "harness/samples/missing-fixture-set.md",
        },
        {
          createLiveRunner: (() => {
            runnerCreated += 1;
            throw new Error("runner should not be created");
          }) as never,
        },
      ),
    ).rejects.toThrow();
    expect(runnerCreated).toBe(0);
  });
});

describe("topic selector semantic replay evaluation and live orchestration", () => {
  it("passes the primary gate when all risks are recalled and records enum drift separately", async () => {
    const outputDir = makeSandbox("live-pass");
    const called: string[] = [];

    const result = await runTopicSelectorSemanticReplay(
      {
        live: true,
        confirmLive: true,
        model: "glm-5.2",
        maxRequests: 2,
        maxCostCny: 1,
        outputDir,
      },
      {
        createLiveRunner: () => ({
          runFixture: async (fixture) => {
            called.push(fixture.fixture_id);
            const issues = fixture.fixture_id === "task17-high-tension"
              ? { selector_candidate_7: "actor_role_mismatch" }
              : {
                  selector_candidate_3: "cause_outcome_mismatch",
                  selector_candidate_7: "overclaim_or_ambiguity",
                };
            return {
              decision: createInternalDecision(fixture, issues),
              observation: createObservation(fixture.fixture_id),
            };
          },
        }),
      },
    );

    expect(called).toEqual(["task17-high-tension", "task17-balanced"]);
    expect(result).toMatchObject({
      mode: "topic_selector_semantic_replay",
      live: true,
      automated_gate: false,
      selector_only: true,
      total_fixtures: 2,
      planned_requests: 2,
      actual_requests: 2,
      expected_risk_count: 3,
      recalled_risk_count: 3,
      none_control_count: 2,
      passed_none_control_count: 2,
      exact_enum_match_count: 2,
      primary_gate_passed: true,
    });
    expect(
      result.results.flatMap((item) => item.annotations).map((item) => item.status),
    ).toContain("risk_recalled_enum_differed");
    expect(existsSync(join(outputDir, "replay-summary.json"))).toBe(true);
    expect(existsSync(join(outputDir, "task17-high-tension.result.json"))).toBe(true);
    expect(existsSync(join(outputDir, "task17-balanced.result.json"))).toBe(true);
    expect(existsSync(join(outputDir, "trace.md"))).toBe(true);

    const reportText = readFileSync(join(outputDir, "replay-summary.json"), "utf8");
    expect(reportText).not.toContain("靖康城破");
    expect(reportText).not.toContain("rawOutput");
    expect(reportText).not.toContain("systemPrompt");
    expect(reportText).not.toContain("api_key");
  });

  it("classifies a missed risk and a failed none control without reading candidate text", () => {
    const [highTension] = loadTopicSelectorSemanticFixtureSet();
    const missed = evaluateTopicSelectorSemanticFixture(
      highTension,
      createInternalDecision(highTension),
    );
    const falsePositive = evaluateTopicSelectorSemanticFixture(
      highTension,
      createInternalDecision(highTension, {
        selector_candidate_7: "actor_role_mismatch",
        selector_candidate_3: "overclaim_or_ambiguity",
      }),
    );

    expect(missed.annotations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidate_id: "selector_candidate_7",
          status: "risk_missed",
        }),
      ]),
    );
    expect(falsePositive.annotations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidate_id: "selector_candidate_3",
          status: "none_control_failed",
        }),
      ]),
    );
  });

  it("marks missing or unknown candidate coverage as structural failure", () => {
    const [fixture] = loadTopicSelectorSemanticFixtureSet();
    const missing = createInternalDecision(fixture);
    missing.ranked_candidates.pop();
    const unknown = createInternalDecision(fixture);
    unknown.ranked_candidates[0].candidate_id = "unknown_candidate";

    expect(evaluateTopicSelectorSemanticFixture(fixture, missing)).toMatchObject({
      structural_failed: true,
      error_code: "topic_selector_semantic_replay_candidate_coverage_mismatch",
    });
    expect(evaluateTopicSelectorSemanticFixture(fixture, unknown)).toMatchObject({
      structural_failed: true,
      error_code: "topic_selector_semantic_replay_candidate_coverage_mismatch",
    });
  });

  it("does not retry a failed fixture and continues with the second budgeted fixture", async () => {
    const called: string[] = [];

    const result = await runTopicSelectorSemanticReplay(
      {
        live: true,
        confirmLive: true,
        model: "glm-5.2",
        maxRequests: 2,
        maxCostCny: 1,
        outputDir: makeSandbox("live-first-fails"),
      },
      {
        createLiveRunner: () => ({
          runFixture: async (fixture) => {
            called.push(fixture.fixture_id);
            if (fixture.fixture_id === "task17-high-tension") {
              throw new Error("strict failure");
            }
            return {
              decision: createInternalDecision(fixture, {
                selector_candidate_3: "overclaim_or_ambiguity",
                selector_candidate_7: "overclaim_or_ambiguity",
              }),
              observation: createObservation(fixture.fixture_id),
            };
          },
        }),
      },
    );

    expect(called).toEqual(["task17-high-tension", "task17-balanced"]);
    expect(result.actual_requests).toBe(2);
    expect(result.results[0]).toMatchObject({ structural_failed: true });
    expect(result.primary_gate_passed).toBe(false);
  });

  it("uses the production gateway, strict schema, parser, target tool, and one attempt", async () => {
    const [fixture] = loadTopicSelectorSemanticFixtureSet();
    const providerDecision = createProviderDecision(fixture, {
      selector_candidate_7: "actor_role_mismatch",
    });
    const argumentsJson = JSON.stringify(providerDecision);
    let capturedRequest: Record<string, any> | undefined;

    const provider = createOpenAiCompatibleProvider({
      profile: "structured",
      model: "glm-5.2",
      maxAttempts: 1,
      invokeStrictApi: vi.fn(async (request) => {
        capturedRequest = request as unknown as Record<string, any>;
        return {
          rawOutput: argumentsJson,
          content: argumentsJson,
          argumentsJson,
          metadata: {
            finishReason: "tool_calls",
            promptTokens: 100,
            completionTokens: 20,
            reasoningTokens: 0,
          },
        };
      }) as never,
    });
    const runner = createTopicSelectorSemanticReplayLiveRunner("glm-5.2", {
      createProvider: () => provider,
    });

    const result = await runner.runFixture(fixture);

    expect(capturedRequest?.schema).toBe(TOPIC_SELECTOR_STRICT_SCHEMA);
    const parameters = capturedRequest?.schema.parameters as Record<string, any>;
    const properties = parameters.properties as Record<string, any>;
    const scorecard = properties.ranked_candidates.items;
    expect(parameters.required).toEqual(["ranked_candidates"]);
    expect(properties).not.toHaveProperty("consistency_risk_notes");
    expect(scorecard.required).toEqual(
      expect.arrayContaining([
        "consistency_status",
        "primary_consistency_issue",
        "consistency_note",
      ]),
    );
    expect(scorecard.properties).not.toHaveProperty("consistency_issue");
    expect(capturedRequest?.prompt.metadata.id).toBe("topic.selector");
    expect(capturedRequest?.input).toEqual(fixture.selector_input);
    expect(capturedRequest?.options).toMatchObject({
      strategy: "tool_call",
      thinking: "disabled",
      toolChoice: "target_function",
    });
    expect(result.decision.ranked_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidate_id: "selector_candidate_7",
          consistency_status: "risk",
          primary_consistency_issue: "actor_role_mismatch",
        }),
      ]),
    );
    expect(result.observation).toMatchObject({
      model: "glm-5.2",
      prompt_id: "topic.selector",
      attempt_count: 1,
      tool_arguments_chars: argumentsJson.length,
      finish_reason: "tool_calls",
    });
    expect(result.observation.prompt_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.observation.effective_request).toMatchObject({
      maxAttempts: 1,
      strategy: "tool_call",
      thinking: "disabled",
      toolChoice: "target_function",
    });
  });

  it("exposes the replay as a non-default npm command", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts).toMatchObject({
      "harness:topic-selector-semantic-replay":
        "tsx harness/scripts/runtime/topic-selector-semantic-replay.ts",
    });
  });
});
