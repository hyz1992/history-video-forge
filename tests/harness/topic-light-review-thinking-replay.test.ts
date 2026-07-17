import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import { TOPIC_LIGHT_REVIEW_STRICT_SCHEMA } from "../../backend/src/modules/topic/topic-light-review.js";
import type { LlmInteractionLogEntry } from "../../backend/src/runtime/llm/interaction-log.js";

import {
  buildTopicLightReviewThinkingReplayPlan,
  buildTopicLightReviewThinkingReplaySummary,
  createTopicLightReviewThinkingReplayRunner,
  DEFAULT_TOPIC_LIGHT_REVIEW_THINKING_FIXTURE_PATH,
  loadTopicLightReviewThinkingReplayFixture,
  parseTopicLightReviewThinkingReplayArgs,
  runTopicLightReviewThinkingReplay,
  toTopicLightReviewThinkingReplayObservation,
  type TopicLightReviewThinkingReplayFixture,
  type TopicLightReviewThinkingReplayRoundResult,
} from "../../harness/scripts/runtime/topic-light-review-thinking-replay.js";

const sandboxDirs: string[] = [];

const SOURCE_CONTROLS = [
  {
    sourcePath:
      "harness/samples/topic-selector-semantic-replay/task17-high-tension.fixture.json",
    sourceCandidateId: "selector_candidate_7",
    mappedCandidateId: "high_tension_risk_jingkang",
  },
  {
    sourcePath:
      "harness/samples/topic-selector-semantic-replay/task17-high-tension.fixture.json",
    sourceCandidateId: "selector_candidate_3",
    mappedCandidateId: "high_tension_none_xuanwumen",
  },
  {
    sourcePath:
      "harness/samples/topic-selector-semantic-replay/task17-balanced.fixture.json",
    sourceCandidateId: "selector_candidate_3",
    mappedCandidateId: "balanced_risk_hongmenyan",
  },
  {
    sourcePath:
      "harness/samples/topic-selector-semantic-replay/task17-balanced.fixture.json",
    sourceCandidateId: "selector_candidate_5",
    mappedCandidateId: "balanced_none_wugu",
  },
] as const;

interface SourceSelectorFixture {
  selector_input: {
    selector_pool: Array<Record<string, unknown> & { candidate_id: string }>;
  };
  annotations: Array<Record<string, unknown> & { candidate_id: string }>;
}

afterAll(() => {
  for (const dir of sandboxDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeFixture(
  fixture: TopicLightReviewThinkingReplayFixture,
  label: string,
) {
  const dir = mkdtempSync(join(tmpdir(), `topic-light-review-${label}-`));
  sandboxDirs.push(dir);
  const fixturePath = join(dir, "fixture.json");
  writeFileSync(fixturePath, JSON.stringify(fixture), "utf8");
  return fixturePath;
}

function makeSandbox(label: string) {
  const dir = mkdtempSync(join(tmpdir(), `topic-light-review-${label}-`));
  sandboxDirs.push(dir);
  return dir;
}

function cloneFixture(): TopicLightReviewThinkingReplayFixture {
  return structuredClone(loadTopicLightReviewThinkingReplayFixture());
}

function makePassingRounds(): [
  TopicLightReviewThinkingReplayRoundResult,
  TopicLightReviewThinkingReplayRoundResult,
] {
  const fixture = loadTopicLightReviewThinkingReplayFixture();
  const verdicts = fixture.annotations.map(
    ({ candidate_id, expected_issue }) => ({
      candidate_id,
      consistency_issue: expected_issue,
    }),
  );
  const baseEffectiveRequest = {
    profile: "structured",
    model: "glm-5.2",
    strategy: "tool_call",
    thinking: "provider_default",
    timeoutMs: 120_000,
    maxAttempts: 1,
    maxTokens: 2_000,
    temperature: 0.2,
    topP: 0.9,
    toolChoice: "target_function",
  };
  const baseObservation = {
    model: "glm-5.2",
    prompt_id: "topic.light-review",
    prompt_sha256: "a".repeat(64),
    attempt_count: 1,
    prompt_tokens: 1_200,
    completion_tokens: 120,
    finish_reason: "tool_calls",
    tool_arguments_chars: 320,
    error_code: null,
  };

  return [
    {
      status: "success",
      verdicts,
      observation: {
        ...baseObservation,
        mode: "provider_default",
        effective_request: baseEffectiveRequest,
        duration_ms: 50_000,
        reasoning_tokens: 15_000,
      },
    },
    {
      status: "success",
      verdicts,
      observation: {
        ...baseObservation,
        mode: "disabled",
        effective_request: {
          ...baseEffectiveRequest,
          thinking: "disabled",
        },
        duration_ms: 20_000,
        reasoning_tokens: 0,
      },
    },
  ];
}

function loadMappedSourceControls() {
  return SOURCE_CONTROLS.map(
    ({ sourcePath, sourceCandidateId, mappedCandidateId }) => {
      const source = JSON.parse(
        readFileSync(sourcePath, "utf8"),
      ) as SourceSelectorFixture;
      const sourceCandidate = source.selector_input.selector_pool.find(
        (candidate) => candidate.candidate_id === sourceCandidateId,
      );
      const sourceAnnotation = source.annotations.find(
        (annotation) => annotation.candidate_id === sourceCandidateId,
      );
      if (!sourceCandidate || !sourceAnnotation) {
        throw new Error(`missing source control: ${sourceCandidateId}`);
      }

      const {
        candidate_id: _sourceCandidateId,
        fatigue_score: _fatigueScore,
        risk_hints: _riskHints,
        ...candidateBody
      } = sourceCandidate;
      const { candidate_id: _sourceAnnotationId, ...annotationBody } =
        sourceAnnotation;

      return {
        candidate: {
          candidate_id: mappedCandidateId,
          ...candidateBody,
        },
        annotation: {
          candidate_id: mappedCandidateId,
          ...annotationBody,
        },
      };
    },
  );
}

describe("topic light review thinking replay fixture", () => {
  it("loads four unique audited controls", () => {
    const fixture = loadTopicLightReviewThinkingReplayFixture();
    const candidateIds = fixture.review_pool.map(
      (candidate) => candidate.candidate_id,
    );

    expect(candidateIds).toEqual([
      "high_tension_risk_jingkang",
      "high_tension_none_xuanwumen",
      "balanced_risk_hongmenyan",
      "balanced_none_wugu",
    ]);
    expect(new Set(candidateIds).size).toBe(4);
    expect(fixture.annotations.map((annotation) => annotation.candidate_id)).toEqual(
      candidateIds,
    );
    expect(
      fixture.annotations.filter((annotation) => annotation.expected_risk),
    ).toHaveLength(2);
    expect(
      fixture.annotations.filter(
        (annotation) => annotation.expected_issue === "none",
      ),
    ).toHaveLength(2);
    expect(
      fixture.annotations.every(
        (annotation) => annotation.rationale.trim().length > 0,
      ),
    ).toBe(true);
  });

  it("copies the four source controls without field drift", () => {
    const fixture = loadTopicLightReviewThinkingReplayFixture();
    const sourceControls = loadMappedSourceControls();

    expect(fixture.review_pool).toEqual(
      sourceControls.map((control) => control.candidate),
    );
    expect(fixture.annotations).toEqual(
      sourceControls.map((control) => control.annotation),
    );
  });

  it("validates production candidate fields and annotation consistency", () => {
    const requiredStringFields = [
      "candidate_id",
      "title",
      "one_line_angle",
      "core_conflict",
      "strong_scene",
      "event_identity",
      "family_label",
      "scope_label",
    ] as const;

    for (const field of requiredStringFields) {
      const fixture = cloneFixture();
      fixture.review_pool[0][field] = " ";
      expect(() =>
        loadTopicLightReviewThinkingReplayFixture(
          writeFixture(fixture, `empty-${field}`),
        ),
      ).toThrow("topic_light_review_thinking_fixture_invalid_candidate");
    }

    for (const previews of [[], ["valid", " "]]) {
      const fixture = cloneFixture();
      fixture.review_pool[0].must_cover_preview = previews;
      expect(() =>
        loadTopicLightReviewThinkingReplayFixture(
          writeFixture(fixture, "invalid-preview"),
        ),
      ).toThrow("topic_light_review_thinking_fixture_invalid_candidate");
    }

    const invalidFinalStatus = cloneFixture();
    invalidFinalStatus.annotations[0].entered_final_candidates = "true" as never;
    expect(() =>
      loadTopicLightReviewThinkingReplayFixture(
        writeFixture(invalidFinalStatus, "invalid-final-status"),
      ),
    ).toThrow("topic_light_review_thinking_fixture_invalid_annotation");

    const riskMarkedNone = cloneFixture();
    riskMarkedNone.annotations[0].expected_issue = "none";
    expect(() =>
      loadTopicLightReviewThinkingReplayFixture(
        writeFixture(riskMarkedNone, "risk-marked-none"),
      ),
    ).toThrow("topic_light_review_thinking_fixture_risk_issue_mismatch");

    const noneMarkedRisk = cloneFixture();
    noneMarkedRisk.annotations[1].expected_issue = "actor_role_mismatch";
    expect(() =>
      loadTopicLightReviewThinkingReplayFixture(
        writeFixture(noneMarkedRisk, "none-marked-risk"),
      ),
    ).toThrow("topic_light_review_thinking_fixture_risk_issue_mismatch");
  });

  it("rejects duplicate candidate ids", () => {
    const fixture = cloneFixture();
    fixture.review_pool[1].candidate_id = fixture.review_pool[0].candidate_id;

    expect(() =>
      loadTopicLightReviewThinkingReplayFixture(
        writeFixture(fixture, "duplicate-id"),
      ),
    ).toThrow("topic_light_review_thinking_fixture_duplicate_candidate_id");
  });

  it("rejects an expected issue outside the production schema enum", () => {
    const fixture = cloneFixture();
    fixture.annotations[0].expected_issue = "invented_issue" as never;

    expect(() =>
      loadTopicLightReviewThinkingReplayFixture(
        writeFixture(fixture, "invalid-issue"),
      ),
    ).toThrow("topic_light_review_thinking_fixture_invalid_expected_issue");
  });

  it("requires four controls with both risk and none annotations", () => {
    const fixture = cloneFixture();
    fixture.review_pool.pop();
    fixture.annotations.pop();

    expect(() =>
      loadTopicLightReviewThinkingReplayFixture(
        writeFixture(fixture, "invalid-count"),
      ),
    ).toThrow("topic_light_review_thinking_fixture_requires_four_candidates");

    const allRiskFixture = cloneFixture();
    for (const annotation of allRiskFixture.annotations) {
      annotation.expected_risk = true;
      annotation.expected_issue = "actor_role_mismatch";
    }

    expect(() =>
      loadTopicLightReviewThinkingReplayFixture(
        writeFixture(allRiskFixture, "missing-none"),
      ),
    ).toThrow("topic_light_review_thinking_fixture_requires_risk_and_none");
  });

  it("requires a non-empty rationale for every annotation", () => {
    const fixture = cloneFixture();
    fixture.annotations[0].rationale = " ";

    expect(() =>
      loadTopicLightReviewThinkingReplayFixture(
        writeFixture(fixture, "empty-rationale"),
      ),
    ).toThrow("topic_light_review_thinking_fixture_rationale_required");
  });
});

describe("topic light review thinking replay request guard", () => {
  it("builds a fixed light-review-only two-request dry-run plan", () => {
    expect(buildTopicLightReviewThinkingReplayPlan()).toEqual({
      mode: "topic_light_review_thinking_replay_plan",
      live: false,
      automated_gate: false,
      light_review_only: true,
      fixture_path: DEFAULT_TOPIC_LIGHT_REVIEW_THINKING_FIXTURE_PATH,
      required_requests: 2,
      actual_requests: 0,
    });
  });

  it("keeps the default run offline and writes only replay-plan.json", async () => {
    const outputDir = makeSandbox("dry-run");
    let runnerCreated = 0;

    const result = await runTopicLightReviewThinkingReplay(
      { outputDir },
      {
        createLiveRunner: () => {
          runnerCreated += 1;
          throw new Error("live runner must not be created in dry-run");
        },
      },
    );

    expect(runnerCreated).toBe(0);
    expect(result).toEqual({
      mode: "topic_light_review_thinking_replay_plan",
      live: false,
      automated_gate: false,
      light_review_only: true,
      fixture_path: DEFAULT_TOPIC_LIGHT_REVIEW_THINKING_FIXTURE_PATH,
      required_requests: 2,
      actual_requests: 0,
    });
    expect(readdirSync(outputDir)).toEqual(["replay-plan.json"]);
    expect(
      JSON.parse(readFileSync(join(outputDir, "replay-plan.json"), "utf8")),
    ).toEqual(result);
  });

  it.each([
    ["model equals", ["--model=glm-5.2"], { model: "glm-5.2" }],
    ["model separated", ["--model", "glm-5.2"], { model: "glm-5.2" }],
    ["max requests equals", ["--max-requests=2"], { maxRequests: 2 }],
    ["max requests separated", ["--max-requests", "2"], { maxRequests: 2 }],
    ["max cost equals", ["--max-cost-cny=1.5"], { maxCostCny: 1.5 }],
    ["max cost separated", ["--max-cost-cny", "1.5"], { maxCostCny: 1.5 }],
  ])("parses %s CLI form", (_label, argv, expected) => {
    expect(parseTopicLightReviewThinkingReplayArgs(argv)).toMatchObject(expected);
  });

  it("parses fixture and output directory value forms", () => {
    expect(
      parseTopicLightReviewThinkingReplayArgs([
        "--fixture",
        "custom/fixture.json",
        "--output-dir=custom/output",
      ]),
    ).toMatchObject({
      fixturePath: "custom/fixture.json",
      outputDir: "custom/output",
    });
  });

  it.each([
    ["--thinking=disabled"],
    ["--unknown"],
    ["unexpected-positional-value"],
  ])("rejects unsupported CLI argument %s", (argument) => {
    expect(() =>
      parseTopicLightReviewThinkingReplayArgs([argument]),
    ).toThrow("topic_light_review_thinking_replay_argument_unsupported");
  });

  it.each([
    [
      "missing confirmation",
      {
        live: true,
        model: "glm-5.2",
        maxRequests: 2,
        maxCostCny: 1,
      },
      "topic_light_review_thinking_replay_live_confirmation_required",
    ],
    [
      "missing model",
      {
        live: true,
        confirmLive: true,
        maxRequests: 2,
        maxCostCny: 1,
      },
      "topic_light_review_thinking_replay_model_required",
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
      "topic_light_review_thinking_replay_model_must_be_glm_5_2",
    ],
    [
      "missing request budget",
      {
        live: true,
        confirmLive: true,
        model: "glm-5.2",
        maxCostCny: 1,
      },
      "topic_light_review_thinking_replay_request_budget_must_equal_two",
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
      "topic_light_review_thinking_replay_request_budget_must_equal_two",
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
      "topic_light_review_thinking_replay_request_budget_must_equal_two",
    ],
    [
      "missing cost declaration",
      {
        live: true,
        confirmLive: true,
        model: "glm-5.2",
        maxRequests: 2,
      },
      "topic_light_review_thinking_replay_cost_budget_required",
    ],
    [
      "negative cost declaration",
      {
        live: true,
        confirmLive: true,
        model: "glm-5.2",
        maxRequests: 2,
        maxCostCny: -1,
      },
      "topic_light_review_thinking_replay_cost_budget_required",
    ],
    [
      "zero cost declaration",
      {
        live: true,
        confirmLive: true,
        model: "glm-5.2",
        maxRequests: 2,
        maxCostCny: 0,
      },
      "topic_light_review_thinking_replay_cost_budget_required",
    ],
    [
      "infinite cost declaration",
      {
        live: true,
        confirmLive: true,
        model: "glm-5.2",
        maxRequests: 2,
        maxCostCny: Number.POSITIVE_INFINITY,
      },
      "topic_light_review_thinking_replay_cost_budget_required",
    ],
    [
      "NaN cost declaration",
      {
        live: true,
        confirmLive: true,
        model: "glm-5.2",
        maxRequests: 2,
        maxCostCny: Number.NaN,
      },
      "topic_light_review_thinking_replay_cost_budget_required",
    ],
  ])("rejects %s before creating the live runner", async (_label, input, code) => {
    let runnerCreated = 0;

    await expect(
      runTopicLightReviewThinkingReplay(input, {
        createLiveRunner: () => {
          runnerCreated += 1;
          throw new Error("runner should not be created");
        },
      }),
    ).rejects.toThrow(code);
    expect(runnerCreated).toBe(0);
  });

  it("uses one injected live runner after every guard passes", async () => {
    let runnerCreated = 0;
    let fixtureId: string | undefined;
    const outputDir = makeSandbox("injected-live-output");
    const rounds = makePassingRounds();
    const expectedResult = {
      mode: "topic_light_review_thinking_replay" as const,
      live: true as const,
      automated_gate: false as const,
      light_review_only: true as const,
      fixture_id: "task17-controls",
      actual_requests: 2 as const,
      rounds,
      summary: buildTopicLightReviewThinkingReplaySummary(
        loadTopicLightReviewThinkingReplayFixture().annotations,
        rounds,
      ),
    };

    const result = await runTopicLightReviewThinkingReplay(
      {
        live: true,
        confirmLive: true,
        model: "glm-5.2",
        maxRequests: 2,
        maxCostCny: 1,
        outputDir,
      },
      {
        createLiveRunner: () => {
          runnerCreated += 1;
          return {
            async runFixture(fixture) {
              fixtureId = fixture.fixture_id;
              return expectedResult;
            },
          };
        },
      },
    );

    expect(result).toBe(expectedResult);
    expect(runnerCreated).toBe(1);
    expect(fixtureId).toBe("task17-controls");
    expect(readdirSync(outputDir).sort()).toEqual([
      "disabled.result.json",
      "provider-default.result.json",
      "replay-plan.json",
      "replay-summary.json",
      "trace.md",
    ]);
    expect(
      JSON.parse(readFileSync(join(outputDir, "provider-default.result.json"), "utf8")),
    ).toEqual(rounds[0]);
    expect(
      JSON.parse(readFileSync(join(outputDir, "disabled.result.json"), "utf8")),
    ).toEqual(rounds[1]);
    expect(
      JSON.parse(readFileSync(join(outputDir, "replay-summary.json"), "utf8")),
    ).toEqual(expectedResult.summary);

    const publicArtifacts = readdirSync(outputDir)
      .map((fileName) => readFileSync(join(outputDir, fileName), "utf8"))
      .join("\n");
    const fixture = loadTopicLightReviewThinkingReplayFixture();
    for (const candidate of fixture.review_pool) {
      expect(publicArtifacts).not.toContain(candidate.title);
      expect(publicArtifacts).not.toContain(candidate.one_line_angle);
      expect(publicArtifacts).not.toContain(candidate.core_conflict);
      expect(publicArtifacts).not.toContain(candidate.strong_scene);
    }
    for (const forbidden of [
      "systemPrompt",
      "rawOutput",
      '"input"',
      "apiKey",
      "baseURL",
      "provider rejected",
    ]) {
      expect(publicArtifacts).not.toContain(forbidden);
    }
  });

  it("loads and validates the fixture before creating the live runner", async () => {
    let runnerCreated = 0;

    await expect(
      runTopicLightReviewThinkingReplay(
        {
          live: true,
          confirmLive: true,
          model: "glm-5.2",
          maxRequests: 2,
          maxCostCny: 1,
          fixturePath: join(makeSandbox("missing-fixture"), "missing.json"),
        },
        {
          createLiveRunner: () => {
            runnerCreated += 1;
            throw new Error("runner should not be created");
          },
        },
      ),
    ).rejects.toThrow();
    expect(runnerCreated).toBe(0);
  });

  it("exposes one explicit non-default npm command", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts).toMatchObject({
      "harness:topic-light-review-thinking-replay":
        "tsx harness/scripts/runtime/topic-light-review-thinking-replay.ts",
    });
    expect(
      Object.keys(packageJson.scripts ?? {}).filter((name) =>
        name.includes("topic-light-review-thinking-replay"),
      ),
    ).toEqual(["harness:topic-light-review-thinking-replay"]);
  });
});

describe("topic light review thinking replay live runner", () => {
  it("runs one shared-budget provider-default and disabled request", async () => {
    const fixture = loadTopicLightReviewThinkingReplayFixture();
    const decision = {
      candidate_reviews: fixture.review_pool.map((candidate, index) => ({
        candidate_id: candidate.candidate_id,
        consistency_issue:
          index === 0 ? "actor_role_mismatch" : "none",
        note:
          index === 0
            ? `${candidate.title}；${candidate.one_line_angle}`
            : "",
      })),
    };
    const verdicts = decision.candidate_reviews.map(
      ({ candidate_id, consistency_issue }) => ({
        candidate_id,
        consistency_issue,
      }),
    );
    const argumentsJson = JSON.stringify(decision);
    const invokeStrictApi = vi.fn(async () => ({
      rawOutput: argumentsJson,
      content: argumentsJson,
      argumentsJson,
      metadata: {
        finishReason: "tool_calls",
        promptTokens: 120,
        completionTokens: 24,
        reasoningTokens: 0,
      },
    }));
    const runner = createTopicLightReviewThinkingReplayRunner("glm-5.2", {
      invokeStrictApi: invokeStrictApi as never,
    });

    const result = await runner.runFixture(fixture);

    expect(invokeStrictApi).toHaveBeenCalledTimes(2);
    const firstRequest = invokeStrictApi.mock.calls[0][0] as Record<string, any>;
    const secondRequest = invokeStrictApi.mock.calls[1][0] as Record<string, any>;
    expect(firstRequest.prompt.metadata.id).toBe("topic.light-review");
    expect(secondRequest.prompt.metadata.id).toBe("topic.light-review");
    expect(firstRequest.operationName).toBe(
      "topic.light-review-thinking-replay",
    );
    expect(secondRequest.operationName).toBe(firstRequest.operationName);
    expect(firstRequest.input).toEqual(fixture.review_pool);
    expect(secondRequest.input).toEqual(firstRequest.input);
    expect(firstRequest.schema).toBe(TOPIC_LIGHT_REVIEW_STRICT_SCHEMA);
    expect(secondRequest.schema).toBe(firstRequest.schema);
    expect(firstRequest.model).toBe("glm-5.2");
    expect(secondRequest.model).toBe(firstRequest.model);
    expect(firstRequest.options).toMatchObject({
      strategy: "tool_call",
      toolChoice: "target_function",
    });
    expect(secondRequest.options).toMatchObject({
      strategy: "tool_call",
      thinking: "disabled",
      toolChoice: "target_function",
    });
    expect(firstRequest.options.thinking).toBeUndefined();
    expect(JSON.stringify(firstRequest.options)).not.toContain("thinking");
    expect(JSON.stringify(secondRequest.options)).toContain(
      '"thinking":"disabled"',
    );
    expect({ ...firstRequest, options: { ...firstRequest.options, thinking: undefined } }).toEqual(
      { ...secondRequest, options: { ...secondRequest.options, thinking: undefined } },
    );

    expect(result.rounds).toHaveLength(2);
    expect(result.rounds.map((round) => round.verdicts)).toEqual([
      verdicts,
      verdicts,
    ]);
    expect(result.rounds[0].observation).toMatchObject({
      mode: "provider_default",
      model: "glm-5.2",
      prompt_id: "topic.light-review",
      effective_request: {
        profile: "structured",
        strategy: "tool_call",
        thinking: "provider_default",
        maxAttempts: 1,
        toolChoice: "target_function",
      },
      attempt_count: 1,
      prompt_tokens: 120,
      completion_tokens: 24,
      reasoning_tokens: 0,
      finish_reason: "tool_calls",
      tool_arguments_chars: argumentsJson.length,
      error_code: null,
    });
    expect(result.rounds[0].observation.prompt_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.rounds[1].observation).toMatchObject({
      mode: "disabled",
      effective_request: { thinking: "disabled", maxAttempts: 1 },
      attempt_count: 1,
    });
    const {
      thinking: _defaultThinking,
      ...defaultEffectiveRequest
    } = result.rounds[0].observation.effective_request!;
    const {
      thinking: _disabledThinking,
      ...disabledEffectiveRequest
    } = result.rounds[1].observation.effective_request!;
    expect(disabledEffectiveRequest).toEqual(defaultEffectiveRequest);
    const publicResultJson = JSON.stringify(result);
    expect(publicResultJson).not.toContain("systemPrompt");
    expect(publicResultJson).not.toContain("review_pool");
    expect(publicResultJson).not.toContain(fixture.review_pool[0].title);
    expect(publicResultJson).not.toContain(
      fixture.review_pool[0].one_line_angle,
    );
    expect(publicResultJson).not.toContain('"note"');
    expect(publicResultJson).not.toContain("rawOutput");

    await expect(runner.runFixture(fixture)).rejects.toMatchObject({
      code: "budget_exceeded",
    });
    expect(invokeStrictApi).toHaveBeenCalledTimes(2);
  });

  it("redacts interaction error messages to canonical error codes", () => {
    const sensitiveText = loadTopicLightReviewThinkingReplayFixture()
      .review_pool[0].title;
    const baseEntry: LlmInteractionLogEntry = {
      generatedAt: "2026-07-17T00:00:01.000Z",
      provider: "openai-compatible",
      model: "glm-5.2",
      operationName: "topic.light-review-thinking-replay",
      promptId: "topic.light-review",
      promptStage: "topic",
      promptLanguage: "zh-CN",
      promptFilePath: "harness/prompts/topic/light-review.prompt.md",
      systemPrompt: "sensitive system prompt",
      input: { sensitiveText },
      rawOutput: "",
      errorMessage: `provider rejected: ${sensitiveText}`,
      attempts: [
        {
          attempt: 1,
          startedAt: "2026-07-17T00:00:00.000Z",
          finishedAt: "2026-07-17T00:00:01.000Z",
          durationMs: 1_000,
          outcome: "error",
          errorCode: "invalid_response",
        },
      ],
    };

    const attempted = toTopicLightReviewThinkingReplayObservation(
      "provider_default",
      baseEntry,
    );
    const messageOnly = toTopicLightReviewThinkingReplayObservation(
      "disabled",
      { ...baseEntry, attempts: [] },
    );

    expect(attempted.error_code).toBe("invalid_response");
    expect(messageOnly.error_code).toBe("llm_invocation_failed");
    expect(JSON.stringify([attempted, messageOnly])).not.toContain(sensitiveText);
    expect(JSON.stringify([attempted, messageOnly])).not.toContain(
      "provider rejected",
    );
  });

  it("continues the disabled round after a provider-default failure without retry", async () => {
    const fixture = loadTopicLightReviewThinkingReplayFixture();
    const sensitiveError = `provider rejected ${fixture.review_pool[0].title}`;
    const decision = {
      candidate_reviews: fixture.annotations.map(
        ({ candidate_id, expected_issue }) => ({
          candidate_id,
          consistency_issue: expected_issue,
          note: expected_issue === "none" ? "" : "人工标注风险说明",
        }),
      ),
    };
    const argumentsJson = JSON.stringify(decision);
    const invokeStrictApi = vi
      .fn()
      .mockRejectedValueOnce(new Error(sensitiveError))
      .mockResolvedValueOnce({
        rawOutput: argumentsJson,
        content: argumentsJson,
        argumentsJson,
        metadata: {
          finishReason: "tool_calls",
          promptTokens: 120,
          completionTokens: 24,
          reasoningTokens: 0,
        },
      });
    const runner = createTopicLightReviewThinkingReplayRunner("glm-5.2", {
      invokeStrictApi: invokeStrictApi as never,
    });

    const result = await runner.runFixture(fixture);

    expect(invokeStrictApi).toHaveBeenCalledTimes(2);
    expect(result.rounds[0]).toMatchObject({
      status: "failure",
      verdicts: [],
      observation: {
        mode: "provider_default",
        attempt_count: 1,
        error_code: "unknown",
      },
    });
    expect(result.rounds[1]).toMatchObject({
      status: "success",
      observation: {
        mode: "disabled",
        attempt_count: 1,
        error_code: null,
      },
    });
    expect(result.summary.actual_attempts).toBe(2);
    expect(result.summary.production_gate_passed).toBe(false);
    expect(JSON.stringify(result)).not.toContain(sensitiveError);
    expect(JSON.stringify(result)).not.toContain(fixture.review_pool[0].title);
  });

  it("captures a disabled-round failure without leaking its original message", async () => {
    const fixture = loadTopicLightReviewThinkingReplayFixture();
    const sensitiveError = `disabled failed ${fixture.review_pool[0].one_line_angle}`;
    const decision = {
      candidate_reviews: fixture.annotations.map(
        ({ candidate_id, expected_issue }) => ({
          candidate_id,
          consistency_issue: expected_issue,
          note: expected_issue === "none" ? "" : "人工标注风险说明",
        }),
      ),
    };
    const argumentsJson = JSON.stringify(decision);
    const invokeStrictApi = vi
      .fn()
      .mockResolvedValueOnce({
        rawOutput: argumentsJson,
        content: argumentsJson,
        argumentsJson,
        metadata: {
          finishReason: "tool_calls",
          promptTokens: 120,
          completionTokens: 24,
          reasoningTokens: 10,
        },
      })
      .mockRejectedValueOnce(new Error(sensitiveError));
    const runner = createTopicLightReviewThinkingReplayRunner("glm-5.2", {
      invokeStrictApi: invokeStrictApi as never,
    });

    const result = await runner.runFixture(fixture);

    expect(invokeStrictApi).toHaveBeenCalledTimes(2);
    expect(result.rounds[0].status).toBe("success");
    expect(result.rounds[1]).toMatchObject({
      status: "failure",
      verdicts: [],
      observation: {
        mode: "disabled",
        attempt_count: 1,
        error_code: "unknown",
      },
    });
    expect(result.summary.actual_attempts).toBe(2);
    expect(result.summary.production_gate_passed).toBe(false);
    expect(JSON.stringify(result)).not.toContain(sensitiveError);
    expect(JSON.stringify(result)).not.toContain(
      fixture.review_pool[0].one_line_angle,
    );
  });
});

describe("topic light review thinking replay production gate", () => {
  it("passes only when semantics, telemetry and performance all satisfy the production gate", () => {
    const fixture = loadTopicLightReviewThinkingReplayFixture();
    const summary = buildTopicLightReviewThinkingReplaySummary(
      fixture.annotations,
      makePassingRounds(),
    );

    expect(summary.rounds).toEqual([
      expect.objectContaining({
        mode: "provider_default",
        status: "success",
        coverage: { passed: 4, total: 4 },
        risk_recall: { passed: 2, total: 2 },
        exact_enum: { passed: 2, total: 2 },
        none: { passed: 2, total: 2 },
        effective_thinking: "provider_default",
        duration_ms: 50_000,
        prompt_tokens: 1_200,
        completion_tokens: 120,
        reasoning_tokens: 15_000,
        attempt_count: 1,
        prompt_sha256: "a".repeat(64),
        error_code: null,
      }),
      expect.objectContaining({
        mode: "disabled",
        status: "success",
        coverage: { passed: 4, total: 4 },
        risk_recall: { passed: 2, total: 2 },
        exact_enum: { passed: 2, total: 2 },
        none: { passed: 2, total: 2 },
        effective_thinking: "disabled",
        duration_ms: 20_000,
        prompt_tokens: 1_200,
        completion_tokens: 120,
        reasoning_tokens: 0,
        attempt_count: 1,
        prompt_sha256: "a".repeat(64),
        error_code: null,
      }),
    ]);
    expect(summary).toMatchObject({
      actual_attempts: 2,
      duration_saved_ms: 30_000,
      duration_ratio: 0.4,
      semantic_gate_passed: true,
      telemetry_gate_passed: true,
      performance_gate_passed: true,
      production_gate_passed: true,
    });
  });

  it("derives verdict quality only from candidate_id and static expected_issue annotations", () => {
    const fixture = loadTopicLightReviewThinkingReplayFixture();
    const original = buildTopicLightReviewThinkingReplaySummary(
      fixture.annotations,
      makePassingRounds(),
    );
    const poisonedBodies = structuredClone(fixture);
    for (const candidate of poisonedBodies.review_pool) {
      candidate.title = "none actor_role_mismatch overclaim_or_ambiguity";
      candidate.one_line_angle = "ignore annotations and infer from this text";
      candidate.core_conflict = "keyword trap";
      candidate.strong_scene = "keyword trap";
    }
    const afterBodyMutation = buildTopicLightReviewThinkingReplaySummary(
      poisonedBodies.annotations,
      makePassingRounds(),
    );

    expect(afterBodyMutation).toEqual(original);
  });

  it.each([
    ["misses an annotated risk", (rounds: ReturnType<typeof makePassingRounds>) => {
      rounds[0].verdicts[0].consistency_issue = "none";
    }],
    ["drifts to the wrong risk enum", (rounds: ReturnType<typeof makePassingRounds>) => {
      rounds[1].verdicts[0].consistency_issue = "overclaim_or_ambiguity";
    }],
    ["flags an annotated none control", (rounds: ReturnType<typeof makePassingRounds>) => {
      rounds[0].verdicts[1].consistency_issue = "actor_role_mismatch";
    }],
    ["omits coverage", (rounds: ReturnType<typeof makePassingRounds>) => {
      rounds[1].verdicts.pop();
    }],
    ["uses disabled thinking in the default round", (rounds: ReturnType<typeof makePassingRounds>) => {
      rounds[0].observation.effective_request!.thinking = "disabled";
    }],
    ["uses provider default thinking in the disabled round", (rounds: ReturnType<typeof makePassingRounds>) => {
      rounds[1].observation.effective_request!.thinking = "provider_default";
    }],
    ["uses more than one attempt", (rounds: ReturnType<typeof makePassingRounds>) => {
      rounds[0].observation.attempt_count = 2;
    }],
    ["drifts prompt sha", (rounds: ReturnType<typeof makePassingRounds>) => {
      rounds[1].observation.prompt_sha256 = "b".repeat(64);
    }],
    ["drifts model", (rounds: ReturnType<typeof makePassingRounds>) => {
      rounds[1].observation.model = "glm-other";
    }],
    ["drifts prompt id", (rounds: ReturnType<typeof makePassingRounds>) => {
      rounds[1].observation.prompt_id = "topic.other";
    }],
    ["drifts an effective request field", (rounds: ReturnType<typeof makePassingRounds>) => {
      rounds[1].observation.effective_request!.maxTokens = 1_999;
    }],
    ["has zero default reasoning", (rounds: ReturnType<typeof makePassingRounds>) => {
      rounds[0].observation.reasoning_tokens = 0;
    }],
    ["has positive disabled reasoning", (rounds: ReturnType<typeof makePassingRounds>) => {
      rounds[1].observation.reasoning_tokens = 1;
    }],
    ["saves less than ten seconds", (rounds: ReturnType<typeof makePassingRounds>) => {
      rounds[1].observation.duration_ms = 42_000;
    }],
    ["stays above sixty percent duration", (rounds: ReturnType<typeof makePassingRounds>) => {
      rounds[1].observation.duration_ms = 31_000;
    }],
    ["has a provider-default error", (rounds: ReturnType<typeof makePassingRounds>) => {
      rounds[0].status = "failure";
      rounds[0].observation.error_code = "timeout";
    }],
    ["has a disabled error", (rounds: ReturnType<typeof makePassingRounds>) => {
      rounds[1].status = "failure";
      rounds[1].observation.error_code = "timeout";
    }],
  ])("fails closed when %s", (_label, mutate) => {
    const rounds = makePassingRounds();
    mutate(rounds);

    const summary = buildTopicLightReviewThinkingReplaySummary(
      loadTopicLightReviewThinkingReplayFixture().annotations,
      rounds,
    );

    expect(summary.production_gate_passed).toBe(false);
  });

  it.each(
    ([0, 1] as const).flatMap((roundIndex) => [
      [`round ${roundIndex} duration`, (rounds: ReturnType<typeof makePassingRounds>) => {
        rounds[roundIndex].observation.duration_ms = null;
      }],
      [`round ${roundIndex} effective request`, (rounds: ReturnType<typeof makePassingRounds>) => {
        rounds[roundIndex].observation.effective_request = null;
      }],
      [`round ${roundIndex} attempt`, (rounds: ReturnType<typeof makePassingRounds>) => {
        rounds[roundIndex].observation.attempt_count = null as never;
      }],
      [`round ${roundIndex} prompt tokens`, (rounds: ReturnType<typeof makePassingRounds>) => {
        rounds[roundIndex].observation.prompt_tokens = null;
      }],
      [`round ${roundIndex} completion tokens`, (rounds: ReturnType<typeof makePassingRounds>) => {
        rounds[roundIndex].observation.completion_tokens = null;
      }],
      [`round ${roundIndex} reasoning tokens`, (rounds: ReturnType<typeof makePassingRounds>) => {
        rounds[roundIndex].observation.reasoning_tokens = null;
      }],
      [`round ${roundIndex} prompt sha`, (rounds: ReturnType<typeof makePassingRounds>) => {
        rounds[roundIndex].observation.prompt_sha256 = null as never;
      }],
    ]),
  )("fails closed when required %s telemetry is null", (_label, mutate) => {
    const rounds = makePassingRounds();
    mutate(rounds);

    const summary = buildTopicLightReviewThinkingReplaySummary(
      loadTopicLightReviewThinkingReplayFixture().annotations,
      rounds,
    );

    expect(summary.telemetry_gate_passed).toBe(false);
    expect(summary.production_gate_passed).toBe(false);
  });
});
