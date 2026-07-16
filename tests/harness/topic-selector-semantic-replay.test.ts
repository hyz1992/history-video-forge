import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { projectTopicSelectorPool } from "../../backend/src/modules/topic/topic-selector-prompt-projection.js";
import {
  DEFAULT_TOPIC_SELECTOR_SEMANTIC_FIXTURE_SET_PATH,
  buildTopicSelectorSemanticReplayPlan,
  getProductionConsistencyIssueSet,
  loadTopicSelectorSemanticFixtureSet,
  parseTopicSelectorSemanticReplayArgs,
  runTopicSelectorSemanticReplay,
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
