import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  buildTopicLightReviewThinkingReplayPlan,
  DEFAULT_TOPIC_LIGHT_REVIEW_THINKING_FIXTURE_PATH,
  loadTopicLightReviewThinkingReplayFixture,
  parseTopicLightReviewThinkingReplayArgs,
  runTopicLightReviewThinkingReplay,
  type TopicLightReviewThinkingReplayFixture,
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

  it("allows one live runner creation after every guard passes", async () => {
    let runnerCreated = 0;

    await expect(
      runTopicLightReviewThinkingReplay(
        {
          live: true,
          confirmLive: true,
          model: "glm-5.2",
          maxRequests: 2,
          maxCostCny: 1,
        },
        {
          createLiveRunner: () => {
            runnerCreated += 1;
            return {};
          },
        },
      ),
    ).rejects.toThrow(
      "topic_light_review_thinking_replay_live_runner_not_implemented",
    );
    expect(runnerCreated).toBe(1);
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
