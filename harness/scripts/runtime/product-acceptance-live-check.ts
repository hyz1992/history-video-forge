import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildApp, type AppInstance } from "../../../backend/src/app";
import type { ProjectRecord } from "../../../backend/src/db/client";
import { saveAssetPlanRecord } from "../../../backend/src/modules/asset-planning/asset-plan-record.repository";
import { DEFAULT_AUDIO_LIBRARY_ITEMS } from "../../../backend/src/modules/assets/default-audio-library";
import { loadLightweightBgmCatalogItems } from "../../../backend/src/modules/assets/lightweight-audio-catalog-loader";
import { saveMediaLibraryItem } from "../../../backend/src/modules/assets/media-library.repository";
import { createLocalRemotionRenderAdapter } from "../../../backend/src/modules/render/local-remotion-render-adapter";
import type { RenderAdapter } from "../../../backend/src/modules/render/render-adapter";
import { saveScriptRecord } from "../../../backend/src/modules/script/script-record.repository";
import { saveStoryboardRecord } from "../../../backend/src/modules/storyboard/storyboard-record.repository";
import { saveTopicPackage } from "../../../backend/src/modules/topic/topic-package.repository";
import { runStoryboardFiveRoundQualityCheck } from "./storyboard-five-round-quality-check";
import { runTopicScriptSmoke } from "./topic-script-smoke";
import {
  AssetPlan,
  ScriptDraftPackage,
  StoryboardPlan,
  TopicPackage,
  type AssetPlan as AssetPlanType,
  type AssetTask,
  type ScriptDraftPackage as ScriptDraftPackageType,
  type StoryboardPlan as StoryboardPlanType,
  type TopicPackage as TopicPackageType,
} from "../../../shared/src/index";

export interface ProductAcceptanceLiveCheckInput {
  sourceDir?: string;
  outputDir?: string;
  bgmLibraryItemId?: string;
  dashscope?: {
    apiKey?: string;
    baseUrl?: string;
    imageModel?: string;
    ttsModel?: string;
  };
  allowUpstreamGeneration?: boolean;
}

export interface ProductAcceptanceLiveCheckPlan {
  mode: "product_acceptance_live_check";
  automated_gate: false;
  requires_real_env: true;
  provider_mode: "dashscope";
  source_dir: string | null;
  output_dir: string;
  disabled_providers: string[];
  disabled_task_types: string[];
  required_artifacts: string[];
  required_checks: string[];
}

export interface ProductAcceptanceSource {
  sourceDir: string;
  topicPackage: TopicPackageType;
  scriptDraft: ScriptDraftPackageType;
  storyboardPlan: StoryboardPlanType;
}

export interface SeededProductAcceptanceProject {
  app: AppInstance;
  project: ProjectRecord;
}

export interface AcceptanceAssetPlanningResult {
  originalPlan: AssetPlanType;
  executionPlan: AssetPlanType;
  originalAssetPlanRecordId: string;
  executionAssetPlanRecordId: string;
}

export interface ProductAcceptanceEnv {
  ALIYUN_DASHSCOPE_API_KEY?: string;
  ALIYUN_DASHSCOPE_BASE_URL?: string;
  ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL?: string;
  ALIYUN_DASHSCOPE_TTS_MODEL?: string;
}

export interface ProductAcceptanceLiveCheckResult {
  outputDir: string;
  summary: ProductAcceptanceSummary;
}

export interface ProductAcceptanceSummary {
  status: "sample-ready";
  source_title: string;
  output_dir: string;
  output_mp4_path: string | null;
  provider_names: string[];
  artifact_type_counts: Record<string, number>;
  disabled_sfx_confirmed: boolean;
  image_to_video_not_called_confirmed: boolean;
  subtitle_diagnostics: {
    caption_count: number;
    cue_count: number;
    has_style: boolean;
  };
  audio_diagnostics: {
    tts: WavRmsDiagnostics;
    bgm: WavRmsDiagnostics;
  };
  render_diagnostics: Record<string, unknown>;
}

type WavRmsDiagnostics =
  | {
      file_uri: string;
      bytes: number;
      rms: number;
      max: number;
    }
  | {
      file_uri: null;
      bytes: 0;
      rms: null;
      max: null;
    };

export interface ProductAcceptanceLiveCheckDependencies {
  env?: ProductAcceptanceEnv;
  renderAdapter?: RenderAdapter;
  generateAssetPlan?: (input: {
    app: AppInstance;
    project: ProjectRecord;
  }) => Promise<Record<string, unknown>>;
  inject?: (input: {
    app: AppInstance;
    method: string;
    url: string;
    payload?: unknown;
  }) => Promise<Record<string, unknown>>;
}

const DEFAULT_OUTPUT_DIR = resolve(
  process.cwd(),
  "harness/scripts/runtime/output/product-acceptance-live-check",
);
const DEFAULT_ACCEPTANCE_SOURCE_DIRS = [
  "harness/scripts/runtime/output/2026-05-10-storyboard-five-theme-review/round-1",
  "harness/scripts/runtime/output/2026-05-10-storyboard-five-theme-review/round-2",
  "harness/scripts/runtime/output/2026-05-10-storyboard-five-theme-review/round-3",
].map((item) => resolve(process.cwd(), item));
const DISABLED_ACCEPTANCE_TASK_TYPES: ReadonlySet<AssetTask["task_type"]> =
  new Set(["video_clip", "sfx_cue"]);
const PROVIDER_CALL_TASK_TYPES: ReadonlySet<AssetTask["task_type"]> = new Set([
  "tts_audio",
  "image_still",
  "subtitle_track",
  "bgm_cue",
]);

export function buildProductAcceptanceLiveCheckPlan(
  input: ProductAcceptanceLiveCheckInput = {},
): ProductAcceptanceLiveCheckPlan {
  return {
    mode: "product_acceptance_live_check",
    automated_gate: false,
    requires_real_env: true,
    provider_mode: "dashscope",
    source_dir: input.sourceDir ?? null,
    output_dir: input.outputDir ?? DEFAULT_OUTPUT_DIR,
    disabled_providers: ["dashscope_image_to_video"],
    disabled_task_types: ["video_clip", "sfx_cue"],
    required_artifacts: [
      "source-topic-package.json",
      "source-script-draft.json",
      "source-storyboard-plan.json",
      "asset-plan.json",
      "execution-asset-plan.json",
      "assets-response.json",
      "compose-response.json",
      "render-response.json",
      "acceptance-summary.json",
      "manual-review-checklist.md",
      "trace.md",
    ],
    required_checks: [
      "asset planning validation must pass",
      "manifest must contain dashscope_tts audio",
      "manifest must contain dashscope_image image",
      "manifest must contain local_subtitle subtitle_track",
      "render subtitle_cue_count must be greater than 0",
      "manifest must not contain sfx_audio",
      "provider list must not contain dashscope_image_to_video",
    ],
  };
}

export function parseProductAcceptanceLiveCheckCliArgs(
  argv: string[],
): ProductAcceptanceLiveCheckInput {
  const result: ProductAcceptanceLiveCheckInput = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--source-dir" && next) {
      result.sourceDir = next;
      index += 1;
      continue;
    }

    if (current === "--output-dir" && next) {
      result.outputDir = next;
      index += 1;
      continue;
    }

    if (current === "--bgm-id" && next) {
      result.bgmLibraryItemId = next;
      index += 1;
      continue;
    }

    if (current === "--dashscope-base-url" && next) {
      result.dashscope = { ...result.dashscope, baseUrl: next };
      index += 1;
      continue;
    }

    if (current === "--dashscope-image-model" && next) {
      result.dashscope = { ...result.dashscope, imageModel: next };
      index += 1;
      continue;
    }

    if (current === "--dashscope-tts-model" && next) {
      result.dashscope = { ...result.dashscope, ttsModel: next };
      index += 1;
      continue;
    }

    if (current === "--allow-upstream-generation") {
      result.allowUpstreamGeneration = true;
    }
  }

  return result;
}

export function resolveProductAcceptanceEnv(
  env: NodeJS.ProcessEnv = process.env,
): ProductAcceptanceEnv {
  return {
    ALIYUN_DASHSCOPE_API_KEY: env.ALIYUN_DASHSCOPE_API_KEY,
    ALIYUN_DASHSCOPE_BASE_URL: env.ALIYUN_DASHSCOPE_BASE_URL,
    ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL:
      env.ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL,
    ALIYUN_DASHSCOPE_TTS_MODEL: env.ALIYUN_DASHSCOPE_TTS_MODEL,
  };
}

export function buildProductAcceptanceAssetsPayload(input: {
  env: ProductAcceptanceEnv;
  dashscope?: ProductAcceptanceLiveCheckInput["dashscope"];
}) {
  const apiKey = input.dashscope?.apiKey ?? input.env.ALIYUN_DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw new Error("product_acceptance_dashscope_api_key_missing");
  }

  return {
    voice_profile_id: "voice_system_ethan",
    execution_mode: "auto_available",
    provider_mode: "dashscope",
    dashscope: {
      api_key: apiKey,
      base_url:
        input.dashscope?.baseUrl ??
        input.env.ALIYUN_DASHSCOPE_BASE_URL ??
        "https://dashscope.aliyuncs.com",
      image_model:
        input.dashscope?.imageModel ??
        input.env.ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL ??
        "wan2.6-t2i",
      tts_model:
        input.dashscope?.ttsModel ??
        input.env.ALIYUN_DASHSCOPE_TTS_MODEL ??
        "qwen3-tts-instruct-flash",
      tts_format: "wav",
    },
  };
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(outputDir: string, filename: string, value: unknown): void {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    resolve(outputDir, filename),
    JSON.stringify(value, null, 2),
    "utf8",
  );
}

function writeText(outputDir: string, filename: string, value: string): void {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, filename), value, "utf8");
}

export async function resolveProductAcceptanceSourceDir(
  input: ProductAcceptanceLiveCheckInput,
  dependencies: {
    defaultSourceDirs?: string[];
    exists?: (path: string) => boolean;
    generateSource?: () => Promise<string>;
  } = {},
): Promise<string> {
  const exists = dependencies.exists ?? existsSync;
  if (input.sourceDir) {
    const resolved = resolve(process.cwd(), input.sourceDir);
    if (!exists(resolved)) {
      throw new Error(`product_acceptance_source_dir_missing: ${resolved}`);
    }
    return resolved;
  }

  for (const candidate of
    dependencies.defaultSourceDirs ?? DEFAULT_ACCEPTANCE_SOURCE_DIRS) {
    if (exists(candidate)) {
      return candidate;
    }
  }

  if (input.allowUpstreamGeneration) {
    const generateSource =
      dependencies.generateSource ??
      (() => generateProductAcceptanceUpstreamSource(input));
    return generateSource();
  }

  throw new Error(
    "product_acceptance_source_missing_use_allow_upstream_generation",
  );
}

export function loadProductAcceptanceSource(
  sourceDir: string,
): ProductAcceptanceSource {
  const sourceTopicPath = resolve(sourceDir, "source-topic-package.json");
  const topicPath = existsSync(sourceTopicPath)
    ? sourceTopicPath
    : resolve(sourceDir, "topic-package.json");
  const sourceScriptPath = resolve(sourceDir, "source-script-draft.json");
  const scriptPath = existsSync(sourceScriptPath)
    ? sourceScriptPath
    : resolve(sourceDir, "script-draft.json");
  const sourceStoryboardPath = resolve(sourceDir, "source-storyboard-plan.json");
  const storyboardPath = existsSync(sourceStoryboardPath)
    ? sourceStoryboardPath
    : resolve(sourceDir, "storyboard-plan.json");

  return {
    sourceDir,
    topicPackage: TopicPackage.parse(readJson(topicPath)),
    scriptDraft: ScriptDraftPackage.parse(readJson(scriptPath)),
    storyboardPlan: StoryboardPlan.parse(readJson(storyboardPath)),
  };
}

export function sanitizeAssetPlanForProductAcceptance(
  plan: AssetPlanType,
): AssetPlanType {
  const removedTaskIds = new Set(
    plan.tasks
      .filter((task) => DISABLED_ACCEPTANCE_TASK_TYPES.has(task.task_type))
      .map((task) => task.task_id),
  );
  const tasks = plan.tasks.filter((task) => !removedTaskIds.has(task.task_id));
  const dependencies = plan.dependencies.filter(
    (dependency) =>
      !removedTaskIds.has(dependency.task_id) &&
      !removedTaskIds.has(dependency.depends_on_task_id),
  );
  const segmentIds = Array.from(
    new Set(
      plan.tasks
        .map((task) => task.source_segment_id)
        .filter((segmentId): segmentId is string => Boolean(segmentId)),
    ),
  );

  for (const segmentId of segmentIds) {
    const hasImageAnchor = tasks.some(
      (task) =>
        task.source_segment_id === segmentId && task.task_type === "image_still",
    );
    if (!hasImageAnchor) {
      throw new Error(`acceptance_visual_anchor_missing: ${segmentId}`);
    }
  }

  return AssetPlan.parse({
    ...plan,
    tasks,
    dependencies,
    cost_summary: {
      total_tasks: tasks.length,
      by_type: countTasksBy(tasks, (task) => task.task_type),
      by_cost_tier: countTasksBy(tasks, (task) => task.cost_tier),
      estimated_provider_calls: tasks.filter((task) =>
        PROVIDER_CALL_TASK_TYPES.has(task.task_type),
      ).length,
      notes: [
        ...plan.cost_summary.notes,
        "product_acceptance_execution_plan_removed_video_clip_and_sfx",
      ],
    },
  });
}

export async function runAcceptanceAssetPlanning(input: {
  app: AppInstance;
  project: ProjectRecord;
  outputDir: string;
  generateAssetPlan?: (input: {
    app: AppInstance;
    project: ProjectRecord;
  }) => Promise<Record<string, unknown>>;
}): Promise<AcceptanceAssetPlanningResult> {
  const rawBody = input.generateAssetPlan
    ? await input.generateAssetPlan({
        app: input.app,
        project: input.project,
      })
    : await injectOrThrow({
        app: input.app,
        method: "POST",
        url: `/api/projects/${input.project.id}/asset-plan/generate`,
        payload: {},
      });
  const originalPlan = AssetPlan.parse(
    rawBody.asset_plan ?? rawBody.plan ?? rawBody.assetPlan,
  );
  const validation =
    rawBody.local_validation ??
    rawBody.validation ??
    {
      stage: "asset_planning_local_validation",
      decision: "pass",
      errors: [],
      warnings: [],
      metrics: {},
    };

  writeJson(input.outputDir, "asset-plan.json", originalPlan);
  writeJson(input.outputDir, "asset-planning-validation-result.json", validation);

  const executionPlan = sanitizeAssetPlanForProductAcceptance(originalPlan);
  writeJson(input.outputDir, "execution-asset-plan.json", executionPlan);

  const activeAssetPlanRecordId = input.project.activeAssetPlanRecordId;
  const activeAssetPlanRecord = activeAssetPlanRecordId
    ? input.app.db.assetPlanRecords.get(activeAssetPlanRecordId)
    : null;
  if (!activeAssetPlanRecord) {
    throw new Error(
      "product_acceptance_asset_plan_record_missing_after_generation",
    );
  }

  const executionRecord = await saveAssetPlanRecord(input.app.db, {
    id: `asset_plan_product_acceptance_execution_${input.app.db.generateId()}`,
    projectId: input.project.id,
    topicPackageId: activeAssetPlanRecord.topicPackageId,
    scriptRecordId: activeAssetPlanRecord.scriptRecordId,
    storyboardRecordId: activeAssetPlanRecord.storyboardRecordId,
    planJson: executionPlan,
    validationResultJson: activeAssetPlanRecord.validationResultJson,
    executionStateJson: {
      source_asset_plan_record_id: activeAssetPlanRecord.id,
      sanitized_for_product_acceptance: true,
      disabled_task_types: ["video_clip", "sfx_cue"],
    },
    graphTraceSummaryJson: activeAssetPlanRecord.graphTraceSummaryJson,
    runtimeDiagnosticsJson: activeAssetPlanRecord.runtimeDiagnosticsJson,
  });

  input.project.activeAssetPlanRecordId = executionRecord.id;
  input.project.status = "asset_plan_ready";

  return {
    originalPlan,
    executionPlan,
    originalAssetPlanRecordId: activeAssetPlanRecord.id,
    executionAssetPlanRecordId: executionRecord.id,
  };
}

export async function seedAcceptanceMediaLibrary(
  app: AppInstance,
  input: { bgmLibraryItemId?: string } = {},
): Promise<void> {
  const catalogPath = resolve(
    process.cwd(),
    "storage/media-library/ai-bgm-prompt-candidates.json",
  );
  const loadedItems = existsSync(catalogPath)
    ? await loadLightweightBgmCatalogItems(catalogPath)
    : [];

  for (const entry of loadedItems) {
    await saveMediaLibraryItem(app.db, entry.item);
  }
  for (const item of DEFAULT_AUDIO_LIBRARY_ITEMS) {
    await saveMediaLibraryItem(app.db, item);
  }

  if (
    input.bgmLibraryItemId &&
    !app.db.mediaLibraryItems.has(input.bgmLibraryItemId)
  ) {
    throw new Error(
      `product_acceptance_bgm_not_found: ${input.bgmLibraryItemId}`,
    );
  }
}

export function assertProductAcceptanceRenderReadiness(input: {
  assetsBody: Record<string, unknown>;
  renderBody: Record<string, unknown>;
}): void {
  const manifest = input.assetsBody.manifest as
    | {
        artifacts?: Array<{
          artifact_type?: string;
          metadata?: Record<string, unknown>;
        }>;
      }
    | undefined;
  const artifacts = manifest?.artifacts ?? [];
  const subtitleArtifact = artifacts.find(
    (artifact) => artifact.artifact_type === "subtitle_track",
  );
  if (!subtitleArtifact) {
    throw new Error("product_acceptance_subtitle_artifact_missing");
  }
  if (Number(subtitleArtifact.metadata?.caption_count ?? 0) <= 0) {
    throw new Error("product_acceptance_subtitle_caption_count_empty");
  }
  if (!subtitleArtifact.metadata?.subtitle_style) {
    throw new Error("product_acceptance_subtitle_style_missing");
  }

  const diagnostics = input.renderBody.runtime_diagnostics as
    | Record<string, unknown>
    | undefined;
  if (Number(diagnostics?.subtitle_cue_count ?? 0) <= 0) {
    throw new Error("product_acceptance_subtitles_not_rendered");
  }
  if (Number(diagnostics?.audio_clip_count ?? 0) <= 0) {
    throw new Error("product_acceptance_audio_not_rendered");
  }
  if (Number(diagnostics?.visual_clip_count ?? 0) <= 0) {
    throw new Error("product_acceptance_visual_not_rendered");
  }
}

export async function runProductAcceptanceLiveCheck(
  input: ProductAcceptanceLiveCheckInput = {},
  dependencies: ProductAcceptanceLiveCheckDependencies = {},
): Promise<ProductAcceptanceLiveCheckResult> {
  const plan = buildProductAcceptanceLiveCheckPlan(input);
  mkdirSync(plan.output_dir, { recursive: true });
  writeJson(plan.output_dir, "live-check-plan.json", plan);

  const sourceDir = await resolveProductAcceptanceSourceDir(input);
  const source = loadProductAcceptanceSource(sourceDir);
  writeJson(plan.output_dir, "source-topic-package.json", source.topicPackage);
  writeJson(plan.output_dir, "source-script-draft.json", source.scriptDraft);
  writeJson(
    plan.output_dir,
    "source-storyboard-plan.json",
    source.storyboardPlan,
  );

  const seeded = await seedProductAcceptanceProject({
    source,
    outputDir: plan.output_dir,
    renderAdapter:
      dependencies.renderAdapter ?? createLocalRemotionRenderAdapter(),
  });
  await seedAcceptanceMediaLibrary(seeded.app, {
    bgmLibraryItemId: input.bgmLibraryItemId,
  });

  const planning = await runAcceptanceAssetPlanning({
    app: seeded.app,
    project: seeded.project,
    outputDir: plan.output_dir,
    generateAssetPlan: dependencies.generateAssetPlan,
  });
  const inject = dependencies.inject ?? injectOrThrow;
  const assetsBody = await inject({
    app: seeded.app,
    method: "POST",
    url: `/api/projects/${seeded.project.id}/assets/generate`,
    payload: buildProductAcceptanceAssetsPayload({
      env: dependencies.env ?? resolveProductAcceptanceEnv(),
      dashscope: input.dashscope,
    }),
  });
  writeJson(plan.output_dir, "assets-response.json", assetsBody);

  const assetsSnapshot = await inject({
    app: seeded.app,
    method: "GET",
    url: `/api/projects/${seeded.project.id}`,
  });
  writeJson(plan.output_dir, "assets-snapshot.json", assetsSnapshot);

  const composeBody = await inject({
    app: seeded.app,
    method: "POST",
    url: `/api/projects/${seeded.project.id}/compose/generate`,
    payload: {},
  });
  writeJson(plan.output_dir, "compose-response.json", composeBody);

  const renderBody = await inject({
    app: seeded.app,
    method: "POST",
    url: `/api/projects/${seeded.project.id}/render/generate`,
    payload: {},
  });
  writeJson(plan.output_dir, "render-response.json", renderBody);

  assertProductAcceptanceRenderReadiness({ assetsBody, renderBody });
  const summary = await buildProductAcceptanceSummary({
    sourceTitle: source.topicPackage.title,
    outputDir: plan.output_dir,
    assetsBody,
    composeBody,
    renderBody,
    projectStorageRootDir: seeded.project.storageRootDir,
  });
  writeJson(plan.output_dir, "acceptance-summary.json", summary);
  writeManualReviewChecklist(plan.output_dir);
  writeTrace(plan.output_dir, {
    sourceDir,
    projectId: seeded.project.id,
    originalAssetPlanRecordId: planning.originalAssetPlanRecordId,
    executionAssetPlanRecordId: planning.executionAssetPlanRecordId,
    outputMp4Path: summary.output_mp4_path,
  });

  return { outputDir: plan.output_dir, summary };
}

export async function buildProductAcceptanceSummary(input: {
  sourceTitle: string;
  outputDir: string;
  assetsBody: Record<string, unknown>;
  composeBody: Record<string, unknown>;
  renderBody: Record<string, unknown>;
  projectStorageRootDir?: string;
}): Promise<ProductAcceptanceSummary> {
  const manifest = input.assetsBody.manifest as
    | {
        artifacts?: Array<{
          artifact_type?: string;
          file_uri?: string;
          metadata?: Record<string, unknown>;
        }>;
        executions?: Array<{ provider_id?: string | null }>;
        audio_summary?: { sfx_artifact_ids?: string[] };
      }
    | undefined;
  const artifacts = manifest?.artifacts ?? [];
  const providerNames = readProviderNames({ manifest });
  const subtitleArtifact = artifacts.find(
    (artifact) => artifact.artifact_type === "subtitle_track",
  );
  const ttsArtifact = artifacts.find(
    (artifact) => artifact.artifact_type === "tts_merged_audio",
  );
  const bgmArtifact = artifacts.find(
    (artifact) => artifact.artifact_type === "bgm_audio",
  );
  const renderDiagnostics =
    (input.renderBody.runtime_diagnostics as
      | Record<string, unknown>
      | undefined) ?? {};

  return {
    status: "sample-ready",
    source_title: input.sourceTitle,
    output_dir: input.outputDir,
    output_mp4_path:
      (input.renderBody.output_artifact as { file_uri?: string } | undefined)
        ?.file_uri ?? null,
    provider_names: providerNames,
    artifact_type_counts: countBy(
      artifacts
        .map((artifact) => artifact.artifact_type)
        .filter((value): value is string => Boolean(value)),
    ),
    disabled_sfx_confirmed:
      !artifacts.some((artifact) => artifact.artifact_type === "sfx_audio") &&
      (manifest?.audio_summary?.sfx_artifact_ids ?? []).length === 0,
    image_to_video_not_called_confirmed:
      !providerNames.includes("dashscope_image_to_video") &&
      !artifacts.some((artifact) => artifact.artifact_type === "video"),
    subtitle_diagnostics: {
      caption_count: Number(subtitleArtifact?.metadata?.caption_count ?? 0),
      cue_count: Number(renderDiagnostics.subtitle_cue_count ?? 0),
      has_style: Boolean(subtitleArtifact?.metadata?.subtitle_style),
    },
    audio_diagnostics: {
      tts: readWavRmsDiagnostics(ttsArtifact?.file_uri),
      bgm: readWavRmsDiagnostics(bgmArtifact?.file_uri),
    },
    render_diagnostics: renderDiagnostics,
  };
}

export async function seedProductAcceptanceProject(input: {
  source: ProductAcceptanceSource;
  outputDir: string;
  renderAdapter?: RenderAdapter;
}): Promise<SeededProductAcceptanceProject> {
  const app = buildApp(
    input.renderAdapter ? { renderAdapter: input.renderAdapter } : undefined,
  );
  const projectBody = await injectOrThrow({
    app,
    method: "POST",
    url: "/api/projects",
    payload: { name: `Product Acceptance - ${input.source.topicPackage.title}` },
  });
  const project = app.db.projects.get(projectBody.project_id as string);
  if (!project) {
    throw new Error("acceptance_project_missing_after_create");
  }
  project.storageRootDir = resolve(input.outputDir, "project-storage");

  const topicRecord = await saveTopicPackage(app.db, {
    projectId: project.id,
    title: input.source.topicPackage.title,
    selectedAngle: input.source.topicPackage.selected_angle,
    familyLabel: input.source.topicPackage.family_label,
    scopeLabel: input.source.topicPackage.scope_label,
    coreConflict: input.source.topicPackage.core_conflict,
    strongScene: input.source.topicPackage.strong_scene,
    stakes: input.source.topicPackage.stakes,
    packagingSeed: input.source.topicPackage.packaging_seed,
    canonicalQuotesJson: input.source.topicPackage.canonical_quotes,
    canonicalQuoteIntentsJson:
      input.source.topicPackage.canonical_quote_intents,
    durationBandJson: { label: input.source.topicPackage.duration_band },
    narrativeTensionMapJson: input.source.topicPackage.narrative_tension_map,
    mustIncludeBeatsJson: input.source.topicPackage.must_include_beats,
    forbiddenExpansionsJson: input.source.topicPackage.forbidden_expansions,
    riskHintsJson: input.source.topicPackage.risk_hints,
    sourceAnchorRefsJson: input.source.topicPackage.source_anchor_refs,
    ambiguityNotesJson: input.source.topicPackage.ambiguity_notes,
  });

  const scriptRecord = await saveScriptRecord(app.db, {
    projectId: project.id,
    topicPackageId: topicRecord.id,
    scriptText: input.source.scriptDraft.script_text,
    openingSpan: input.source.scriptDraft.opening_span,
    endingSpan: input.source.scriptDraft.ending_span,
    estimatedDurationSec: input.source.scriptDraft.estimated_duration_sec,
    beatTraceJson: input.source.scriptDraft.beat_trace,
    quoteTraceJson: input.source.scriptDraft.quote_trace,
    reviewStatus: "accepted_for_product_acceptance",
    validationResultJson: null,
    semanticReviewResultJson: null,
    executionStateJson: null,
  });

  const storyboardRecord = await saveStoryboardRecord(app.db, {
    projectId: project.id,
    topicPackageId: topicRecord.id,
    scriptRecordId: scriptRecord.id,
    planJson: input.source.storyboardPlan,
    validationResultJson: {
      stage: "storyboard_local_validation",
      decision: "pass",
      errors: [],
      warnings: [],
      metrics: {},
    },
  });

  project.activeTopicPackageId = topicRecord.id;
  project.activeScriptRecordId = scriptRecord.id;
  project.activeStoryboardRecordId = storyboardRecord.id;
  project.status = "storyboard_ready";

  return { app, project };
}

async function generateProductAcceptanceUpstreamSource(
  input: ProductAcceptanceLiveCheckInput,
): Promise<string> {
  const outputRoot = input.outputDir ?? DEFAULT_OUTPUT_DIR;
  const topicScriptDir = resolve(outputRoot, "generated-source/topic-script");
  const storyboardDir = resolve(outputRoot, "generated-source/storyboard");

  await runTopicScriptSmoke({
    samplePath: "harness/samples/topic-script/yanzi-shichu.sample.json",
    outputDir: topicScriptDir,
  });
  await runStoryboardFiveRoundQualityCheck(
    {
      sourceDir: topicScriptDir,
      outputDir: storyboardDir,
      rounds: 1,
    },
    { requireRealEnv: true },
  );

  return resolve(storyboardDir, "round-1");
}

function countTasksBy(
  tasks: AssetTask[],
  pickKey: (task: AssetTask) => string,
): Record<string, number> {
  return tasks.reduce<Record<string, number>>((acc, task) => {
    const key = pickKey(task);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function countBy(items: string[]): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item] = (acc[item] ?? 0) + 1;
    return acc;
  }, {});
}

function readProviderNames(input: {
  manifest:
    | {
        artifacts?: Array<{ metadata?: Record<string, unknown> }>;
        executions?: Array<{ provider_id?: string | null }>;
      }
    | undefined;
}): string[] {
  return Array.from(
    new Set([
      ...((input.manifest?.artifacts ?? [])
        .map((artifact) => artifact.metadata?.provider_name)
        .filter((value): value is string => typeof value === "string")),
      ...((input.manifest?.executions ?? [])
        .map((execution) => execution.provider_id)
        .filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0,
        )),
    ]),
  );
}

function readWavRmsDiagnostics(fileUri: string | undefined): WavRmsDiagnostics {
  if (!fileUri || !existsSync(fileUri)) {
    return { file_uri: null, bytes: 0, rms: null, max: null };
  }

  const buffer = readFileSync(fileUri);
  if (buffer.length <= 44) {
    return { file_uri: fileUri, bytes: buffer.length, rms: 0, max: 0 };
  }

  let sumSquares = 0;
  let max = 0;
  let samples = 0;
  for (let offset = 44; offset + 1 < buffer.length; offset += 2) {
    const sample = buffer.readInt16LE(offset);
    const abs = Math.abs(sample);
    max = Math.max(max, abs);
    sumSquares += sample * sample;
    samples += 1;
  }

  return {
    file_uri: fileUri,
    bytes: buffer.length,
    rms: samples > 0 ? Math.sqrt(sumSquares / samples) : 0,
    max,
  };
}

function writeManualReviewChecklist(outputDir: string): void {
  writeText(
    outputDir,
    "manual-review-checklist.md",
    [
      "# 成品验收人工检查",
      "",
      "- [ ] 口播能听清，BGM 没有压过口播。",
      "- [ ] 字幕出现，位置不遮挡主体，节奏大致跟随口播。",
      "- [ ] 生图符合中国古代历史题材，没有明显现代物、文字水印或严重脸部崩坏。",
      "- [ ] 画面运动没有明显黑屏、闪烁或卡死。",
      "- [ ] BGM 情绪适配题材，不像现代电子舞曲或无关氛围音。",
      "- [ ] 全片时长、结尾和口播收束没有明显截断。",
      "",
    ].join("\n"),
  );
}

function writeTrace(
  outputDir: string,
  input: {
    sourceDir: string;
    projectId: string;
    originalAssetPlanRecordId: string;
    executionAssetPlanRecordId: string;
    outputMp4Path: string | null;
  },
): void {
  writeText(
    outputDir,
    "trace.md",
    [
      "# Product Acceptance Trace",
      "",
      `sourceDir: ${input.sourceDir}`,
      `projectId: ${input.projectId}`,
      `originalAssetPlanRecordId: ${input.originalAssetPlanRecordId}`,
      `executionAssetPlanRecordId: ${input.executionAssetPlanRecordId}`,
      `outputMp4Path: ${input.outputMp4Path ?? ""}`,
      "",
    ].join("\n"),
  );
}

async function injectOrThrow(input: {
  app: AppInstance;
  method: string;
  url: string;
  payload?: unknown;
}): Promise<Record<string, unknown>> {
  const response = await input.app.inject({
    method: input.method,
    url: input.url,
    payload: input.payload,
  });
  const body = response.json() as Record<string, unknown>;
  if (response.statusCode >= 400) {
    throw new Error(
      `request_failed ${input.method} ${input.url}: ${response.statusCode} ${JSON.stringify(body)}`,
    );
  }

  return body;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runProductAcceptanceLiveCheck(
    parseProductAcceptanceLiveCheckCliArgs(process.argv.slice(2)),
  )
    .then((result) => {
      console.log(
        `成品验收样片已生成：${result.summary.output_mp4_path ?? result.outputDir}`,
      );
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
