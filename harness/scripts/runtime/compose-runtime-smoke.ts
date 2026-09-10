import { pathToFileURL } from "node:url";
import { buildPricingCatalogSeed } from "../../../backend/src/modules/generation-cost/pricing-catalog.seed.js";
import { seedGlobalVoiceProfiles } from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";
import { createAuthenticatedAuthContext } from "../../../backend/src/auth/auth-context.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildApp } from "../../../backend/src/app";
import { createLegacyProject } from "../../../tests/backend/projects/legacy-project.fixture.js";
import { saveAssetPlanRecord } from "../../../backend/src/modules/asset-planning/asset-plan-record.repository";
import type { AssetPlan } from "../../../shared/src/index.js";

const TOPIC_PACKAGE_ID = "topic_compose_smoke_001";
const SCRIPT_RECORD_ID = "script_compose_smoke_001";
const STORYBOARD_RECORD_ID = "storyboard_compose_smoke_001";

export interface RunComposeRuntimeSmokeInput {
  outputDir?: string;
}

export interface RunComposeRuntimeSmokeResult {
  outputDir: string;
  status: {
    generatedAt: string;
    status: "sample-ready";
    stage: "assets-to-compose";
    projectId: string;
    outputDir: string;
    activeAssetsAfterFirstRun: string | null;
    activeComposeAfterGenerate: string | null;
    activeAssetsAfterRefresh: string | null;
    activeComposeAfterAssetsRefresh: string | null;
  };
}

function writeJson(outputDir: string, filename: string, value: unknown) {
  writeFileSync(resolve(outputDir, filename), JSON.stringify(value, null, 2), "utf8");
}

function makeAssetPlan(input: { assetPlanRecordId: string }): AssetPlan {
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
      voice_profile_id: "voice_compose_smoke",
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
    ],
    dependencies: [],
    cost_summary: {
      total_tasks: 3,
      by_type: {
        tts_audio: 1,
        subtitle_track: 1,
        image_still: 1,
      },
      by_cost_tier: {
        low: 3,
      },
      estimated_provider_calls: 3,
      notes: [],
    },
    global_production_notes: [],
  };
}

async function seedActiveAssetPlan(input: {
  app: ReturnType<typeof buildApp>;
  projectId: string;
}) {
  const { app, projectId } = input;
  const assetPlanRecordId = `asset_plan_compose_smoke_${app.db.generateId()}`;
  const assetPlan = makeAssetPlan({ assetPlanRecordId });

  app.db.storyboardRecords.set(STORYBOARD_RECORD_ID, {
    id: STORYBOARD_RECORD_ID,
    projectId,
    topicPackageId: TOPIC_PACKAGE_ID,
    scriptRecordId: SCRIPT_RECORD_ID,
    planJson: {
      plan_version: "storyboard_v1",
      source_script_record_id: SCRIPT_RECORD_ID,
      source_topic_package_id: TOPIC_PACKAGE_ID,
      segments: [
        {
          segment_id: "sb_001",
          start_sec: 0,
          end_sec: 12,
          script_excerpt: "A tense public answer changes the room.",
          scene_description: "A court hall freezes after the answer.",
          visual_intent: "public pressure",
          camera_plan: "slow push in",
          on_screen_text: null,
          asset_brief: "ancient court",
          continuity_notes: [],
          trace_refs: [],
        },
      ],
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
    // S1-3 授权合同：POST /api/projects 等路由要求认证用户；harness 烟测
    // 使用固定测试用户（与 tests/backend/api 惯例一致），非真实登录。
    auth: createAuthenticatedAuthContext({
      userId: "smoke-owner",
      username: "smoke-owner",
      displayName: "Smoke Owner",
      role: "ADMIN",
      sessionId: "smoke-session",
    }),
  });

  if (response.statusCode >= 400) {
    throw new Error(
      `request_failed ${input.method} ${input.url}: ${response.statusCode} ${JSON.stringify(response.json())} ${JSON.stringify([...input.app.db.generationRunEvents.values()].flat().filter(e=>e.eventType==="dispatch_failed").map(e=>(e.eventJson as {message?:string}).message))}`,
    );
  }

  return response.json();
}

export async function runComposeRuntimeSmoke(
  input: RunComposeRuntimeSmokeInput = {},
): Promise<RunComposeRuntimeSmokeResult> {
  const finalOutputDir =
    input.outputDir ?? resolve(process.cwd(), "harness/scripts/runtime/output/compose-runtime-smoke");
  mkdirSync(finalOutputDir, { recursive: true });

  const app = buildApp({storageBaseDir:resolve(finalOutputDir,"app"),skipSnapshotLoad:true});
  for(const row of buildPricingCatalogSeed({llm:{mode:"stub"},media:{deploymentScope:"cn-beijing"}}))app.db.providerModelCatalog.set(row.id,row);
  await seedGlobalVoiceProfiles(app.db);
  // 口播前置定版后创建入口为 narration 模式；本冒烟驱动 legacy 资产生成→合成链路，
  // 经 legacy 测试夹具直造项目。
  const legacyProject = await createLegacyProject(app.db, { name: "Compose Runtime Smoke", ownerId: "smoke-owner" });
  const projectId = legacyProject.id;
  const project = app.db.projects.get(projectId);
  if (!project) {
    throw new Error("project_missing_after_create");
  }
  project.storageRootDir = resolve(finalOutputDir, "project-storage");

  await seedActiveAssetPlan({ app, projectId });

  const firstAssetsBody = await injectOrThrow({
    app,
    method: "POST",
    url: `/api/projects/${projectId}/assets/generate`,
    payload: {
      execution_mode: "auto_available",
    },
  });
  writeJson(finalOutputDir, "assets-response.json", firstAssetsBody);
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

  const refreshAssetsBody = await injectOrThrow({
    app,
    method: "POST",
    url: `/api/projects/${projectId}/assets/generate`,
    payload: {
      execution_mode: "auto_available",
    },
  });
  writeJson(finalOutputDir, "assets-refresh-response.json", refreshAssetsBody);
  const refreshSnapshot = await injectOrThrow({
    app,
    method: "GET",
    url: `/api/projects/${projectId}`,
  });
  writeJson(finalOutputDir, "assets-refresh-snapshot.json", refreshSnapshot);

  const generatedAt = new Date().toISOString();
  const status = {
    generatedAt,
    status: "sample-ready" as const,
    stage: "assets-to-compose" as const,
    projectId,
    outputDir: finalOutputDir,
    activeAssetsAfterFirstRun:
      (assetsSnapshot.active_assets?.asset_manifest_record_id as string | undefined) ??
      null,
    activeComposeAfterGenerate:
      (composeSnapshot.active_compose?.compose_record_id as string | undefined) ??
      null,
    activeAssetsAfterRefresh:
      (refreshSnapshot.active_assets?.asset_manifest_record_id as string | undefined) ??
      null,
    activeComposeAfterAssetsRefresh:
      (refreshSnapshot.active_compose?.compose_record_id as string | undefined) ??
      null,
  };

  writeJson(finalOutputDir, "status.json", status);
  writeFileSync(
    resolve(finalOutputDir, "trace.md"),
    [
      "# compose runtime smoke trace",
      "",
      `- project_id: ${projectId}`,
      `- generated_at: ${generatedAt}`,
      "- flow: create-project -> seed-active-asset-plan -> assets-generate -> compose-generate -> snapshot -> assets-generate -> snapshot",
      `- active_assets_after_first_run: ${status.activeAssetsAfterFirstRun ?? "null"}`,
      `- active_compose_after_generate: ${status.activeComposeAfterGenerate ?? "null"}`,
      `- active_assets_after_refresh: ${status.activeAssetsAfterRefresh ?? "null"}`,
      `- active_compose_after_assets_refresh: ${status.activeComposeAfterAssetsRefresh ?? "null"}`,
      "",
      "## Notes",
      "",
      "- This smoke uses fake/local asset providers only.",
      "- It verifies that a refreshed active asset manifest invalidates the stale active compose pointer.",
    ].join("\n"),
    "utf8",
  );

  return {
    outputDir: finalOutputDir,
    status,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runComposeRuntimeSmoke()
    .then((result) => {
      console.log(JSON.stringify(result.status, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
