import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  ScriptDraftPackage,
  StoryboardPlan,
  TopicPackage,
  type ScriptDraftPackage as ScriptDraftPackageType,
  type StoryboardPlan as StoryboardPlanType,
  type TopicPackage as TopicPackageType,
} from "../../../shared/src/index.js";
import {
  generateStoryboardPlan,
  type TopicBoundaryContext,
} from "../../../backend/src/modules/storyboard/storyboard-generation.service";
import { validateStoryboardPlan } from "../../../backend/src/modules/storyboard/storyboard-local-validator";
import {
  renderLlmInteractionMarkdown,
  type LlmInteractionLogEntry,
  type LlmInteractionLogWriter,
} from "../../../backend/src/runtime/llm/interaction-log";

const DEFAULT_SOURCE_SCRIPT_DIRS = [
  "harness/scripts/runtime/output/2026-05-09-script-writer-duration-pacing-scene-density-five-round/yanzi-shichu",
  "harness/scripts/runtime/output/2026-05-09-script-writer-duration-pacing-scene-density-five-round/zhuanzhu-ciwangliao",
  "harness/scripts/runtime/output/2026-05-09-script-writer-duration-pacing-scene-density-five-round/julu-zhizhan",
  "harness/scripts/runtime/output/2026-05-09-script-writer-duration-pacing-scene-density-five-round/hongmenyan",
  "harness/scripts/runtime/output/2026-05-10-storyboard-fifth-source/tianji-saima",
].map((item) => resolve(process.cwd(), item));
const DEFAULT_OUTPUT_DIR = resolve(
  process.cwd(),
  "harness/scripts/runtime/output/storyboard-five-round-quality-check",
);
const DEFAULT_ROUNDS = 5;

export interface StoryboardFiveRoundQualityCheckInput {
  sourceDir?: string;
  sourceDirs?: string[];
  outputDir?: string;
  rounds?: number;
}

export interface StoryboardFiveRoundQualityCheckPlan {
  mode: "storyboard_real_runtime_live_check";
  automated_gate: false;
  requires_real_env: true;
  source_script_dirs: string[];
  total_rounds: number;
  output_dir: string;
  required_artifacts: string[];
  required_checks: string[];
}

export interface StoryboardFiveRoundRoundResult {
  round: number;
  status: "round-ready" | "round-failed";
  source_script_dir: string;
  source_title: string;
  regenerated: boolean;
  output_dir: string;
  validation_decision: string;
  validation_errors: string[];
  validation_warnings: string[];
  segment_count: number;
  coverage_ratio: number | null;
  duration_hint_sec: number | null;
}

export interface StoryboardFiveRoundQualityCheckResult
  extends StoryboardFiveRoundQualityCheckPlan {
  passed_rounds: number;
  failed_rounds: number;
  rounds: StoryboardFiveRoundRoundResult[];
}

export interface StoryboardFiveRoundPlanGeneratorInput {
  sourceScriptRecordId: string;
  sourceTopicPackageId: string;
  draft: ScriptDraftPackageType;
  topicBoundaryContext: TopicBoundaryContext;
  interactionLogWriter: LlmInteractionLogWriter;
  round: number;
  regenerationContext?: {
    reason: "storyboard_local_validation_regen_once";
    errors: string[];
    metrics: Record<string, unknown>;
  };
}

export interface StoryboardFiveRoundQualityCheckDependencies {
  requireRealEnv?: boolean;
  planGenerator?: (
    input: StoryboardFiveRoundPlanGeneratorInput,
  ) => Promise<StoryboardPlanType>;
}

export function buildStoryboardFiveRoundQualityCheckPlan(
  input: StoryboardFiveRoundQualityCheckInput = {},
): StoryboardFiveRoundQualityCheckPlan {
  const sourceScriptDirs = resolveSourceScriptDirs(input);
  return {
    mode: "storyboard_real_runtime_live_check",
    automated_gate: false,
    requires_real_env: true,
    source_script_dirs: sourceScriptDirs,
    total_rounds: input.rounds ?? sourceScriptDirs.length,
    output_dir: input.outputDir ?? DEFAULT_OUTPUT_DIR,
    required_artifacts: [
      "source-script-draft.json",
      "source-topic-package.json",
      "storyboard-plan.json",
      "storyboard-validation-result.json",
      "runtime-diagnostics.json",
      "trace.md",
      "llm-interactions/01-storyboard.planner.md",
    ],
    required_checks: [
      "Requires real .env and must be run explicitly outside the default automated gate.",
      "默认 5 轮分别读取 5 个不同主题的高质量 script 产物，不重新运行 topic 或 script。",
      "只观察 storyboard planning 的稳定性、覆盖率、段落切分与视觉计划质量。",
      "不执行 asset planning、assets、compose，也不生成镜头级 shot list。",
      "真实 storyboard live check 建议显式设置 LLM_TIMEOUT_MS=240000；该参数只用于人工巡检运行，不改变默认自动化 gate。",
    ],
  };
}

export async function runStoryboardFiveRoundQualityCheck(
  input: StoryboardFiveRoundQualityCheckInput = {},
  dependencies: StoryboardFiveRoundQualityCheckDependencies = {},
): Promise<StoryboardFiveRoundQualityCheckResult> {
  const plan = writeStoryboardFiveRoundQualityCheckPlan(input);
  const requireRealEnv = dependencies.requireRealEnv ?? true;

  if (requireRealEnv && !existsSync(resolve(process.cwd(), ".env"))) {
    throw new Error("storyboard_live_check_real_env_missing");
  }

  const planGenerator =
    dependencies.planGenerator ??
    ((generatorInput: StoryboardFiveRoundPlanGeneratorInput) =>
      generateStoryboardPlan(generatorInput));
  const rounds: StoryboardFiveRoundRoundResult[] = [];

  for (let round = 1; round <= plan.total_rounds; round += 1) {
    const sourceScriptDir =
      plan.source_script_dirs[(round - 1) % plan.source_script_dirs.length];
    const source = loadStoryboardFixedSource(sourceScriptDir);
    const roundOutputDir = resolve(plan.output_dir, `round-${round}`);
    mkdirSync(roundOutputDir, { recursive: true });
    writeJson(roundOutputDir, "source-script-draft.json", source.draft);
    writeJson(roundOutputDir, "source-topic-package.json", source.topicPackage);

    const interactionLogWriter = createRoundInteractionLogWriter(roundOutputDir);
    let generatedPlan = StoryboardPlan.parse(
      await planGenerator({
        sourceScriptRecordId: "fixed-script-record",
        sourceTopicPackageId: source.topicPackage.topic_id,
        draft: source.draft,
        topicBoundaryContext: source.topicBoundaryContext,
        interactionLogWriter,
        round,
      }),
    );
    let validation = validateStoryboardPlan({
      draft: source.draft,
      plan: generatedPlan,
    });
    let regenerated = false;

    if (validation.decision === "regen_once") {
      regenerated = true;
      generatedPlan = StoryboardPlan.parse(
        await planGenerator({
          sourceScriptRecordId: "fixed-script-record",
          sourceTopicPackageId: source.topicPackage.topic_id,
          draft: source.draft,
          topicBoundaryContext: source.topicBoundaryContext,
          interactionLogWriter,
          round,
          regenerationContext: {
            reason: "storyboard_local_validation_regen_once",
            errors: validation.errors,
            metrics: validation.metrics,
          },
        }),
      );
      validation = validateStoryboardPlan({
        draft: source.draft,
        plan: generatedPlan,
      });
    }

    const runtimeDiagnostics = {
      checks: [
        ...(regenerated
          ? [
              {
                code: "storyboard_regen_once",
                level: "info",
              },
            ]
          : []),
        {
          code:
            validation.decision === "pass"
              ? "storyboard_local_validation_passed"
              : "storyboard_local_validation_failed",
          level: validation.decision === "pass" ? "info" : "error",
        },
      ],
    };

    writeJson(roundOutputDir, "storyboard-plan.json", generatedPlan);
    writeJson(roundOutputDir, "storyboard-validation-result.json", validation);
    writeJson(roundOutputDir, "runtime-diagnostics.json", runtimeDiagnostics);
    writeRoundTrace(roundOutputDir, {
      round,
      sourceScriptDir,
      sourceTitle: source.topicPackage.title,
      regenerated,
      validationDecision: validation.decision,
      validationErrors: validation.errors,
      segmentCount: generatedPlan.segments.length,
      coverageRatio: readNumberMetric(validation.metrics.coverage_ratio),
    });

    rounds.push({
      round,
      status: validation.decision === "pass" ? "round-ready" : "round-failed",
      source_script_dir: sourceScriptDir,
      source_title: source.topicPackage.title,
      regenerated,
      output_dir: roundOutputDir,
      validation_decision: validation.decision,
      validation_errors: validation.errors,
      validation_warnings: validation.warnings,
      segment_count: generatedPlan.segments.length,
      coverage_ratio: readNumberMetric(validation.metrics.coverage_ratio),
      duration_hint_sec: readNumberMetric(validation.metrics.total_duration_hint_sec),
    });
  }

  const result: StoryboardFiveRoundQualityCheckResult = {
    ...plan,
    passed_rounds: rounds.filter((round) => round.status === "round-ready").length,
    failed_rounds: rounds.filter((round) => round.status === "round-failed").length,
    rounds,
  };

  writeJson(plan.output_dir, "live-check-summary.json", result);

  return result;
}

export function parseStoryboardFiveRoundQualityCheckCliArgs(argv: string[]) {
  const result: StoryboardFiveRoundQualityCheckInput = {};

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

    if (!current.startsWith("--") && !result.outputDir) {
      result.outputDir = current;
    }
  }

  return result;
}

function writeStoryboardFiveRoundQualityCheckPlan(
  input: StoryboardFiveRoundQualityCheckInput,
) {
  const plan = buildStoryboardFiveRoundQualityCheckPlan(input);
  mkdirSync(plan.output_dir, { recursive: true });
  writeJson(plan.output_dir, "live-check-plan.json", plan);
  writeFileSync(
    resolve(plan.output_dir, "trace.md"),
    [
      "# storyboard five-round live check plan",
      "",
      `- mode: ${plan.mode}`,
      `- automated_gate: ${plan.automated_gate}`,
      `- requires_real_env: ${plan.requires_real_env}`,
      `- total_rounds: ${plan.total_rounds}`,
      `- output_dir: ${plan.output_dir}`,
      "",
      "## Source Script Dirs",
      "",
      ...plan.source_script_dirs.map((item, index) => `${index + 1}. ${item}`),
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

function resolveSourceScriptDirs(input: StoryboardFiveRoundQualityCheckInput) {
  if (input.sourceDirs && input.sourceDirs.length > 0) {
    return input.sourceDirs.map((item) => resolve(process.cwd(), item));
  }

  if (input.sourceDir) {
    return [resolve(process.cwd(), input.sourceDir)];
  }

  return DEFAULT_SOURCE_SCRIPT_DIRS;
}

function loadStoryboardFixedSource(sourceDir: string) {
  const draft = ScriptDraftPackage.parse(
    readJson(resolve(sourceDir, "script-draft.json")),
  );
  const topicPackage = TopicPackage.parse(
    normalizeTopicPackageArtifact(readJson(resolve(sourceDir, "topic-package.json"))),
  );

  return {
    draft,
    topicPackage,
    topicBoundaryContext: toTopicBoundaryContext(topicPackage),
  };
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

function toTopicBoundaryContext(
  topicPackage: TopicPackageType,
): TopicBoundaryContext {
  return {
    title: topicPackage.title,
    selected_angle: topicPackage.selected_angle,
    core_conflict: topicPackage.core_conflict,
    strong_scene: topicPackage.strong_scene,
    forbidden_expansions: topicPackage.forbidden_expansions,
    risk_hints: topicPackage.risk_hints,
    source_anchor_refs: topicPackage.source_anchor_refs,
    canonical_quotes: topicPackage.canonical_quotes,
    narrative_tension_map: topicPackage.narrative_tension_map,
  };
}

function createRoundInteractionLogWriter(roundOutputDir: string): LlmInteractionLogWriter {
  let sequence = 0;
  const logDir = resolve(roundOutputDir, "llm-interactions");
  mkdirSync(logDir, { recursive: true });

  return {
    write(entry: LlmInteractionLogEntry) {
      sequence += 1;
      const filename = `${String(sequence).padStart(2, "0")}-${entry.promptId}.md`;
      writeFileSync(
        resolve(logDir, filename),
        renderLlmInteractionMarkdown({ ...entry, sequence }),
        "utf8",
      );
    },
  };
}

function writeRoundTrace(
  roundOutputDir: string,
  input: {
    round: number;
    sourceScriptDir: string;
    sourceTitle: string;
    regenerated: boolean;
    validationDecision: string;
    validationErrors: string[];
    segmentCount: number;
    coverageRatio: number | null;
  },
) {
  writeFileSync(
    resolve(roundOutputDir, "trace.md"),
    [
      "# storyboard round trace",
      "",
      `- round: ${input.round}`,
      `- source_title: ${input.sourceTitle}`,
      `- source_script_dir: ${input.sourceScriptDir}`,
      `- regenerated: ${input.regenerated}`,
      `- validation_decision: ${input.validationDecision}`,
      `- segment_count: ${input.segmentCount}`,
      `- coverage_ratio: ${input.coverageRatio ?? "unknown"}`,
      `- validation_errors: ${
        input.validationErrors.length > 0 ? input.validationErrors.join(", ") : "none"
      }`,
      "",
    ].join("\n"),
    "utf8",
  );
}

function readJson(filePath: string) {
  return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
}

function writeJson(outputDir: string, filename: string, value: unknown) {
  writeFileSync(resolve(outputDir, filename), JSON.stringify(value, null, 2), "utf8");
}

function readNumberMetric(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

async function main() {
  const result = await runStoryboardFiveRoundQualityCheck(
    parseStoryboardFiveRoundQualityCheckCliArgs(process.argv.slice(2)),
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "storyboard-five-round-quality-check-completed",
        output_dir: result.output_dir,
        source_script_dirs: result.source_script_dirs,
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
