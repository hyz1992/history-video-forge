import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import {
  registerManualArtifact,
  runAssetsGeneration,
} from "../../../backend/src/modules/assets/assets-run.service.js";
import type { AssetManifest, AssetPlan } from "../../../shared/src/index.js";

const TOPIC_PACKAGE_ID = "topic_001";
const SCRIPT_RECORD_ID = "script_001";
const STORYBOARD_RECORD_ID = "storyboard_001";
const ASSET_PLAN_RECORD_ID = "asset_plan_001";

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
      voice_profile_id: "voice_plan",
      estimated_total_duration_sec: 12,
      chunking_strategy: "segment_boundary",
      chunks: [
        {
          chunk_id: "tts_001",
          order: 0,
          script_excerpt: "Narration for segment one.",
          estimated_duration_sec: 12,
        },
      ],
    },
    tasks: [
      {
        task_id: "img_001",
        order: 0,
        task_type: "image_still",
        source_segment_id: "sb_001",
        source_excerpt: "Image source excerpt.",
        production_intent: "Create the segment anchor image.",
        recommended_mode: "manual_allowed",
        provider_hint: "image_provider",
        prompt_draft: "Ancient court image.",
        parameters: {},
        manual_upload_policy: {
          allowed: true,
          required: false,
          accepted_file_types: ["image/png"],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
    ],
    dependencies: [],
    cost_summary: {
      total_tasks: 1,
      by_type: { image_still: 1 },
      by_cost_tier: { low: 1 },
      estimated_provider_calls: 1,
      notes: [],
    },
    global_production_notes: [],
  };
}

async function prepareProjectWithAssetPlan() {
  const db = createDbClient();
  const project = await createProject(db, { name: "assets service test" });
  project.activeAssetPlanRecordId = ASSET_PLAN_RECORD_ID;
  project.status = "asset_plan_ready";

  db.storyboardRecords.set(STORYBOARD_RECORD_ID, {
    id: STORYBOARD_RECORD_ID,
    projectId: project.id,
    topicPackageId: TOPIC_PACKAGE_ID,
    scriptRecordId: SCRIPT_RECORD_ID,
    planJson: {
      segments: [
        {
          segment_id: "sb_001",
        },
      ],
    },
    validationResultJson: {},
    executionStateJson: null,
    graphTraceSummaryJson: null,
    runtimeDiagnosticsJson: null,
    createdAt: new Date(),
  });

  db.assetPlanRecords.set(ASSET_PLAN_RECORD_ID, {
    id: ASSET_PLAN_RECORD_ID,
    projectId: project.id,
    topicPackageId: TOPIC_PACKAGE_ID,
    scriptRecordId: SCRIPT_RECORD_ID,
    storyboardRecordId: STORYBOARD_RECORD_ID,
    planJson: makeAssetPlan(),
    validationResultJson: {
      stage: "asset_planning_local_validation",
      decision: "pass",
      errors: [],
      warnings: [],
      metrics: {},
    },
    executionStateJson: {},
    graphTraceSummaryJson: null,
    runtimeDiagnosticsJson: null,
    createdAt: new Date(),
  });

  return { db, project };
}

describe("assets run service integration", () => {
  it("writes request execution options into the manifest and stored trace", async () => {
    const { db, project } = await prepareProjectWithAssetPlan();

    const response = await runAssetsGeneration({
      db,
      project,
      voiceProfileId: "voice_custom",
      executionMode: "dry_run",
    });

    expect(response.statusCode).toBe(200);
    const body = response.body as {
      manifest: AssetManifest;
      graph_trace_summary: unknown;
    };

    expect(body.manifest.execution_options).toMatchObject({
      execution_mode: "dry_run",
      voice_profile_id: "voice_custom",
    });
    expect(body.graph_trace_summary).toMatchObject({
      phase: "assets",
    });

    const manifestRecord = db.assetManifestRecords.get(
      project.activeAssetManifestRecordId!,
    );
    expect(manifestRecord?.graphTraceSummaryJson).toMatchObject({
      phase: "assets",
    });
  });

  it("registers a manual image artifact into the segment route before revalidation", async () => {
    const { db, project } = await prepareProjectWithAssetPlan();

    await runAssetsGeneration({
      db,
      project,
      voiceProfileId: "voice_plan",
      executionMode: "auto_available",
    });

    const response = await registerManualArtifact({
      db,
      project,
      taskId: "img_001",
      artifactType: "image",
      fileUri: "manual://image.png",
      mimeType: "image/png",
      metadata: { width: 1080, height: 1920 },
    });

    expect(response.statusCode).toBe(200);
    const body = response.body as {
      manifest: AssetManifest;
      local_validation: { errors: string[] };
    };
    const route = body.manifest.segment_routes.find(
      (item) => item.segment_id === "sb_001",
    );

    expect(route?.primary_visual_artifact_id).toBeDefined();
    expect(route?.primary_visual_artifact_id).toContain("artifact_manual_");
    expect(body.local_validation.errors).not.toContain(
      "assets_segment_visual_missing",
    );
  });

  it("rejects manual artifacts that do not match the shared artifact schema", async () => {
    const { db, project } = await prepareProjectWithAssetPlan();

    await runAssetsGeneration({
      db,
      project,
      voiceProfileId: "voice_plan",
      executionMode: "auto_available",
    });

    const response = await registerManualArtifact({
      db,
      project,
      taskId: "img_001",
      artifactType: "image",
      fileUri: "manual://bad",
      mimeType: "image/png",
      metadata: {},
    });

    expect(response.statusCode).toBe(422);
    expect(response.body).toMatchObject({
      error: "asset_manual_artifact_invalid",
    });
  });
});
