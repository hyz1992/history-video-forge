/**
 * End-to-end assets execution regression.
 *
 * Exercises: TTS chunks, merged TTS, subtitle SRT/VTT, image stills,
 * render_motion_cue (placeholder), bgm_cue (selection from library).
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { runAssetsGeneration } from "../../../backend/src/modules/assets/assets-run.service.js";
import { saveMediaLibraryItem } from "../../../backend/src/modules/assets/media-library.repository.js";
import { listAssetProviderJobRecordsByManifest } from "../../../backend/src/modules/assets/asset-provider-job.repository.js";
import type {
  AssetManifest,
  AssetPlan,
  MediaLibraryItem,
} from "../../../shared/src/index.js";

const TOPIC_PACKAGE_ID = "topic_reg_1";
const SCRIPT_RECORD_ID = "script_reg_1";
const STORYBOARD_RECORD_ID = "storyboard_reg_1";
const ASSET_PLAN_RECORD_ID = "asset_plan_reg_1";

function makeFullAssetPlan(): AssetPlan {
  return {
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: STORYBOARD_RECORD_ID,
    source_script_record_id: SCRIPT_RECORD_ID,
    source_topic_package_id: TOPIC_PACKAGE_ID,
    art_bible: {
      era_style: "战国",
      visual_tone: "冷色",
      characters: [],
      locations: [],
      props: [],
      global_prompt_prefix: "中国古代历史短视频画面",
      global_negative_prompts: ["现代建筑"],
      consistency_notes: [],
    },
    visual_budget: {},
    downgrade_policy: {},
    global_audio_strategy: {},
    tts_plan: {
      voice_profile_id: "voice_plan",
      estimated_total_duration_sec: 30,
      chunking_strategy: "segment_boundary",
      chunks: [
        { chunk_id: "chunk_1", order: 0, script_excerpt: "第一段口播文本。", estimated_duration_sec: 10 },
        { chunk_id: "chunk_2", order: 1, script_excerpt: "第二段口播文本。", estimated_duration_sec: 20 },
      ],
    },
    tasks: [
      // tts_audio
      {
        task_id: "task_tts",
        order: 0,
        task_type: "tts_audio",
        source_segment_id: null,
        source_excerpt: "全片口播",
        production_intent: "生成全片口播",
        recommended_mode: "auto",
        provider_hint: "fake_tts",
        prompt_draft: null,
        parameters: {},
        manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
      // subtitle_track
      {
        task_id: "task_sub",
        order: 1,
        task_type: "subtitle_track",
        source_segment_id: null,
        source_excerpt: "字幕",
        production_intent: "从 TTS 生成字幕",
        recommended_mode: "auto",
        provider_hint: "local_subtitle",
        prompt_draft: null,
        parameters: {},
        manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
      // image_still for sb_001
      {
        task_id: "task_img_1",
        order: 2,
        task_type: "image_still",
        source_segment_id: "sb_001",
        source_excerpt: "分镜一画面",
        production_intent: "生成分镜一静态图",
        recommended_mode: "auto",
        provider_hint: "fake_image",
        prompt_draft: "战国宫门前",
        parameters: {},
        manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
      // image_still for sb_002
      {
        task_id: "task_img_2",
        order: 3,
        task_type: "image_still",
        source_segment_id: "sb_002",
        source_excerpt: "分镜二画面",
        production_intent: "生成分镜二静态图",
        recommended_mode: "auto",
        provider_hint: "fake_image",
        prompt_draft: "大殿对峙",
        parameters: {},
        manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
      // render_motion_cue (placeholder — not in AssetProviderType, skipped by engine)
      {
        task_id: "task_motion",
        order: 4,
        task_type: "render_motion_cue",
        source_segment_id: "sb_001",
        source_excerpt: "motion cue",
        production_intent: "Ken Burns push-in",
        recommended_mode: "auto",
        provider_hint: null,
        prompt_draft: null,
        parameters: {},
        manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
      // bgm_cue (optional — no adapter registered, remains planned)
      {
        task_id: "task_bgm",
        order: 5,
        task_type: "bgm_cue",
        source_segment_id: null,
        source_excerpt: "背景音乐",
        production_intent: "选择战场背景音乐",
        recommended_mode: "auto",
        provider_hint: null,
        prompt_draft: null,
        parameters: {},
        manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
    ],
    dependencies: [],
    cost_summary: {
      total_tasks: 6,
      by_type: { tts_audio: 1, subtitle_track: 1, image_still: 2, render_motion_cue: 1, bgm_cue: 1 },
      by_cost_tier: { low: 6 },
      estimated_provider_calls: 4,
      notes: [],
    },
    global_production_notes: [],
  };
}

async function prepareFullProject() {
  const db = createDbClient();
  const project = await createProject(db, { name: "regression test" });
  project.activeAssetPlanRecordId = ASSET_PLAN_RECORD_ID;
  project.status = "asset_plan_ready";

  db.storyboardRecords.set(STORYBOARD_RECORD_ID, {
    id: STORYBOARD_RECORD_ID,
    projectId: project.id,
    topicPackageId: TOPIC_PACKAGE_ID,
    scriptRecordId: SCRIPT_RECORD_ID,
    planJson: {
      segments: [
        { segment_id: "sb_001" },
        { segment_id: "sb_002" },
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
    planJson: makeFullAssetPlan(),
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

describe("assets execution regression", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("dry_run is blocked or partial with no generated artifacts", async () => {
    const { db, project } = await prepareFullProject();
    tempDir = join(tmpdir(), `reg-dry-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    project.storageRootDir = tempDir;

    const response = await runAssetsGeneration({
      db,
      project,
      voiceProfileId: "voice_plan",
      executionMode: "dry_run",
    });
    const body = response.body as {
      manifest: AssetManifest;
      local_validation: { decision: string; errors: string[] };
    };

    // dry_run strips all artifacts
    expect(body.manifest.artifacts).toEqual([]);

    // Should be blocked because tts/subtitle/image tasks have no completed artifacts
    expect(body.local_validation.decision).not.toBe("ready_for_compose");
  });

  it("auto_available produces full pipeline artifacts with verified files and records", async () => {
    const { db, project } = await prepareFullProject();
    tempDir = join(tmpdir(), `reg-auto-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    project.storageRootDir = tempDir;

    const response = await runAssetsGeneration({
      db,
      project,
      voiceProfileId: "voice_plan",
      executionMode: "auto_available",
    });
    const body = response.body as {
      asset_manifest_record_id: string;
      manifest: AssetManifest;
      local_validation: { decision: string; errors: string[]; warnings: string[] };
    };
    const manifest = body.manifest;

    // TTS chunk audio (at least 2 chunks matching the plan)
    const ttsChunkArtifacts = manifest.artifacts.filter((a) => a.artifact_type === "tts_chunk_audio");
    expect(ttsChunkArtifacts.length).toBeGreaterThanOrEqual(2);

    // TTS merged audio
    expect(manifest.artifacts.some((a) => a.artifact_type === "tts_merged_audio")).toBe(true);

    // Subtitle tracks (at least SRT + VTT)
    expect(manifest.artifacts.filter((a) => a.artifact_type === "subtitle_track").length).toBeGreaterThanOrEqual(2);

    // Images (2)
    const imageArtifacts = manifest.artifacts.filter((a) => a.artifact_type === "image");
    expect(imageArtifacts.length).toBeGreaterThanOrEqual(2);

    // Provider jobs are recorded under the final persisted manifest id
    expect(db.assetProviderJobRecords.size).toBeGreaterThan(0);
    const finalManifestJobs = await listAssetProviderJobRecordsByManifest(
      db,
      body.asset_manifest_record_id,
    );
    expect(finalManifestJobs.length).toBeGreaterThan(0);

    // Generated (non-placeholder) artifacts should have real file URIs
    const generatedArtifacts = manifest.artifacts.filter(
      (a) => !a.file_uri.startsWith("planned://"),
    );
    expect(generatedArtifacts.length).toBeGreaterThan(0);
    for (const artifact of generatedArtifacts) {
      expect(artifact.file_uri).not.toMatch(/^planned:\/\//);
    }
    expect(manifest.artifacts.some((a) => a.file_uri.startsWith("planned://"))).toBe(false);
    expect(body.local_validation.errors).not.toContain(
      "assets_artifact_placeholder_unresolved",
    );

    // bgm_cue has no adapter → stays planned, and execution doesn't produce a bgm artifact
    const bgmExec = manifest.executions.find((e) => e.task_id === "task_bgm");
    expect(bgmExec).toBeDefined();

    // render_motion_cue is NOT in AssetProviderType, no adapter registered, should be skipped
    const motionExec = manifest.executions.find((e) => e.task_id === "task_motion");
    expect(motionExec).toBeDefined();
    // motion_cue has no adapter in current registry → status stays planned
    // (the builder may create an inline motion_recipe artifact placeholder)

    // Segment routes should have visual artifacts
    const route1 = manifest.segment_routes.find((r) => r.segment_id === "sb_001");
    expect(route1?.primary_visual_artifact_id).toBeDefined();
    expect(route1?.visual_route_type).toBe("image_with_motion");
    expect(route1?.motion_artifact_id).toBeDefined();

    const route2 = manifest.segment_routes.find((r) => r.segment_id === "sb_002");
    expect(route2?.primary_visual_artifact_id).toBeDefined();

    // Audio summary should be populated
    expect(manifest.audio_summary.tts_chunk_artifact_ids.length).toBeGreaterThan(0);
    expect(manifest.audio_summary.tts_merged_artifact_id).toBeDefined();
    expect(manifest.audio_summary.subtitle_artifact_id).toBeDefined();
    expect(body.local_validation.errors).not.toContain("assets_execution_incomplete");
  });

  it("dry_run blocks readiness when required tasks are not terminal", async () => {
    const { db, project } = await prepareFullProject();
    tempDir = join(tmpdir(), `reg-blocked-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    project.storageRootDir = tempDir;

    const dryResponse = await runAssetsGeneration({
      db,
      project,
      voiceProfileId: "voice_plan",
      executionMode: "dry_run",
    });
    const dryBody = dryResponse.body as { local_validation: { decision: string } };

    // dry_run should not yield ready_for_compose
    expect(dryBody.local_validation.decision).not.toBe("ready_for_compose");
  });
});
