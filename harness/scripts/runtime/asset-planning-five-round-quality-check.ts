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
    const interactionLogWriter = createRoundInteractionLogWriter(
      roundOutputDir,
      llmCallDiagnostics,
    );

    let assetPlan = AssetPlan.parse(
      await planGenerator({
        sourceStoryboardRecordId,
        sourceScriptRecordId,
        sourceTopicPackageId,
        storyboard: source.storyboard,
        draft: source.draft,
        topicBoundaryContext: source.topicBoundaryContext,
        interactionLogWriter,
        chunkConcurrency: input.chunkConcurrency,
        round,
      }),
    );
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
      assetPlan = AssetPlan.parse(
        await planGenerator({
          sourceStoryboardRecordId,
          sourceScriptRecordId,
          sourceTopicPackageId,
          storyboard: source.storyboard,
          draft: source.draft,
          topicBoundaryContext: source.topicBoundaryContext,
          interactionLogWriter,
          chunkConcurrency: input.chunkConcurrency,
          round,
          regenerationContext: {
            reason: "asset_planning_local_validation_regen_once",
            errors: validation.errors,
            metrics: validation.metrics,
          },
        }),
      );
      validation = validateAssetPlan({
        storyboardRecordId: sourceStoryboardRecordId,
        scriptRecordId: sourceScriptRecordId,
        topicPackageId: sourceTopicPackageId,
        storyboard: source.storyboard,
        scriptText: source.draft.script_text,
        plan: assetPlan,
      });
    }

    const runtimeDiagnostics = {
      llm_calls: llmCallDiagnostics,
      checks: [
        ...(regenerated
          ? [
              {
                code: "asset_planning_regen_once",
                level: "info",
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
          level: "error",
        })),
      ],
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
      output_dir: roundOutputDir,
      validation_decision: validation.decision,
      validation_errors: validation.errors,
      validation_warnings: validation.warnings,
      task_count: assetPlan.tasks.length,
      dependency_count: assetPlan.dependencies.length,
      segment_count: source.storyboard.segments.length,
      task_type_counts: countTasksByType(assetPlan),
    });
  }

  const result: AssetPlanningFiveRoundQualityCheckResult = {
    ...plan,
    passed_rounds: rounds.filter((round) => round.status === "round-ready").length,
    failed_rounds: rounds.filter((round) => round.status === "round-failed").length,
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
  return {
    reviewMarkdown,
    roundResult: {
      round: input.round,
      status: "round-ready" as const,
      source_storyboard_dir: input.sourceStoryboardDir,
      source_title: input.source.topicPackage.title,
      regenerated: false,
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
        `- round ${round.round}: ${round.source_title}, validation=${round.validation_decision}, tasks=${round.task_count}, output=${round.output_dir}`,
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
