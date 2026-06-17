import { describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { saveAssetManifestRecord } from "../../../backend/src/modules/assets/asset-manifest-record.repository.js";
import { saveComposeRecord } from "../../../backend/src/modules/compose/compose-record.repository.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import {
  getPublishPackageRecordById,
} from "../../../backend/src/modules/publish/publish-record.repository.js";
import { saveRenderJobRecord } from "../../../backend/src/modules/render/render-record.repository.js";
import { saveScriptRecord } from "../../../backend/src/modules/script/script-record.repository.js";
import { saveStoryboardRecord } from "../../../backend/src/modules/storyboard/storyboard-record.repository.js";
import { saveTopicPackage } from "../../../backend/src/modules/topic/topic-package.repository.js";

describe("publish API", () => {
  async function setupProjectWithRender() {
    const app = buildApp();
    const db = app.db;

    const project = await createProject(db, { name: "Publish API Test" });

    const topicPackage = await saveTopicPackage(db, {
      projectId: project.id,
      title: "测试标题",
      selectedAngle: "测试角度",
      familyLabel: "测试标签",
      scopeLabel: "完整事件",
      coreConflict: "核心冲突",
      strongScene: "强场面",
      packagingSeed: "种子",
      canonicalQuotesJson: [],
      durationBandJson: { label: "medium" },
      narrativeTensionMapJson: { hook_claim: "hook" },
    });

    const scriptRecord = await saveScriptRecord(db, {
      projectId: project.id,
      topicPackageId: topicPackage.id,
      scriptText: "测试脚本正文",
      openingSpan: "开头",
      endingSpan: "结尾",
      estimatedDurationSec: 60,
      beatTraceJson: [],
      quoteTraceJson: [],
      reviewStatus: "pass",
      validationResultJson: { stage: "script_local_validation", decision: "pass" },
      semanticReviewResultJson: { stage: "script_semantic_review", decision: "pass", patch_intent: null },
      executionStateJson: { patch_used: false, regenerate_used: false },
    });

    const storyboardRecord = await saveStoryboardRecord(db, {
      projectId: project.id,
      topicPackageId: topicPackage.id,
      scriptRecordId: scriptRecord.id,
      planJson: { plan_version: "storyboard_v1", segments: [] },
      validationResultJson: { stage: "storyboard_local_validation", decision: "pass", errors: [], warnings: [], metrics: {} },
      executionStateJson: { regenerate_used: false },
    });

    const assetManifestRecord = await saveAssetManifestRecord(db, {
      projectId: project.id,
      topicPackageId: topicPackage.id,
      scriptRecordId: scriptRecord.id,
      storyboardRecordId: storyboardRecord.id,
      assetPlanRecordId: "asset_plan_001",
      manifestJson: { manifest_version: "asset_manifest_v1", artifacts: [], executions: [], audio_summary: {}, segment_routes: [], readiness: "ready", notes: [] },
      validationResultJson: { stage: "assets_local_validation", decision: "pass", errors: [], warnings: [], metrics: {} },
      executionStateJson: { activated: true },
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
    });

    const composeRecord = await saveComposeRecord(db, {
      projectId: project.id,
      assetManifestRecordId: assetManifestRecord.id,
      timelineJson: { timeline_version: "compose_timeline_v1", duration_sec: 60, tracks: [], segments: [] },
      validationResultJson: { stage: "compose_local_validation", decision: "ready_for_render", errors: [], warnings: [], metrics: {} },
      executionStateJson: { activated: true },
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
    });

    const exportArtifact = {
      artifact_id: "export_001",
      artifact_type: "rendered_video",
      file_uri: "file://storage/output.mp4",
      mime_type: "video/mp4",
      duration_sec: 60,
      width: 1080,
      height: 1920,
      fps: 30,
      source_compose_record_id: composeRecord.id,
      source_asset_manifest_record_id: assetManifestRecord.id,
      metadata: { renderer: "fake" },
    };

    const renderJobRecord = await saveRenderJobRecord(db, {
      projectId: project.id,
      composeRecordId: composeRecord.id,
      assetManifestRecordId: assetManifestRecord.id,
      status: "completed",
      profileJson: { width: 1080, height: 1920, fps: 30 },
      outputArtifactJson: exportArtifact,
      validationResultJson: { stage: "render_local_validation", decision: "rendered", errors: [], warnings: [], metrics: {} },
      executionStateJson: { activated: true },
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
    });

    project.activeTopicPackageId = topicPackage.id;
    project.activeScriptRecordId = scriptRecord.id;
    project.activeStoryboardRecordId = storyboardRecord.id;
    project.activeAssetManifestRecordId = assetManifestRecord.id;
    project.activeComposeRecordId = composeRecord.id;
    project.activeRenderJobRecordId = renderJobRecord.id;
    project.status = "render_ready";

    return { app, project, renderJobRecord };
  }

  it("POST generate creates a publish package and returns 201", async () => {
    const { app, project } = await setupProjectWithRender();

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/publish/generate`,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body.active_publish_package).toBeTruthy();

    const pkg = body.active_publish_package as Record<string, unknown>;
    expect(pkg.is_stale).toBe(false);
    expect(pkg.stale_reason).toBeNull();

    const inner = pkg.package as Record<string, unknown>;
    expect(inner.package_version).toBe("publish_package_v1");
    expect(inner.readiness).toBe("draft");
    expect(inner.video_export_artifact_id).toBe("export_001");

    // Verify the active pointer was set
    expect(project.activePublishPackageRecordId).toBeTruthy();
    const record = await getPublishPackageRecordById(
      app.db,
      project.activePublishPackageRecordId!,
    );
    expect(record).not.toBeNull();
  });

  it("POST generate returns 404 for non-existent project", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/projects/nonexistent/publish/generate",
    });

    expect(res.statusCode).toBe(404);
  });

  it("POST generate returns 409 when no render job", async () => {
    const app = buildApp();
    const db = app.db;
    const project = await createProject(db, { name: "No Render" });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/publish/generate`,
    });

    expect(res.statusCode).toBe(409);
    const body = res.json() as Record<string, unknown>;
    expect(body.error).toBe("no_active_render_job");
  });

  it("POST generate returns 409 when render job not completed", async () => {
    const app = buildApp();
    const db = app.db;
    const project = await createProject(db, { name: "Failed Render" });

    const renderJob = await saveRenderJobRecord(db, {
      projectId: project.id,
      composeRecordId: "compose_001",
      assetManifestRecordId: "asset_manifest_001",
      status: "failed",
      profileJson: {},
      outputArtifactJson: null,
      validationResultJson: { stage: "render_local_validation", decision: "failed", errors: [], warnings: [], metrics: {} },
    });

    project.activeRenderJobRecordId = renderJob.id;

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/publish/generate`,
    });

    expect(res.statusCode).toBe(409);
    expect((res.json() as Record<string, unknown>).error).toBe("render_job_not_completed");
  });

  it("POST generate returns 409 when upstream pipeline incomplete", async () => {
    const app = buildApp();
    const db = app.db;
    const project = await createProject(db, { name: "Incomplete Pipeline" });

    const exportArtifact = {
      artifact_id: "export_001",
      artifact_type: "rendered_video",
      file_uri: "file://storage/output.mp4",
      mime_type: "video/mp4",
      duration_sec: 60,
      width: 1080,
      height: 1920,
      fps: 30,
      source_compose_record_id: "compose_001",
      source_asset_manifest_record_id: "asset_manifest_001",
      metadata: {},
    };

    const renderJob = await saveRenderJobRecord(db, {
      projectId: project.id,
      composeRecordId: "compose_001",
      assetManifestRecordId: "asset_manifest_001",
      status: "completed",
      profileJson: {},
      outputArtifactJson: exportArtifact,
      validationResultJson: { stage: "render_local_validation", decision: "rendered", errors: [], warnings: [], metrics: {} },
    });

    project.activeRenderJobRecordId = renderJob.id;
    // Missing topic/script/storyboard/asset manifest pointers

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/publish/generate`,
    });

    expect(res.statusCode).toBe(409);
    expect((res.json() as Record<string, unknown>).error).toBe("incomplete_upstream_pipeline");
  });

  it("PATCH updates editable fields and returns 200", async () => {
    const { app, project } = await setupProjectWithRender();

    // First generate a package
    const genRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/publish/generate`,
    });
    expect(genRes.statusCode).toBe(201);

    // Patch the package
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/publish`,
      payload: {
        selected_title: "更新后的标题",
        description: "更新后的描述",
        hashtags: ["历史", "春秋"],
        readiness: "ready",
      },
    });

    expect(patchRes.statusCode).toBe(200);
    const body = patchRes.json() as Record<string, unknown>;
    const pkg = (body.active_publish_package as Record<string, unknown>).package as Record<string, unknown>;
    expect(pkg.selected_title).toBe("更新后的标题");
    expect(pkg.description).toBe("更新后的描述");
    expect(pkg.hashtags).toEqual(["历史", "春秋"]);
    expect(pkg.readiness).toBe("ready");
  });

  it("PATCH returns 400 for read-only fields", async () => {
    const { app, project } = await setupProjectWithRender();

    await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/publish/generate`,
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/publish`,
      payload: {
        package_version: "hacked_version",
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as Record<string, unknown>;
    expect(body.error).toBe("invalid_fields");
  });

  it("PATCH returns 409 when no active publish package", async () => {
    const app = buildApp();
    const db = app.db;
    const project = await createProject(db, { name: "No Publish Pkg" });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/publish`,
      payload: { selected_title: "test" },
    });

    expect(res.statusCode).toBe(409);
    expect((res.json() as Record<string, unknown>).error).toBe("no_active_publish_package");
  });

  it("second POST generate creates a new record without modifying the old one", async () => {
    const { app, project } = await setupProjectWithRender();

    // First generate
    const res1 = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/publish/generate`,
    });
    expect(res1.statusCode).toBe(201);
    const firstRecordId = project.activePublishPackageRecordId;

    // Generate again
    const res2 = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/publish/generate`,
    });
    expect(res2.statusCode).toBe(201);
    const secondRecordId = project.activePublishPackageRecordId;

    // Both records should exist, but the active pointer should point to the new one
    expect(firstRecordId).not.toBe(secondRecordId);
    const firstRecord = await getPublishPackageRecordById(app.db, firstRecordId!);
    const secondRecord = await getPublishPackageRecordById(app.db, secondRecordId!);
    expect(firstRecord).not.toBeNull();
    expect(secondRecord).not.toBeNull();
    expect(project.activePublishPackageRecordId).toBe(secondRecordId);
  });
});
