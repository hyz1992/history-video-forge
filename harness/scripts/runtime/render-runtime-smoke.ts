import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildApp } from "../../../backend/src/app";
import { saveAssetPlanRecord } from "../../../backend/src/modules/asset-planning/asset-plan-record.repository";
import { DEFAULT_AUDIO_LIBRARY_ITEMS } from "../../../backend/src/modules/assets/default-audio-library";
import { saveMediaLibraryItem } from "../../../backend/src/modules/assets/media-library.repository";
import { createFakeRenderAdapter } from "../../../backend/src/modules/render/fake-render-adapter";
import { createLocalRemotionRenderAdapter } from "../../../backend/src/modules/render/local-remotion-render-adapter";
import type { RenderAdapter } from "../../../backend/src/modules/render/render-adapter";
import type { AssetPlan } from "../../../shared/src/index.js";

const TOPIC_PACKAGE_ID = "topic_render_smoke_001";
const SCRIPT_RECORD_ID = "script_render_smoke_001";
const STORYBOARD_RECORD_ID = "storyboard_render_smoke_001";

export interface RunRenderRuntimeSmokeInput {
  adapter?: "fake" | "remotion";
  outputDir?: string;
}

export interface RunRenderRuntimeSmokeResult {
  outputDir: string;
  status: {
    generatedAt: string;
    status: "sample-ready";
    stage: "compose-to-render";
    projectId: string;
    outputDir: string;
    activeAssetsAfterGenerate: string | null;
    activeComposeAfterGenerate: string | null;
    activeRenderAfterGenerate: string | null;
    activeComposeAfterRefresh: string | null;
    activeRenderAfterComposeRefresh: string | null;
  };
}

function writeJson(outputDir: string, filename: string, value: unknown) {
  writeFileSync(resolve(outputDir, filename), JSON.stringify(value, null, 2), "utf8");
}

function makeAssetPlan(): AssetPlan {
  return {
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: STORYBOARD_RECORD_ID,
    source_script_record_id: SCRIPT_RECORD_ID,
    source_topic_package_id: TOPIC_PACKAGE_ID,
    art_bible: {
      era_style: "ancient court",
      visual_tone: "tense",
      characters: [],
      locations: [],
      props: [],
      global_prompt_prefix: "ancient Chinese historical short video",
      global_negative_prompts: [],
      consistency_notes: [],
    },
    visual_budget: {},
    downgrade_policy: {},
    global_audio_strategy: {},
    tts_plan: {
      voice_profile_id: "voice_render_smoke",
      estimated_total_duration_sec: 12,
      chunking_strategy: "segment_boundary",
      chunks: [
        {
          chunk_id: "tts_001",
          order: 0,
          script_excerpt: "A tense public answer changes the room.",
          estimated_duration_sec: 12,
        },
      ],
    },
    tasks: [
      {
        task_id: "tts_001",
        order: 0,
        task_type: "tts_audio",
        source_segment_id: null,
        source_excerpt: "A tense public answer changes the room.",
        production_intent: "Generate narration audio.",
        recommended_mode: "auto",
        provider_hint: "fake_tts",
        prompt_draft: null,
        parameters: {},
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
      {
        task_id: "sub_001",
        order: 1,
        task_type: "subtitle_track",
        source_segment_id: null,
        source_excerpt: "A tense public answer changes the room.",
        production_intent: "Generate subtitle track from TTS.",
        recommended_mode: "auto",
        provider_hint: "local_subtitle",
        prompt_draft: null,
        parameters: {},
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
      {
        task_id: "img_001",
        order: 2,
        task_type: "image_still",
        source_segment_id: "sb_001",
        source_excerpt: "The envoy faces the hall.",
        production_intent: "Create the segment anchor image.",
        recommended_mode: "auto",
        provider_hint: "fake_image",
        prompt_draft: "Ancient court, tense public confrontation.",
        parameters: {},
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
      {
        task_id: "sfx_001",
        order: 3,
        task_type: "sfx_cue",
        source_segment_id: "sb_001",
        source_excerpt: "A sharp hit lands in the court.",
        production_intent: "Add a short impact sound effect.",
        recommended_mode: "auto",
        provider_hint: "local_sfx",
        prompt_draft: null,
        parameters: {
          sfx_tags: ["hit"],
          mood_tags: ["sharp", "impact"],
        },
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
      {
        task_id: "bgm_001",
        order: 4,
        task_type: "bgm_cue",
        source_segment_id: null,
        source_excerpt: "Tense background bed.",
        production_intent: "Add restrained background music.",
        recommended_mode: "auto",
        provider_hint: "local_bgm",
        prompt_draft: null,
        parameters: {
          required_tags: ["background", "drone"],
          mood_tags: ["tense", "dark"],
          scope: "global",
          volume: 0.25,
          fade_in_sec: 1,
          fade_out_sec: 1,
        },
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
    ],
    dependencies: [],
    cost_summary: {
      total_tasks: 5,
      by_type: {
        tts_audio: 1,
        subtitle_track: 1,
        image_still: 1,
        sfx_cue: 1,
        bgm_cue: 1,
      },
      by_cost_tier: {
        low: 5,
      },
      estimated_provider_calls: 5,
      notes: [],
    },
    global_production_notes: [],
  };
}

async function seedSmokeMediaLibrary(app: ReturnType<typeof buildApp>) {
  for (const item of DEFAULT_AUDIO_LIBRARY_ITEMS) {
    await saveMediaLibraryItem(app.db, item);
  }
}

async function seedActiveAssetPlan(input: {
  app: ReturnType<typeof buildApp>;
  projectId: string;
}) {
  const { app, projectId } = input;
  const assetPlanRecordId = `asset_plan_render_smoke_${app.db.generateId()}`;
  const assetPlan = makeAssetPlan();

  app.db.storyboardRecords.set(STORYBOARD_RECORD_ID, {
    id: STORYBOARD_RECORD_ID,
    projectId,
    topicPackageId: TOPIC_PACKAGE_ID,
    scriptRecordId: SCRIPT_RECORD_ID,
    planJson: {
      plan_version: "storyboard_v1",
      source_script_record_id: SCRIPT_RECORD_ID,
      source_topic_package_id: TOPIC_PACKAGE_ID,
      estimated_total_duration_sec: 12,
      segments: [
        {
          segment_id: "sb_001",
          order: 0,
          script_excerpt: "A tense public answer changes the room.",
          start_hint_sec: 0,
          end_hint_sec: 12,
          narrative_role: "opening",
          visual_intent: "public pressure",
          scene_description: "A court hall freezes after the answer.",
          visual_elements: ["envoy", "court hall"],
          framing_hint: "medium",
          content_type: "live_action",
          motion_hint: "push_in",
          editing_hint: "single",
          on_screen_text: [],
          linked_beats: ["public answer"],
          linked_quotes: [],
          risk_notes: [],
        },
      ],
      global_visual_notes: [],
    },
    validationResultJson: {
      stage: "storyboard_local_validation",
      decision: "pass",
      errors: [],
      warnings: [],
      metrics: {},
    },
    executionStateJson: null,
    graphTraceSummaryJson: null,
    runtimeDiagnosticsJson: null,
    createdAt: new Date(),
  });

  const assetPlanRecord = await saveAssetPlanRecord(app.db, {
    id: assetPlanRecordId,
    projectId,
    topicPackageId: TOPIC_PACKAGE_ID,
    scriptRecordId: SCRIPT_RECORD_ID,
    storyboardRecordId: STORYBOARD_RECORD_ID,
    planJson: assetPlan,
    validationResultJson: {
      stage: "asset_planning_local_validation",
      decision: "pass",
      errors: [],
      warnings: [],
      metrics: {},
    },
    executionStateJson: {
      regenerate_used: false,
    },
    graphTraceSummaryJson: null,
    runtimeDiagnosticsJson: null,
  });

  const project = app.db.projects.get(projectId);
  if (!project) {
    throw new Error("project_missing_after_create");
  }
  project.activeStoryboardRecordId = STORYBOARD_RECORD_ID;
  project.activeAssetPlanRecordId = assetPlanRecord.id;
  project.status = "asset_plan_ready";
}

async function injectOrThrow(input: {
  app: ReturnType<typeof buildApp>;
  method: string;
  url: string;
  payload?: unknown;
}) {
  const response = await input.app.inject({
    method: input.method,
    url: input.url,
    payload: input.payload,
  });

  if (response.statusCode >= 400) {
    throw new Error(
      `request_failed ${input.method} ${input.url}: ${response.statusCode} ${JSON.stringify(response.json())}`,
    );
  }

  return response.json();
}

function alignActiveManifestReadinessForSmoke(input: {
  app: ReturnType<typeof buildApp>;
  projectId: string;
}) {
  const project = input.app.db.projects.get(input.projectId);
  const manifestRecord = project?.activeAssetManifestRecordId
    ? input.app.db.assetManifestRecords.get(project.activeAssetManifestRecordId)
    : null;
  if (!manifestRecord) {
    throw new Error("active_manifest_missing_after_assets_generate");
  }

  const validationDecision = String(
    manifestRecord.validationResultJson.decision ?? "",
  );
  if (validationDecision === "ready_for_compose" || validationDecision === "partial") {
    manifestRecord.manifestJson = {
      ...manifestRecord.manifestJson,
      readiness: "ready_for_compose",
    };
  }
}

function createSmokeRenderAdapter(adapter: "fake" | "remotion"): RenderAdapter {
  if (adapter === "remotion") {
    return createLocalRemotionRenderAdapter();
  }

  return createFakeRenderAdapter();
}

export async function runRenderRuntimeSmoke(
  input: RunRenderRuntimeSmokeInput = {},
): Promise<RunRenderRuntimeSmokeResult> {
  const adapter = input.adapter ?? "fake";

  const finalOutputDir =
    input.outputDir ?? resolve(process.cwd(), "harness/scripts/runtime/output/render-runtime-smoke");
  mkdirSync(finalOutputDir, { recursive: true });

  const app = buildApp({ renderAdapter: createSmokeRenderAdapter(adapter) });
  const projectBody = await injectOrThrow({
    app,
    method: "POST",
    url: "/api/projects",
    payload: {
      name: "Render Runtime Smoke",
    },
  });
  const projectId = projectBody.project_id as string;
  const project = app.db.projects.get(projectId);
  if (!project) {
    throw new Error("project_missing_after_create");
  }
  project.storageRootDir = resolve(finalOutputDir, "project-storage");

  await seedSmokeMediaLibrary(app);
  await seedActiveAssetPlan({ app, projectId });

  const assetsBody = await injectOrThrow({
    app,
    method: "POST",
    url: `/api/projects/${projectId}/assets/generate`,
    payload: {
      voice_profile_id: "voice_render_smoke",
      execution_mode: "auto_available",
    },
  });
  writeJson(finalOutputDir, "assets-response.json", assetsBody);
  alignActiveManifestReadinessForSmoke({ app, projectId });
  const assetsSnapshot = await injectOrThrow({
    app,
    method: "GET",
    url: `/api/projects/${projectId}`,
  });
  writeJson(finalOutputDir, "assets-snapshot.json", assetsSnapshot);

  const composeBody = await injectOrThrow({
    app,
    method: "POST",
    url: `/api/projects/${projectId}/compose/generate`,
    payload: {},
  });
  writeJson(finalOutputDir, "compose-response.json", composeBody);
  const composeSnapshot = await injectOrThrow({
    app,
    method: "GET",
    url: `/api/projects/${projectId}`,
  });
  writeJson(finalOutputDir, "compose-snapshot.json", composeSnapshot);

  const renderBody = await injectOrThrow({
    app,
    method: "POST",
    url: `/api/projects/${projectId}/render/generate`,
    payload: {},
  });
  writeJson(finalOutputDir, "render-response.json", renderBody);
  const renderSnapshot = await injectOrThrow({
    app,
    method: "GET",
    url: `/api/projects/${projectId}`,
  });
  writeJson(finalOutputDir, "render-snapshot.json", renderSnapshot);

  const composeRefreshBody = await injectOrThrow({
    app,
    method: "POST",
    url: `/api/projects/${projectId}/compose/generate`,
    payload: {},
  });
  writeJson(finalOutputDir, "compose-refresh-response.json", composeRefreshBody);
  const composeRefreshSnapshot = await injectOrThrow({
    app,
    method: "GET",
    url: `/api/projects/${projectId}`,
  });
  writeJson(finalOutputDir, "compose-refresh-snapshot.json", composeRefreshSnapshot);

  const generatedAt = new Date().toISOString();
  const status = {
    generatedAt,
    status: "sample-ready" as const,
    stage: "compose-to-render" as const,
    projectId,
    outputDir: finalOutputDir,
    activeAssetsAfterGenerate:
      (assetsSnapshot.active_assets?.asset_manifest_record_id as string | undefined) ??
      null,
    activeComposeAfterGenerate:
      (composeSnapshot.active_compose?.compose_record_id as string | undefined) ??
      null,
    activeRenderAfterGenerate:
      (renderSnapshot.active_render?.render_job_record_id as string | undefined) ??
      null,
    activeComposeAfterRefresh:
      (composeRefreshSnapshot.active_compose?.compose_record_id as string | undefined) ??
      null,
    activeRenderAfterComposeRefresh:
      (composeRefreshSnapshot.active_render?.render_job_record_id as string | undefined) ??
      null,
  };

  writeJson(finalOutputDir, "status.json", status);
  writeFileSync(
    resolve(finalOutputDir, "trace.md"),
    [
      "# render runtime smoke trace",
      "",
      `- project_id: ${projectId}`,
      `- generated_at: ${generatedAt}`,
      "- flow: create-project -> seed-active-asset-plan -> assets-generate -> compose-generate -> render-generate -> snapshot -> compose-generate -> snapshot",
      `- active_assets_after_generate: ${status.activeAssetsAfterGenerate ?? "null"}`,
      `- active_compose_after_generate: ${status.activeComposeAfterGenerate ?? "null"}`,
      `- active_render_after_generate: ${status.activeRenderAfterGenerate ?? "null"}`,
      `- active_compose_after_refresh: ${status.activeComposeAfterRefresh ?? "null"}`,
      `- active_render_after_compose_refresh: ${status.activeRenderAfterComposeRefresh ?? "null"}`,
      "",
      "## Notes",
      "",
      `- This smoke uses fake/local asset providers and the ${adapter} render adapter.`,
      "- It verifies that a refreshed active compose invalidates the stale active render pointer.",
    ].join("\n"),
    "utf8",
  );

  return {
    outputDir: finalOutputDir,
    status,
  };
}

function parseCliArgs(argv: string[]): RunRenderRuntimeSmokeInput {
  const result: RunRenderRuntimeSmokeInput = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--output-dir" && next) {
      result.outputDir = next;
      index += 1;
      continue;
    }

    if (current.startsWith("--adapter=")) {
      result.adapter = current.slice("--adapter=".length) as
        | "fake"
        | "remotion";
      continue;
    }

    if (current === "--adapter" && next) {
      result.adapter = next as "fake" | "remotion";
      index += 1;
      continue;
    }
  }

  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRenderRuntimeSmoke(parseCliArgs(process.argv.slice(2)))
    .then((result) => {
      console.log(JSON.stringify(result.status, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
