import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
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
const OWNERSHIP_MARKER_FILE = ".topic-light-review-thinking-replay-owned";
const OWNERSHIP_MARKER_CONTENT = "topic-light-review-thinking-replay:v1\n";
const PUBLISHED_ARTIFACT_FILES = [
  "disabled.result.json",
  "provider-default.result.json",
  "replay-plan.json",
  "replay-summary.json",
  "trace.md",
] as const;
const OWNED_OUTPUT_ENTRIES = new Set([
  OWNERSHIP_MARKER_FILE,
  ...PUBLISHED_ARTIFACT_FILES,
]);

const DEFAULT_ARTIFACT_FILE_SYSTEM: TopicLightReviewThinkingReplayArtifactFileSystem = {
  ensureDirectory(path) {
    mkdirSync(path, { recursive: true });
  },
  makeTempDirectory(prefix) {
    return mkdtempSync(prefix);
  },
  writeText(path, content) {
    writeFileSync(path, content, "utf8");
  },
  removePath(path) {
    rmSync(path, { recursive: true, force: true });
  },
  removeFile(path) {
    unlinkSync(path);
  },
  pathExists(path) {
    return existsSync(path);
  },
  isDirectory(path) {
    return lstatSync(path).isDirectory();
  },
  isFile(path) {
    return lstatSync(path).isFile();
  },
  readDirectory(path) {
    return readdirSync(path);
  },
  readText(path) {
    return readFileSync(path, "utf8");
  },
  renameDirectory(source, target) {
    renameSync(source, target);
  },
};

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
  artifactFileSystem?: Partial<TopicLightReviewThinkingReplayArtifactFileSystem>;
}

export interface TopicLightReviewThinkingReplayArtifactFileSystem {
  ensureDirectory(path: string): void;
  makeTempDirectory(prefix: string): string;
  writeText(path: string, content: string): void;
  removePath(path: string): void;
  removeFile(path: string): void;
  pathExists(path: string): boolean;
  isDirectory(path: string): boolean;
  isFile(path: string): boolean;
  readDirectory(path: string): string[];
  readText(path: string): string;
  renameDirectory(source: string, target: string): void;
}

export interface TopicLightReviewThinkingReplayObservation {
  mode: "provider_default" | "disabled";
  model: string;
  prompt_id: string;
  prompt_sha256: string;
  effective_request: LlmInteractionLogEntry["effectiveRequest"] | null;
  attempt_count: number | null;
  duration_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  reasoning_tokens: number | null;
  finish_reason: string | null;
  tool_arguments_chars: number | null;
  error_code: string | null;
}

export interface TopicLightReviewThinkingReplayRoundResult {
  status: "success" | "failure";
  verdicts: Array<{
    candidate_id: string;
    consistency_issue: TopicLightReviewConsistencyIssue;
  }>;
  observation: TopicLightReviewThinkingReplayObservation;
}

export interface TopicLightReviewThinkingReplayRoundSummary {
  mode: "provider_default" | "disabled";
  status: "success" | "failure";
  coverage: { passed: number; total: number };
  risk_recall: { passed: number; total: number };
  exact_enum: { passed: number; total: number };
  none: { passed: number; total: number };
  effective_thinking: string | null;
  duration_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  reasoning_tokens: number | null;
  attempt_count: number | null;
  prompt_sha256: string | null;
  error_code: string | null;
}

export interface TopicLightReviewThinkingReplaySummary {
  rounds: [
    TopicLightReviewThinkingReplayRoundSummary,
    TopicLightReviewThinkingReplayRoundSummary,
  ];
  actual_attempts: number | null;
  duration_saved_ms: number | null;
  duration_ratio: number | null;
  semantic_gate_passed: boolean;
  telemetry_gate_passed: boolean;
  performance_gate_passed: boolean;
  production_gate_passed: boolean;
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
  summary: TopicLightReviewThinkingReplaySummary;
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
  const artifactFileSystem = createArtifactFileSystem(
    dependencies.artifactFileSystem,
  );
  const preparedOutput = prepareLiveReplayStagingDirectory(
    input.outputDir ?? DEFAULT_TOPIC_LIGHT_REVIEW_THINKING_OUTPUT_DIR,
    plan,
    artifactFileSystem,
  );
  try {
    const runner =
      dependencies.createLiveRunner?.(input) ??
      createTopicLightReviewThinkingReplayRunner(input.model!);
    const result = await runner.runFixture(fixture);
    writeLiveReplayArtifacts(
      preparedOutput.stagingDir,
      plan,
      result,
      artifactFileSystem,
    );
    publishLiveReplayStagingDirectory(
      preparedOutput,
      artifactFileSystem,
    );
    return result;
  } catch (error) {
    removeCreatedStagingDirectorySafely(
      artifactFileSystem,
      preparedOutput.outputDir,
      preparedOutput.stagingDir,
    );
    throw error;
  }
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
  let fixtureRunStarted = false;

  return {
    async runFixture(fixture) {
      if (fixtureRunStarted) {
        requestBudget.consume("topic.light-review-thinking-replay");
      }
      fixtureRunStarted = true;
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
        try {
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
              ...(mode === "disabled"
                ? { thinking: "disabled" as const }
                : {}),
              toolChoice: "target_function",
            },
          });
          const capturedInteraction = interaction as LlmInteractionLogEntry | null;
          if (!capturedInteraction) {
            throw new Error(
              "topic_light_review_thinking_replay_interaction_missing",
            );
          }

          return {
            status: "success",
            verdicts: decision.candidate_reviews.map(
              ({ candidate_id, consistency_issue }) => ({
                candidate_id,
                consistency_issue,
              }),
            ),
            observation: toTopicLightReviewThinkingReplayObservation(
              mode,
              capturedInteraction,
            ),
          };
        } catch (error) {
          const capturedInteraction = interaction as LlmInteractionLogEntry | null;
          return {
            status: "failure",
            verdicts: [],
            observation: capturedInteraction
              ? toTopicLightReviewThinkingReplayObservation(
                  mode,
                  capturedInteraction,
                )
              : createMissingInteractionObservation(mode, model, error),
          };
        }
      };

      const providerDefault = await runRound("provider_default");
      const disabled = await runRound("disabled");
      const rounds: [
        TopicLightReviewThinkingReplayRoundResult,
        TopicLightReviewThinkingReplayRoundResult,
      ] = [providerDefault, disabled];
      return {
        mode: "topic_light_review_thinking_replay",
        live: true,
        automated_gate: false,
        light_review_only: true,
        fixture_id: fixture.fixture_id,
        actual_requests: REQUIRED_REQUESTS,
        rounds,
        summary: buildTopicLightReviewThinkingReplaySummary(
          fixture.annotations,
          rounds,
        ),
      };
    },
  };
}

export function buildTopicLightReviewThinkingReplaySummary(
  annotations: TopicLightReviewThinkingReplayAnnotation[],
  rounds: [
    TopicLightReviewThinkingReplayRoundResult,
    TopicLightReviewThinkingReplayRoundResult,
  ],
): TopicLightReviewThinkingReplaySummary {
  const riskAnnotations = annotations.filter(
    (annotation) => annotation.expected_risk,
  );
  const noneAnnotations = annotations.filter(
    (annotation) => annotation.expected_issue === "none",
  );
  const roundSummaries = rounds.map((round) => {
    const verdictsByCandidate = new Map<
      string,
      TopicLightReviewConsistencyIssue
    >();
    const verdictCounts = new Map<string, number>();
    for (const verdict of round.verdicts) {
      verdictsByCandidate.set(verdict.candidate_id, verdict.consistency_issue);
      verdictCounts.set(
        verdict.candidate_id,
        (verdictCounts.get(verdict.candidate_id) ?? 0) + 1,
      );
    }
    const coveragePassed = annotations.filter(
      (annotation) => verdictCounts.get(annotation.candidate_id) === 1,
    ).length;
    const riskRecallPassed = riskAnnotations.filter(
      (annotation) =>
        verdictsByCandidate.has(annotation.candidate_id) &&
        verdictsByCandidate.get(annotation.candidate_id) !== "none",
    ).length;
    const exactEnumPassed = riskAnnotations.filter(
      (annotation) =>
        verdictsByCandidate.get(annotation.candidate_id) ===
        annotation.expected_issue,
    ).length;
    const nonePassed = noneAnnotations.filter(
      (annotation) =>
        verdictsByCandidate.get(annotation.candidate_id) === "none",
    ).length;

    return {
      mode: round.observation.mode,
      status: round.status,
      coverage: { passed: coveragePassed, total: annotations.length },
      risk_recall: {
        passed: riskRecallPassed,
        total: riskAnnotations.length,
      },
      exact_enum: { passed: exactEnumPassed, total: riskAnnotations.length },
      none: { passed: nonePassed, total: noneAnnotations.length },
      effective_thinking: round.observation.effective_request?.thinking ?? null,
      duration_ms: round.observation.duration_ms,
      prompt_tokens: round.observation.prompt_tokens,
      completion_tokens: round.observation.completion_tokens,
      reasoning_tokens: round.observation.reasoning_tokens,
      attempt_count: round.observation.attempt_count,
      prompt_sha256: round.observation.prompt_sha256 ?? null,
      error_code: round.observation.error_code,
    } satisfies TopicLightReviewThinkingReplayRoundSummary;
  }) as [
    TopicLightReviewThinkingReplayRoundSummary,
    TopicLightReviewThinkingReplayRoundSummary,
  ];

  const semanticGatePassed = rounds.every((round, index) => {
    const summary = roundSummaries[index];
    return (
      round.status === "success" &&
      round.verdicts.length === annotations.length &&
      summary.coverage.passed === summary.coverage.total &&
      summary.risk_recall.passed === summary.risk_recall.total &&
      summary.exact_enum.passed === summary.exact_enum.total &&
      summary.none.passed === summary.none.total
    );
  });

  const [providerDefault, disabled] = rounds;
  const [providerDefaultSummary, disabledSummary] = roundSummaries;
  const actualAttempts = readTotalAttempts(rounds);
  const telemetryGatePassed =
    roundsHaveCompleteTelemetry(rounds) &&
    providerDefault.status === "success" &&
    disabled.status === "success" &&
    providerDefault.observation.mode === "provider_default" &&
    disabled.observation.mode === "disabled" &&
    providerDefault.observation.effective_request?.thinking ===
      "provider_default" &&
    disabled.observation.effective_request?.thinking === "disabled" &&
    providerDefault.observation.reasoning_tokens! > 0 &&
    disabled.observation.reasoning_tokens === 0 &&
    actualAttempts === REQUIRED_REQUESTS &&
    observationsMatchExceptThinking(
      providerDefault.observation,
      disabled.observation,
    );

  const durationSavedMs =
    providerDefaultSummary.duration_ms !== null &&
    disabledSummary.duration_ms !== null
      ? providerDefaultSummary.duration_ms - disabledSummary.duration_ms
      : null;
  const durationRatio =
    providerDefaultSummary.duration_ms !== null &&
    providerDefaultSummary.duration_ms > 0 &&
    disabledSummary.duration_ms !== null
      ? disabledSummary.duration_ms / providerDefaultSummary.duration_ms
      : null;
  const performanceGatePassed =
    durationSavedMs !== null &&
    durationRatio !== null &&
    durationSavedMs >= 10_000 &&
    durationRatio <= 0.6;

  return {
    rounds: roundSummaries,
    actual_attempts: actualAttempts,
    duration_saved_ms: durationSavedMs,
    duration_ratio: durationRatio,
    semantic_gate_passed: semanticGatePassed,
    telemetry_gate_passed: telemetryGatePassed,
    performance_gate_passed: performanceGatePassed,
    production_gate_passed:
      semanticGatePassed && telemetryGatePassed && performanceGatePassed,
  };
}

function roundsHaveCompleteTelemetry(
  rounds: [
    TopicLightReviewThinkingReplayRoundResult,
    TopicLightReviewThinkingReplayRoundResult,
  ],
) {
  return rounds.every(({ observation }) => {
    const effective = observation.effective_request;
    return (
      observation.error_code === null &&
      observation.model === "glm-5.2" &&
      observation.prompt_id === "topic.light-review" &&
      typeof observation.prompt_sha256 === "string" &&
      /^[a-f0-9]{64}$/.test(observation.prompt_sha256) &&
      effective !== null &&
      effective.profile === "structured" &&
      effective.model === observation.model &&
      effective.strategy === "tool_call" &&
      effective.toolChoice === "target_function" &&
      effective.maxAttempts === 1 &&
      observation.attempt_count === 1 &&
      isNonNegativeNumber(observation.duration_ms) &&
      isNonNegativeNumber(observation.prompt_tokens) &&
      isNonNegativeNumber(observation.completion_tokens) &&
      isNonNegativeNumber(observation.reasoning_tokens)
    );
  });
}

function observationsMatchExceptThinking(
  providerDefault: TopicLightReviewThinkingReplayObservation,
  disabled: TopicLightReviewThinkingReplayObservation,
) {
  if (
    providerDefault.model !== disabled.model ||
    providerDefault.prompt_id !== disabled.prompt_id ||
    providerDefault.prompt_sha256 !== disabled.prompt_sha256 ||
    !providerDefault.effective_request ||
    !disabled.effective_request
  ) {
    return false;
  }
  const { thinking: _providerThinking, ...providerRequest } =
    providerDefault.effective_request;
  const { thinking: _disabledThinking, ...disabledRequest } =
    disabled.effective_request;
  return stableJson(providerRequest) === stableJson(disabledRequest);
}

function readTotalAttempts(
  rounds: [
    TopicLightReviewThinkingReplayRoundResult,
    TopicLightReviewThinkingReplayRoundResult,
  ],
) {
  const attempts = rounds.map((round) => round.observation.attempt_count);
  return attempts.every((attempt): attempt is number => attempt !== null)
    ? attempts.reduce((total, attempt) => total + attempt, 0)
    : null;
}

function isNonNegativeNumber(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function stableJson(value: Record<string, unknown>) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
}

function createMissingInteractionObservation(
  mode: TopicLightReviewThinkingReplayObservation["mode"],
  model: string,
  error: unknown,
): TopicLightReviewThinkingReplayObservation {
  return {
    mode,
    model,
    prompt_id: "topic.light-review",
    prompt_sha256: "",
    effective_request: null,
    attempt_count: null,
    duration_ms: null,
    prompt_tokens: null,
    completion_tokens: null,
    reasoning_tokens: null,
    finish_reason: null,
    tool_arguments_chars: null,
    error_code: normalizeThrownErrorCode(error),
  };
}

function normalizeThrownErrorCode(error: unknown) {
  if (isRecord(error) && typeof error.code === "string") {
    return CANONICAL_ERROR_CODES.has(error.code)
      ? error.code
      : "llm_invocation_failed";
  }
  return "llm_invocation_failed";
}

interface PreparedLiveReplayOutput {
  outputDir: string;
  stagingDir: string;
  existingOutputOwned: boolean;
}

function createArtifactFileSystem(
  overrides?: Partial<TopicLightReviewThinkingReplayArtifactFileSystem>,
): TopicLightReviewThinkingReplayArtifactFileSystem {
  return { ...DEFAULT_ARTIFACT_FILE_SYSTEM, ...overrides };
}

function prepareLiveReplayStagingDirectory(
  requestedOutputDir: string,
  plan: TopicLightReviewThinkingReplayPlan,
  fileSystem: TopicLightReviewThinkingReplayArtifactFileSystem,
): PreparedLiveReplayOutput {
  const outputDir = resolve(requestedOutputDir);
  fileSystem.ensureDirectory(dirname(outputDir));
  const existingOutputOwned = fileSystem.pathExists(outputDir);
  if (existingOutputOwned) {
    validateOwnedPublishedDirectory(outputDir, fileSystem);
  }
  let stagingDir: string | null = null;
  try {
    stagingDir = fileSystem.makeTempDirectory(`${outputDir}.staging-`);
    writeOwnershipMarker(stagingDir, fileSystem);
    writeReplayJson(
      stagingDir,
      "replay-plan.json",
      plan,
      fileSystem,
    );
    const probePath = resolve(stagingDir, ".write-probe");
    fileSystem.writeText(probePath, "writable\n");
    fileSystem.removeFile(probePath);
    return { outputDir, stagingDir, existingOutputOwned };
  } catch (error) {
    if (stagingDir) {
      removeCreatedStagingDirectorySafely(
        fileSystem,
        outputDir,
        stagingDir,
      );
    }
    throw error;
  }
}

function validateOwnedPublishedDirectory(
  outputDir: string,
  fileSystem: TopicLightReviewThinkingReplayArtifactFileSystem,
) {
  if (!fileSystem.isDirectory(outputDir)) {
    throw new Error(
      "topic_light_review_thinking_replay_output_directory_not_owned",
    );
  }
  const markerPath = resolve(outputDir, OWNERSHIP_MARKER_FILE);
  if (!fileSystem.pathExists(markerPath) || !fileSystem.isFile(markerPath)) {
    throw new Error(
      "topic_light_review_thinking_replay_output_directory_not_owned",
    );
  }
  if (fileSystem.readText(markerPath) !== OWNERSHIP_MARKER_CONTENT) {
    throw new Error(
      "topic_light_review_thinking_replay_ownership_marker_invalid",
    );
  }

  const entries = fileSystem.readDirectory(outputDir);
  if (
    entries.length !== OWNED_OUTPUT_ENTRIES.size ||
    entries.some((entry) => !OWNED_OUTPUT_ENTRIES.has(entry)) ||
    entries.some((entry) => !fileSystem.isFile(resolve(outputDir, entry)))
  ) {
    throw new Error(
      "topic_light_review_thinking_replay_output_directory_contents_invalid",
    );
  }
}

function publishLiveReplayStagingDirectory(
  prepared: PreparedLiveReplayOutput,
  fileSystem: TopicLightReviewThinkingReplayArtifactFileSystem,
) {
  const { outputDir, stagingDir, existingOutputOwned } = prepared;
  let backupDir: string | null = null;
  try {
    if (existingOutputOwned) {
      if (!fileSystem.pathExists(outputDir)) {
        throw new Error(
          "topic_light_review_thinking_replay_output_directory_changed",
        );
      }
      validateOwnedPublishedDirectory(outputDir, fileSystem);
      backupDir = `${outputDir}.backup-${randomUUID()}`;
      fileSystem.renameDirectory(outputDir, backupDir);
    } else if (fileSystem.pathExists(outputDir)) {
      throw new Error(
        "topic_light_review_thinking_replay_output_directory_changed",
      );
    }
    fileSystem.renameDirectory(stagingDir, outputDir);
  } catch (error) {
    if (backupDir && fileSystem.pathExists(backupDir)) {
      if (fileSystem.pathExists(outputDir)) {
        validateOwnedPublishedDirectory(outputDir, fileSystem);
        fileSystem.renameDirectory(outputDir, stagingDir);
      }
      fileSystem.renameDirectory(backupDir, outputDir);
    }
    removeCreatedStagingDirectorySafely(fileSystem, outputDir, stagingDir);
    throw error;
  }

  if (backupDir) {
    try {
      removeValidatedBackupDirectory(fileSystem, prepared, backupDir);
    } catch (error) {
      fileSystem.renameDirectory(outputDir, stagingDir);
      if (fileSystem.pathExists(backupDir)) {
        fileSystem.renameDirectory(backupDir, outputDir);
      }
      removeCreatedStagingDirectorySafely(fileSystem, outputDir, stagingDir);
      throw error;
    }
  }
}

function removeCreatedStagingDirectorySafely(
  fileSystem: TopicLightReviewThinkingReplayArtifactFileSystem,
  outputDir: string,
  stagingDir: string,
) {
  assertSafeSiblingPath(outputDir, stagingDir, "staging");
  try {
    fileSystem.removePath(stagingDir);
  } catch {
    // Keep the original preparation, write, or publication error.
  }
}

function removeValidatedBackupDirectory(
  fileSystem: TopicLightReviewThinkingReplayArtifactFileSystem,
  prepared: PreparedLiveReplayOutput,
  backupDir: string,
) {
  if (!prepared.existingOutputOwned) {
    throw new Error(
      "topic_light_review_thinking_replay_backup_ownership_missing",
    );
  }
  assertSafeSiblingPath(prepared.outputDir, backupDir, "backup");
  validateOwnedPublishedDirectory(backupDir, fileSystem);
  fileSystem.removePath(backupDir);
}

function assertSafeSiblingPath(
  outputDir: string,
  candidatePath: string,
  kind: "staging" | "backup",
) {
  const expectedPrefix = `${outputDir}.${kind}-`;
  if (
    dirname(candidatePath) !== dirname(outputDir) ||
    !candidatePath.startsWith(expectedPrefix) ||
    candidatePath.length <= expectedPrefix.length
  ) {
    throw new Error(
      `topic_light_review_thinking_replay_unsafe_${kind}_path`,
    );
  }
}

function writeLiveReplayArtifacts(
  outputDir: string,
  plan: TopicLightReviewThinkingReplayPlan,
  result: TopicLightReviewThinkingReplayResult,
  fileSystem: TopicLightReviewThinkingReplayArtifactFileSystem,
) {
  writeOwnershipMarker(outputDir, fileSystem);
  writeReplayJson(outputDir, "replay-plan.json", plan, fileSystem);
  writeReplayJson(
    outputDir,
    "provider-default.result.json",
    result.rounds[0],
    fileSystem,
  );
  writeReplayJson(
    outputDir,
    "disabled.result.json",
    result.rounds[1],
    fileSystem,
  );
  writeReplayJson(
    outputDir,
    "replay-summary.json",
    result.summary,
    fileSystem,
  );
  fileSystem.writeText(
    resolve(outputDir, "trace.md"),
    renderTopicLightReviewThinkingReplayTrace(result.summary),
  );
}

function writeOwnershipMarker(
  outputDir: string,
  fileSystem: TopicLightReviewThinkingReplayArtifactFileSystem,
) {
  fileSystem.writeText(
    resolve(outputDir, OWNERSHIP_MARKER_FILE),
    OWNERSHIP_MARKER_CONTENT,
  );
}

function writeReplayJson(
  outputDir: string,
  fileName: string,
  value: unknown,
  fileSystem: TopicLightReviewThinkingReplayArtifactFileSystem,
) {
  fileSystem.writeText(
    resolve(outputDir, fileName),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

function renderTopicLightReviewThinkingReplayTrace(
  summary: TopicLightReviewThinkingReplaySummary,
) {
  const lines = [
    "# Topic Light Review Thinking Replay Trace",
    "",
    "| mode | status | thinking | duration_ms | prompt_tokens | completion_tokens | reasoning_tokens | attempts | error_code |",
    "|---|---|---|---:|---:|---:|---:|---:|---|",
  ];
  for (const round of summary.rounds) {
    lines.push(
      `| ${round.mode} | ${round.status} | ${round.effective_thinking ?? "unavailable"} | ${round.duration_ms ?? "unavailable"} | ${round.prompt_tokens ?? "unavailable"} | ${round.completion_tokens ?? "unavailable"} | ${round.reasoning_tokens ?? "unavailable"} | ${round.attempt_count ?? "unavailable"} | ${round.error_code ?? "-"} |`,
    );
  }
  lines.push(
    "",
    "## Semantic Counts",
    "",
    "| mode | coverage | risk_recall | exact_enum | none |",
    "|---|---:|---:|---:|---:|",
  );
  for (const round of summary.rounds) {
    lines.push(
      `| ${round.mode} | ${round.coverage.passed}/${round.coverage.total} | ${round.risk_recall.passed}/${round.risk_recall.total} | ${round.exact_enum.passed}/${round.exact_enum.total} | ${round.none.passed}/${round.none.total} |`,
    );
  }
  lines.push(
    "",
    "## Gates",
    "",
    `- actual_attempts: ${summary.actual_attempts ?? "unavailable"}`,
    `- duration_saved_ms: ${summary.duration_saved_ms ?? "unavailable"}`,
    `- duration_ratio: ${summary.duration_ratio ?? "unavailable"}`,
    `- semantic_gate_passed: ${summary.semantic_gate_passed}`,
    `- telemetry_gate_passed: ${summary.telemetry_gate_passed}`,
    `- performance_gate_passed: ${summary.performance_gate_passed}`,
    `- production_gate_passed: ${summary.production_gate_passed}`,
    "",
  );
  return lines.join("\n");
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
