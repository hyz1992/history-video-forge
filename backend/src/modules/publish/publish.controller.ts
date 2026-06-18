import type { AppResponse, RouteContext } from "../../app";
import { env } from "../../config/env";
import { saveAssetManifestRecord } from "../assets/asset-manifest-record.repository";
import { getProjectSnapshot } from "../projects/project-snapshot.service";
import {
  buildCoverPromptContext,
  generateCoverPromptDraft,
  initializeCoverFromStoryboard,
} from "./cover.service";
import { generateCoverImage } from "./cover-generate.service";
import { generateDescription } from "./description-generator.service";
import { deriveHashtags } from "./hashtag-derivation.service";
import { getPublishLlmGateway } from "./llm-helper";
import { savePublishPackageRecord } from "./publish-record.repository";
import { generateTitleCandidates } from "./title-generator.service";
import { exportPublishPackage } from "./publish-export.service";

function buildDefaultPublishPackage(input: {
  renderJobRecordId: string;
  topicPackageId: string;
  scriptRecordId: string;
  storyboardRecordId: string;
  assetManifestRecordId: string;
  videoExportArtifactId: string;
  coverArtifactId?: string | null;
  coverPromptDraft?: string | null;
  coverOrigin?: string;
}): Record<string, unknown> {
  return {
    package_version: "publish_package_v1",
    source_render_job_record_id: input.renderJobRecordId,
    source_topic_package_id: input.topicPackageId,
    source_script_record_id: input.scriptRecordId,
    source_storyboard_record_id: input.storyboardRecordId,
    source_asset_manifest_record_id: input.assetManifestRecordId,
    video_export_artifact_id: input.videoExportArtifactId,
    cover_artifact_id: input.coverArtifactId ?? null,
    cover_prompt_draft: input.coverPromptDraft ?? null,
    cover_origin: input.coverOrigin ?? "storyboard_image",
    title_candidates: [],
    selected_title: "",
    description: "",
    hashtags: [],
    platform_profile: "generic",
    readiness: "ready",
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

  // Initialize cover from #1 storyboard image (copy file + register artifact)
  let coverArtifactId: string | null = null;
  const notes: string[] = [];
  try {
    const coverResult = await initializeCoverFromStoryboard(
      db,
      projectId,
      assetManifestRecordId,
    );
    coverArtifactId = coverResult.coverArtifactId;
  } catch (err) {
    notes.push(
      `cover_init_skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Resolve upstream records
  const topicPackage = db.topicPackages.get(topicPackageId);
  const scriptRecord = db.scriptRecords.get(scriptRecordId);

  // Save preliminary package and set active pointer BEFORE LLM calls
  // so refresh during generation shows the publishing state, not empty
  const prePackageJson = buildDefaultPublishPackage({
    renderJobRecordId: renderJob.id,
    topicPackageId,
    scriptRecordId,
    storyboardRecordId,
    assetManifestRecordId,
    videoExportArtifactId: exportArtifact.artifact_id,
    coverArtifactId,
    coverPromptDraft: null,
  });
  (prePackageJson as Record<string, unknown>).readiness = "generating";
  (prePackageJson as Record<string, unknown>).notes = notes;

  const generatingRecord = await savePublishPackageRecord(db, {
    projectId,
    renderJobRecordId: renderJob.id,
    topicPackageId,
    scriptRecordId,
    storyboardRecordId,
    assetManifestRecordId,
    packageJson: prePackageJson,
    executionStateJson: { generated_at: new Date().toISOString(), generating: true },
  });
  project.activePublishPackageRecordId = generatingRecord.id;

  // Generate cover prompt via LLM
  let coverPromptDraft: string | null = null;
  let llmUsed = false;
  try {
    const ctx = buildCoverPromptContext(db, projectId, assetManifestRecordId);
    coverPromptDraft = await generateCoverPromptDraft(ctx);
    llmUsed = true;
  } catch (err) {
    notes.push(
      `cover_prompt_gen_failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Generate description via LLM
  let description = "";
  try {
    if (topicPackage && scriptRecord) {
      const descResult = await generateDescription({
        topicTitle: topicPackage.title,
        selectedAngle: topicPackage.selectedAngle,
        scriptSummary: scriptRecord.scriptText.slice(0, 500),
        durationSec: exportArtifact.duration_sec ?? scriptRecord.estimatedDurationSec ?? 60,
      });
      description = descResult.description;
      llmUsed = true;
    }
  } catch (err) {
    notes.push(
      `description_gen_failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Generate title candidates via LLM and auto-select first
  let titleCandidates: Array<{ candidate_id: string; text: string; style: string }> = [];
  let selectedTitle = "";
  try {
    if (topicPackage && scriptRecord) {
      const titleResult = await generateTitleCandidates({
        topicTitle: topicPackage.title,
        selectedAngle: topicPackage.selectedAngle,
        scriptSummary: scriptRecord.scriptText.slice(0, 300),
        durationSec: Math.round(exportArtifact.duration_sec ?? scriptRecord.estimatedDurationSec ?? 60),
      });
      titleCandidates = titleResult.candidates;
      if (titleCandidates.length > 0) {
        selectedTitle = titleCandidates[0].text;
      }
      llmUsed = true;
    }
  } catch (err) {
    notes.push(
      `title_gen_failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Derive hashtags from structured upstream fields (non-LLM)
  let hashtags: string[] = [];
  if (topicPackage) {
    hashtags = deriveHashtags({
      familyLabel: topicPackage.familyLabel,
      scopeLabel: topicPackage.scopeLabel,
      topicTitle: topicPackage.title,
    });
  }

  // Build and save the publish package
  const packageJson = buildDefaultPublishPackage({
    renderJobRecordId: renderJob.id,
    topicPackageId,
    scriptRecordId,
    storyboardRecordId,
    assetManifestRecordId,
    videoExportArtifactId: exportArtifact.artifact_id,
    coverArtifactId,
    coverPromptDraft,
  });

  if (notes.length > 0) {
    (packageJson as Record<string, unknown>).notes = notes;
  }

  // Set description from LLM generation
  if (description) {
    (packageJson as Record<string, unknown>).description = description;
  }

  // Set hashtags from derivation
  if (hashtags.length > 0) {
    (packageJson as Record<string, unknown>).hashtags = hashtags;
  }

  // Set title candidates and auto-selected title
  if (titleCandidates.length > 0) {
    (packageJson as Record<string, unknown>).title_candidates = titleCandidates;
    (packageJson as Record<string, unknown>).selected_title = selectedTitle;
  }

  const record = await savePublishPackageRecord(db, {
    id: generatingRecord.id,
    projectId,
    renderJobRecordId: renderJob.id,
    topicPackageId,
    scriptRecordId,
    storyboardRecordId,
    assetManifestRecordId,
    packageJson,
    executionStateJson: {
      generated_at: new Date().toISOString(),
      llm_used: llmUsed,
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
  await savePublishPackageRecord(db, {
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

export async function coverPromptOptimizeController(
  context: RouteContext,
): Promise<AppResponse> {
  const { app, params } = context;
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

  const pkg = record.packageJson as Record<string, unknown>;
  const currentPrompt = (pkg.cover_prompt_draft as string) ?? "";
  const selectedTitle = (pkg.selected_title as string) ?? "";

  // Get ArtBible from asset manifest
  const manifestRecord = db.assetManifestRecords.get(
    record.assetManifestRecordId,
  );
  const manifestJson = (manifestRecord?.manifestJson ?? {}) as Record<string, unknown>;
  const artBible = (manifestJson.art_bible ?? {}) as Record<string, unknown>;

  try {
    const gateway = getPublishLlmGateway();

    const result = await gateway.invokeStructuredPrompt<{
      optimized_prompt: string;
      change_summary: string[];
    }>({
      promptId: "publish.cover-prompt-optimizer",
      input: {
        current_prompt: currentPrompt,
        publish_title: selectedTitle,
        art_bible: {
          era_style: artBible.era_style ?? "",
          visual_tone: artBible.visual_tone ?? "",
        },
      },
      interactionLogWriter: null,
    });

    return {
      statusCode: 200,
      body: {
        optimized_prompt: result.optimized_prompt,
        change_summary: result.change_summary,
      },
    };
  } catch (error) {
    // Fallback: return current prompt with basic enhancement note
    const message = error instanceof Error ? error.message : "optimize_failed";
    const fallbackPrompt = currentPrompt
      ? `${currentPrompt}，增强视觉冲击力，主体居中，9:16竖屏构图，电影级光影`
      : "";

    return {
      statusCode: 200,
      body: {
        optimized_prompt: fallbackPrompt,
        change_summary: ["LLM 不可用，返回基础优化版本"],
        _fallback: true,
        _fallback_reason: message,
      },
    };
  }
}

export async function coverUploadController(
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

  const body = payload as Record<string, unknown> | undefined;
  const fileUri = body?.file_uri as string | undefined;
  if (!fileUri) {
    return { statusCode: 400, body: { error: "missing_file_uri" } };
  }

  const mimeType = (body?.mime_type as string) ?? "image/png";
  if (!["image/png", "image/jpeg"].includes(mimeType)) {
    return {
      statusCode: 400,
      body: { error: "unsupported_mime_type", details: "only image/png and image/jpeg are accepted" },
    };
  }

  // Register the uploaded cover as an artifact in the manifest
  const manifestRecord = db.assetManifestRecords.get(
    record.assetManifestRecordId,
  );
  if (!manifestRecord) {
    return {
      statusCode: 409,
      body: { error: "asset_manifest_not_found", details: "发布包关联的资产清单不存在，无法注册封面图" },
    };
  }

  const newArtifactId = db.generateId();
  const newArtifact = {
    artifact_id: newArtifactId,
    artifact_type: "image",
    origin: "manual_upload",
    file_uri: fileUri,
    created_at: new Date().toISOString(),
    metadata: {
      mime_type: mimeType,
      width: (body?.width as number) ?? null,
      height: (body?.height as number) ?? null,
      uploaded_for_cover: true,
    },
  };

  const manifestJson = manifestRecord.manifestJson as Record<string, unknown>;
  const artifacts = (manifestJson.artifacts ?? []) as Array<Record<string, unknown>>;
  artifacts.push(newArtifact);
  manifestJson.artifacts = artifacts;

  await saveAssetManifestRecord(db, {
    id: manifestRecord.id,
    projectId: manifestRecord.projectId,
    topicPackageId: manifestRecord.topicPackageId,
    scriptRecordId: manifestRecord.scriptRecordId,
    storyboardRecordId: manifestRecord.storyboardRecordId,
    assetPlanRecordId: manifestRecord.assetPlanRecordId,
    manifestJson,
    validationResultJson: manifestRecord.validationResultJson,
    executionStateJson: manifestRecord.executionStateJson,
    graphTraceSummaryJson: manifestRecord.graphTraceSummaryJson,
    runtimeDiagnosticsJson: manifestRecord.runtimeDiagnosticsJson,
    createdAt: manifestRecord.createdAt,
  });

  // Update the publish package
  const updatedPackage = {
    ...(record.packageJson as Record<string, unknown>),
    cover_artifact_id: newArtifactId,
    cover_origin: "manual_upload",
  };

  await savePublishPackageRecord(db, {
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
      cover_uploaded_at: new Date().toISOString(),
    },
    createdAt: record.createdAt,
    updatedAt: new Date(),
  });

  const snapshot = await getProjectSnapshot(db, projectId);

  return {
    statusCode: 200,
    body: snapshot,
  };
}

export async function coverGenerateController(
  context: RouteContext,
): Promise<AppResponse> {
  const { app, params } = context;
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

  const pkg = record.packageJson as Record<string, unknown>;
  const coverPrompt = pkg.cover_prompt_draft as string | null | undefined;
  if (!coverPrompt) {
    return {
      statusCode: 400,
      body: { error: "no_cover_prompt_draft", details: "请先填写封面提示词" },
    };
  }

  const dashscopeApiKey = process.env.ALIYUN_DASHSCOPE_API_KEY || env.dashscopeApiKey;
  if (!dashscopeApiKey) {
    return {
      statusCode: 501,
      body: {
        error: "dashscope_not_configured",
        details: "DashScope API key 未配置，无法生成封面图。请手动上传封面图。",
      },
    };
  }

  try {
    const result = await generateCoverImage(
      db,
      projectId,
      record.assetManifestRecordId,
      {
        apiKey: dashscopeApiKey,
        prompt: coverPrompt,
        size: "1080*1920",
      },
    );

    // Update publish package with the generated cover
    const updatedPackage = {
      ...(record.packageJson as Record<string, unknown>),
      cover_artifact_id: result.artifactId,
      cover_origin: "generated",
    };

    await savePublishPackageRecord(db, {
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
        cover_generated_at: new Date().toISOString(),
      },
      createdAt: record.createdAt,
      updatedAt: new Date(),
    });

    const snapshot = await getProjectSnapshot(db, projectId);
    return { statusCode: 200, body: snapshot };
  } catch (error) {
    const message = error instanceof Error ? error.message : "cover_generate_failed";
    return {
      statusCode: 500,
      body: { error: "cover_generate_failed", details: message },
    };
  }
}

export async function titleCandidatesController(
  context: RouteContext,
): Promise<AppResponse> {
  const { app, params } = context;
  const db = app.db;
  const projectId = params.projectId;

  const project = db.projects.get(projectId);
  if (!project) {
    return { statusCode: 404, body: { error: "project_not_found" } };
  }

  // Collect upstream context
  const topicPackage = project.activeTopicPackageId
    ? db.topicPackages.get(project.activeTopicPackageId)
    : null;
  const scriptRecord = project.activeScriptRecordId
    ? db.scriptRecords.get(project.activeScriptRecordId)
    : null;

  if (!topicPackage || !scriptRecord) {
    return {
      statusCode: 409,
      body: { error: "incomplete_upstream_pipeline" },
    };
  }

  const renderJob = project.activeRenderJobRecordId
    ? db.renderJobRecords.get(project.activeRenderJobRecordId)
    : null;
  const durationSec =
    renderJob?.outputArtifactJson?.duration_sec ??
    scriptRecord.estimatedDurationSec ??
    60;

  // Get current publish package record if exists
  let currentTitle = "";
  let publishRecord: ReturnType<typeof db.publishPackageRecords.get> = null;
  if (project.activePublishPackageRecordId) {
    publishRecord = db.publishPackageRecords.get(
      project.activePublishPackageRecordId,
    );
    if (publishRecord) {
      const pkg = publishRecord.packageJson as Record<string, unknown>;
      currentTitle = (pkg.selected_title as string) ?? "";
    }
  }

  const result = await generateTitleCandidates({
    topicTitle: topicPackage.title,
    selectedAngle: topicPackage.selectedAngle,
    scriptSummary: scriptRecord.scriptText.slice(0, 300),
    durationSec: Math.round(durationSec),
    currentTitle: currentTitle || undefined,
  });

  // Persist candidates to the publish package if one exists
  if (publishRecord) {
    const updatedPackage = {
      ...(publishRecord.packageJson as Record<string, unknown>),
      title_candidates: result.candidates,
    };
    await savePublishPackageRecord(db, {
      id: publishRecord.id,
      projectId: publishRecord.projectId,
      renderJobRecordId: publishRecord.renderJobRecordId,
      topicPackageId: publishRecord.topicPackageId,
      scriptRecordId: publishRecord.scriptRecordId,
      storyboardRecordId: publishRecord.storyboardRecordId,
      assetManifestRecordId: publishRecord.assetManifestRecordId,
      packageJson: updatedPackage,
      validationResultJson: publishRecord.validationResultJson,
      executionStateJson: {
        ...(publishRecord.executionStateJson as Record<string, unknown> ?? {}),
        title_candidates_generated_at: new Date().toISOString(),
      },
      createdAt: publishRecord.createdAt,
      updatedAt: new Date(),
    });
  }

  return {
    statusCode: 200,
    body: {
      candidates: result.candidates,
      _fallback: !result.candidates.length || result.candidates.every(
        (c) => c.style === "standard",
      ),
    },
  };
}

export async function publishExportController(
  context: RouteContext,
): Promise<AppResponse> {
  const { app, params } = context;
  const db = app.db;
  const projectId = params.projectId;

  try {
    const result = await exportPublishPackage(db, projectId);

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${encodeURIComponent(result.filename)}"`,
        "x-export-manifest": JSON.stringify(result.manifest),
      },
      body: result.zipBuffer,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "export_failed";

    if (message === "project_not_found") {
      return { statusCode: 404, body: { error: message } };
    }
    if (message === "no_active_publish_package" || message === "publish_package_not_found") {
      return { statusCode: 409, body: { error: message } };
    }

    return { statusCode: 500, body: { error: "export_failed", details: message } };
  }
}
