import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  AssetPlan,
  ScriptDraftPackage,
  StoryboardPlan,
  TopicPackage,
  type AssetPlan as AssetPlanType,
  type ScriptDraftPackage as ScriptDraftPackageType,
  type StoryboardPlan as StoryboardPlanType,
  type TopicPackage as TopicPackageType,
} from "../../../shared/src/index.js";
import type {
  AssetPlanningTopicBoundaryContext,
  GenerateAssetPlanInput,
  GlobalDraftStructureEvent,
  IntentChunkSettledEvent,
} from "../../../backend/src/modules/asset-planning/asset-planning-generation.service";
import { validateAssetPlan } from "../../../backend/src/modules/asset-planning/asset-planning-local-validator";
import type {
  LlmInteractionLogEntry,
  LlmInteractionLogWriter,
} from "../../../backend/src/runtime/llm/interaction-log";

type RenderLlmInteractionMarkdown = typeof import(
  "../../../backend/src/runtime/llm/interaction-log"
).renderLlmInteractionMarkdown;

const DEFAULT_SOURCE_STORYBOARD_DIRS = [
  "harness/scripts/runtime/output/2026-05-10-storyboard-five-theme-review/round-1",
  "harness/scripts/runtime/output/2026-05-10-storyboard-five-theme-review/round-2",
  "harness/scripts/runtime/output/2026-05-10-storyboard-five-theme-review/round-3",
  "harness/scripts/runtime/output/2026-05-10-storyboard-five-theme-review/round-4",
  "harness/scripts/runtime/output/2026-05-10-storyboard-five-theme-review/round-5",
].map((item) => resolve(process.cwd(), item));

const DEFAULT_OUTPUT_DIR = resolve(
  process.cwd(),
  "harness/scripts/runtime/output/asset-planning-five-round-quality-check",
);
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PROMPT_BUNDLE_DIRECTORIES = ["prompts"];
const PROMPT_BUNDLE_CONFIG_FILES = [
  "backend/src/runtime/prompts/prompt-registry.ts",
  "backend/src/runtime/llm/operation-policy.ts",
  "backend/src/runtime/llm/operation-tier-registry.ts",
];
const RUNTIME_REVISION_DIRECTORIES = [
  "backend/src",
  "shared/src",
  "prompts",
  "harness/scripts/runtime",
];
const RUNTIME_REVISION_CONFIG_FILES = [
  "package.json",
  "package-lock.json",
  "backend/package.json",
  "backend/tsconfig.json",
  "backend/providers.json",
  "backend/.env.example",
  "shared/package.json",
  "shared/tsconfig.json",
];

const ALL_SETTLED_ROUND_ARTIFACTS = [
  "source-script-draft.json",
  "source-topic-package.json",
  "source-storyboard-plan.json",
  "runtime-diagnostics.json",
  "trace.md",
  "review.md",
  "round-result.json",
];
const SUCCESS_ONLY_ROUND_ARTIFACTS = [
  "asset-plan.json",
  "asset-planning-validation-result.json",
];
const FAILURE_ONLY_ROUND_ARTIFACTS: string[] = [];

export interface AssetPlanningFiveRoundQualityCheckInput {
  sourceDir?: string;
  sourceDirs?: string[];
  fixture?: string;
  outputDir?: string;
  rounds?: number;
  maxMakeupRounds?: number;
  mode?: "legacy" | "intent_compiler";
  dryRun?: boolean;
  live?: boolean;
  help?: boolean;
  chunkConcurrency?: number;
  resume?: boolean;
  runId?: string;
}

export interface AssetPlanningFiveRoundQualityCheckPlan {
  mode: "asset_planning_real_runtime_live_check";
  generation_mode: "legacy" | "intent_compiler";
  automated_gate: false;
  requires_real_env: boolean;
  source_storyboard_dirs: string[];
  total_rounds: number;
  output_dir: string;
  run_manifest: AssetPlanningQualityCheckRunManifest;
  required_artifacts: {
    run_level: string[];
    all_settled: string[];
    success_only: string[];
    failure_only: string[];
    interaction_evidence: {
      condition: "llm_invocation_attempted";
      marker_paths: "explicit_relative_markdown_paths";
    };
  };
  required_checks: string[];
}

interface AssetPlanningQualityCheckRunManifest {
  version: "asset_planning_run_manifest_v1";
  fingerprint: string;
  fingerprint_inputs: {
    generation_mode: "legacy" | "intent_compiler";
    execution_mode: "dry-run" | "live";
    target_rounds: number;
    max_makeup_rounds: number;
    max_total_rounds: number;
    chunk_concurrency: number | null;
    estimated_chunk_count: number;
    provider_id: string;
    model_id: string;
    prompt_bundle_sha256: string;
    runtime_revision_sha256: string;
    runtime_profile_sha256: string;
    ordered_sources: Array<{
      kind: "fixture" | "source_dir";
      content_sha256: string;
      source_ids: string[];
    }>;
  };
}

export interface AssetPlanningFiveRoundRoundResult {
  round: number;
  status: "round-ready" | "round-failed";
  source_storyboard_dir: string;
  source_title: string;
  regenerated: boolean;
  full_regen_used: boolean;
  chunk_structural_repair_used: boolean;
  plan_structural_repair_used: boolean;
  provider_safety_retry_used: boolean;
  global_structure_normalization_event_count: number;
  global_structure_normalized_path_count: number;
  global_structural_repair_used: boolean;
  global_structural_repair_succeeded: boolean;
  global_structural_repair_failed: boolean;
  global_structural_repair_provider_failed: boolean;
  first_pass_wall_time_ms: number;
  repair_wall_time_ms: number;
  regen_wall_time_ms: number;
  llm_call_count: number;
  output_dir: string;
  validation_decision: string;
  validation_errors: string[];
  validation_warnings: string[];
  task_count: number;
  dependency_count: number;
  segment_count: number;
  task_type_counts: Record<string, number>;
  failure_class: "provider" | "structural_compiler" | null;
  repair_attempts: number;
  regeneration_attempts: number;
  safety_attempts: number;
  provider_attempts: number;
  accounting_complete: boolean;
  resumed?: boolean;
}

export interface AssetPlanningFiveRoundQualityCheckResult
  extends AssetPlanningFiveRoundQualityCheckPlan {
  target_rounds: number;
  passed_rounds: number;
  failed_rounds: number;
  valid_provider_rounds: number;
  end_to_end_success_rounds: number;
  provider_failure_rounds: number;
  structural_compiler_failure_rounds: number;
  repair_attempts: number;
  regeneration_attempts: number;
  safety_attempts: number;
  provider_attempts: number;
  makeup_rounds: number;
  zero_denominator: boolean;
  dry_run: boolean;
  estimated_chunk_count: number;
  max_total_rounds: number;
  network_requests_per_chunk_max: 10;
  worst_case_chunk_network_requests: number;
  global_planning_requests_per_round_max: 2;
  global_safety_requests_per_round_max: 2;
  global_structural_repair_requests_per_round_max: 2;
  global_provider_requests_per_round_max: 6;
  worst_case_global_provider_requests: number;
  worst_case_total_provider_requests: number;
  accounting_incomplete_rounds: number;
  global_structure_normalization_event_count: number;
  global_structure_normalization_used_rounds: number;
  global_structure_normalized_path_count: number;
  global_structural_repair_used_rounds: number;
  global_structural_repair_succeeded_rounds: number;
  global_structural_repair_failed_rounds: number;
  global_structural_repair_provider_failed_rounds: number;
  rounds: AssetPlanningFiveRoundRoundResult[];
}

interface PersistedAssetPlanningRoundResult {
  version: "asset_planning_round_result_v1";
  run_fingerprint: string;
  round: number;
  outcome: "success" | "provider_failure" | "structural_failure";
  success: boolean;
  failure_class: "provider" | "structural_compiler" | null;
  failure_code: string | null;
  attempt_accounting: {
    repair_attempts: number;
    regeneration_attempts: number;
    safety_attempts: number;
    provider_attempts: number;
    accounting_complete: boolean;
  };
  required_paths: string[];
  interaction_evidence: string[];
  round_result: AssetPlanningFiveRoundRoundResult;
}

export interface AssetPlanningRuntimeFingerprintInputs {
  provider_id: string;
  model_id: string;
  prompt_bundle_sha256: string;
  runtime_revision_sha256: string;
  runtime_profile_sha256: string;
}

export interface AssetPlanningFiveRoundPlanGeneratorInput
  extends GenerateAssetPlanInput {
  round: number;
}

export interface AssetPlanningFiveRoundQualityCheckDependencies {
  requireRealEnv?: boolean;
  runtimeFingerprintInputs?: AssetPlanningRuntimeFingerprintInputs;
  planGenerator?: (
    input: AssetPlanningFiveRoundPlanGeneratorInput,
  ) => Promise<AssetPlanType>;
}

interface RuntimeLlmCallDiagnostics {
  sequence: number;
  prompt_id: string;
  planning_mode: string | null;
  chunk_id: string | null;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  repair_mode: string | null;
  safety_retry_context_reason: string | null;
  provider_attempts: number;
}

interface RuntimeDiagnosticCheck {
  code: string;
  level: "info" | "warning" | "error";
  message?: string;
}

interface RepairChainMetrics {
  chunk_structural_repair_used: boolean;
  plan_structural_repair_used: boolean;
  provider_safety_retry_used: boolean;
  full_regen_used: boolean;
  first_pass_wall_time_ms: number;
  repair_wall_time_ms: number;
  regen_wall_time_ms: number;
  llm_call_count: number;
}

interface GlobalStructureObservation {
  global_structure_normalization_event_count: number;
  global_structure_normalized_path_count: number;
  global_structural_repair_used: boolean;
  global_structural_repair_succeeded: boolean;
  global_structural_repair_failed: boolean;
  global_structural_repair_provider_failed: boolean;
}

function aggregateGlobalStructureEvents(
  events: GlobalDraftStructureEvent[],
): GlobalStructureObservation {
  const normalizationEvents = events.filter(
    (event) => event.type === "normalization_applied",
  );
  const normalizedPaths = new Set(
    normalizationEvents.flatMap((event) =>
      event.type === "normalization_applied"
        ? event.actions
            .filter((action) => action.type === "default_inserted")
            .map((action) => action.path)
        : [],
    ),
  );
  return {
    global_structure_normalization_event_count: normalizationEvents.length,
    global_structure_normalized_path_count: normalizedPaths.size,
    global_structural_repair_used: events.some((event) => event.type === "repair_started"),
    global_structural_repair_succeeded: events.some((event) => event.type === "repair_succeeded"),
    global_structural_repair_failed: events.some((event) => event.type === "repair_failed"),
    global_structural_repair_provider_failed: events.some(
      (event) => event.type === "repair_provider_failed",
    ),
  };
}

export function buildAssetPlanningFiveRoundQualityCheckPlan(
  input: AssetPlanningFiveRoundQualityCheckInput = {},
  runtimeFingerprintInputs?: AssetPlanningRuntimeFingerprintInputs,
): AssetPlanningFiveRoundQualityCheckPlan {
  const sourceStoryboardDirs = resolveSourceStoryboardDirs(input);
  const runManifest = buildRunManifest(
    input,
    sourceStoryboardDirs,
    runtimeFingerprintInputs,
  );
  return {
    mode: "asset_planning_real_runtime_live_check",
    generation_mode: input.mode ?? "legacy",
    automated_gate: false,
    requires_real_env: input.live === true,
    source_storyboard_dirs: sourceStoryboardDirs,
    total_rounds: input.rounds ?? sourceStoryboardDirs.length,
    output_dir: resolveQualityCheckOutputDir(input),
    run_manifest: runManifest,
    required_artifacts: {
      run_level: [
        "live-check-plan.json",
        "live-check-summary.json",
        "gemini-review-pack.md",
      ],
      all_settled: [...ALL_SETTLED_ROUND_ARTIFACTS],
      success_only: [...SUCCESS_ONLY_ROUND_ARTIFACTS],
      failure_only: [...FAILURE_ONLY_ROUND_ARTIFACTS],
      interaction_evidence: {
        condition: "llm_invocation_attempted",
        marker_paths: "explicit_relative_markdown_paths",
      },
    },
    required_checks: [
      "Requires real .env and must be run explicitly outside the default automated gate.",
      "Runs 5 asset planning rounds from fixed storyboard artifacts; it does not rerun topic, script, or storyboard.",
      "Copies script, topic, and storyboard artifacts into each round so Gemini and humans can review the full upstream context.",
      "Does not call assets providers, create physical files, upload files, preview assets, compose timelines, or export video.",
      "Local validation only checks structure, references, dependencies, and coverage; it does not judge aesthetics or viral quality.",
    ],
  };
}

function resolveQualityCheckOutputDir(
  input: AssetPlanningFiveRoundQualityCheckInput,
) {
  if (input.outputDir) return input.outputDir;
  const evidenceMode = input.live === true ? "live" : "dry-run";
  const runId = sanitizeRunId(input.runId ?? createDefaultRunId());
  if (!input.fixture) {
    return resolve(
      DEFAULT_OUTPUT_DIR,
      `${input.mode ?? "legacy"}-${evidenceMode}-${runId}`,
    );
  }
  const fixtureName = basename(input.fixture, extname(input.fixture));
  return resolve(
    DEFAULT_OUTPUT_DIR,
    `${fixtureName}-${input.mode ?? "legacy"}-${evidenceMode}-${runId}`,
  );
}

function createDefaultRunId() {
  const timestamp = new Date().toISOString().replace(/[^0-9TZ]/gu, "");
  return `${timestamp}-${randomUUID()}`;
}

function sanitizeRunId(value: string) {
  const sanitized = value.trim().replace(/[^A-Za-z0-9._-]/gu, "_");
  return sanitized || randomUUID();
}

function buildRunManifest(
  input: AssetPlanningFiveRoundQualityCheckInput,
  sourceStoryboardDirs: string[],
  runtimeFingerprintInputs = defaultPlanRuntimeFingerprintInputs(input),
): AssetPlanningQualityCheckRunManifest {
  const targetRounds = input.rounds ?? sourceStoryboardDirs.length;
  const maxMakeupRounds = Math.max(0, input.maxMakeupRounds ?? 0);
  const fingerprintInputs: AssetPlanningQualityCheckRunManifest["fingerprint_inputs"] = {
    generation_mode: input.mode ?? "legacy",
    execution_mode: input.live === true ? "live" : "dry-run",
    target_rounds: targetRounds,
    max_makeup_rounds: maxMakeupRounds,
    max_total_rounds: targetRounds + maxMakeupRounds,
    chunk_concurrency: input.chunkConcurrency ?? null,
    estimated_chunk_count: estimateChunkCount(input),
    provider_id: runtimeFingerprintInputs.provider_id,
    model_id: runtimeFingerprintInputs.model_id,
    prompt_bundle_sha256: runtimeFingerprintInputs.prompt_bundle_sha256,
    runtime_revision_sha256: runtimeFingerprintInputs.runtime_revision_sha256,
    runtime_profile_sha256: runtimeFingerprintInputs.runtime_profile_sha256,
    ordered_sources: input.fixture
      ? [fingerprintFixtureSource(input.fixture)]
      : sourceStoryboardDirs.map(fingerprintSourceDirectory),
  };
  return {
    version: "asset_planning_run_manifest_v1",
    fingerprint: sha256Canonical(fingerprintInputs),
    fingerprint_inputs: fingerprintInputs,
  };
}

function defaultPlanRuntimeFingerprintInputs(
  input: AssetPlanningFiveRoundQualityCheckInput,
): AssetPlanningRuntimeFingerprintInputs {
  const unloaded = input.live === true
    ? "not_loaded_plan_only"
    : "not_loaded_dry_run";
  return {
    provider_id: unloaded,
    model_id: unloaded,
    prompt_bundle_sha256: computeContentTreeSha256(
      REPOSITORY_ROOT,
      PROMPT_BUNDLE_DIRECTORIES,
      PROMPT_BUNDLE_CONFIG_FILES,
    ),
    runtime_revision_sha256:
      computeAssetPlanningRuntimeRevisionSha256(REPOSITORY_ROOT),
    runtime_profile_sha256: unloaded,
  };
}

export function computeAssetPlanningRuntimeRevisionSha256(
  repositoryRoot = REPOSITORY_ROOT,
) {
  return computeContentTreeSha256(
    repositoryRoot,
    RUNTIME_REVISION_DIRECTORIES,
    RUNTIME_REVISION_CONFIG_FILES,
  );
}

function computeContentTreeSha256(
  repositoryRoot: string,
  relativeDirectories: string[],
  relativeFiles: string[],
) {
  const discoveredFiles = relativeDirectories.flatMap((relativeDirectory) =>
    collectContentTreeFiles(repositoryRoot, relativeDirectory),
  );
  const allFiles = [...new Set([...discoveredFiles, ...relativeFiles])]
    .filter((relativePath) => existsSync(resolve(repositoryRoot, relativePath)))
    .sort((left, right) => left.localeCompare(right, "en"));
  return sha256Canonical(
    allFiles.map((relativePath) => {
      const absolutePath = resolve(repositoryRoot, relativePath);
      return {
        path: relativePath.replaceAll("\\", "/"),
        sha256: sha256Text(readFileSync(absolutePath, "utf8")),
      };
    }),
  );
}

function collectContentTreeFiles(
  repositoryRoot: string,
  relativeDirectory: string,
): string[] {
  const normalizedDirectory = relativeDirectory.replaceAll("\\", "/");
  if (normalizedDirectory === "harness/scripts/runtime/output") return [];
  const absoluteDirectory = resolve(repositoryRoot, relativeDirectory);
  if (!existsSync(absoluteDirectory)) return [];
  return readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap(
    (entry) => {
      const relativePath = `${normalizedDirectory}/${entry.name}`;
      if (entry.isDirectory()) {
        return collectContentTreeFiles(repositoryRoot, relativePath);
      }
      return entry.isFile() ? [relativePath] : [];
    },
  );
}

async function resolveRuntimeFingerprintInputs(
  input: AssetPlanningFiveRoundQualityCheckInput,
  injected: AssetPlanningRuntimeFingerprintInputs | undefined,
  requireRealEnv: boolean,
): Promise<AssetPlanningRuntimeFingerprintInputs> {
  if (input.live !== true) {
    return defaultPlanRuntimeFingerprintInputs(input);
  }
  if (injected && !requireRealEnv) {
    return normalizeRuntimeFingerprintInputs(injected);
  }

  const { getValidatedRuntimeEnv } = await import(
    "../../../backend/src/config/env"
  );
  let runtimeEnv: ReturnType<typeof getValidatedRuntimeEnv>;
  try {
    runtimeEnv = getValidatedRuntimeEnv();
  } catch {
    throw new Error("asset_planning_live_check_runtime_config_invalid");
  }
  if (requireRealEnv) {
    if (runtimeEnv.llm.provider === "stub") {
      throw new Error("asset_planning_live_check_real_env_missing");
    }
    try {
      const { resolveTierProviderSnapshot } = await import(
        "../../../backend/src/runtime/llm/tier-aware-provider-factory"
      );
      resolveTierProviderSnapshot();
    } catch {
      throw new Error("asset_planning_live_check_runtime_config_invalid");
    }
  }
  if (injected) {
    return normalizeRuntimeFingerprintInputs(injected);
  }
  const smartModel = runtimeEnv.llm.smartModel?.trim();
  const separator = smartModel?.indexOf(":") ?? -1;
  const providerId =
    separator > 0 ? smartModel!.slice(0, separator) : runtimeEnv.llm.provider;
  const modelId =
    separator > 0
      ? smartModel!.slice(separator + 1)
      : runtimeEnv.llm.structuredModel ?? runtimeEnv.llm.model;
  return normalizeRuntimeFingerprintInputs({
    provider_id: providerId,
    model_id: modelId,
    prompt_bundle_sha256: computeContentTreeSha256(
      REPOSITORY_ROOT,
      PROMPT_BUNDLE_DIRECTORIES,
      PROMPT_BUNDLE_CONFIG_FILES,
    ),
    runtime_revision_sha256:
      computeAssetPlanningRuntimeRevisionSha256(REPOSITORY_ROOT),
    runtime_profile_sha256: buildRuntimeProfileSha256(runtimeEnv),
  });
}

function buildRuntimeProfileSha256(runtimeEnv: {
  llm: {
    baseUrl?: string;
    structuredBaseUrl?: string;
    smartModel?: string;
    flashModel?: string;
    structuredStrategy: string;
    structuredThinking?: string;
    structuredTemperature?: number;
    structuredTopP?: number;
    structuredMaxTokens?: number;
    timeoutMs: number;
    maxAttempts: number;
    requestBudgetMaxRequests: number;
    providersConfigPath?: string;
  };
}) {
  const providersConfigPath = runtimeEnv.llm.providersConfigPath
    ? resolve(runtimeEnv.llm.providersConfigPath)
    : resolve(process.cwd(), "backend/providers.json");
  return sha256Canonical({
    endpoint_sha256: sha256Canonical({
      base_url: runtimeEnv.llm.baseUrl ?? null,
      structured_base_url: runtimeEnv.llm.structuredBaseUrl ?? null,
    }),
    providers_config_sha256: existsSync(providersConfigPath)
      ? sha256Text(readFileSync(providersConfigPath, "utf8"))
      : "not_configured",
    profile_sha256: sha256Canonical({
      smart_model: runtimeEnv.llm.smartModel ?? null,
      flash_model: runtimeEnv.llm.flashModel ?? null,
      structured_strategy: runtimeEnv.llm.structuredStrategy,
      structured_thinking: runtimeEnv.llm.structuredThinking ?? null,
      structured_temperature: runtimeEnv.llm.structuredTemperature ?? null,
      structured_top_p: runtimeEnv.llm.structuredTopP ?? null,
      structured_max_tokens: runtimeEnv.llm.structuredMaxTokens ?? null,
      timeout_ms: runtimeEnv.llm.timeoutMs,
      max_attempts: runtimeEnv.llm.maxAttempts,
      request_budget_max_requests: runtimeEnv.llm.requestBudgetMaxRequests,
    }),
  });
}

function normalizeRuntimeFingerprintInputs(
  input: AssetPlanningRuntimeFingerprintInputs,
): AssetPlanningRuntimeFingerprintInputs {
  if (
    !/^[a-f0-9]{64}$/u.test(input.prompt_bundle_sha256) ||
    !/^[a-f0-9]{64}$/u.test(input.runtime_revision_sha256) ||
    !/^[a-f0-9]{64}$/u.test(input.runtime_profile_sha256)
  ) {
    throw new Error("asset_planning_quality_check_runtime_fingerprint_invalid");
  }
  return {
    provider_id: sanitizeRuntimeIdentifier(input.provider_id),
    model_id: sanitizeRuntimeIdentifier(input.model_id),
    prompt_bundle_sha256: input.prompt_bundle_sha256,
    runtime_revision_sha256: input.runtime_revision_sha256,
    runtime_profile_sha256: input.runtime_profile_sha256,
  };
}

function sanitizeRuntimeIdentifier(value: string) {
  const sanitized = value
    .trim()
    .slice(0, 128)
    .replace(/[^A-Za-z0-9._:/-]/gu, "_");
  return sanitized || "unknown";
}

function fingerprintFixtureSource(fixturePath: string) {
  const raw = readJson(resolve(process.cwd(), fixturePath));
  const sourceIds =
    raw && typeof raw === "object"
      ? readStableSourceIds((raw as { source_ids?: unknown }).source_ids)
      : [];
  return {
    kind: "fixture" as const,
    content_sha256: sha256Canonical(raw),
    source_ids: sourceIds,
  };
}

function fingerprintSourceDirectory(sourceDir: string) {
  const candidatePaths = [
    resolve(sourceDir, "source-script-draft.json"),
    resolve(sourceDir, "source-topic-package.json"),
    existsSync(resolve(sourceDir, "storyboard-plan.json"))
      ? resolve(sourceDir, "storyboard-plan.json")
      : resolve(sourceDir, "source-storyboard-plan.json"),
  ];
  const artifacts = candidatePaths.map((artifactPath) => ({
    artifact: basename(artifactPath),
    content: existsSync(artifactPath) ? readJson(artifactPath) : null,
  }));
  const sourceIds = artifacts.flatMap(({ content }) =>
    readStableSourceIds(content),
  );
  return {
    kind: "source_dir" as const,
    content_sha256: sha256Canonical({
      source_path_sha256: sha256Text(resolve(sourceDir).toLowerCase()),
      artifacts,
    }),
    source_ids: [...new Set(sourceIds)].sort(),
  };
}

function readStableSourceIds(value: unknown) {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const stableKeys = [
    "storyboard_record_id",
    "source_storyboard_record_id",
    "script_record_id",
    "source_script_record_id",
    "topic_package_id",
    "source_topic_package_id",
    "topic_id",
  ];
  return stableKeys.flatMap((key) =>
    typeof record[key] === "string" ? [record[key] as string] : [],
  );
}

function sha256Canonical(value: unknown) {
  return sha256Text(canonicalJson(value));
}

function sha256Text(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export async function runAssetPlanningFiveRoundQualityCheck(
  input: AssetPlanningFiveRoundQualityCheckInput = {},
  dependencies: AssetPlanningFiveRoundQualityCheckDependencies = {},
): Promise<AssetPlanningFiveRoundQualityCheckResult> {
  if (input.dryRun === true && input.live === true) {
    throw new Error("asset_planning_quality_check_dry_run_live_conflict");
  }
  if (input.live === true && input.mode !== "intent_compiler") {
    throw new Error("asset_planning_quality_check_live_mode_unsupported");
  }
  if (input.resume === true && !input.outputDir) {
    throw new Error("asset_planning_quality_check_resume_output_dir_required");
  }
  if (
    input.resume === true &&
    !existsSync(resolve(input.outputDir!, "live-check-plan.json"))
  ) {
    throw new Error("asset_planning_quality_check_resume_output_not_found");
  }

  const requireRealEnv = dependencies.requireRealEnv ?? true;
  const runtimeFingerprintInputs = await resolveRuntimeFingerprintInputs(
    input,
    dependencies.runtimeFingerprintInputs,
    requireRealEnv,
  );
  const previewPlan = buildAssetPlanningFiveRoundQualityCheckPlan(
    input,
    runtimeFingerprintInputs,
  );
  if (
    input.live !== true &&
    hasExistingRoundEvidence(previewPlan.output_dir)
  ) {
    throw new Error(
      "asset_planning_quality_check_dry_run_live_evidence_conflict",
    );
  }
  if (
    input.live === true &&
    input.resume !== true &&
    hasExistingRoundEvidence(previewPlan.output_dir)
  ) {
    throw new Error(
      "asset_planning_quality_check_existing_evidence_requires_resume",
    );
  }

  assertExistingRunManifestCompatible(previewPlan);
  assertExistingRoundMarkersCompatible(previewPlan);
  const plan = writeAssetPlanningFiveRoundQualityCheckPlan(previewPlan);
  const targetRounds = plan.total_rounds;
  const maxMakeupRounds = Math.max(0, input.maxMakeupRounds ?? 0);
  const maxTotalRounds = targetRounds + maxMakeupRounds;
  const estimatedChunkCount = estimateChunkCount(input);

  const dryRun = input.live !== true;
  if (dryRun) {
    const result = buildQualityCheckResult({
      plan,
      rounds: [],
      targetRounds,
      maxTotalRounds,
      estimatedChunkCount,
      dryRun: true,
    });
    writeQualityCheckResult(result, []);
    return result;
  }

  const { renderLlmInteractionMarkdown } = await import(
    "../../../backend/src/runtime/llm/interaction-log"
  );
  let planGenerator = dependencies.planGenerator;
  if (!planGenerator) {
    const { generateAssetPlan } = await import(
      "../../../backend/src/modules/asset-planning/asset-planning-generation.service"
    );
    planGenerator = (generatorInput: AssetPlanningFiveRoundPlanGeneratorInput) =>
      generateAssetPlan(generatorInput);
  }
  const rounds: AssetPlanningFiveRoundRoundResult[] = [];
  const reviewSections: string[] = [];

  for (
    let round = 1;
    round <= maxTotalRounds && countValidProviderRounds(rounds) < targetRounds;
    round += 1
  ) {
    const sourceStoryboardDir =
      plan.source_storyboard_dirs[(round - 1) % plan.source_storyboard_dirs.length];
    const source = input.fixture
      ? loadAssetPlanningFixtureSource(input.fixture)
      : loadAssetPlanningFixedSource(sourceStoryboardDir);
    const roundOutputDir = resolve(plan.output_dir, `round-${round}`);
    const sourceStoryboardRecordId =
      source.storyboardRecordId ?? `fixed-storyboard-record-${round}`;
    const sourceScriptRecordId = source.storyboard.source_script_record_id;
    const sourceTopicPackageId = source.storyboard.source_topic_package_id;

    if (input.resume) {
      const resumedRound = readCompletedRoundIfAvailable({
        round,
        roundOutputDir,
        sourceStoryboardDir,
        source,
        sourceStoryboardRecordId,
        sourceScriptRecordId,
        sourceTopicPackageId,
        expectedRunFingerprint: plan.run_manifest.fingerprint,
      });

      if (resumedRound) {
        rounds.push(resumedRound.roundResult);
        reviewSections.push(resumedRound.reviewMarkdown);
        continue;
      }
    }

    mkdirSync(roundOutputDir, { recursive: true });
    writeJson(roundOutputDir, "source-script-draft.json", source.draft);
    writeJson(roundOutputDir, "source-topic-package.json", source.topicPackage);
    writeJson(roundOutputDir, "source-storyboard-plan.json", source.storyboard);

    const llmCallDiagnostics: RuntimeLlmCallDiagnostics[] = [];
    const intentChunkEvents: IntentChunkSettledEvent[] = [];
    const globalStructureEvents: GlobalDraftStructureEvent[] = [];
    const onGlobalStructureEvent = (event: GlobalDraftStructureEvent) => {
      globalStructureEvents.push(event);
    };
    const interactionLogWriter = createRoundInteractionLogWriter(
      roundOutputDir,
      llmCallDiagnostics,
      renderLlmInteractionMarkdown,
    );
    const onIntentChunkSettled = (event: IntentChunkSettledEvent) => {
      intentChunkEvents.push(structuredClone(event));
    };
    let firstPassWallTimeMs = 0;
    let regenWallTimeMs = 0;

    try {
      const firstPassStartedAt = Date.now();
      let assetPlan: AssetPlanType;
      try {
        assetPlan = AssetPlan.parse(
          await planGenerator({
            sourceStoryboardRecordId,
            sourceScriptRecordId,
            sourceTopicPackageId,
            storyboard: source.storyboard,
            draft: source.draft,
            topicBoundaryContext: source.topicBoundaryContext,
            interactionLogWriter,
            onGlobalStructureEvent,
            chunkConcurrency: input.chunkConcurrency,
            generationMode: input.mode,
            onIntentChunkSettled,
            round,
          }),
        );
      } finally {
        firstPassWallTimeMs = Date.now() - firstPassStartedAt;
      }
      let validation = validateAssetPlan({
        storyboardRecordId: sourceStoryboardRecordId,
        scriptRecordId: sourceScriptRecordId,
        topicPackageId: sourceTopicPackageId,
        storyboard: source.storyboard,
        scriptText: source.draft.script_text,
        plan: assetPlan,
      });
      let regenerated = false;

      if (
        validation.decision === "regen_once" &&
        input.mode !== "intent_compiler"
      ) {
        regenerated = true;
        const regenStartedAt = Date.now();
        try {
          assetPlan = AssetPlan.parse(
            await planGenerator({
              sourceStoryboardRecordId,
              sourceScriptRecordId,
              sourceTopicPackageId,
              storyboard: source.storyboard,
              draft: source.draft,
              topicBoundaryContext: source.topicBoundaryContext,
              interactionLogWriter,
              onGlobalStructureEvent,
              chunkConcurrency: input.chunkConcurrency,
              generationMode: input.mode,
              onIntentChunkSettled,
              round,
              regenerationContext: {
                reason: "asset_planning_local_validation_regen_once",
                errors: validation.errors,
                metrics: validation.metrics,
              },
            }),
          );
        } finally {
          regenWallTimeMs = Date.now() - regenStartedAt;
        }
        validation = validateAssetPlan({
          storyboardRecordId: sourceStoryboardRecordId,
          scriptRecordId: sourceScriptRecordId,
          topicPackageId: sourceTopicPackageId,
          storyboard: source.storyboard,
          scriptText: source.draft.script_text,
          plan: assetPlan,
        });
      }

      const baseChecks: RuntimeDiagnosticCheck[] = [
        ...(regenerated
          ? [
              {
                code: "asset_planning_regen_once",
                level: "info" as const,
              },
            ]
          : []),
        {
          code:
            validation.decision === "pass"
              ? "asset_planning_local_validation_passed"
              : "asset_planning_local_validation_failed",
          level: validation.decision === "pass" ? "info" : "error",
        },
        ...validation.errors.map((error) => ({
          code: error,
          level: "error" as const,
        })),
      ];
      const repairChainMetrics = buildRepairChainMetrics({
        llmCalls: llmCallDiagnostics,
        checks: baseChecks,
        fullRegenUsed: regenerated,
        firstPassWallTimeMs,
        regenWallTimeMs,
      });
      const globalStructureObservation = aggregateGlobalStructureEvents(
        globalStructureEvents,
      );
      const attemptMetrics = aggregateRoundAttempts({
        intentChunkEvents,
        globalStructureEvents,
        llmCalls: llmCallDiagnostics,
        fullRegenerationUsed: regenerated,
      });
      const runtimeDiagnostics = {
        llm_calls: llmCallDiagnostics,
        checks: [
          ...baseChecks,
          ...buildRepairChainChecks(repairChainMetrics),
        ],
        repair_chain_metrics: repairChainMetrics,
        attempt_accounting: {
          ...attemptMetrics,
          accounting_complete: true,
        },
        global_structure_observation: globalStructureObservation,
      };

      writeJson(roundOutputDir, "asset-plan.json", assetPlan);
      writeJson(roundOutputDir, "asset-planning-validation-result.json", validation);
      writeJson(roundOutputDir, "runtime-diagnostics.json", runtimeDiagnostics);
      writeRoundTrace(roundOutputDir, {
        round,
        sourceStoryboardDir,
        sourceTitle: source.topicPackage.title,
        regenerated,
        validationDecision: validation.decision,
        validationErrors: validation.errors,
        taskCount: assetPlan.tasks.length,
        dependencyCount: assetPlan.dependencies.length,
        segmentCount: source.storyboard.segments.length,
        repairChainMetrics,
      });

      const reviewMarkdown = renderRoundReviewMarkdown({
        round,
        sourceTitle: source.topicPackage.title,
        sourceStoryboardDir,
        draft: source.draft,
        storyboard: source.storyboard,
        assetPlan,
        validation,
      });
      writeFileSync(resolve(roundOutputDir, "review.md"), reviewMarkdown, "utf8");
      reviewSections.push(reviewMarkdown);

      const roundResult: AssetPlanningFiveRoundRoundResult = {
        round,
        status: validation.decision === "pass" ? "round-ready" : "round-failed",
        source_storyboard_dir: sourceStoryboardDir,
        source_title: source.topicPackage.title,
        regenerated,
        full_regen_used: repairChainMetrics.full_regen_used,
        chunk_structural_repair_used:
          repairChainMetrics.chunk_structural_repair_used,
        plan_structural_repair_used:
          repairChainMetrics.plan_structural_repair_used,
        provider_safety_retry_used: repairChainMetrics.provider_safety_retry_used,
        ...globalStructureObservation,
        first_pass_wall_time_ms: repairChainMetrics.first_pass_wall_time_ms,
        repair_wall_time_ms: repairChainMetrics.repair_wall_time_ms,
        regen_wall_time_ms: repairChainMetrics.regen_wall_time_ms,
        llm_call_count: repairChainMetrics.llm_call_count,
        output_dir: roundOutputDir,
        validation_decision: validation.decision,
        validation_errors: validation.errors,
        validation_warnings: validation.warnings,
        task_count: assetPlan.tasks.length,
        dependency_count: assetPlan.dependencies.length,
        segment_count: source.storyboard.segments.length,
        task_type_counts: countTasksByType(assetPlan),
        failure_class:
          validation.decision === "pass" ? null : "structural_compiler",
        ...attemptMetrics,
        accounting_complete: true,
      };
      persistSettledRoundResult({
        roundOutputDir,
        roundResult,
        runFingerprint: plan.run_manifest.fingerprint,
        failureCode:
          validation.decision === "pass"
            ? null
            : validation.errors[0] ?? "asset_planning_local_validation_failed",
        requiredPaths:
          validation.decision === "pass"
            ? [
                ...ALL_SETTLED_ROUND_ARTIFACTS,
                ...SUCCESS_ONLY_ROUND_ARTIFACTS,
              ]
            : [
                ...ALL_SETTLED_ROUND_ARTIFACTS,
                ...FAILURE_ONLY_ROUND_ARTIFACTS,
              ],
      });
      rounds.push(roundResult);
    } catch (error) {
      const failureClass = classifyFailure(error, intentChunkEvents);
      const failureCode = stableFailureCode(error, failureClass);
      const baseChecks: RuntimeDiagnosticCheck[] = [
        {
          code: failureCode,
          level: "error",
        },
      ];
      const repairChainMetrics = buildRepairChainMetrics({
        llmCalls: llmCallDiagnostics,
        checks: baseChecks,
        fullRegenUsed: false,
        firstPassWallTimeMs,
        regenWallTimeMs,
      });
      const globalStructureObservation = aggregateGlobalStructureEvents(
        globalStructureEvents,
      );
      const attemptMetrics = aggregateRoundAttempts({
        intentChunkEvents,
        globalStructureEvents,
        llmCalls: llmCallDiagnostics,
        fullRegenerationUsed: false,
      });
      const runtimeDiagnostics = {
        llm_calls: llmCallDiagnostics,
        checks: [
          ...baseChecks,
          ...buildRepairChainChecks(repairChainMetrics),
        ],
        repair_chain_metrics: repairChainMetrics,
        attempt_accounting: {
          ...attemptMetrics,
          accounting_complete: true,
        },
        global_structure_observation: globalStructureObservation,
      };
      writeJson(roundOutputDir, "runtime-diagnostics.json", runtimeDiagnostics);
      writeRoundTrace(roundOutputDir, {
        round,
        sourceStoryboardDir,
        sourceTitle: source.topicPackage.title,
        regenerated: false,
        validationDecision: "external_error",
        validationErrors: [failureCode],
        taskCount: 0,
        dependencyCount: 0,
        segmentCount: source.storyboard.segments.length,
        repairChainMetrics,
      });
      const reviewMarkdown = renderFailedRoundReviewMarkdown({
        round,
        sourceTitle: source.topicPackage.title,
        sourceStoryboardDir,
        draft: source.draft,
        storyboard: source.storyboard,
        failureCode,
        failureClass,
      });
      writeFileSync(resolve(roundOutputDir, "review.md"), reviewMarkdown, "utf8");
      reviewSections.push(reviewMarkdown);

      const roundResult: AssetPlanningFiveRoundRoundResult = {
        round,
        status: "round-failed",
        source_storyboard_dir: sourceStoryboardDir,
        source_title: source.topicPackage.title,
        regenerated: false,
        full_regen_used: repairChainMetrics.full_regen_used,
        chunk_structural_repair_used:
          repairChainMetrics.chunk_structural_repair_used,
        plan_structural_repair_used:
          repairChainMetrics.plan_structural_repair_used,
        provider_safety_retry_used: repairChainMetrics.provider_safety_retry_used,
        ...globalStructureObservation,
        first_pass_wall_time_ms: repairChainMetrics.first_pass_wall_time_ms,
        repair_wall_time_ms: repairChainMetrics.repair_wall_time_ms,
        regen_wall_time_ms: repairChainMetrics.regen_wall_time_ms,
        llm_call_count: repairChainMetrics.llm_call_count,
        output_dir: roundOutputDir,
        validation_decision: "external_error",
        validation_errors: [failureCode],
        validation_warnings: [],
        task_count: 0,
        dependency_count: 0,
        segment_count: source.storyboard.segments.length,
        task_type_counts: {},
        failure_class: failureClass,
        ...attemptMetrics,
        accounting_complete: true,
      };
      persistSettledRoundResult({
        roundOutputDir,
        roundResult,
        runFingerprint: plan.run_manifest.fingerprint,
        failureCode,
        requiredPaths: [
          ...ALL_SETTLED_ROUND_ARTIFACTS,
          ...FAILURE_ONLY_ROUND_ARTIFACTS,
        ],
      });
      rounds.push(roundResult);
    }
  }

  const result = buildQualityCheckResult({
    plan,
    rounds,
    targetRounds,
    maxTotalRounds,
    estimatedChunkCount,
    dryRun: false,
  });

  writeQualityCheckResult(result, reviewSections);

  return result;
}

function buildQualityCheckResult(input: {
  plan: AssetPlanningFiveRoundQualityCheckPlan;
  rounds: AssetPlanningFiveRoundRoundResult[];
  targetRounds: number;
  maxTotalRounds: number;
  estimatedChunkCount: number;
  dryRun: boolean;
}): AssetPlanningFiveRoundQualityCheckResult {
  const { plan, rounds } = input;
  const validProviderRounds = countValidProviderRounds(rounds);
  return {
    ...plan,
    target_rounds: input.targetRounds,
    total_rounds: rounds.length,
    passed_rounds: rounds.filter((round) => round.status === "round-ready").length,
    failed_rounds: rounds.filter((round) => round.status === "round-failed").length,
    valid_provider_rounds: validProviderRounds,
    end_to_end_success_rounds: rounds.filter((round) => round.status === "round-ready").length,
    provider_failure_rounds: rounds.filter((round) => round.failure_class === "provider").length,
    structural_compiler_failure_rounds: rounds.filter(
      (round) => round.failure_class === "structural_compiler",
    ).length,
    repair_attempts: sumRoundMetric(rounds, "repair_attempts"),
    regeneration_attempts: sumRoundMetric(rounds, "regeneration_attempts"),
    safety_attempts: sumRoundMetric(rounds, "safety_attempts"),
    provider_attempts: sumRoundMetric(rounds, "provider_attempts"),
    makeup_rounds: Math.max(0, rounds.length - input.targetRounds),
    zero_denominator: validProviderRounds === 0,
    dry_run: input.dryRun,
    estimated_chunk_count: input.estimatedChunkCount,
    max_total_rounds: input.maxTotalRounds,
    network_requests_per_chunk_max: 10,
    worst_case_chunk_network_requests:
      input.estimatedChunkCount * input.maxTotalRounds * 10,
    global_planning_requests_per_round_max: 2,
    global_safety_requests_per_round_max: 2,
    global_structural_repair_requests_per_round_max: 2,
    global_provider_requests_per_round_max: 6,
    worst_case_global_provider_requests: input.maxTotalRounds * 6,
    worst_case_total_provider_requests:
      input.maxTotalRounds * (6 + input.estimatedChunkCount * 10),
    accounting_incomplete_rounds: rounds.filter(
      (round) => !round.accounting_complete,
    ).length,
    global_structure_normalization_event_count: rounds.reduce(
      (sum, round) => sum + round.global_structure_normalization_event_count,
      0,
    ),
    global_structure_normalization_used_rounds: rounds.filter(
      (round) => round.global_structure_normalization_event_count > 0,
    ).length,
    global_structure_normalized_path_count: rounds.reduce(
      (sum, round) => sum + round.global_structure_normalized_path_count,
      0,
    ),
    global_structural_repair_used_rounds: rounds.filter(
      (round) => round.global_structural_repair_used,
    ).length,
    global_structural_repair_succeeded_rounds: rounds.filter(
      (round) => round.global_structural_repair_succeeded,
    ).length,
    global_structural_repair_failed_rounds: rounds.filter(
      (round) => round.global_structural_repair_failed,
    ).length,
    global_structural_repair_provider_failed_rounds: rounds.filter(
      (round) => round.global_structural_repair_provider_failed,
    ).length,
    rounds,
  };
}

function writeQualityCheckResult(
  result: AssetPlanningFiveRoundQualityCheckResult,
  reviewSections: string[],
) {
  const outputDir = result.output_dir;
  writeJson(outputDir, "live-check-summary.json", result);
  writeFileSync(
    resolve(outputDir, "gemini-review-pack.md"),
    renderGeminiReviewPack(result, reviewSections),
    "utf8",
  );
}

export function parseAssetPlanningFiveRoundQualityCheckCliArgs(argv: string[]) {
  const result: AssetPlanningFiveRoundQualityCheckInput = {};
  let sawDryRun = false;
  let sawLive = false;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    const separator = current.indexOf("=");
    const flag = separator >= 0 ? current.slice(0, separator) : current;
    const inlineValue = separator >= 0 ? current.slice(separator + 1) : undefined;

    if (flag === "--fixture") {
      const value = readCliOptionValue({
        inlineValue,
        next,
        field: "fixture",
      });
      result.fixture = value.value;
      if (value.consumedNext) index += 1;
      continue;
    }

    if (flag === "--mode") {
      const value = readCliOptionValue({
        inlineValue,
        next,
        field: "mode",
      });
      const mode = value.value;
      if (mode !== "legacy" && mode !== "intent_compiler") {
        throw new Error("asset_planning_quality_check_mode_invalid");
      }
      result.mode = mode;
      if (value.consumedNext) index += 1;
      continue;
    }

    if (flag === "--rounds") {
      const value = readCliOptionValue({
        inlineValue,
        next,
        field: "rounds",
      });
      result.rounds = readNonNegativeInteger(value.value, "rounds", 1);
      if (value.consumedNext) index += 1;
      continue;
    }

    if (flag === "--max-makeup-rounds") {
      const value = readCliOptionValue({
        inlineValue,
        next,
        field: "max_makeup_rounds",
      });
      result.maxMakeupRounds = readNonNegativeInteger(
        value.value,
        "max_makeup_rounds",
        0,
      );
      if (value.consumedNext) index += 1;
      continue;
    }

    if (current === "--dry-run") {
      sawDryRun = true;
      result.dryRun = true;
      continue;
    }

    if (current === "--live") {
      sawLive = true;
      result.live = true;
      continue;
    }

    if (current === "--help" || current === "-h") {
      result.help = true;
      continue;
    }

    if (flag === "--output-dir") {
      const value = readCliOptionValue({
        inlineValue,
        next,
        field: "output_dir",
      });
      result.outputDir = value.value;
      if (value.consumedNext) index += 1;
      continue;
    }

    if (flag === "--source-dir") {
      const value = readCliOptionValue({
        inlineValue,
        next,
        field: "source_dir",
      });
      result.sourceDirs = [...(result.sourceDirs ?? []), value.value];
      if (value.consumedNext) index += 1;
      continue;
    }

    if (flag === "--chunk-concurrency") {
      const value = readCliOptionValue({
        inlineValue,
        next,
        field: "chunk_concurrency",
      });
      result.chunkConcurrency = readNonNegativeInteger(
        value.value,
        "chunk_concurrency",
        1,
      );
      if (value.consumedNext) index += 1;
      continue;
    }

    if (current === "--resume") {
      result.resume = true;
      continue;
    }

    throw new Error("asset_planning_quality_check_argument_unknown");
  }

  if (sawDryRun && sawLive) {
    throw new Error("asset_planning_quality_check_dry_run_live_conflict");
  }
  if (result.live === true && result.mode !== "intent_compiler") {
    throw new Error("asset_planning_quality_check_live_mode_unsupported");
  }
  if (result.resume === true && !result.outputDir) {
    throw new Error("asset_planning_quality_check_resume_output_dir_required");
  }
  if (!sawLive) {
    result.dryRun = true;
    result.live = false;
  } else {
    result.dryRun = false;
  }

  return result;
}

function readCliOptionValue(input: {
  inlineValue: string | undefined;
  next: string | undefined;
  field: string;
}) {
  if (input.inlineValue !== undefined) {
    if (input.inlineValue.length === 0) {
      throw new Error(`asset_planning_quality_check_${input.field}_required`);
    }
    return { value: input.inlineValue, consumedNext: false };
  }
  if (!input.next || input.next.startsWith("-")) {
    throw new Error(`asset_planning_quality_check_${input.field}_required`);
  }
  return { value: input.next, consumedNext: true };
}

function readNonNegativeInteger(value: string, field: string, minimum: number) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`asset_planning_quality_check_${field}_invalid`);
  }
  return parsed;
}

function countValidProviderRounds(rounds: AssetPlanningFiveRoundRoundResult[]) {
  return rounds.filter((round) => round.failure_class !== "provider").length;
}

function sumRoundMetric(
  rounds: AssetPlanningFiveRoundRoundResult[],
  field:
    | "repair_attempts"
    | "regeneration_attempts"
    | "safety_attempts"
    | "provider_attempts",
) {
  return rounds.reduce((sum, round) => sum + round[field], 0);
}

function aggregateRoundAttempts(input: {
  intentChunkEvents: IntentChunkSettledEvent[];
  globalStructureEvents: GlobalDraftStructureEvent[];
  llmCalls: RuntimeLlmCallDiagnostics[];
  fullRegenerationUsed: boolean;
}) {
  const latestByChunk = new Map<string, IntentChunkSettledEvent>();
  for (const event of input.intentChunkEvents) {
    const existing = latestByChunk.get(event.chunk_id);
    if (
      !existing ||
      event.accounting.logical_invocation >= existing.accounting.logical_invocation
    ) {
      latestByChunk.set(event.chunk_id, event);
    }
  }
  const settled = [...latestByChunk.values()];
  const hasIntentAccounting = settled.length > 0;
  const nonChunkCalls = input.llmCalls.filter(
    (call) =>
      call.planning_mode !== "segment_intent_batch" &&
      call.planning_mode !== "segment_chunk" &&
      call.repair_mode !== "segment_chunk_structural_repair" &&
      call.repair_mode !== "segment_intent_targeted_repair",
  );
  const legacyRepairAttempts = hasIntentAccounting
    ? 0
    : input.llmCalls.filter((call) => Boolean(call.repair_mode)).length;
  const globalStructuralRepairAttempts = input.globalStructureEvents.filter(
    (event) => event.type === "repair_started",
  ).length;
  return {
    repair_attempts:
      settled.filter((event) => event.accounting.business_slot >= 2).length +
      legacyRepairAttempts +
      globalStructuralRepairAttempts,
    regeneration_attempts:
      settled.filter((event) => event.accounting.business_slot >= 3).length +
      (input.fullRegenerationUsed ? 1 : 0),
    safety_attempts: settled.reduce(
      (sum, event) => sum + event.accounting.safety_invocation,
      0,
    ) +
      (hasIntentAccounting ? nonChunkCalls : input.llmCalls).filter(
        (call) => Boolean(call.safety_retry_context_reason),
      ).length,
    provider_attempts:
      settled.reduce(
        (sum, event) => sum + event.accounting.provider_attempts,
        0,
      ) +
      (hasIntentAccounting ? nonChunkCalls : input.llmCalls).reduce(
        (sum, call) => sum + call.provider_attempts,
        0,
      ),
  };
}

const PROVIDER_FAILURE_CODES = new Set([
  "configuration",
  "content_filter",
  "invalid_request",
  "invalid_response",
  "llm_service_unavailable",
  "network",
  "rate_limited",
  "service_unavailable",
  "timeout",
  "budget_exceeded",
  "unknown",
]);

function classifyFailure(
  error: unknown,
  events: IntentChunkSettledEvent[],
): "provider" | "structural_compiler" {
  const realFailures = events.filter((event) => event.outcome === "failure");
  if (
    realFailures.some((event) => event.failure_class !== "provider")
  ) {
    return "structural_compiler";
  }
  if (
    realFailures.length > 0 &&
    realFailures.every((event) => event.failure_class === "provider")
  ) {
    return "provider";
  }
  const code = readErrorCode(error);
  if (code && PROVIDER_FAILURE_CODES.has(code)) {
    return "provider";
  }
  return "structural_compiler";
}

function stableFailureCode(
  error: unknown,
  failureClass: "provider" | "structural_compiler",
) {
  const code = readErrorCode(error);
  if (failureClass === "provider" && code && PROVIDER_FAILURE_CODES.has(code)) {
    return code;
  }
  if (failureClass === "provider") {
    return "asset_planning_provider_failure";
  }
  if (code === "asset_plan_compiler_invariant_failed") {
    return code;
  }
  return "asset_planning_structural_compiler_failure";
}

function readErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function estimateChunkCount(input: AssetPlanningFiveRoundQualityCheckInput) {
  if (input.fixture) {
    const raw = readJson(resolve(process.cwd(), input.fixture));
    if (!raw || typeof raw !== "object") {
      throw new Error("asset_planning_quality_check_fixture_invalid");
    }
    const storyboard = (raw as { storyboard?: unknown }).storyboard;
    const parsed = StoryboardPlan.parse(storyboard);
    return Math.ceil(parsed.segments.length / 2);
  }
  const sourceDirs = input.sourceDirs ?? (input.sourceDir ? [input.sourceDir] : []);
  return sourceDirs.reduce((maximum, sourceDir) => {
    const preferred = resolve(sourceDir, "storyboard-plan.json");
    const fallback = resolve(sourceDir, "source-storyboard-plan.json");
    const storyboardPath = existsSync(preferred) ? preferred : fallback;
    if (!existsSync(storyboardPath)) return maximum;
    const parsed = StoryboardPlan.parse(readJson(storyboardPath));
    return Math.max(maximum, Math.ceil(parsed.segments.length / 2));
  }, 0);
}

function readCompletedRoundIfAvailable(input: {
  round: number;
  roundOutputDir: string;
  sourceStoryboardDir: string;
  source: ReturnType<typeof loadAssetPlanningFixedSource>;
  sourceStoryboardRecordId: string;
  sourceScriptRecordId: string;
  sourceTopicPackageId: string;
  expectedRunFingerprint: string;
}) {
  const persistedPath = resolve(input.roundOutputDir, "round-result.json");
  if (existsSync(persistedPath)) {
    try {
      const persisted = readPersistedSettledRoundResult(
        input.roundOutputDir,
        input.round,
        input.expectedRunFingerprint,
      );
      return {
        reviewMarkdown: readFileSync(
          resolve(input.roundOutputDir, "review.md"),
          "utf8",
        ),
        roundResult: { ...persisted.round_result, resumed: true },
      };
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message ===
          "asset_planning_quality_check_round_fingerprint_missing" ||
          error.message ===
            "asset_planning_quality_check_round_fingerprint_mismatch")
      ) {
        throw error;
      }
      throw new Error("asset_planning_quality_check_partial_round_evidence");
    }
  }

  if (!isRoundDirectoryNonEmpty(input.roundOutputDir)) {
    return null;
  }

  const hasSettledLegacyEvidence = ALL_SETTLED_ROUND_ARTIFACTS.filter(
    (requiredPath) => requiredPath !== "round-result.json",
  ).every((requiredPath) => existsSync(resolve(input.roundOutputDir, requiredPath)));
  throw new Error(
    hasSettledLegacyEvidence
      ? "asset_planning_quality_check_round_fingerprint_missing"
      : "asset_planning_quality_check_partial_round_evidence",
  );
}

function persistSettledRoundResult(input: {
  roundOutputDir: string;
  roundResult: AssetPlanningFiveRoundRoundResult;
  runFingerprint: string;
  failureCode: string | null;
  requiredPaths: string[];
}) {
  const interactionEvidence = listRoundInteractionMarkdown(
    input.roundOutputDir,
  );
  if (
    hasInvocationAttempt(input.roundResult) &&
    interactionEvidence.length === 0
  ) {
    throw new Error(
      "asset_planning_quality_check_interaction_evidence_missing",
    );
  }
  const requiredPaths = [
    ...new Set([...input.requiredPaths, ...interactionEvidence]),
  ];
  for (const requiredPath of requiredPaths) {
    if (requiredPath === "round-result.json") continue;
    if (!existsSync(resolve(input.roundOutputDir, requiredPath))) {
      throw new Error("asset_planning_quality_check_round_artifact_missing");
    }
  }
  const success = input.roundResult.status === "round-ready";
  const persisted: PersistedAssetPlanningRoundResult = {
    version: "asset_planning_round_result_v1",
    run_fingerprint: input.runFingerprint,
    round: input.roundResult.round,
    outcome: success
      ? "success"
      : input.roundResult.failure_class === "provider"
        ? "provider_failure"
        : "structural_failure",
    success,
    failure_class: input.roundResult.failure_class,
    failure_code: input.failureCode,
    attempt_accounting: {
      repair_attempts: input.roundResult.repair_attempts,
      regeneration_attempts: input.roundResult.regeneration_attempts,
      safety_attempts: input.roundResult.safety_attempts,
      provider_attempts: input.roundResult.provider_attempts,
      accounting_complete: input.roundResult.accounting_complete,
    },
    required_paths: requiredPaths,
    interaction_evidence: interactionEvidence,
    round_result: input.roundResult,
  };
  writeJsonAtomic(input.roundOutputDir, "round-result.json", persisted);
}

function listRoundInteractionMarkdown(roundOutputDir: string) {
  const interactionDir = resolve(roundOutputDir, "llm-interactions");
  if (!existsSync(interactionDir)) return [];
  return readdirSync(interactionDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => `llm-interactions/${entry.name}`)
    .sort();
}

function hasInvocationAttempt(roundResult: AssetPlanningFiveRoundRoundResult) {
  return (
    roundResult.llm_call_count > 0 ||
    roundResult.provider_attempts > 0 ||
    roundResult.repair_attempts > 0 ||
    roundResult.regeneration_attempts > 0 ||
    roundResult.safety_attempts > 0
  );
}

function readPersistedSettledRoundResult(
  roundOutputDir: string,
  expectedRound: number,
  expectedRunFingerprint: string,
) {
  const raw = readJson(resolve(roundOutputDir, "round-result.json"));
  if (!raw || typeof raw !== "object") {
    throw new Error("round_result_invalid");
  }
  const persisted = raw as Partial<PersistedAssetPlanningRoundResult>;
  if (typeof persisted.run_fingerprint !== "string") {
    throw new Error(
      "asset_planning_quality_check_round_fingerprint_missing",
    );
  }
  if (persisted.run_fingerprint !== expectedRunFingerprint) {
    throw new Error(
      "asset_planning_quality_check_round_fingerprint_mismatch",
    );
  }
  if (
    persisted.version !== "asset_planning_round_result_v1" ||
    persisted.round !== expectedRound ||
    typeof persisted.success !== "boolean" ||
    !Array.isArray(persisted.required_paths) ||
    !Array.isArray(persisted.interaction_evidence) ||
    !persisted.round_result ||
    persisted.round_result.round !== expectedRound ||
    persisted.round_result.status !==
      (persisted.success ? "round-ready" : "round-failed")
  ) {
    throw new Error("round_result_invalid");
  }
  if (
    persisted.required_paths.some(
      (requiredPath) =>
        typeof requiredPath !== "string" ||
        !existsSync(resolve(roundOutputDir, requiredPath)),
    )
  ) {
    throw new Error("round_result_required_path_missing");
  }
  if (
    persisted.interaction_evidence.some(
      (interactionPath) =>
        typeof interactionPath !== "string" ||
        !interactionPath.startsWith("llm-interactions/") ||
        !interactionPath.endsWith(".md") ||
        !persisted.required_paths!.includes(interactionPath),
    ) ||
    (hasInvocationAttempt(persisted.round_result) &&
      persisted.interaction_evidence.length === 0)
  ) {
    throw new Error("round_result_interaction_evidence_invalid");
  }
  const accounting = readPersistedAttemptAccounting(
    persisted.attempt_accounting,
  );
  if (!accounting.accounting_complete) {
    throw new Error("round_result_accounting_invalid");
  }
  const roundResult = persisted.round_result;
  if (
    roundResult.repair_attempts !== accounting.repair_attempts ||
    roundResult.regeneration_attempts !== accounting.regeneration_attempts ||
    roundResult.safety_attempts !== accounting.safety_attempts ||
    roundResult.provider_attempts !== accounting.provider_attempts ||
    roundResult.accounting_complete !== true
  ) {
    throw new Error("round_result_accounting_mismatch");
  }
  return persisted as PersistedAssetPlanningRoundResult;
}

function writeJsonAtomic(outputDir: string, filename: string, value: unknown) {
  const destination = resolve(outputDir, filename);
  const temporary = resolve(
    outputDir,
    `.${filename}.${process.pid}.${Date.now()}.tmp`,
  );
  writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
  renameSync(temporary, destination);
}

function readPersistedAttemptAccounting(value: unknown) {
  if (!value || typeof value !== "object") {
    return emptyIncompleteAttemptAccounting();
  }
  const accounting = value as Record<string, unknown>;
  const fields = [
    "repair_attempts",
    "regeneration_attempts",
    "safety_attempts",
    "provider_attempts",
  ] as const;
  if (
    accounting.accounting_complete !== true ||
    fields.some(
      (field) =>
        !Number.isSafeInteger(accounting[field]) ||
        (accounting[field] as number) < 0,
    )
  ) {
    return emptyIncompleteAttemptAccounting();
  }
  return {
    repair_attempts: accounting.repair_attempts as number,
    regeneration_attempts: accounting.regeneration_attempts as number,
    safety_attempts: accounting.safety_attempts as number,
    provider_attempts: accounting.provider_attempts as number,
    accounting_complete: true,
  };
}

function emptyIncompleteAttemptAccounting() {
  return {
    repair_attempts: 0,
    regeneration_attempts: 0,
    safety_attempts: 0,
    provider_attempts: 0,
    accounting_complete: false,
  };
}

function assertExistingRunManifestCompatible(
  plan: AssetPlanningFiveRoundQualityCheckPlan,
) {
  const existingPlanPath = resolve(plan.output_dir, "live-check-plan.json");
  if (!existsSync(existingPlanPath)) return;
  let existing: unknown;
  try {
    existing = readJson(existingPlanPath);
  } catch {
    throw new Error("asset_planning_quality_check_run_fingerprint_missing");
  }
  const fingerprint =
    existing && typeof existing === "object"
      ? (existing as { run_manifest?: { fingerprint?: unknown } }).run_manifest
          ?.fingerprint
      : null;
  if (typeof fingerprint !== "string") {
    throw new Error("asset_planning_quality_check_run_fingerprint_missing");
  }
  if (fingerprint !== plan.run_manifest.fingerprint) {
    throw new Error("asset_planning_quality_check_run_fingerprint_mismatch");
  }
}

function assertExistingRoundMarkersCompatible(
  plan: AssetPlanningFiveRoundQualityCheckPlan,
) {
  if (!existsSync(plan.output_dir)) return;
  for (const entry of readdirSync(plan.output_dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^round-\d+$/u.test(entry.name)) continue;
    const roundOutputDir = resolve(plan.output_dir, entry.name);
    if (!isRoundDirectoryNonEmpty(roundOutputDir)) continue;
    const markerPath = resolve(roundOutputDir, "round-result.json");
    if (!existsSync(markerPath)) {
      const hasSettledLegacyEvidence = ALL_SETTLED_ROUND_ARTIFACTS.filter(
        (requiredPath) => requiredPath !== "round-result.json",
      ).every((requiredPath) => existsSync(resolve(roundOutputDir, requiredPath)));
      throw new Error(
        hasSettledLegacyEvidence
          ? "asset_planning_quality_check_round_fingerprint_missing"
          : "asset_planning_quality_check_partial_round_evidence",
      );
    }
    let marker: unknown;
    try {
      marker = readJson(markerPath);
    } catch {
      throw new Error("asset_planning_quality_check_round_fingerprint_missing");
    }
    const fingerprint =
      marker && typeof marker === "object"
        ? (marker as { run_fingerprint?: unknown }).run_fingerprint
        : null;
    const directoryRound = Number(entry.name.slice("round-".length));
    const markerRound =
      marker && typeof marker === "object"
        ? (marker as { round?: unknown }).round
        : null;
    if (
      markerRound !== directoryRound ||
      directoryRound > plan.run_manifest.fingerprint_inputs.max_total_rounds
    ) {
      throw new Error("asset_planning_quality_check_partial_round_evidence");
    }
    if (typeof fingerprint !== "string") {
      throw new Error("asset_planning_quality_check_round_fingerprint_missing");
    }
    if (fingerprint !== plan.run_manifest.fingerprint) {
      throw new Error("asset_planning_quality_check_round_fingerprint_mismatch");
    }
    const markerRecord = marker as {
      required_paths?: unknown;
      interaction_evidence?: unknown;
      round_result?: unknown;
    };
    if (
      !Array.isArray(markerRecord.required_paths) ||
      !Array.isArray(markerRecord.interaction_evidence) ||
      !markerRecord.round_result ||
      typeof markerRecord.round_result !== "object"
    ) {
      throw new Error("asset_planning_quality_check_partial_round_evidence");
    }
    const requiredPaths = markerRecord.required_paths;
    const interactionEvidence = markerRecord.interaction_evidence;
    if (
      requiredPaths.some(
        (requiredPath) =>
          typeof requiredPath !== "string" ||
          !existsSync(resolve(roundOutputDir, requiredPath)),
      ) ||
      interactionEvidence.some(
        (interactionPath) =>
          typeof interactionPath !== "string" ||
          !interactionPath.startsWith("llm-interactions/") ||
          !interactionPath.endsWith(".md") ||
          !requiredPaths.includes(interactionPath),
      ) ||
      (hasInvocationAttempt(
        markerRecord.round_result as AssetPlanningFiveRoundRoundResult,
      ) && interactionEvidence.length === 0)
    ) {
      throw new Error("asset_planning_quality_check_partial_round_evidence");
    }
  }
}

function writeAssetPlanningFiveRoundQualityCheckPlan(
  plan: AssetPlanningFiveRoundQualityCheckPlan,
) {
  mkdirSync(plan.output_dir, { recursive: true });
  writeJson(plan.output_dir, "live-check-plan.json", plan);
  writeFileSync(
    resolve(plan.output_dir, "trace.md"),
    [
      "# asset planning five-round live check plan",
      "",
      `- mode: ${plan.mode}`,
      `- generation_mode: ${plan.generation_mode}`,
      `- automated_gate: ${plan.automated_gate}`,
      `- requires_real_env: ${plan.requires_real_env}`,
      `- total_rounds: ${plan.total_rounds}`,
      `- output_dir: ${plan.output_dir}`,
      `- run_fingerprint: ${plan.run_manifest.fingerprint}`,
      "",
      "## Source Storyboard Dirs",
      "",
      ...plan.source_storyboard_dirs.map((item, index) => `${index + 1}. ${item}`),
      "",
      "## Required Checks",
      "",
      ...plan.required_checks.map((item) => `- ${item}`),
      "",
      "## Required Artifacts",
      "",
      "### Run Level",
      ...plan.required_artifacts.run_level.map((item) => `- ${item}`),
      "",
      "### All Settled Rounds",
      ...plan.required_artifacts.all_settled.map((item) => `- ${item}`),
      "",
      "### Success Only",
      ...plan.required_artifacts.success_only.map((item) => `- ${item}`),
      "",
      "### Failure Only",
      ...(plan.required_artifacts.failure_only.length > 0
        ? plan.required_artifacts.failure_only.map((item) => `- ${item}`)
        : ["- no additional artifacts"]),
      "",
      "### Interaction Evidence Conditional",
      `- condition: ${plan.required_artifacts.interaction_evidence.condition}`,
      `- marker_paths: ${plan.required_artifacts.interaction_evidence.marker_paths}`,
      "",
    ].join("\n"),
    "utf8",
  );

  return plan;
}

function hasExistingRoundEvidence(outputDir: string) {
  if (!existsSync(outputDir)) return false;
  return readdirSync(outputDir, { withFileTypes: true }).some((entry) => {
    if (!entry.isDirectory() || !/^round-\d+$/u.test(entry.name)) return false;
    return isRoundDirectoryNonEmpty(resolve(outputDir, entry.name));
  });
}

function isRoundDirectoryNonEmpty(roundOutputDir: string) {
  return existsSync(roundOutputDir) && readdirSync(roundOutputDir).length > 0;
}

function resolveSourceStoryboardDirs(input: AssetPlanningFiveRoundQualityCheckInput) {
  if (input.fixture) {
    return [resolve(process.cwd(), input.fixture)];
  }

  if (input.sourceDirs && input.sourceDirs.length > 0) {
    return input.sourceDirs.map((item) => resolve(process.cwd(), item));
  }

  if (input.sourceDir) {
    return [resolve(process.cwd(), input.sourceDir)];
  }

  return DEFAULT_SOURCE_STORYBOARD_DIRS;
}

function loadAssetPlanningFixedSource(sourceDir: string) {
  const draft = ScriptDraftPackage.parse(
    readJson(resolve(sourceDir, "source-script-draft.json")),
  );
  const storyboard = StoryboardPlan.parse(readStoryboardPlan(sourceDir));
  const topicPackage = TopicPackage.parse(
    normalizeTopicPackageArtifact(
      readJson(resolve(sourceDir, "source-topic-package.json")),
    ),
  );

  return {
    draft,
    storyboard,
    topicPackage,
    topicBoundaryContext: toAssetPlanningTopicBoundaryContext(topicPackage),
    storyboardRecordId: undefined as string | undefined,
  };
}

function loadAssetPlanningFixtureSource(fixturePath: string) {
  const raw = readJson(resolve(process.cwd(), fixturePath));
  if (!raw || typeof raw !== "object") {
    throw new Error("asset_planning_quality_check_fixture_invalid");
  }
  const fixture = raw as {
    source_ids?: {
      storyboard_record_id?: unknown;
      script_record_id?: unknown;
      topic_package_id?: unknown;
    };
    script?: unknown;
    storyboard?: unknown;
  };
  const draft = ScriptDraftPackage.parse(fixture.script);
  const storyboard = StoryboardPlan.parse(fixture.storyboard);
  const storyboardRecordId = requireFixtureString(
    fixture.source_ids?.storyboard_record_id,
    "storyboard_record_id",
  );
  const topicId = requireFixtureString(
    fixture.source_ids?.topic_package_id,
    "topic_package_id",
  );
  const beatNames = draft.beat_trace.map((item) => item.beat);
  const topicPackage = TopicPackage.parse({
    topic_id: topicId,
    title: `Synthetic asset planning fixture (${storyboard.segments.length} segments)`,
    selected_angle: "Use the supplied synthetic script and storyboard without expanding scope.",
    family_label: "synthetic_fixture",
    scope_label: "single_event",
    core_conflict: "Preserve the supplied storyboard's evidence chain and visual continuity.",
    stakes: "The quality check must keep every supplied segment traceable.",
    strong_scene: storyboard.segments[0]?.scene_description ?? "Synthetic opening scene.",
    packaging_seed: "Long-storyboard asset-planning resilience check.",
    must_include_beats: beatNames,
    forbidden_expansions: [],
    risk_hints: ["All fixture people, places, and events are synthetic."],
    source_anchor_refs: ["synthetic-fixture"],
    canonical_quotes: [],
    canonical_quote_intents: [],
    ambiguity_notes: [],
    duration_band: "medium",
    narrative_tension_map: {
      hook_claim: draft.opening_span,
      pressure_escalation: beatNames[0] ?? "Synthetic pressure escalation.",
      mid_reveal: beatNames[Math.floor(beatNames.length / 2)] ?? "Synthetic reveal.",
      peak_payoff: beatNames.at(-1) ?? "Synthetic payoff.",
      ending_residue: draft.ending_span,
    },
  });
  return {
    draft,
    storyboard,
    topicPackage,
    topicBoundaryContext: toAssetPlanningTopicBoundaryContext(topicPackage),
    storyboardRecordId,
  };
}

function requireFixtureString(value: unknown, field: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`asset_planning_quality_check_fixture_${field}_invalid`);
  }
  return value;
}

function readStoryboardPlan(sourceDir: string) {
  const preferredPath = resolve(sourceDir, "storyboard-plan.json");
  if (existsSync(preferredPath)) {
    return readJson(preferredPath);
  }

  return readJson(resolve(sourceDir, "source-storyboard-plan.json"));
}

function normalizeTopicPackageArtifact(rawArtifact: unknown) {
  if (!rawArtifact || typeof rawArtifact !== "object") {
    return rawArtifact;
  }

  const artifact = rawArtifact as Record<string, unknown>;
  const durationBand = artifact.duration_band;
  const durationBandLabel =
    typeof durationBand === "object" && durationBand !== null
      ? (durationBand as Record<string, unknown>).label
      : durationBand;

  return {
    topic_id: artifact.topic_id ?? artifact.topic_package_id,
    title: artifact.title ?? artifact.canonical_title,
    selected_angle: artifact.selected_angle,
    family_label: artifact.family_label,
    scope_label: artifact.scope_label,
    core_conflict: artifact.core_conflict,
    stakes: artifact.stakes,
    strong_scene: artifact.strong_scene,
    packaging_seed:
      artifact.packaging_seed ?? artifact.selected_angle ?? artifact.core_conflict,
    must_include_beats: artifact.must_include_beats,
    forbidden_expansions: artifact.forbidden_expansions ?? [],
    risk_hints: artifact.risk_hints ?? [],
    source_anchor_refs: artifact.source_anchor_refs ?? [],
    canonical_quotes: artifact.canonical_quotes ?? [],
    canonical_quote_intents: artifact.canonical_quote_intents ?? [],
    ambiguity_notes: artifact.ambiguity_notes ?? [],
    duration_band: durationBandLabel,
    narrative_tension_map: artifact.narrative_tension_map,
  };
}

function toAssetPlanningTopicBoundaryContext(
  topicPackage: TopicPackageType,
): AssetPlanningTopicBoundaryContext {
  return {
    title: topicPackage.title,
    selected_angle: topicPackage.selected_angle,
    family_label: topicPackage.family_label,
    scope_label: topicPackage.scope_label,
    core_conflict: topicPackage.core_conflict,
    strong_scene: topicPackage.strong_scene,
    forbidden_expansions: topicPackage.forbidden_expansions,
    risk_hints: topicPackage.risk_hints,
    source_anchor_refs: topicPackage.source_anchor_refs,
    canonical_quotes: topicPackage.canonical_quotes,
    narrative_tension_map: topicPackage.narrative_tension_map,
  };
}

function createRoundInteractionLogWriter(
  roundOutputDir: string,
  llmCallDiagnostics: RuntimeLlmCallDiagnostics[],
  renderInteractionMarkdown: RenderLlmInteractionMarkdown,
): LlmInteractionLogWriter {
  let sequence = 0;
  const logDir = resolve(roundOutputDir, "llm-interactions");
  mkdirSync(logDir, { recursive: true });

  return {
    write(entry: LlmInteractionLogEntry) {
      sequence += 1;
      const finishedAt = entry.timing?.finishedAt ?? new Date().toISOString();
      const startedAt = entry.timing?.startedAt ?? entry.generatedAt ?? finishedAt;
      const durationMs =
        entry.timing?.durationMs ??
        Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
      llmCallDiagnostics.push({
        sequence,
        prompt_id: entry.promptId,
        planning_mode: readPlanningMode(entry.input),
        chunk_id: readChunkId(entry.input),
        started_at: startedAt,
        finished_at: finishedAt,
        duration_ms: Number.isFinite(durationMs) ? durationMs : 0,
        repair_mode: readRepairMode(entry.input),
        safety_retry_context_reason: readSafetyRetryContextReason(entry.input),
        provider_attempts: Array.isArray(entry.attempts)
          ? entry.attempts.filter(
              (attempt) =>
                attempt.outcome === "success" || attempt.outcome === "error",
            ).length
          : 0,
      });
      const filename = `${String(sequence).padStart(2, "0")}-${entry.promptId}.md`;
      const finalAttempt = entry.attempts?.at(-1);
      const failed =
        Boolean(entry.errorMessage) || finalAttempt?.outcome === "error";
      writeFileSync(
        resolve(logDir, filename),
        failed
          ? renderStableFailedInteractionMarkdown(entry, sequence)
          : renderInteractionMarkdown({ ...entry, sequence }),
        "utf8",
      );
    },
  };
}

function renderStableFailedInteractionMarkdown(
  entry: LlmInteractionLogEntry,
  sequence: number,
) {
  const finalAttempt = entry.attempts?.at(-1);
  const errorCode =
    finalAttempt?.outcome === "error" &&
    typeof finalAttempt.errorCode === "string" &&
    PROVIDER_FAILURE_CODES.has(finalAttempt.errorCode)
      ? finalAttempt.errorCode
      : undefined;
  const failureCode = errorCode ?? "asset_planning_interaction_failure";
  const failureClass = errorCode ? "provider" : "structural_compiler";
  const providerAttempts = Array.isArray(entry.attempts)
    ? entry.attempts.filter(
        (attempt) => attempt.outcome === "success" || attempt.outcome === "error",
      ).length
    : 0;
  return [
    "# LLM failure interaction",
    "",
    `- sequence: ${sequence}`,
    `- failure_code: ${failureCode}`,
    `- failure_class: ${failureClass}`,
    `- provider_attempts: ${providerAttempts}`,
    "",
  ].join("\n");
}

function readPlanningMode(input: unknown) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const planningMode = (input as Record<string, unknown>).planning_mode;
  return typeof planningMode === "string" ? planningMode : null;
}

function readChunkId(input: unknown) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const chunk = (input as Record<string, unknown>).chunk;
  if (!chunk || typeof chunk !== "object") {
    return null;
  }

  const chunkId = (chunk as Record<string, unknown>).chunk_id;
  return typeof chunkId === "string" ? chunkId : null;
}

function readRepairMode(input: unknown) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const repairMode = (input as Record<string, unknown>).repair_mode;
  return typeof repairMode === "string" ? repairMode : null;
}

function readSafetyRetryContextReason(input: unknown) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const safetyRetryContext = (input as Record<string, unknown>)
    .safety_retry_context;
  if (!safetyRetryContext || typeof safetyRetryContext !== "object") {
    return null;
  }

  const reason = (safetyRetryContext as Record<string, unknown>).reason;
  return typeof reason === "string" ? reason : null;
}

function buildRepairChainMetrics(input: {
  llmCalls: RuntimeLlmCallDiagnostics[];
  checks: RuntimeDiagnosticCheck[];
  fullRegenUsed: boolean;
  firstPassWallTimeMs: number;
  regenWallTimeMs: number;
}): RepairChainMetrics {
  const checkCodes = new Set(input.checks.map((check) => check.code));
  const chunkStructuralRepairUsed = input.llmCalls.some(
    (call) => call.repair_mode === "segment_chunk_structural_repair",
  );
  const planStructuralRepairUsed =
    input.llmCalls.some(
      (call) => call.repair_mode === "asset_plan_structural_patch",
    ) || checkCodes.has("asset_planning_plan_structural_repair_used");
  const providerSafetyRetryUsed =
    input.llmCalls.some((call) => Boolean(call.safety_retry_context_reason)) ||
    checkCodes.has("asset_planning_provider_safety_retry_used");
  const fullRegenUsed =
    input.fullRegenUsed || checkCodes.has("asset_planning_regen_once");

  return {
    chunk_structural_repair_used: chunkStructuralRepairUsed,
    plan_structural_repair_used: planStructuralRepairUsed,
    provider_safety_retry_used: providerSafetyRetryUsed,
    full_regen_used: fullRegenUsed,
    first_pass_wall_time_ms: Math.max(0, input.firstPassWallTimeMs),
    repair_wall_time_ms: input.llmCalls
      .filter((call) => call.prompt_id === "asset-planning.asset-structural-repair")
      .reduce((sum, call) => sum + call.duration_ms, 0),
    regen_wall_time_ms: Math.max(0, input.regenWallTimeMs),
    llm_call_count: input.llmCalls.length,
  };
}

function buildRepairChainChecks(
  metrics: RepairChainMetrics,
): RuntimeDiagnosticCheck[] {
  const checks: RuntimeDiagnosticCheck[] = [];
  if (metrics.chunk_structural_repair_used) {
    checks.push({
      code: "asset_planning_chunk_structural_repair_used",
      level: "warning",
    });
  }
  if (metrics.plan_structural_repair_used) {
    checks.push({
      code: "asset_planning_plan_structural_repair_used",
      level: "warning",
    });
  }
  if (metrics.provider_safety_retry_used) {
    checks.push({
      code: "asset_planning_provider_safety_retry_used",
      level: "warning",
    });
  }
  return checks;
}

function writeRoundTrace(
  roundOutputDir: string,
  input: {
    round: number;
    sourceStoryboardDir: string;
    sourceTitle: string;
    regenerated: boolean;
    validationDecision: string;
    validationErrors: string[];
    taskCount: number;
    dependencyCount: number;
    segmentCount: number;
    repairChainMetrics: RepairChainMetrics;
  },
) {
  writeFileSync(
    resolve(roundOutputDir, "trace.md"),
    [
      "# asset planning round trace",
      "",
      `- round: ${input.round}`,
      `- source_title: ${input.sourceTitle}`,
      `- source_storyboard_dir: ${input.sourceStoryboardDir}`,
      `- regenerated: ${input.regenerated}`,
      `- full_regen_used: ${input.repairChainMetrics.full_regen_used}`,
      `- chunk_structural_repair_used: ${input.repairChainMetrics.chunk_structural_repair_used}`,
      `- plan_structural_repair_used: ${input.repairChainMetrics.plan_structural_repair_used}`,
      `- provider_safety_retry_used: ${input.repairChainMetrics.provider_safety_retry_used}`,
      `- first_pass_wall_time_ms: ${input.repairChainMetrics.first_pass_wall_time_ms}`,
      `- repair_wall_time_ms: ${input.repairChainMetrics.repair_wall_time_ms}`,
      `- regen_wall_time_ms: ${input.repairChainMetrics.regen_wall_time_ms}`,
      `- llm_call_count: ${input.repairChainMetrics.llm_call_count}`,
      `- validation_decision: ${input.validationDecision}`,
      `- segment_count: ${input.segmentCount}`,
      `- task_count: ${input.taskCount}`,
      `- dependency_count: ${input.dependencyCount}`,
      `- validation_errors: ${
        input.validationErrors.length > 0 ? input.validationErrors.join(", ") : "none"
      }`,
      "",
    ].join("\n"),
    "utf8",
  );
}

function renderRoundReviewMarkdown(input: {
  round: number;
  sourceTitle: string;
  sourceStoryboardDir: string;
  draft: ScriptDraftPackageType;
  storyboard: StoryboardPlanType;
  assetPlan: AssetPlanType;
  validation: ReturnType<typeof validateAssetPlan>;
}) {
  return [
    `# Round ${input.round}: ${input.sourceTitle}`,
    "",
    `- source_storyboard_dir: ${input.sourceStoryboardDir}`,
    `- validation_decision: ${input.validation.decision}`,
    `- validation_errors: ${
      input.validation.errors.length > 0 ? input.validation.errors.join(", ") : "none"
    }`,
    `- segment_count: ${input.storyboard.segments.length}`,
    `- task_count: ${input.assetPlan.tasks.length}`,
    "",
    "## Script",
    "",
    input.draft.script_text,
    "",
    "## Storyboard",
    "",
    ...input.storyboard.segments.flatMap((segment) => [
      `### ${segment.segment_id} (${segment.narrative_role})`,
      "",
      `- excerpt: ${segment.script_excerpt}`,
      `- visual_intent: ${segment.visual_intent}`,
      `- scene_description: ${segment.scene_description}`,
      `- motion_hint: ${segment.motion_hint}`,
      "",
    ]),
    "## Asset Plan",
    "",
    `- art_bible.era_style: ${input.assetPlan.art_bible.era_style}`,
    `- art_bible.visual_tone: ${input.assetPlan.art_bible.visual_tone}`,
    `- tts_chunks: ${input.assetPlan.tts_plan.chunks.length}`,
    "",
    "### Tasks",
    "",
    ...input.assetPlan.tasks.map(
      (task) =>
        `- ${task.task_id} | ${task.task_type} | segment=${task.source_segment_id ?? "global"} | mode=${task.recommended_mode} | cost=${task.cost_tier} | intent=${task.production_intent}`,
    ),
    "",
    "### Dependencies",
    "",
    ...input.assetPlan.dependencies.map(
      (dependency) =>
        `- ${dependency.task_id} <- ${dependency.depends_on_task_id} (${dependency.dependency_type})`,
    ),
    "",
  ].join("\n");
}

function renderFailedRoundReviewMarkdown(input: {
  round: number;
  sourceTitle: string;
  sourceStoryboardDir: string;
  draft: ScriptDraftPackageType;
  storyboard: StoryboardPlanType;
  failureCode: string;
  failureClass: "provider" | "structural_compiler";
}) {
  return [
    `# Round ${input.round}: ${input.sourceTitle}`,
    "",
    `- source_storyboard_dir: ${input.sourceStoryboardDir}`,
    "- validation_decision: external_error",
    `- validation_errors: ${input.failureCode}`,
    `- failure_class: ${input.failureClass}`,
    `- segment_count: ${input.storyboard.segments.length}`,
    "- task_count: 0",
    "",
    "## Failure",
    "",
    `- failure_code: ${input.failureCode}`,
    `- failure_class: ${input.failureClass}`,
    "",
    "## Script",
    "",
    input.draft.script_text,
    "",
    "## Storyboard",
    "",
    ...input.storyboard.segments.flatMap((segment) => [
      `### ${segment.segment_id} (${segment.narrative_role})`,
      "",
      `- excerpt: ${segment.script_excerpt}`,
      `- visual_intent: ${segment.visual_intent}`,
      `- scene_description: ${segment.scene_description}`,
      `- motion_hint: ${segment.motion_hint}`,
      "",
    ]),
  ].join("\n");
}

function renderGeminiReviewPack(
  result: AssetPlanningFiveRoundQualityCheckResult,
  reviewSections: string[],
) {
  return [
    "# Asset Planning Five-round Review Pack",
    "",
    `- total_rounds: ${result.total_rounds}`,
    `- generation_mode: ${result.generation_mode}`,
    `- target_rounds: ${result.target_rounds}`,
    `- valid_provider_rounds: ${result.valid_provider_rounds}`,
    `- end_to_end_success_rounds: ${result.end_to_end_success_rounds}`,
    `- provider_failure_rounds: ${result.provider_failure_rounds}`,
    `- structural_compiler_failure_rounds: ${result.structural_compiler_failure_rounds}`,
    `- repair_attempts: ${result.repair_attempts}`,
    `- regeneration_attempts: ${result.regeneration_attempts}`,
    `- safety_attempts: ${result.safety_attempts}`,
    `- provider_attempts: ${result.provider_attempts}`,
    `- makeup_rounds: ${result.makeup_rounds}`,
    `- zero_denominator: ${result.zero_denominator}`,
    `- accounting_incomplete_rounds: ${result.accounting_incomplete_rounds}`,
    `- worst_case_chunk_network_requests: ${result.worst_case_chunk_network_requests}`,
    `- global_planning_requests_per_round_max: ${result.global_planning_requests_per_round_max}`,
    `- global_safety_requests_per_round_max: ${result.global_safety_requests_per_round_max}`,
    `- global_structural_repair_requests_per_round_max: ${result.global_structural_repair_requests_per_round_max}`,
    `- global_provider_requests_per_round_max: ${result.global_provider_requests_per_round_max}`,
    `- worst_case_global_provider_requests: ${result.worst_case_global_provider_requests}`,
    `- worst_case_total_provider_requests: ${result.worst_case_total_provider_requests}`,
    `- passed_rounds: ${result.passed_rounds}`,
    `- failed_rounds: ${result.failed_rounds}`,
    `- output_dir: ${result.output_dir}`,
    "",
    "## Round Index",
    "",
    ...result.rounds.map(
      (round) =>
        `- round ${round.round}: ${round.source_title}, validation=${round.validation_decision}, tasks=${round.task_count}, llm_calls=${round.llm_call_count}, first_pass_ms=${round.first_pass_wall_time_ms}, repair_ms=${round.repair_wall_time_ms}, regen_ms=${round.regen_wall_time_ms}, chunk_repair=${round.chunk_structural_repair_used}, plan_repair=${round.plan_structural_repair_used}, safety_retry=${round.provider_safety_retry_used}, full_regen=${round.full_regen_used}, output=${round.output_dir}`,
    ),
    "",
    "---",
    "",
    ...reviewSections,
  ].join("\n");
}

function countTasksByType(plan: AssetPlanType) {
  const counts: Record<string, number> = {};
  for (const task of plan.tasks) {
    counts[task.task_type] = (counts[task.task_type] ?? 0) + 1;
  }
  return counts;
}

function readJson(filePath: string) {
  return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
}

function writeJson(outputDir: string, filename: string, value: unknown) {
  writeFileSync(resolve(outputDir, filename), JSON.stringify(value, null, 2), "utf8");
}

async function main() {
  const input = parseAssetPlanningFiveRoundQualityCheckCliArgs(process.argv.slice(2));
  if (input.help) {
    process.stdout.write(renderCliHelp());
    return;
  }
  const result = await runAssetPlanningFiveRoundQualityCheck(input);
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "asset-planning-five-round-quality-check-completed",
        output_dir: result.output_dir,
        source_storyboard_dirs: result.source_storyboard_dirs,
        total_rounds: result.total_rounds,
        generation_mode: result.generation_mode,
        target_rounds: result.target_rounds,
        valid_provider_rounds: result.valid_provider_rounds,
        end_to_end_success_rounds: result.end_to_end_success_rounds,
        provider_failure_rounds: result.provider_failure_rounds,
        structural_compiler_failure_rounds:
          result.structural_compiler_failure_rounds,
        repair_attempts: result.repair_attempts,
        regeneration_attempts: result.regeneration_attempts,
        safety_attempts: result.safety_attempts,
        provider_attempts: result.provider_attempts,
        makeup_rounds: result.makeup_rounds,
        zero_denominator: result.zero_denominator,
        dry_run: result.dry_run,
        estimated_chunk_count: result.estimated_chunk_count,
        max_total_rounds: result.max_total_rounds,
        network_requests_per_chunk_max:
          result.network_requests_per_chunk_max,
        worst_case_chunk_network_requests:
          result.worst_case_chunk_network_requests,
        global_planning_requests_per_round_max:
          result.global_planning_requests_per_round_max,
        global_safety_requests_per_round_max:
          result.global_safety_requests_per_round_max,
        global_structural_repair_requests_per_round_max:
          result.global_structural_repair_requests_per_round_max,
        global_provider_requests_per_round_max:
          result.global_provider_requests_per_round_max,
        worst_case_global_provider_requests:
          result.worst_case_global_provider_requests,
        worst_case_total_provider_requests:
          result.worst_case_total_provider_requests,
        accounting_incomplete_rounds: result.accounting_incomplete_rounds,
        passed_rounds: result.passed_rounds,
        failed_rounds: result.failed_rounds,
      },
      null,
      2,
    )}\n`,
  );
}

function renderCliHelp() {
  return [
    "Asset planning long-storyboard quality check",
    "",
    "Usage:",
    "  npm.cmd run harness:asset-planning-five-round-quality-check -- --fixture=<path> --mode=intent_compiler --rounds=<n> --max-makeup-rounds=<n> --dry-run --output-dir=<path>",
    "  npm.cmd run harness:asset-planning-five-round-quality-check -- --fixture=<path> --mode=intent_compiler --rounds=<n> --max-makeup-rounds=<n> --live --output-dir=<path>",
    "  npm.cmd run harness:asset-planning-five-round-quality-check -- --resume --live --mode=intent_compiler --output-dir=<existing-run-path>",
    "",
    "Safety:",
    "  --fixture defaults to dry-run. Only explicit --live permits real provider calls.",
    "  Without --output-dir, a non-resume run creates a unique run directory.",
    "  --resume requires an explicit --output-dir that contains an existing run plan.",
    "  Windows PowerShell: use npm.cmd so arguments after -- are forwarded to the script.",
    "  Stop a live run with Ctrl+C; completed round artifacts remain in the output directory.",
    "",
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
