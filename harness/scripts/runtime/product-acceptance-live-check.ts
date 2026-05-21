import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildApp, type AppInstance } from "../../../backend/src/app";
import type { ProjectRecord } from "../../../backend/src/db/client";
import { saveScriptRecord } from "../../../backend/src/modules/script/script-record.repository";
import { saveStoryboardRecord } from "../../../backend/src/modules/storyboard/storyboard-record.repository";
import { saveTopicPackage } from "../../../backend/src/modules/topic/topic-package.repository";
import {
  ScriptDraftPackage,
  StoryboardPlan,
  TopicPackage,
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

const DEFAULT_OUTPUT_DIR = resolve(
  process.cwd(),
  "harness/scripts/runtime/output/product-acceptance-live-check",
);

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

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8"));
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
