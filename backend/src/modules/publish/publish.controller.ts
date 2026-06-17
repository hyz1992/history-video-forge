import type { AppResponse, RouteContext } from "../../app";
import { getProjectSnapshot } from "../projects/project-snapshot.service";
import { savePublishPackageRecord } from "./publish-record.repository";

function buildDefaultPublishPackage(input: {
  renderJobRecordId: string;
  topicPackageId: string;
  scriptRecordId: string;
  storyboardRecordId: string;
  assetManifestRecordId: string;
  videoExportArtifactId: string;
}): Record<string, unknown> {
  return {
    package_version: "publish_package_v1",
    source_render_job_record_id: input.renderJobRecordId,
    source_topic_package_id: input.topicPackageId,
    source_script_record_id: input.scriptRecordId,
    source_storyboard_record_id: input.storyboardRecordId,
    source_asset_manifest_record_id: input.assetManifestRecordId,
    video_export_artifact_id: input.videoExportArtifactId,
    cover_artifact_id: null,
    cover_prompt_draft: null,
    cover_origin: "storyboard_image",
    title_candidates: [],
    selected_title: "",
    description: "",
    hashtags: [],
    platform_profile: "generic",
    readiness: "draft",
    notes: [],
  };
}

const EDITABLE_FIELDS = new Set([
  "title_candidates",
  "selected_title",
  "description",
  "hashtags",
  "cover_prompt_draft",
  "cover_artifact_id",
  "cover_origin",
  "platform_profile",
  "readiness",
  "notes",
]);

export async function publishGenerateController(
  context: RouteContext,
): Promise<AppResponse> {
  const { app, params } = context;
  const db = app.db;
  const projectId = params.projectId;

  const project = db.projects.get(projectId);
  if (!project) {
    return { statusCode: 404, body: { error: "project_not_found" } };
  }

  // Verify render job exists and is completed
  if (!project.activeRenderJobRecordId) {
    return {
      statusCode: 409,
      body: { error: "no_active_render_job" },
    };
  }

  const renderJob = db.renderJobRecords.get(project.activeRenderJobRecordId);
  if (!renderJob) {
    return {
      statusCode: 409,
      body: { error: "render_job_not_found" },
    };
  }

  if (renderJob.status !== "completed") {
    return {
      statusCode: 409,
      body: { error: "render_job_not_completed" },
    };
  }

  const exportArtifact = renderJob.outputArtifactJson;
  if (!exportArtifact) {
    return {
      statusCode: 409,
      body: { error: "no_export_artifact" },
    };
  }

  // Resolve upstream source record IDs from render job
  const topicPackageId = project.activeTopicPackageId;
  const scriptRecordId = project.activeScriptRecordId;
  const storyboardRecordId = project.activeStoryboardRecordId;
  const assetManifestRecordId = project.activeAssetManifestRecordId;

  if (!topicPackageId || !scriptRecordId || !storyboardRecordId || !assetManifestRecordId) {
    return {
      statusCode: 409,
      body: { error: "incomplete_upstream_pipeline" },
    };
  }

  // Build and save the publish package
  const packageJson = buildDefaultPublishPackage({
    renderJobRecordId: renderJob.id,
    topicPackageId,
    scriptRecordId,
    storyboardRecordId,
    assetManifestRecordId,
    videoExportArtifactId: exportArtifact.artifact_id,
  });

  const record = await savePublishPackageRecord(db, {
    projectId,
    renderJobRecordId: renderJob.id,
    topicPackageId,
    scriptRecordId,
    storyboardRecordId,
    assetManifestRecordId,
    packageJson,
    executionStateJson: {
      generated_at: new Date().toISOString(),
      llm_used: false,
    },
  });

  // Set the active pointer
  project.activePublishPackageRecordId = record.id;

  // Return the snapshot with the new active_publish_package
  const snapshot = await getProjectSnapshot(db, projectId);

  return {
    statusCode: 201,
    body: snapshot,
  };
}

export async function publishUpdateController(
  context: RouteContext,
): Promise<AppResponse> {
  const { app, params, payload } = context;
  const db = app.db;
  const projectId = params.projectId;

  const project = db.projects.get(projectId);
  if (!project) {
    return { statusCode: 404, body: { error: "project_not_found" } };
  }

  if (!project.activePublishPackageRecordId) {
    return {
      statusCode: 409,
      body: { error: "no_active_publish_package" },
    };
  }

  const record = db.publishPackageRecords.get(
    project.activePublishPackageRecordId,
  );
  if (!record) {
    return {
      statusCode: 409,
      body: { error: "publish_package_not_found" },
    };
  }

  const updates = payload as Record<string, unknown> | undefined;
  if (!updates || typeof updates !== "object") {
    return { statusCode: 400, body: { error: "invalid_payload" } };
  }

  // Validate that all update keys are editable fields
  const unknownKeys = Object.keys(updates).filter(
    (k) => !EDITABLE_FIELDS.has(k),
  );
  if (unknownKeys.length > 0) {
    return {
      statusCode: 400,
      body: {
        error: "invalid_fields",
        details: `unknown or read-only fields: ${unknownKeys.join(", ")}`,
      },
    };
  }

  // Merge updates into the package JSON
  const updatedPackage = {
    ...(record.packageJson as Record<string, unknown>),
    ...updates,
  };

  // Save the updated record
  const updatedRecord = await savePublishPackageRecord(db, {
    id: record.id,
    projectId: record.projectId,
    renderJobRecordId: record.renderJobRecordId,
    topicPackageId: record.topicPackageId,
    scriptRecordId: record.scriptRecordId,
    storyboardRecordId: record.storyboardRecordId,
    assetManifestRecordId: record.assetManifestRecordId,
    packageJson: updatedPackage,
    validationResultJson: record.validationResultJson,
    executionStateJson: {
      ...(record.executionStateJson as Record<string, unknown> ?? {}),
      last_patched_at: new Date().toISOString(),
    },
    createdAt: record.createdAt,
    updatedAt: new Date(),
  });

  // Return the updated snapshot
  const snapshot = await getProjectSnapshot(db, projectId);

  return {
    statusCode: 200,
    body: snapshot,
  };
}
