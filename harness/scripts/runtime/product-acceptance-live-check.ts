import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildApp, type AppInstance } from "../../../backend/src/app";
import type { ProjectRecord } from "../../../backend/src/db/client";
import { saveAssetPlanRecord } from "../../../backend/src/modules/asset-planning/asset-plan-record.repository";
import { DEFAULT_AUDIO_LIBRARY_ITEMS } from "../../../backend/src/modules/assets/default-audio-library";
import { loadLightweightBgmCatalogItems } from "../../../backend/src/modules/assets/lightweight-audio-catalog-loader";
import { saveMediaLibraryItem } from "../../../backend/src/modules/assets/media-library.repository";
import { saveScriptRecord } from "../../../backend/src/modules/script/script-record.repository";
import { saveStoryboardRecord } from "../../../backend/src/modules/storyboard/storyboard-record.repository";
import { saveTopicPackage } from "../../../backend/src/modules/topic/topic-package.repository";
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

const DEFAULT_OUTPUT_DIR = resolve(
  process.cwd(),
  "harness/scripts/runtime/output/product-acceptance-live-check",
);
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
  generateAssetPlan?: () => Promise<Record<string, unknown>>;
}): Promise<AcceptanceAssetPlanningResult> {
  const rawBody = input.generateAssetPlan
    ? await input.generateAssetPlan()
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

export async function seedProductAcceptanceProject(input: {
  source: ProductAcceptanceSource;
  outputDir: string;
}): Promise<SeededProductAcceptanceProject> {
  const app = buildApp();
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
