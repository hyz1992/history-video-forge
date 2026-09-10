import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createDbClient } from "../../../backend/src/db/client.js";
import { createLegacyProject as createProject } from "../projects/legacy-project.fixture.js";
import type { DbClient, ProjectRecord } from "../../../backend/src/db/client.js";
import { buildInitialAssetManifest } from "../../../backend/src/modules/assets/assets-manifest-builder.js";
import { saveAssetManifestRecord } from "../../../backend/src/modules/assets/asset-manifest-record.repository.js";
import { buildApp, type AppInstance } from "../../../backend/src/app.js";
import { buildTestAuth } from "../auth/test-utils.js";
import { createServer } from "node:http";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const TOPIC_PACKAGE_ID = "topic_001";
const SCRIPT_RECORD_ID = "script_001";
const STORYBOARD_RECORD_ID = "storyboard_001";
const ASSET_PLAN_RECORD_ID = "asset_plan_001";

// Minimal valid 1x1 PNG
const MINIMAL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const TEST_DIR = join(process.cwd(), ".test-upload");

function makeAssetPlanWithImage() {
  return {
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: STORYBOARD_RECORD_ID,
    source_script_record_id: SCRIPT_RECORD_ID,
    source_topic_package_id: TOPIC_PACKAGE_ID,
    art_bible: { era_style: "test", visual_tone: "test", characters: [], locations: [], props: [], global_prompt_prefix: "", global_negative_prompts: [], consistency_notes: [] },
    visual_budget: {},
    downgrade_policy: {},
    global_audio_strategy: {},
    tts_plan: {
      voice_profile_id: "voice_001",
      estimated_total_duration_sec: 20,
      chunking_strategy: "segment_boundary",
      chunks: [{ chunk_id: "chunk_1", order: 0, script_excerpt: "旁白", estimated_duration_sec: 20 }],
    },
    tasks: [
      {
        task_id: "tts_001", order: 0, task_type: "tts_audio",
        source_segment_id: null, source_excerpt: "全片", production_intent: "TTS",
        recommended_mode: "auto", provider_hint: "fake_tts", prompt_draft: null,
        parameters: {}, manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
        risk_notes: [], cost_tier: "low", initial_status: "planned",
      },
      {
        task_id: "img_001", order: 1, task_type: "image_still",
        source_segment_id: "sb_001", source_excerpt: "画面", production_intent: "图片",
        recommended_mode: "manual_allowed", provider_hint: "image_provider", prompt_draft: "测试图",
        parameters: {},
        manual_upload_policy: { allowed: true, required: false, accepted_file_types: ["image/png", "image/jpeg"], acceptance_notes: [] },
        risk_notes: [], cost_tier: "low", initial_status: "planned",
      },
    ],
    dependencies: [],
    cost_summary: { total_tasks: 2, by_type: {}, by_cost_tier: {}, estimated_provider_calls: 2, notes: [] },
    global_production_notes: [],
  };
}

function makeAssetPlanWithTtsOnly() {
  return {
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: STORYBOARD_RECORD_ID,
    source_script_record_id: SCRIPT_RECORD_ID,
    source_topic_package_id: TOPIC_PACKAGE_ID,
    art_bible: { era_style: "test", visual_tone: "test", characters: [], locations: [], props: [], global_prompt_prefix: "", global_negative_prompts: [], consistency_notes: [] },
    visual_budget: {},
    downgrade_policy: {},
    global_audio_strategy: {},
    tts_plan: {
      voice_profile_id: "voice_001",
      estimated_total_duration_sec: 20,
      chunking_strategy: "segment_boundary",
      chunks: [{ chunk_id: "chunk_1", order: 0, script_excerpt: "旁白", estimated_duration_sec: 20 }],
    },
    tasks: [
      {
        task_id: "tts_001", order: 0, task_type: "tts_audio",
        source_segment_id: null, source_excerpt: "全片", production_intent: "TTS",
        recommended_mode: "auto", provider_hint: "fake_tts", prompt_draft: null,
        parameters: {}, manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
        risk_notes: [], cost_tier: "low", initial_status: "planned",
      },
    ],
    dependencies: [],
    cost_summary: { total_tasks: 1, by_type: {}, by_cost_tier: {}, estimated_provider_calls: 1, notes: [] },
    global_production_notes: [],
  };
}

function createFormData(boundary: string, fieldName: string, filename: string, mimeType: string, content: Buffer): Buffer {
  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  return Buffer.concat([header, content, footer]);
}

describe("upload artifact", () => {
  const auth = buildTestAuth({ userId: "owner-1" });
  let db: DbClient;
  let project: ProjectRecord;
  let storageRoot: string;

  beforeEach(async () => {
    storageRoot = join(TEST_DIR, `storage-${Date.now()}`);
    mkdirSync(storageRoot, { recursive: true });

    db = createDbClient();
    project = await createProject(db, {
      name: "upload test",
      ownerId: auth.userId,
    });
    project.storageRootDir = storageRoot;
    project.activeAssetPlanRecordId = ASSET_PLAN_RECORD_ID;
    project.status = "asset_plan_ready";

    db.storyboardRecords.set(STORYBOARD_RECORD_ID, {
      id: STORYBOARD_RECORD_ID,
      projectId: project.id,
      topicPackageId: TOPIC_PACKAGE_ID,
      scriptRecordId: SCRIPT_RECORD_ID,
      planJson: { segments: [{ segment_id: "sb_001", visual_description: "test", narration_text: "test", duration_estimate_sec: 20 }] },
      validationResultJson: { decision: "pass" },
      executionStateJson: {},
      graphTraceSummaryJson: {},
      runtimeDiagnosticsJson: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const assetPlan = makeAssetPlanWithImage();
    db.assetPlanRecords.set(ASSET_PLAN_RECORD_ID, {
      id: ASSET_PLAN_RECORD_ID,
      projectId: project.id,
      topicPackageId: TOPIC_PACKAGE_ID,
      scriptRecordId: SCRIPT_RECORD_ID,
      storyboardRecordId: STORYBOARD_RECORD_ID,
      planJson: assetPlan as any,
      validationResultJson: { decision: "pass" } as any,
      executionStateJson: {},
      graphTraceSummaryJson: {},
      runtimeDiagnosticsJson: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Build and save an initial manifest with enabled_provider_types excluding image
    const manifest = buildInitialAssetManifest({
      assetPlanRecordId: ASSET_PLAN_RECORD_ID,
      assetPlan: assetPlan as any,
      segmentIds: ["sb_001"],
      executionOptions: {
        execution_mode: "dry_run",
        voice_profile_id: "voice_001",
        enabled_provider_types: ["tts"],
        allow_manual_placeholders: false,
      },
    });

    const manifestRecord = await saveAssetManifestRecord(db, {
      projectId: project.id,
      topicPackageId: TOPIC_PACKAGE_ID,
      scriptRecordId: SCRIPT_RECORD_ID,
      storyboardRecordId: STORYBOARD_RECORD_ID,
      assetPlanRecordId: ASSET_PLAN_RECORD_ID,
      manifestJson: manifest,
      validationResultJson: { decision: "blocked" },
      executionStateJson: {},
      graphTraceSummaryJson: {},
      runtimeDiagnosticsJson: null,
    });

    project.activeAssetManifestRecordId = manifestRecord.id;
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  async function injectUpload(taskId: string, filename: string, mimeType: string, content: Buffer) {
    const app = buildApp();
    // Copy test data into app's own db
    app.db.projects.set(project.id, project);
    for (const [k, v] of db.storyboardRecords) app.db.storyboardRecords.set(k, v);
    for (const [k, v] of db.assetPlanRecords) app.db.assetPlanRecords.set(k, v);
    for (const [k, v] of db.assetManifestRecords) app.db.assetManifestRecords.set(k, v);

    return app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/assets/tasks/${taskId}/artifacts/upload`,
      payload: {
        file: {
          buffer: content,
          originalName: filename,
          mimeType,
          truncated: false,
        },
      },
      auth,
    });
  }

  it("合法图片上传成功，返回 manifest", async () => {
    const response = await injectUpload("img_001", "test.png", "image/png", MINIMAL_PNG);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.manifest).toBeDefined();
    const imgArtifact = body.manifest.artifacts.find((a: any) => a.artifact_type === "image");
    expect(imgArtifact).toBeDefined();
    expect(imgArtifact.metadata.width).toBe(1);
    expect(imgArtifact.metadata.height).toBe(1);
  });

  it("不允许手动上传的 task 返回 422", async () => {
    const response = await injectUpload("tts_001", "test.png", "image/png", MINIMAL_PNG);
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toBe("asset_manual_upload_not_allowed");
  });

  it("MIME 不在 accepted_file_types 中返回 422", async () => {
    const response = await injectUpload("img_001", "test.gif", "image/gif", MINIMAL_PNG);
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toBe("asset_manual_upload_type_not_allowed");
  });

  it("魔数不匹配返回 422", async () => {
    const fakePng = Buffer.from("this is not a png at all");
    const response = await injectUpload("img_001", "fake.png", "image/png", fakePng);
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toBe("asset_upload_magic_number_mismatch");
  });

  it("文件过大（truncated）返回 413", async () => {
    const app = buildApp();
    app.db.projects.set(project.id, project);
    for (const [k, v] of db.storyboardRecords) app.db.storyboardRecords.set(k, v);
    for (const [k, v] of db.assetPlanRecords) app.db.assetPlanRecords.set(k, v);
    for (const [k, v] of db.assetManifestRecords) app.db.assetManifestRecords.set(k, v);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/assets/tasks/img_001/artifacts/upload`,
      payload: {
        file: {
          buffer: MINIMAL_PNG,
          originalName: "big.png",
          mimeType: "image/png",
          truncated: true,
        },
      },
      auth,
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().error).toBe("asset_upload_file_too_large");
  });
});
