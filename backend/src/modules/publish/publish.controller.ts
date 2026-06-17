import type { AppResponse, RouteContext } from "../../app";
import { env } from "../../config/env";
import { createLlmGateway } from "../../runtime/llm/llm-gateway";
import { createOpenAiCompatibleProvider } from "../../runtime/llm/openai-compatible-provider";
import { createPromptRegistry } from "../../runtime/prompts/prompt-registry";
import { saveAssetManifestRecord } from "../assets/asset-manifest-record.repository";
import { getProjectSnapshot } from "../projects/project-snapshot.service";
import { initializeCoverFromStoryboard } from "./cover.service";
import { generateDescription } from "./description-generator.service";
import { deriveHashtags } from "./hashtag-derivation.service";
import { savePublishPackageRecord } from "./publish-record.repository";
import { generateTitleCandidates } from "./title-generator.service";

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

  // Initialize cover from #1 storyboard image
  let coverArtifactId: string | null = null;
  let coverPromptDraft: string | null = null;
  const notes: string[] = [];
  try {
    const coverResult = await initializeCoverFromStoryboard(
      db,
      projectId,
      assetManifestRecordId,
    );
    coverArtifactId = coverResult.coverArtifactId;
    coverPromptDraft = coverResult.coverPromptDraft;
  } catch (err) {
    notes.push(
      `cover_init_skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Resolve upstream records for description and hashtag derivation
  const topicPackage = db.topicPackages.get(topicPackageId);
  const scriptRecord = db.scriptRecords.get(scriptRecordId);
  const storyboardRecord = db.storyboardRecords.get(storyboardRecordId);

  // Generate description via LLM (fallback on failure)
  let description = "";
  let llmUsed = false;
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

  // Derive hashtags from structured upstream fields (non-LLM)
  let hashtags: string[] = [];
  if (topicPackage) {
    const manifestRecord = db.assetManifestRecords.get(assetManifestRecordId);
    const manifestJson = (manifestRecord?.manifestJson ?? {}) as Record<string, unknown>;
    const artBible = (manifestJson.art_bible ?? {}) as Record<string, unknown>;

    const storyboardPlan = (storyboardRecord?.planJson ?? {}) as Record<string, unknown>;
    const segments = (storyboardPlan.segments ?? []) as Array<Record<string, unknown>>;
    const narrativeRoles = segments.map((s) => s.narrative_role as string).filter(Boolean);

    hashtags = deriveHashtags({
      familyLabel: topicPackage.familyLabel,
      scopeLabel: topicPackage.scopeLabel,
      topicTitle: topicPackage.title,
      eraStyle: artBible.era_style as string | undefined,
      narrativeRoles,
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
    const registry = createPromptRegistry();
    const provider = createOpenAiCompatibleProvider({});
    const gateway = createLlmGateway({ registry, provider });

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

  if (manifestRecord) {
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
  }

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

  const dashscopeApiKey = env.dashscopeApiKey;
  if (!dashscopeApiKey) {
    return {
      statusCode: 501,
      body: {
        error: "dashscope_not_configured",
        details: "DashScope API key 未配置，无法生成封面图。请手动上传封面图。",
      },
    };
  }

  // For now, return not implemented since full image gen pipeline requires
  // the provider adapter framework. The endpoint contract is established.
  return {
    statusCode: 501,
    body: {
      error: "not_implemented",
      details: "封面图生成功能将在后续迭代中接入 DashScope image provider。当前请使用手动上传。",
    },
  };
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

  // Get current selected title if publish package exists
  let currentTitle = "";
  if (project.activePublishPackageRecordId) {
    const record = db.publishPackageRecords.get(
      project.activePublishPackageRecordId,
    );
    if (record) {
      const pkg = record.packageJson as Record<string, unknown>;
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
