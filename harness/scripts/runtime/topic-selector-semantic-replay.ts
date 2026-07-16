import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { TOPIC_SELECTOR_STRICT_SCHEMA } from "../../../backend/src/modules/topic/topic-recommendation.service.js";

export const DEFAULT_TOPIC_SELECTOR_SEMANTIC_FIXTURE_SET_PATH =
  "harness/samples/topic-selector-semantic-replay/fixture-set.md";

const DEFAULT_TOPIC_SELECTOR_SEMANTIC_OUTPUT_DIR = resolve(
  process.cwd(),
  "harness/scripts/runtime/output/topic-selector-semantic-replay",
);

export interface TopicSelectorSemanticReplayInput {
  live?: boolean;
  confirmLive?: boolean;
  model?: string;
  maxRequests?: number;
  maxCostCny?: number;
  fixtureSetPath?: string;
  outputDir?: string;
}

export interface TopicSelectorSemanticReplayPlan {
  mode: "topic_selector_semantic_replay_plan";
  live: boolean;
  automated_gate: false;
  selector_only: true;
  fixture_set_path: string;
  fixture_count: number;
  required_requests: number;
  actual_requests: 0;
  required_checks: string[];
}

export interface TopicSelectorSemanticReplayDependencies {
  createLiveRunner?: (model: string) => unknown;
}

export interface TopicSelectorSemanticFixture {
  fixture_id: string;
  source: {
    project_id: string;
    topic_run_id: string;
    interaction_index: number;
    model: string;
    task: string;
    baseline_observation: "all_none";
  };
  selector_input: {
    recent_event_memory: Array<Record<string, unknown>>;
    recommendation_seed: Record<string, unknown>;
    selector_pool: Array<Record<string, unknown> & { candidate_id: string }>;
  };
  annotations: Array<{
    candidate_id: string;
    expected_risk: boolean;
    expected_issue: string;
    entered_final_candidates: boolean;
    rationale: string;
  }>;
}

export function getProductionConsistencyIssueSet(): Set<string> {
  const rankedCandidates = readRecord(
    TOPIC_SELECTOR_STRICT_SCHEMA.parameters.properties.ranked_candidates,
    "topic_selector_semantic_replay_production_issue_enum_missing",
  );
  const items = readRecord(
    rankedCandidates.items,
    "topic_selector_semantic_replay_production_issue_enum_missing",
  );
  const properties = readRecord(
    items.properties,
    "topic_selector_semantic_replay_production_issue_enum_missing",
  );
  const consistencyIssue = readRecord(
    properties.consistency_issue,
    "topic_selector_semantic_replay_production_issue_enum_missing",
  );
  const enumValues = consistencyIssue.enum;

  if (
    !Array.isArray(enumValues) ||
    enumValues.length === 0 ||
    enumValues.some((value) => typeof value !== "string" || value.length === 0)
  ) {
    throw new Error("topic_selector_semantic_replay_production_issue_enum_missing");
  }

  return new Set(enumValues as string[]);
}

export function loadTopicSelectorSemanticFixtureSet(
  fixtureSetPath = DEFAULT_TOPIC_SELECTOR_SEMANTIC_FIXTURE_SET_PATH,
): TopicSelectorSemanticFixture[] {
  const fixturePaths = loadFixturePaths(fixtureSetPath);
  const fixtures = fixturePaths.map(loadFixture);
  const fixtureIds = new Set<string>();

  for (const fixture of fixtures) {
    if (fixtureIds.has(fixture.fixture_id)) {
      throw new Error("topic_selector_semantic_replay_duplicate_fixture_id");
    }
    fixtureIds.add(fixture.fixture_id);
  }

  return fixtures;
}

export function buildTopicSelectorSemanticReplayPlan(
  input: TopicSelectorSemanticReplayInput = {},
): TopicSelectorSemanticReplayPlan {
  const fixtureSetPath =
    input.fixtureSetPath ?? DEFAULT_TOPIC_SELECTOR_SEMANTIC_FIXTURE_SET_PATH;
  const fixtures = loadTopicSelectorSemanticFixtureSet(fixtureSetPath);

  return createReplayPlan(input, fixtureSetPath, fixtures.length);
}

export async function runTopicSelectorSemanticReplay(
  input: TopicSelectorSemanticReplayInput = {},
  _dependencies: TopicSelectorSemanticReplayDependencies = {},
): Promise<TopicSelectorSemanticReplayPlan> {
  const fixtureSetPath =
    input.fixtureSetPath ?? DEFAULT_TOPIC_SELECTOR_SEMANTIC_FIXTURE_SET_PATH;
  const fixtures = loadTopicSelectorSemanticFixtureSet(fixtureSetPath);
  const plan = createReplayPlan(input, fixtureSetPath, fixtures.length);

  if (!input.live) {
    const outputDir = input.outputDir ?? DEFAULT_TOPIC_SELECTOR_SEMANTIC_OUTPUT_DIR;
    mkdirSync(outputDir, { recursive: true });
    writeJson(outputDir, "replay-plan.json", plan);
    return plan;
  }

  validateLiveInput(input, fixtures.length);
  throw new Error("topic_selector_semantic_replay_live_not_implemented");
}

export function parseTopicSelectorSemanticReplayArgs(
  argv: string[],
): TopicSelectorSemanticReplayInput {
  return {
    live: argv.includes("--live"),
    confirmLive: argv.includes("--confirm-live"),
    model: readCliValue(argv, "--model"),
    maxRequests: readOptionalNumber(readCliValue(argv, "--max-requests")),
    maxCostCny: readOptionalNumber(readCliValue(argv, "--max-cost-cny")),
    fixtureSetPath: readCliValue(argv, "--fixture-set"),
    outputDir: readCliValue(argv, "--output-dir"),
  };
}

function createReplayPlan(
  input: TopicSelectorSemanticReplayInput,
  fixtureSetPath: string,
  fixtureCount: number,
): TopicSelectorSemanticReplayPlan {
  return {
    mode: "topic_selector_semantic_replay_plan",
    live: input.live === true,
    automated_gate: false,
    selector_only: true,
    fixture_set_path: fixtureSetPath,
    fixture_count: fixtureCount,
    required_requests: fixtureCount,
    actual_requests: 0,
    required_checks: [
      "不得把 fixture 期望结果接入生产 selection",
      "不得使用本地字符串规则替代语义判断",
      "真实模型结果只表示固定样本 Selector 语义表现",
    ],
  };
}

function validateLiveInput(
  input: TopicSelectorSemanticReplayInput,
  fixtureCount: number,
) {
  if (!input.confirmLive) {
    throw new Error("topic_selector_semantic_replay_live_confirmation_required");
  }
  if (!input.model) {
    throw new Error("topic_selector_semantic_replay_model_required");
  }
  if (input.model !== "glm-5.2") {
    throw new Error("topic_selector_semantic_replay_model_must_be_glm_5_2");
  }
  if (input.maxRequests !== fixtureCount) {
    throw new Error(
      "topic_selector_semantic_replay_request_budget_must_equal_fixture_count",
    );
  }
  if (
    input.maxCostCny === undefined ||
    !Number.isFinite(input.maxCostCny) ||
    input.maxCostCny <= 0
  ) {
    throw new Error("topic_selector_semantic_replay_cost_budget_required");
  }
}

function readCliValue(argv: string[], name: string): string | undefined {
  const equalsPrefix = `${name}=`;
  const equalsValue = argv.find((value) => value.startsWith(equalsPrefix));
  if (equalsValue) {
    return equalsValue.slice(equalsPrefix.length);
  }

  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function readOptionalNumber(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}

function writeJson(outputDir: string, filename: string, value: unknown) {
  writeFileSync(
    resolve(outputDir, filename),
    JSON.stringify(value, null, 2),
    "utf8",
  );
}

function loadFixturePaths(fixtureSetPath: string): string[] {
  const content = readFileSync(resolve(process.cwd(), fixtureSetPath), "utf8");
  const paths = [...content.matchAll(/`([^`]+\.fixture\.json)`/g)].map(
    (match) => match[1],
  );

  if (paths.length === 0) {
    throw new Error("topic_selector_semantic_replay_fixture_set_empty");
  }

  return paths;
}

function loadFixture(fixturePath: string): TopicSelectorSemanticFixture {
  const raw = readRecord(
    JSON.parse(readFileSync(resolve(process.cwd(), fixturePath), "utf8")),
    "topic_selector_semantic_replay_fixture_invalid",
  );
  const source = readRecord(
    raw.source,
    "topic_selector_semantic_replay_fixture_invalid_source",
  );
  const selectorInput = readRecord(
    raw.selector_input,
    "topic_selector_semantic_replay_fixture_invalid_selector_input",
  );
  const recentEventMemory = selectorInput.recent_event_memory;
  const recommendationSeed = selectorInput.recommendation_seed;
  const selectorPool = selectorInput.selector_pool;
  const rawAnnotations = raw.annotations;

  if (
    !Array.isArray(recentEventMemory) ||
    recentEventMemory.some((item) => !isRecord(item)) ||
    !isRecord(recommendationSeed) ||
    !Array.isArray(selectorPool) ||
    selectorPool.length === 0 ||
    !Array.isArray(rawAnnotations) ||
    rawAnnotations.length === 0
  ) {
    throw new Error("topic_selector_semantic_replay_fixture_invalid_selector_input");
  }

  const candidateIds = new Set<string>();
  const parsedSelectorPool = selectorPool.map((rawCandidate) => {
    const candidate = readRecord(
      rawCandidate,
      "topic_selector_semantic_replay_fixture_invalid_candidate",
    );
    const candidateId = readString(
      candidate.candidate_id,
      "topic_selector_semantic_replay_fixture_invalid_candidate_id",
    );

    if (candidateIds.has(candidateId)) {
      throw new Error("topic_selector_semantic_replay_duplicate_candidate_id");
    }
    candidateIds.add(candidateId);

    return { ...candidate, candidate_id: candidateId };
  });

  const productionIssues = getProductionConsistencyIssueSet();
  const annotationIds = new Set<string>();
  const annotations = rawAnnotations.map((rawAnnotation) => {
    const annotation = readRecord(
      rawAnnotation,
      "topic_selector_semantic_replay_fixture_invalid_annotation",
    );
    const candidateId = readString(
      annotation.candidate_id,
      "topic_selector_semantic_replay_fixture_invalid_annotation_candidate_id",
    );
    const expectedRisk = readBoolean(
      annotation.expected_risk,
      "topic_selector_semantic_replay_fixture_invalid_expected_risk",
    );
    const expectedIssue = readString(
      annotation.expected_issue,
      "topic_selector_semantic_replay_fixture_invalid_expected_issue",
    );

    if (!candidateIds.has(candidateId)) {
      throw new Error("topic_selector_semantic_replay_annotation_unknown_candidate");
    }
    if (annotationIds.has(candidateId)) {
      throw new Error("topic_selector_semantic_replay_duplicate_annotation_candidate");
    }
    if (!productionIssues.has(expectedIssue)) {
      throw new Error("topic_selector_semantic_replay_annotation_unknown_issue");
    }
    if ((expectedIssue !== "none") !== expectedRisk) {
      throw new Error("topic_selector_semantic_replay_annotation_risk_issue_mismatch");
    }
    annotationIds.add(candidateId);

    return {
      candidate_id: candidateId,
      expected_risk: expectedRisk,
      expected_issue: expectedIssue,
      entered_final_candidates: readBoolean(
        annotation.entered_final_candidates,
        "topic_selector_semantic_replay_fixture_invalid_final_candidate_flag",
      ),
      rationale: readString(
        annotation.rationale,
        "topic_selector_semantic_replay_fixture_invalid_rationale",
      ),
    };
  });

  if (!annotations.some((item) => item.expected_risk)) {
    throw new Error("topic_selector_semantic_replay_fixture_missing_risk_case");
  }
  if (!annotations.some((item) => !item.expected_risk)) {
    throw new Error("topic_selector_semantic_replay_fixture_missing_none_control");
  }
  if (source.baseline_observation !== "all_none") {
    throw new Error("topic_selector_semantic_replay_fixture_invalid_baseline_observation");
  }

  return {
    fixture_id: readString(
      raw.fixture_id,
      "topic_selector_semantic_replay_fixture_invalid_fixture_id",
    ),
    source: {
      project_id: readString(
        source.project_id,
        "topic_selector_semantic_replay_fixture_invalid_project_id",
      ),
      topic_run_id: readString(
        source.topic_run_id,
        "topic_selector_semantic_replay_fixture_invalid_topic_run_id",
      ),
      interaction_index: readNumber(
        source.interaction_index,
        "topic_selector_semantic_replay_fixture_invalid_interaction_index",
      ),
      model: readString(
        source.model,
        "topic_selector_semantic_replay_fixture_invalid_model",
      ),
      task: readString(
        source.task,
        "topic_selector_semantic_replay_fixture_invalid_task",
      ),
      baseline_observation: "all_none",
    },
    selector_input: {
      recent_event_memory: recentEventMemory as Array<Record<string, unknown>>,
      recommendation_seed: recommendationSeed,
      selector_pool: parsedSelectorPool,
    },
    annotations,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRecord(value: unknown, errorCode: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(errorCode);
  }
  return value;
}

function readString(value: unknown, errorCode: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(errorCode);
  }
  return value;
}

function readBoolean(value: unknown, errorCode: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(errorCode);
  }
  return value;
}

function readNumber(value: unknown, errorCode: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(errorCode);
  }
  return value;
}
