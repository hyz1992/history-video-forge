import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

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
import {
  generateAssetPlan,
  type AssetPlanningTopicBoundaryContext,
  type GenerateAssetPlanInput,
  type GlobalDraftStructureEvent,
} from "../../../backend/src/modules/asset-planning/asset-planning-generation.service";
import { validateAssetPlan } from "../../../backend/src/modules/asset-planning/asset-planning-local-validator";
import {
  renderLlmInteractionMarkdown,
  type LlmInteractionLogEntry,
  type LlmInteractionLogWriter,
} from "../../../backend/src/runtime/llm/interaction-log";

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

export interface AssetPlanningFiveRoundQualityCheckInput {
  sourceDir?: string;
  sourceDirs?: string[];
  outputDir?: string;
  rounds?: number;
  chunkConcurrency?: number;
  resume?: boolean;
}

export interface AssetPlanningFiveRoundQualityCheckPlan {
  mode: "asset_planning_real_runtime_live_check";
  automated_gate: false;
  requires_real_env: true;
  source_storyboard_dirs: string[];
  total_rounds: number;
  output_dir: string;
  required_artifacts: string[];
  required_checks: string[];
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
  resumed?: boolean;
}

export interface AssetPlanningFiveRoundQualityCheckResult
  extends AssetPlanningFiveRoundQualityCheckPlan {
  passed_rounds: number;
  failed_rounds: number;
  global_structure_normalization_event_count: number;
  global_structure_normalization_used_rounds: number;
  global_structure_normalized_path_count: number;
  global_structural_repair_used_rounds: number;
  global_structural_repair_succeeded_rounds: number;
  global_structural_repair_failed_rounds: number;
  global_structural_repair_provider_failed_rounds: number;
  rounds: AssetPlanningFiveRoundRoundResult[];
}

export interface AssetPlanningFiveRoundPlanGeneratorInput
  extends GenerateAssetPlanInput {
  round: number;
}

export interface AssetPlanningFiveRoundQualityCheckDependencies {
  requireRealEnv?: boolean;
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
): AssetPlanningFiveRoundQualityCheckPlan {
  const sourceStoryboardDirs = resolveSourceStoryboardDirs(input);
  return {
    mode: "asset_planning_real_runtime_live_check",
    automated_gate: false,
    requires_real_env: true,
    source_storyboard_dirs: sourceStoryboardDirs,
    total_rounds: input.rounds ?? sourceStoryboardDirs.length,
    output_dir: input.outputDir ?? DEFAULT_OUTPUT_DIR,
    required_artifacts: [
      "source-script-draft.json",
      "source-topic-package.json",
      "source-storyboard-plan.json",
      "asset-plan.json",
      "asset-planning-validation-result.json",
      "runtime-diagnostics.json",
      "trace.md",
      "review.md",
      "gemini-review-pack.md",
      "llm-interactions/*.md",
    ],
    required_checks: [
      "Requires real .env and must be run explicitly outside the default automated gate.",
      "Runs 5 asset planning rounds from fixed storyboard artifacts; it does not rerun topic, script, or storyboard.",
      "Copies script, topic, and storyboard artifacts into each round so Gemini and humans can review the full upstream context.",
      "Does not call assets providers, create physical files, upload files, preview assets, compose timelines, or export video.",
      "Local validation only checks structure, references, dependencies, and coverage; it does not judge aesthetics or viral quality.",
    ],
  };
}

export async function runAssetPlanningFiveRoundQualityCheck(
  input: AssetPlanningFiveRoundQualityCheckInput = {},
  dependencies: AssetPlanningFiveRoundQualityCheckDependencies = {},
): Promise<AssetPlanningFiveRoundQualityCheckResult> {
  const plan = writeAssetPlanningFiveRoundQualityCheckPlan(input);
  const requireRealEnv = dependencies.requireRealEnv ?? true;

  if (requireRealEnv && !existsSync(resolve(process.cwd(), ".env"))) {
    throw new Error("asset_planning_live_check_real_env_missing");
  }

  const planGenerator =
    dependencies.planGenerator ??
    ((generatorInput: AssetPlanningFiveRoundPlanGeneratorInput) =>
      generateAssetPlan(generatorInput));
  const rounds: AssetPlanningFiveRoundRoundResult[] = [];
  const reviewSections: string[] = [];

  for (let round = 1; round <= plan.total_rounds; round += 1) {
    const sourceStoryboardDir =
      plan.source_storyboard_dirs[(round - 1) % plan.source_storyboard_dirs.length];
    const source = loadAssetPlanningFixedSource(sourceStoryboardDir);
    const roundOutputDir = resolve(plan.output_dir, `round-${round}`);
    mkdirSync(roundOutputDir, { recursive: true });
    writeJson(roundOutputDir, "source-script-draft.json", source.draft);
    writeJson(roundOutputDir, "source-topic-package.json", source.topicPackage);
    writeJson(roundOutputDir, "source-storyboard-plan.json", source.storyboard);

    const sourceStoryboardRecordId = `fixed-storyboard-record-${round}`;
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
      });

      if (resumedRound) {
        rounds.push(resumedRound.roundResult);
        reviewSections.push(resumedRound.reviewMarkdown);
        continue;
      }
    }

    const llmCallDiagnostics: RuntimeLlmCallDiagnostics[] = [];
    const globalStructureEvents: GlobalDraftStructureEvent[] = [];
    const onGlobalStructureEvent = (event: GlobalDraftStructureEvent) => {
      globalStructureEvents.push(event);
    };
    const interactionLogWriter = createRoundInteractionLogWriter(
      roundOutputDir,
      llmCallDiagnostics,
    );
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

      if (validation.decision === "regen_once") {
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
      const runtimeDiagnostics = {
        llm_calls: llmCallDiagnostics,
        checks: [
          ...baseChecks,
          ...buildRepairChainChecks(repairChainMetrics),
        ],
        repair_chain_metrics: repairChainMetrics,
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

      rounds.push({
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
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      const baseChecks: RuntimeDiagnosticCheck[] = [
        {
          code: "asset_planning_external_error",
          level: "error",
          message: errorMessage,
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
      const runtimeDiagnostics = {
        llm_calls: llmCallDiagnostics,
        checks: [
          ...baseChecks,
          ...buildRepairChainChecks(repairChainMetrics),
        ],
        repair_chain_metrics: repairChainMetrics,
        global_structure_observation: globalStructureObservation,
      };
      writeJson(roundOutputDir, "runtime-diagnostics.json", runtimeDiagnostics);
      writeRoundTrace(roundOutputDir, {
        round,
        sourceStoryboardDir,
        sourceTitle: source.topicPackage.title,
        regenerated: false,
        validationDecision: "external_error",
        validationErrors: ["asset_planning_external_error"],
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
        errorMessage,
      });
      writeFileSync(resolve(roundOutputDir, "review.md"), reviewMarkdown, "utf8");
      reviewSections.push(reviewMarkdown);

      rounds.push({
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
        validation_errors: ["asset_planning_external_error"],
        validation_warnings: [],
        task_count: 0,
        dependency_count: 0,
        segment_count: source.storyboard.segments.length,
        task_type_counts: {},
      });
    }
  }

  const result: AssetPlanningFiveRoundQualityCheckResult = {
    ...plan,
    passed_rounds: rounds.filter((round) => round.status === "round-ready").length,
    failed_rounds: rounds.filter((round) => round.status === "round-failed").length,
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

  writeJson(plan.output_dir, "live-check-summary.json", result);
  writeFileSync(
    resolve(plan.output_dir, "gemini-review-pack.md"),
    renderGeminiReviewPack(result, reviewSections),
    "utf8",
  );

  return result;
}

export function parseAssetPlanningFiveRoundQualityCheckCliArgs(argv: string[]) {
  const result: AssetPlanningFiveRoundQualityCheckInput = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--output-dir" && next) {
      result.outputDir = next;
      index += 1;
      continue;
    }

    if (current === "--source-dir" && next) {
      result.sourceDirs = [...(result.sourceDirs ?? []), next];
      index += 1;
      continue;
    }

    if (current === "--rounds" && next) {
      result.rounds = Number(next);
      index += 1;
      continue;
    }

    if (current === "--chunk-concurrency" && next) {
      result.chunkConcurrency = Number(next);
      index += 1;
      continue;
    }

    if (current === "--resume") {
      result.resume = true;
      continue;
    }

    if (!current.startsWith("--") && !result.outputDir) {
      result.outputDir = current;
    }
  }

  return result;
}

function readCompletedRoundIfAvailable(input: {
  round: number;
  roundOutputDir: string;
  sourceStoryboardDir: string;
  source: ReturnType<typeof loadAssetPlanningFixedSource>;
  sourceStoryboardRecordId: string;
  sourceScriptRecordId: string;
  sourceTopicPackageId: string;
}) {
  const assetPlanPath = resolve(input.roundOutputDir, "asset-plan.json");
  const reviewPath = resolve(input.roundOutputDir, "review.md");
  if (!existsSync(assetPlanPath) || !existsSync(reviewPath)) {
    return null;
  }

  const assetPlan = AssetPlan.parse(readJson(assetPlanPath));
  const validation = validateAssetPlan({
    storyboardRecordId: input.sourceStoryboardRecordId,
    scriptRecordId: input.sourceScriptRecordId,
    topicPackageId: input.sourceTopicPackageId,
    storyboard: input.source.storyboard,
    scriptText: input.source.draft.script_text,
    plan: assetPlan,
  });

  if (validation.decision !== "pass") {
    return null;
  }

  const reviewMarkdown = readFileSync(reviewPath, "utf8");
  const runtimeDiagnosticsPath = resolve(
    input.roundOutputDir,
    "runtime-diagnostics.json",
  );
  const runtimeDiagnostics = existsSync(runtimeDiagnosticsPath)
    ? (readJson(runtimeDiagnosticsPath) as {
        repair_chain_metrics?: Partial<RepairChainMetrics>;
        llm_calls?: RuntimeLlmCallDiagnostics[];
        checks?: RuntimeDiagnosticCheck[];
        global_structure_observation?: Partial<GlobalStructureObservation>;
      })
    : {};
  const repairChainMetrics =
    runtimeDiagnostics.repair_chain_metrics ??
    buildRepairChainMetrics({
      llmCalls: runtimeDiagnostics.llm_calls ?? [],
      checks: runtimeDiagnostics.checks ?? [],
      fullRegenUsed: false,
      firstPassWallTimeMs: 0,
      regenWallTimeMs: 0,
    });
  const globalStructureObservation: GlobalStructureObservation = {
    global_structure_normalization_event_count:
      runtimeDiagnostics.global_structure_observation
        ?.global_structure_normalization_event_count ?? 0,
    global_structure_normalized_path_count:
      runtimeDiagnostics.global_structure_observation
        ?.global_structure_normalized_path_count ?? 0,
    global_structural_repair_used: Boolean(
      runtimeDiagnostics.global_structure_observation
        ?.global_structural_repair_used,
    ),
    global_structural_repair_succeeded: Boolean(
      runtimeDiagnostics.global_structure_observation
        ?.global_structural_repair_succeeded,
    ),
    global_structural_repair_failed: Boolean(
      runtimeDiagnostics.global_structure_observation
        ?.global_structural_repair_failed,
    ),
    global_structural_repair_provider_failed: Boolean(
      runtimeDiagnostics.global_structure_observation
        ?.global_structural_repair_provider_failed,
    ),
  };
  return {
    reviewMarkdown,
    roundResult: {
      round: input.round,
      status: "round-ready" as const,
      source_storyboard_dir: input.sourceStoryboardDir,
      source_title: input.source.topicPackage.title,
      regenerated: false,
      full_regen_used: Boolean(repairChainMetrics.full_regen_used),
      chunk_structural_repair_used: Boolean(
        repairChainMetrics.chunk_structural_repair_used,
      ),
      plan_structural_repair_used: Boolean(
        repairChainMetrics.plan_structural_repair_used,
      ),
      provider_safety_retry_used: Boolean(
        repairChainMetrics.provider_safety_retry_used,
      ),
      ...globalStructureObservation,
      first_pass_wall_time_ms: repairChainMetrics.first_pass_wall_time_ms ?? 0,
      repair_wall_time_ms: repairChainMetrics.repair_wall_time_ms ?? 0,
      regen_wall_time_ms: repairChainMetrics.regen_wall_time_ms ?? 0,
      llm_call_count: repairChainMetrics.llm_call_count ?? 0,
      output_dir: input.roundOutputDir,
      validation_decision: validation.decision,
      validation_errors: validation.errors,
      validation_warnings: validation.warnings,
      task_count: assetPlan.tasks.length,
      dependency_count: assetPlan.dependencies.length,
      segment_count: input.source.storyboard.segments.length,
      task_type_counts: countTasksByType(assetPlan),
      resumed: true,
    },
  };
}

function writeAssetPlanningFiveRoundQualityCheckPlan(
  input: AssetPlanningFiveRoundQualityCheckInput,
) {
  const plan = buildAssetPlanningFiveRoundQualityCheckPlan(input);
  mkdirSync(plan.output_dir, { recursive: true });
  writeJson(plan.output_dir, "live-check-plan.json", plan);
  writeFileSync(
    resolve(plan.output_dir, "trace.md"),
    [
      "# asset planning five-round live check plan",
      "",
      `- mode: ${plan.mode}`,
      `- automated_gate: ${plan.automated_gate}`,
      `- requires_real_env: ${plan.requires_real_env}`,
      `- total_rounds: ${plan.total_rounds}`,
      `- output_dir: ${plan.output_dir}`,
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
      ...plan.required_artifacts.map((item) => `- ${item}`),
      "",
    ].join("\n"),
    "utf8",
  );

  return plan;
}

function resolveSourceStoryboardDirs(input: AssetPlanningFiveRoundQualityCheckInput) {
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
  };
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
      });
      const filename = `${String(sequence).padStart(2, "0")}-${entry.promptId}.md`;
      writeFileSync(
        resolve(logDir, filename),
        renderLlmInteractionMarkdown({ ...entry, sequence }),
        "utf8",
      );
    },
  };
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
  errorMessage: string;
}) {
  return [
    `# Round ${input.round}: ${input.sourceTitle}`,
    "",
    `- source_storyboard_dir: ${input.sourceStoryboardDir}`,
    "- validation_decision: external_error",
    "- validation_errors: asset_planning_external_error",
    `- segment_count: ${input.storyboard.segments.length}`,
    "- task_count: 0",
    "",
    "## Failure",
    "",
    input.errorMessage,
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

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return JSON.stringify(error);
}

async function main() {
  const result = await runAssetPlanningFiveRoundQualityCheck(
    parseAssetPlanningFiveRoundQualityCheckCliArgs(process.argv.slice(2)),
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "asset-planning-five-round-quality-check-completed",
        output_dir: result.output_dir,
        source_storyboard_dirs: result.source_storyboard_dirs,
        total_rounds: result.total_rounds,
        passed_rounds: result.passed_rounds,
        failed_rounds: result.failed_rounds,
      },
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
