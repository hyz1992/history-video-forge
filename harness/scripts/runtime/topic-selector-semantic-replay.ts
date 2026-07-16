import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  parseStrictSelectorDecision,
  TOPIC_SELECTOR_STRICT_SCHEMA,
} from "../../../backend/src/modules/topic/topic-recommendation.service.js";
import { createLlmGateway } from "../../../backend/src/runtime/llm/llm-gateway.js";
import type {
  LlmInteractionLogEntry,
  LlmInteractionLogWriter,
} from "../../../backend/src/runtime/llm/interaction-log.js";
import { createOpenAiCompatibleProvider } from "../../../backend/src/runtime/llm/openai-compatible-provider.js";
import type {
  StrictStructuredThinking,
  StructuredPromptProvider,
} from "../../../backend/src/runtime/llm/provider-contract.js";
import { createPromptRegistry } from "../../../backend/src/runtime/prompts/prompt-registry.js";

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
  thinking?: StrictStructuredThinking;
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
  requested_thinking: StrictStructuredThinking | null;
  fixture_set_path: string;
  fixture_count: number;
  required_requests: number;
  actual_requests: 0;
  required_checks: string[];
}

export interface TopicSelectorSemanticReplayDependencies {
  createLiveRunner?: (
    model: string,
    thinking: StrictStructuredThinking,
  ) => TopicSelectorSemanticReplayLiveRunner;
}

export interface TopicSelectorSemanticReplayLiveRunnerDependencies {
  createProvider?: (model: string) => StructuredPromptProvider;
}

export interface TopicSelectorSemanticReplayLiveRunner {
  runFixture(fixture: TopicSelectorSemanticFixture): Promise<{
    decision: TopicSelectorSemanticReplayDecision;
    observation: TopicSelectorSemanticReplayObservation;
  }>;
}

export interface TopicSelectorSemanticReplayDecision {
  ranked_candidates: Array<{
    candidate_id: string;
    primary_consistency_issue: string;
    consistency_status?: string;
    [key: string]: unknown;
  }>;
}

export interface TopicSelectorSemanticReplayObservation {
  model: string;
  prompt_id: string;
  prompt_sha256: string;
  effective_request: LlmInteractionLogEntry["effectiveRequest"] | null;
  attempt_count: number;
  duration_ms: number | null;
  usage: {
    prompt_tokens: number | null;
    completion_tokens: number | null;
    reasoning_tokens: number | null;
  };
  finish_reason: string | null;
  tool_arguments_chars: number | null;
  error_code: string | null;
}

export type TopicSelectorSemanticAnnotationStatus =
  | "matched"
  | "risk_recalled_enum_differed"
  | "risk_missed"
  | "none_control_failed";

export interface TopicSelectorSemanticReplayFixtureResult {
  fixture_id: string;
  source_project_id: string;
  source_topic_run_id: string;
  structural_failed: boolean;
  error_code: string | null;
  annotations: Array<{
    candidate_id: string;
    expected_risk: boolean;
    expected_issue: string;
    actual_issue: string;
    entered_final_candidates: boolean;
    status: TopicSelectorSemanticAnnotationStatus;
  }>;
  observation: TopicSelectorSemanticReplayObservation | null;
}

export interface TopicSelectorSemanticReplaySummary {
  mode: "topic_selector_semantic_replay";
  live: true;
  automated_gate: false;
  selector_only: true;
  requested_thinking: StrictStructuredThinking;
  fixture_set_path: string;
  output_dir: string;
  total_fixtures: number;
  planned_requests: number;
  actual_requests: number;
  expected_risk_count: number;
  recalled_risk_count: number;
  none_control_count: number;
  passed_none_control_count: number;
  exact_enum_match_count: number;
  effective_thinking_match_count: number;
  primary_gate_passed: boolean;
  results: TopicSelectorSemanticReplayFixtureResult[];
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
  dependencies: TopicSelectorSemanticReplayDependencies = {},
): Promise<TopicSelectorSemanticReplayPlan | TopicSelectorSemanticReplaySummary> {
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
  const outputDir = input.outputDir ?? DEFAULT_TOPIC_SELECTOR_SEMANTIC_OUTPUT_DIR;
  mkdirSync(outputDir, { recursive: true });
  writeJson(outputDir, "replay-plan.json", plan);

  const runner =
    dependencies.createLiveRunner?.(input.model!, input.thinking!) ??
    createTopicSelectorSemanticReplayLiveRunner(input.model!, input.thinking!);
  const results: TopicSelectorSemanticReplayFixtureResult[] = [];
  let actualRequests = 0;

  for (const fixture of fixtures) {
    actualRequests += 1;
    let result: TopicSelectorSemanticReplayFixtureResult;

    try {
      const replay = await runner.runFixture(fixture);
      result = {
        ...evaluateTopicSelectorSemanticFixture(fixture, replay.decision),
        observation: replay.observation,
      };
    } catch (error) {
      result = createStructuralFailureResult(
        fixture,
        error instanceof Error ? error.message : String(error),
      );
    }

    results.push(result);
    writeJson(outputDir, `${fixture.fixture_id}.result.json`, result);
  }

  const expectedRiskCount = fixtures
    .flatMap((fixture) => fixture.annotations)
    .filter((annotation) => annotation.expected_risk).length;
  const noneControlCount = fixtures
    .flatMap((fixture) => fixture.annotations)
    .filter((annotation) => !annotation.expected_risk).length;
  const evaluatedAnnotations = results.flatMap((result) => result.annotations);
  const recalledRiskCount = evaluatedAnnotations.filter(
    (annotation) =>
      annotation.expected_risk &&
      (annotation.status === "matched" ||
        annotation.status === "risk_recalled_enum_differed"),
  ).length;
  const passedNoneControlCount = evaluatedAnnotations.filter(
    (annotation) => !annotation.expected_risk && annotation.status === "matched",
  ).length;
  const exactEnumMatchCount = evaluatedAnnotations.filter(
    (annotation) => annotation.expected_risk && annotation.status === "matched",
  ).length;
  const effectiveThinkingMatchCount = results.filter(
    (result) =>
      result.observation?.effective_request?.thinking === input.thinking,
  ).length;
  const primaryGatePassed =
    results.every((result) => !result.structural_failed) &&
    recalledRiskCount === expectedRiskCount &&
    passedNoneControlCount === noneControlCount &&
    effectiveThinkingMatchCount === fixtures.length;

  const summary: TopicSelectorSemanticReplaySummary = {
    mode: "topic_selector_semantic_replay",
    live: true,
    automated_gate: false,
    selector_only: true,
    requested_thinking: input.thinking!,
    fixture_set_path: fixtureSetPath,
    output_dir: outputDir,
    total_fixtures: fixtures.length,
    planned_requests: plan.required_requests,
    actual_requests: actualRequests,
    expected_risk_count: expectedRiskCount,
    recalled_risk_count: recalledRiskCount,
    none_control_count: noneControlCount,
    passed_none_control_count: passedNoneControlCount,
    exact_enum_match_count: exactEnumMatchCount,
    effective_thinking_match_count: effectiveThinkingMatchCount,
    primary_gate_passed: primaryGatePassed,
    results,
  };

  writeJson(outputDir, "replay-summary.json", summary);
  writeReplayTrace(outputDir, summary);
  return summary;
}

export function evaluateTopicSelectorSemanticFixture(
  fixture: TopicSelectorSemanticFixture,
  decision: TopicSelectorSemanticReplayDecision,
): TopicSelectorSemanticReplayFixtureResult {
  const expectedIds = fixture.selector_input.selector_pool.map(
    (candidate) => candidate.candidate_id,
  );
  const actualIds = decision.ranked_candidates.map(
    (candidate) => candidate.candidate_id,
  );

  if (!sameUniqueStringSet(expectedIds, actualIds)) {
    return createStructuralFailureResult(
      fixture,
      "topic_selector_semantic_replay_candidate_coverage_mismatch",
    );
  }

  const productionIssues = getProductionConsistencyIssueSet();
  const actualIssueById = new Map<string, string>();
  for (const candidate of decision.ranked_candidates) {
    if (!productionIssues.has(candidate.primary_consistency_issue)) {
      return createStructuralFailureResult(
        fixture,
        "topic_selector_semantic_replay_invalid_actual_issue",
      );
    }
    actualIssueById.set(candidate.candidate_id, candidate.primary_consistency_issue);
  }

  return {
    fixture_id: fixture.fixture_id,
    source_project_id: fixture.source.project_id,
    source_topic_run_id: fixture.source.topic_run_id,
    structural_failed: false,
    error_code: null,
    annotations: fixture.annotations.map((annotation) => {
      const actualIssue = actualIssueById.get(annotation.candidate_id)!;
      let status: TopicSelectorSemanticAnnotationStatus = "matched";

      if (annotation.expected_risk && actualIssue === "none") {
        status = "risk_missed";
      } else if (!annotation.expected_risk && actualIssue !== "none") {
        status = "none_control_failed";
      } else if (
        annotation.expected_risk &&
        actualIssue !== annotation.expected_issue
      ) {
        status = "risk_recalled_enum_differed";
      }

      return {
        candidate_id: annotation.candidate_id,
        expected_risk: annotation.expected_risk,
        expected_issue: annotation.expected_issue,
        actual_issue: actualIssue,
        entered_final_candidates: annotation.entered_final_candidates,
        status,
      };
    }),
    observation: null,
  };
}

export function createTopicSelectorSemanticReplayLiveRunner(
  model: string,
  thinking: StrictStructuredThinking,
  dependencies: TopicSelectorSemanticReplayLiveRunnerDependencies = {},
): TopicSelectorSemanticReplayLiveRunner {
  const provider =
    dependencies.createProvider?.(model) ??
    createOpenAiCompatibleProvider({
      profile: "structured",
      model,
      maxAttempts: 1,
    });
  const gateway = createLlmGateway({
    registry: createPromptRegistry(),
    provider,
  });

  return {
    async runFixture(fixture) {
      let interaction: LlmInteractionLogEntry | null = null;
      const writer: LlmInteractionLogWriter = {
        write(entry) {
          interaction = entry;
        },
      };
      const decision = await gateway.invokeStrictStructured({
        promptId: "topic.selector",
        input: fixture.selector_input,
        schema: TOPIC_SELECTOR_STRICT_SCHEMA,
        parse: parseStrictSelectorDecision,
        operationName: "topic.selector",
        interactionLogWriter: writer,
        options: {
          strategy: "tool_call",
          thinking,
          toolChoice: "target_function",
        },
      });

      if (!interaction) {
        throw new Error("topic_selector_semantic_replay_interaction_missing");
      }

      return {
        decision,
        observation: toReplayObservation(interaction),
      };
    },
  };
}

export function parseTopicSelectorSemanticReplayArgs(
  argv: string[],
): TopicSelectorSemanticReplayInput {
  return {
    live: argv.includes("--live"),
    confirmLive: argv.includes("--confirm-live"),
    model: readCliValue(argv, "--model"),
    thinking: readThinking(readCliValue(argv, "--thinking")),
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
    requested_thinking: input.thinking ?? null,
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
  if (!input.thinking) {
    throw new Error("topic_selector_semantic_replay_thinking_required");
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

function readThinking(
  value: string | undefined,
): StrictStructuredThinking | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "enabled" || value === "disabled") {
    return value;
  }
  throw new Error("topic_selector_semantic_replay_thinking_invalid");
}

function writeJson(outputDir: string, filename: string, value: unknown) {
  writeFileSync(
    resolve(outputDir, filename),
    JSON.stringify(value, null, 2),
    "utf8",
  );
}

function sameUniqueStringSet(expected: string[], actual: string[]): boolean {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);

  return (
    expectedSet.size === expected.length &&
    actualSet.size === actual.length &&
    expectedSet.size === actualSet.size &&
    expected.every((value) => actualSet.has(value))
  );
}

function createStructuralFailureResult(
  fixture: TopicSelectorSemanticFixture,
  errorCode: string,
): TopicSelectorSemanticReplayFixtureResult {
  return {
    fixture_id: fixture.fixture_id,
    source_project_id: fixture.source.project_id,
    source_topic_run_id: fixture.source.topic_run_id,
    structural_failed: true,
    error_code: errorCode,
    annotations: [],
    observation: null,
  };
}

function toReplayObservation(
  entry: LlmInteractionLogEntry,
): TopicSelectorSemanticReplayObservation {
  return {
    model: entry.model,
    prompt_id: entry.promptId,
    prompt_sha256: createHash("sha256")
      .update(entry.systemPrompt, "utf8")
      .digest("hex"),
    effective_request: entry.effectiveRequest ?? null,
    attempt_count: entry.attempts?.length ?? 0,
    duration_ms: entry.timing?.durationMs ?? null,
    usage: {
      prompt_tokens: entry.responseMetadata?.promptTokens ?? null,
      completion_tokens: entry.responseMetadata?.completionTokens ?? null,
      reasoning_tokens: entry.responseMetadata?.reasoningTokens ?? null,
    },
    finish_reason: entry.responseMetadata?.finishReason ?? null,
    tool_arguments_chars: readToolArgumentsChars(entry.rawOutput),
    error_code: entry.errorMessage ?? null,
  };
}

function readToolArgumentsChars(rawOutput: string): number | null {
  try {
    const parsed = JSON.parse(rawOutput) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    if (
      Array.isArray(parsed.ranked_candidates) &&
      Array.isArray(parsed.consistency_risk_notes)
    ) {
      return rawOutput.length;
    }

    const choices = parsed.choices;
    if (!Array.isArray(choices)) {
      return null;
    }

    for (const rawChoice of choices) {
      if (!isRecord(rawChoice) || !isRecord(rawChoice.message)) {
        continue;
      }
      const toolCalls = rawChoice.message.tool_calls;
      if (!Array.isArray(toolCalls)) {
        continue;
      }
      for (const rawToolCall of toolCalls) {
        if (!isRecord(rawToolCall) || !isRecord(rawToolCall.function)) {
          continue;
        }
        if (
          rawToolCall.function.name === TOPIC_SELECTOR_STRICT_SCHEMA.name &&
          typeof rawToolCall.function.arguments === "string"
        ) {
          return rawToolCall.function.arguments.length;
        }
      }
    }
  } catch {
    return null;
  }

  return null;
}

function writeReplayTrace(
  outputDir: string,
  summary: TopicSelectorSemanticReplaySummary,
) {
  const fixtureLines = summary.results.map((result) => {
    const statuses = result.annotations
      .map((annotation) => `${annotation.candidate_id}:${annotation.status}`)
      .join(", ");
    return `- ${result.fixture_id}: structural_failed=${result.structural_failed}, ${statuses || result.error_code || "no annotations"}`;
  });

  writeFileSync(
    resolve(outputDir, "trace.md"),
    [
      "# Topic Selector Semantic Replay",
      "",
      `- live: ${summary.live}`,
      `- automated_gate: ${summary.automated_gate}`,
      `- selector_only: ${summary.selector_only}`,
      `- requested_thinking: ${summary.requested_thinking}`,
      `- planned_requests: ${summary.planned_requests}`,
      `- actual_requests: ${summary.actual_requests}`,
      `- expected_risk_count: ${summary.expected_risk_count}`,
      `- recalled_risk_count: ${summary.recalled_risk_count}`,
      `- none_control_count: ${summary.none_control_count}`,
      `- passed_none_control_count: ${summary.passed_none_control_count}`,
      `- exact_enum_match_count: ${summary.exact_enum_match_count}`,
      `- effective_thinking_match_count: ${summary.effective_thinking_match_count}`,
      `- primary_gate_passed: ${summary.primary_gate_passed}`,
      "",
      "## Fixtures",
      "",
      ...fixtureLines,
    ].join("\n"),
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

async function main() {
  const result = await runTopicSelectorSemanticReplay(
    parseTopicSelectorSemanticReplayArgs(process.argv.slice(2)),
  );
  const summary = result.mode === "topic_selector_semantic_replay_plan"
    ? {
        mode: result.mode,
        live: result.live,
        requested_thinking: result.requested_thinking,
        fixture_count: result.fixture_count,
        required_requests: result.required_requests,
        actual_requests: result.actual_requests,
      }
    : {
        mode: result.mode,
        live: result.live,
        requested_thinking: result.requested_thinking,
        total_fixtures: result.total_fixtures,
        actual_requests: result.actual_requests,
        primary_gate_passed: result.primary_gate_passed,
        output_dir: result.output_dir,
      };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
