import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  TOPIC_LIGHT_REVIEW_STRICT_SCHEMA,
  parseTopicLightReviewDecision,
  type TopicLightReviewConsistencyIssue,
  type TopicLightReviewPromptCandidate,
} from "../../../backend/src/modules/topic/topic-light-review.js";
import { createLlmGateway } from "../../../backend/src/runtime/llm/llm-gateway.js";
import type {
  LlmInteractionLogEntry,
  LlmInteractionLogWriter,
} from "../../../backend/src/runtime/llm/interaction-log.js";
import {
  createOpenAiCompatibleProvider,
  type OpenAiCompatibleProviderOptions,
} from "../../../backend/src/runtime/llm/openai-compatible-provider.js";
import { createRequestBudget } from "../../../backend/src/runtime/llm/request-budget.js";
import { createPromptRegistry } from "../../../backend/src/runtime/prompts/prompt-registry.js";

export const DEFAULT_TOPIC_LIGHT_REVIEW_THINKING_FIXTURE_PATH =
  "harness/samples/topic-light-review-thinking-replay/task17-controls.fixture.json";

const DEFAULT_TOPIC_LIGHT_REVIEW_THINKING_OUTPUT_DIR = resolve(
  process.cwd(),
  "harness/scripts/runtime/output/topic-light-review-thinking-replay",
);

const REQUIRED_REQUESTS = 2;

export interface TopicLightReviewThinkingReplayInput {
  live?: boolean;
  confirmLive?: boolean;
  model?: string;
  maxRequests?: number;
  maxCostCny?: number;
  fixturePath?: string;
  outputDir?: string;
}

export interface TopicLightReviewThinkingReplayPlan {
  mode: "topic_light_review_thinking_replay_plan";
  live: boolean;
  automated_gate: false;
  light_review_only: true;
  fixture_path: string;
  required_requests: 2;
  actual_requests: 0;
}

export interface TopicLightReviewThinkingReplayDependencies {
  createLiveRunner?: (
    input: TopicLightReviewThinkingReplayInput,
  ) => TopicLightReviewThinkingReplayRunner;
}

export interface TopicLightReviewThinkingReplayObservation {
  mode: "provider_default" | "disabled";
  model: string;
  prompt_id: string;
  prompt_sha256: string;
  effective_request: LlmInteractionLogEntry["effectiveRequest"] | null;
  attempt_count: number;
  duration_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  reasoning_tokens: number | null;
  finish_reason: string | null;
  tool_arguments_chars: number | null;
  error_code: string | null;
}

export interface TopicLightReviewThinkingReplayRoundResult {
  verdicts: Array<{
    candidate_id: string;
    consistency_issue: TopicLightReviewConsistencyIssue;
  }>;
  observation: TopicLightReviewThinkingReplayObservation;
}

export interface TopicLightReviewThinkingReplayResult {
  mode: "topic_light_review_thinking_replay";
  live: true;
  automated_gate: false;
  light_review_only: true;
  fixture_id: string;
  actual_requests: 2;
  rounds: [
    TopicLightReviewThinkingReplayRoundResult,
    TopicLightReviewThinkingReplayRoundResult,
  ];
}

export interface TopicLightReviewThinkingReplayRunner {
  runFixture(
    fixture: TopicLightReviewThinkingReplayFixture,
  ): Promise<TopicLightReviewThinkingReplayResult>;
}

export interface TopicLightReviewThinkingReplayRunnerDependencies {
  invokeStrictApi?: OpenAiCompatibleProviderOptions["invokeStrictApi"];
}

export interface TopicLightReviewThinkingReplayAnnotation {
  candidate_id: string;
  expected_risk: boolean;
  expected_issue: TopicLightReviewConsistencyIssue;
  entered_final_candidates: boolean;
  rationale: string;
}

export interface TopicLightReviewThinkingReplayFixture {
  fixture_id: string;
  review_pool: TopicLightReviewPromptCandidate[];
  annotations: TopicLightReviewThinkingReplayAnnotation[];
}

interface JsonSchemaNode {
  enum?: unknown[];
  items?: JsonSchemaNode;
  properties?: Record<string, JsonSchemaNode>;
}

const REQUIRED_CANDIDATE_STRING_FIELDS = [
  "candidate_id",
  "title",
  "one_line_angle",
  "core_conflict",
  "strong_scene",
  "event_identity",
  "family_label",
  "scope_label",
] as const;

export function loadTopicLightReviewThinkingReplayFixture(
  fixturePath = DEFAULT_TOPIC_LIGHT_REVIEW_THINKING_FIXTURE_PATH,
): TopicLightReviewThinkingReplayFixture {
  const rawFixture: unknown = JSON.parse(readFileSync(fixturePath, "utf8"));
  if (
    !isRecord(rawFixture) ||
    typeof rawFixture.fixture_id !== "string" ||
    !Array.isArray(rawFixture.review_pool) ||
    !Array.isArray(rawFixture.annotations)
  ) {
    throw new Error("topic_light_review_thinking_fixture_invalid_structure");
  }

  if (rawFixture.review_pool.length !== 4) {
    throw new Error("topic_light_review_thinking_fixture_requires_four_candidates");
  }

  const candidateIds = rawFixture.review_pool.map((candidate) => {
    if (
      !isRecord(candidate) ||
      REQUIRED_CANDIDATE_STRING_FIELDS.some(
        (field) =>
          typeof candidate[field] !== "string" ||
          candidate[field].trim().length === 0,
      ) ||
      !Array.isArray(candidate.must_cover_preview) ||
      candidate.must_cover_preview.length === 0 ||
      candidate.must_cover_preview.some(
        (item) => typeof item !== "string" || item.trim().length === 0,
      )
    ) {
      throw new Error("topic_light_review_thinking_fixture_invalid_candidate");
    }
    return candidate.candidate_id as string;
  });
  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new Error("topic_light_review_thinking_fixture_duplicate_candidate_id");
  }

  if (rawFixture.annotations.length !== candidateIds.length) {
    throw new Error("topic_light_review_thinking_fixture_annotation_coverage_mismatch");
  }

  const allowedIssues = getProductionIssueEnum();
  const annotationIds = new Set<string>();
  let hasRisk = false;
  let hasNone = false;
  for (const annotation of rawFixture.annotations) {
    if (
      !isRecord(annotation) ||
      typeof annotation.candidate_id !== "string" ||
      typeof annotation.expected_risk !== "boolean" ||
      typeof annotation.expected_issue !== "string" ||
      typeof annotation.entered_final_candidates !== "boolean" ||
      typeof annotation.rationale !== "string"
    ) {
      throw new Error("topic_light_review_thinking_fixture_invalid_annotation");
    }
    if (!allowedIssues.has(annotation.expected_issue)) {
      throw new Error("topic_light_review_thinking_fixture_invalid_expected_issue");
    }
    if (
      annotation.expected_risk ===
      (annotation.expected_issue === "none")
    ) {
      throw new Error("topic_light_review_thinking_fixture_risk_issue_mismatch");
    }
    if (annotation.rationale.trim().length === 0) {
      throw new Error("topic_light_review_thinking_fixture_rationale_required");
    }
    annotationIds.add(annotation.candidate_id);
    hasRisk ||= annotation.expected_risk;
    hasNone ||= annotation.expected_issue === "none";
  }

  if (
    annotationIds.size !== candidateIds.length ||
    candidateIds.some((candidateId) => !annotationIds.has(candidateId))
  ) {
    throw new Error("topic_light_review_thinking_fixture_annotation_coverage_mismatch");
  }
  if (!hasRisk || !hasNone) {
    throw new Error("topic_light_review_thinking_fixture_requires_risk_and_none");
  }

  return rawFixture as unknown as TopicLightReviewThinkingReplayFixture;
}

export function buildTopicLightReviewThinkingReplayPlan(
  input: TopicLightReviewThinkingReplayInput = {},
): TopicLightReviewThinkingReplayPlan {
  const fixturePath =
    input.fixturePath ?? DEFAULT_TOPIC_LIGHT_REVIEW_THINKING_FIXTURE_PATH;
  loadTopicLightReviewThinkingReplayFixture(fixturePath);
  return createReplayPlan(input, fixturePath);
}

export async function runTopicLightReviewThinkingReplay(
  input: TopicLightReviewThinkingReplayInput = {},
  dependencies: TopicLightReviewThinkingReplayDependencies = {},
): Promise<
  TopicLightReviewThinkingReplayPlan | TopicLightReviewThinkingReplayResult
> {
  const fixturePath =
    input.fixturePath ?? DEFAULT_TOPIC_LIGHT_REVIEW_THINKING_FIXTURE_PATH;
  const fixture = loadTopicLightReviewThinkingReplayFixture(fixturePath);
  const plan = createReplayPlan(input, fixturePath);

  if (!input.live) {
    const outputDir =
      input.outputDir ?? DEFAULT_TOPIC_LIGHT_REVIEW_THINKING_OUTPUT_DIR;
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(
      resolve(outputDir, "replay-plan.json"),
      JSON.stringify(plan, null, 2),
      "utf8",
    );
    return plan;
  }

  validateLiveInput(input);
  const runner =
    dependencies.createLiveRunner?.(input) ??
    createTopicLightReviewThinkingReplayRunner(input.model!);
  return runner.runFixture(fixture);
}

export function createTopicLightReviewThinkingReplayRunner(
  model: string,
  dependencies: TopicLightReviewThinkingReplayRunnerDependencies = {},
): TopicLightReviewThinkingReplayRunner {
  const requestBudget = createRequestBudget({ maxRequests: REQUIRED_REQUESTS });
  const provider = createOpenAiCompatibleProvider({
    profile: "structured",
    model,
    maxAttempts: 1,
    requestBudget,
    invokeStrictApi: dependencies.invokeStrictApi,
  });
  const gateway = createLlmGateway({
    registry: createPromptRegistry(),
    provider,
  });

  return {
    async runFixture(fixture) {
      const expectedCandidateIds = fixture.review_pool.map(
        (candidate) => candidate.candidate_id,
      );
      const runRound = async (
        mode: TopicLightReviewThinkingReplayObservation["mode"],
      ): Promise<TopicLightReviewThinkingReplayRoundResult> => {
        let interaction: LlmInteractionLogEntry | null = null;
        const writer: LlmInteractionLogWriter = {
          write(entry) {
            interaction = entry;
          },
        };
        const decision = await gateway.invokeStrictStructured({
          promptId: "topic.light-review",
          input: fixture.review_pool,
          operationName: "topic.light-review-thinking-replay",
          schema: TOPIC_LIGHT_REVIEW_STRICT_SCHEMA,
          parse: (rawOutput) =>
            parseTopicLightReviewDecision(rawOutput, expectedCandidateIds),
          interactionLogWriter: writer,
          options: {
            strategy: "tool_call",
            ...(mode === "disabled" ? { thinking: "disabled" as const } : {}),
            toolChoice: "target_function",
          },
        });

        if (!interaction) {
          throw new Error("topic_light_review_thinking_replay_interaction_missing");
        }

        return {
          verdicts: decision.candidate_reviews.map(
            ({ candidate_id, consistency_issue }) => ({
              candidate_id,
              consistency_issue,
            }),
          ),
          observation: toTopicLightReviewThinkingReplayObservation(
            mode,
            interaction,
          ),
        };
      };

      const providerDefault = await runRound("provider_default");
      const disabled = await runRound("disabled");
      return {
        mode: "topic_light_review_thinking_replay",
        live: true,
        automated_gate: false,
        light_review_only: true,
        fixture_id: fixture.fixture_id,
        actual_requests: REQUIRED_REQUESTS,
        rounds: [providerDefault, disabled],
      };
    },
  };
}

export function parseTopicLightReviewThinkingReplayArgs(
  argv: string[],
): TopicLightReviewThinkingReplayInput {
  assertSupportedArguments(argv);
  return {
    live: argv.includes("--live"),
    confirmLive: argv.includes("--confirm-live"),
    model: readCliValue(argv, "--model"),
    maxRequests: readOptionalNumber(readCliValue(argv, "--max-requests")),
    maxCostCny: readOptionalNumber(readCliValue(argv, "--max-cost-cny")),
    fixturePath: readCliValue(argv, "--fixture"),
    outputDir: readCliValue(argv, "--output-dir"),
  };
}

function createReplayPlan(
  input: TopicLightReviewThinkingReplayInput,
  fixturePath: string,
): TopicLightReviewThinkingReplayPlan {
  return {
    mode: "topic_light_review_thinking_replay_plan",
    live: input.live === true,
    automated_gate: false,
    light_review_only: true,
    fixture_path: fixturePath,
    required_requests: REQUIRED_REQUESTS,
    actual_requests: 0,
  };
}

function validateLiveInput(input: TopicLightReviewThinkingReplayInput) {
  if (!input.confirmLive) {
    throw new Error(
      "topic_light_review_thinking_replay_live_confirmation_required",
    );
  }
  if (!input.model) {
    throw new Error("topic_light_review_thinking_replay_model_required");
  }
  if (input.model !== "glm-5.2") {
    throw new Error(
      "topic_light_review_thinking_replay_model_must_be_glm_5_2",
    );
  }
  if (input.maxRequests !== REQUIRED_REQUESTS) {
    throw new Error(
      "topic_light_review_thinking_replay_request_budget_must_equal_two",
    );
  }
  if (
    input.maxCostCny === undefined ||
    !Number.isFinite(input.maxCostCny) ||
    input.maxCostCny <= 0
  ) {
    throw new Error("topic_light_review_thinking_replay_cost_budget_required");
  }
}

function assertSupportedArguments(argv: string[]) {
  const booleanArguments = new Set(["--live", "--confirm-live"]);
  const valueArguments = [
    "--model",
    "--max-requests",
    "--max-cost-cny",
    "--fixture",
    "--output-dir",
  ];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (booleanArguments.has(argument)) {
      continue;
    }
    if (valueArguments.some((name) => argument.startsWith(`${name}=`))) {
      continue;
    }
    if (valueArguments.includes(argument)) {
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        index += 1;
      }
      continue;
    }
    throw new Error("topic_light_review_thinking_replay_argument_unsupported");
  }
}

function readCliValue(argv: string[], name: string): string | undefined {
  const equalsPrefix = `${name}=`;
  const equalsValue = argv.find((value) => value.startsWith(equalsPrefix));
  if (equalsValue) {
    return equalsValue.slice(equalsPrefix.length);
  }

  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value?.startsWith("--") ? undefined : value;
}

function readOptionalNumber(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}

function getProductionIssueEnum(): Set<string> {
  const candidateReviews = TOPIC_LIGHT_REVIEW_STRICT_SCHEMA.parameters.properties
    .candidate_reviews as JsonSchemaNode;
  const issueEnum =
    candidateReviews.items?.properties?.consistency_issue?.enum;
  if (!Array.isArray(issueEnum)) {
    throw new Error("topic_light_review_thinking_fixture_schema_enum_missing");
  }
  return new Set(
    issueEnum.filter((issue): issue is string => typeof issue === "string"),
  );
}

export function toTopicLightReviewThinkingReplayObservation(
  mode: TopicLightReviewThinkingReplayObservation["mode"],
  entry: LlmInteractionLogEntry,
): TopicLightReviewThinkingReplayObservation {
  return {
    mode,
    model: entry.model,
    prompt_id: entry.promptId,
    prompt_sha256: createHash("sha256")
      .update(entry.systemPrompt, "utf8")
      .digest("hex"),
    effective_request: entry.effectiveRequest ?? null,
    attempt_count: entry.attempts?.length ?? 0,
    duration_ms: entry.timing?.durationMs ?? null,
    prompt_tokens: entry.responseMetadata?.promptTokens ?? null,
    completion_tokens: entry.responseMetadata?.completionTokens ?? null,
    reasoning_tokens: entry.responseMetadata?.reasoningTokens ?? null,
    finish_reason: entry.responseMetadata?.finishReason ?? null,
    tool_arguments_chars: readToolArgumentsChars(entry.rawOutput),
    error_code: readCanonicalErrorCode(entry),
  };
}

const CANONICAL_ERROR_CODES = new Set([
  "budget_exceeded",
  "configuration",
  "invalid_request",
  "invalid_response",
  "network",
  "rate_limited",
  "service_unavailable",
  "timeout",
  "unknown",
]);

function readCanonicalErrorCode(entry: LlmInteractionLogEntry): string | null {
  const attempts = entry.attempts ?? [];
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    const errorCode = attempts[index].errorCode;
    if (errorCode && CANONICAL_ERROR_CODES.has(errorCode)) {
      return errorCode;
    }
  }
  return entry.errorMessage ? "llm_invocation_failed" : null;
}

function readToolArgumentsChars(rawOutput: string): number | null {
  try {
    const parsed = JSON.parse(rawOutput) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }
    if (Array.isArray(parsed.candidate_reviews)) {
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
          rawToolCall.function.name === TOPIC_LIGHT_REVIEW_STRICT_SCHEMA.name &&
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function main() {
  const plan = await runTopicLightReviewThinkingReplay(
    parseTopicLightReviewThinkingReplayArgs(process.argv.slice(2)),
  );
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
