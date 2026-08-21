import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { DbClient } from "../../db/client";
import { saveAssetManifestRecord } from "../assets/asset-manifest-record.repository";
import { getProjectStorageProfile } from "../../runtime/trace/project-storage";
import { getPublishLlmGateway } from "./llm-helper";
import type { LlmInteractionLogWriter } from "../../runtime/llm/interaction-log.js";
import { copyStagedArtifactFile, preserveArtifactAfterRegistrationFailure, promoteStagedArtifactFile, resolveStagedArtifactFile, type StagedArtifactFile } from "../../runtime/files/artifact-file-commit.js";

export interface CoverInitializationResult {
  coverArtifactId: string;
}

export interface CoverPromptContext {
  topicTitle: string;
  selectedAngle: string;
  eraStyle: string;
  visualTone: string;
}

/**
 * Find the #1 storyboard segment's primary visual asset and copy it
 * as a standalone cover artifact.
 */
export async function initializeCoverFromStoryboard(
  db: DbClient,
  projectId: string,
  assetManifestRecordId: string,
): Promise<CoverInitializationResult> {
  const project = db.projects.get(projectId);
  if (!project) {
    throw new Error("project_not_found");
  }

  const manifestRecord = db.assetManifestRecords.get(assetManifestRecordId);
  if (!manifestRecord) {
    throw new Error("asset_manifest_not_found");
  }

  const manifestJson = { ...(manifestRecord.manifestJson as Record<string, unknown>) };
  const segmentRoutes = (manifestJson.segment_routes ??
    []) as Array<Record<string, unknown>>;
  const artifacts = [...((manifestJson.artifacts ??
    []) as Array<Record<string, unknown>>)]

  if (segmentRoutes.length === 0 || artifacts.length === 0) {
    throw new Error("no_segment_routes_or_artifacts");
  }

  const sortedRoutes = [...segmentRoutes].sort((a, b) =>
    String(a.segment_id ?? "").localeCompare(String(b.segment_id ?? "")),
  );

  let sourceArtifact: Record<string, unknown> | null = null;
  for (const route of sortedRoutes) {
    const visualId = route.primary_visual_artifact_id as string | null | undefined;
    if (!visualId) continue;

    const found = artifacts.find((a) => a.artifact_id === visualId);
    if (found && found.artifact_type === "image") {
      sourceArtifact = found as Record<string, unknown>;
      break;
    }
  }

  if (!sourceArtifact) {
    throw new Error("no_storyboard_image_found");
  }

  const newArtifactId = db.generateId();
  const sourceUri = String(sourceArtifact.file_uri ?? "");
  const sourceMeta = (sourceArtifact.metadata ?? {}) as Record<string, unknown>;

  let newFileUri: string;
  let stagedFile: StagedArtifactFile | null = null;

  if (sourceUri.startsWith("memory://") || sourceUri.startsWith("inline://")) {
    newFileUri = `memory://cover_${newArtifactId}.png`;
  } else {
    const storageProfile = getProjectStorageProfile(project);
    const sourcePath = sourceUri.startsWith("file://")
      ? fileURLToPath(sourceUri)
      : sourceUri;

    const ext = sourcePath.split(".").pop() ?? "png";
    stagedFile = resolveStagedArtifactFile({ rootDir: storageProfile.root_dir, operationId: newArtifactId, relativeFinalPath: join("publish", `cover_${newArtifactId}.${ext}`) });
    await copyStagedArtifactFile(stagedFile, sourcePath);
    await promoteStagedArtifactFile(stagedFile);
    newFileUri = resolve(stagedFile.finalPath);
  }

  const newArtifact = {
    artifact_id: newArtifactId,
    artifact_type: "image",
    origin: "local",
    file_uri: newFileUri,
    created_at: new Date().toISOString(),
    metadata: {
      mime_type: sourceMeta.mime_type ?? "image/png",
      width: sourceMeta.width ?? null,
      height: sourceMeta.height ?? null,
      source_artifact_id: sourceArtifact.artifact_id,
      cover_of_project: projectId,
    },
  };

  artifacts.push(newArtifact);
  manifestJson.artifacts = artifacts;

  try {
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
    manifestRecord.manifestJson = manifestJson;
  } catch (error) {
    if (stagedFile) await preserveArtifactAfterRegistrationFailure(stagedFile).catch(() => undefined);
    throw error;
  }

  return { coverArtifactId: newArtifactId };
}

/**
 * Build the context needed for cover prompt generation.
 */
export function buildCoverPromptContext(
  db: DbClient,
  projectId: string,
  assetManifestRecordId: string,
): CoverPromptContext {
  const project = db.projects.get(projectId);
  const topicPackage = project?.activeTopicPackageId
    ? db.topicPackages.get(project.activeTopicPackageId)
    : null;
  const manifestRecord = db.assetManifestRecords.get(assetManifestRecordId);
  const manifestJson = (manifestRecord?.manifestJson ?? {}) as Record<string, unknown>;
  const artBible = (manifestJson.art_bible ?? {}) as Record<string, unknown>;

  return {
    topicTitle: topicPackage?.title ?? "",
    selectedAngle: topicPackage?.selectedAngle ?? "",
    eraStyle: (artBible.era_style as string) ?? "",
    visualTone: (artBible.visual_tone as string) ?? "",
  };
}

/**
 * Generate a cover prompt via LLM using the dedicated prompt.
 * Falls back to a structured template when the LLM is unavailable.
 */
export async function generateCoverPromptDraft(
  ctx: CoverPromptContext,
  interactionLogWriter?: LlmInteractionLogWriter,
  snapshotCapabilities?: import("../../../../shared/src/index").ResolvedCapabilityMap,
): Promise<string> {
  try {
    const gateway = getPublishLlmGateway(snapshotCapabilities);
    const result = await gateway.invokeStructuredPrompt<{ cover_prompt: string }>({
      promptId: "publish.cover-prompt-generator",
      operationName: "publish.cover-prompt-generator",
      input: {
        topic_title: ctx.topicTitle,
        selected_angle: ctx.selectedAngle,
        era_style: ctx.eraStyle,
        visual_tone: ctx.visualTone,
        selected_title: "",
      },
      interactionLogWriter,
    });
    return result.cover_prompt?.trim() || buildFallbackCoverPrompt(ctx);
  } catch {
    return buildFallbackCoverPrompt(ctx);
  }
}

function buildFallbackCoverPrompt(ctx: CoverPromptContext): string {
  const era = ctx.eraStyle ? `${ctx.eraStyle}` : "历史场景";
  const title = ctx.topicTitle ? `"${ctx.topicTitle}"` : "历史故事";
  return [
    `${era}，9:16竖屏封面构图`,
    `主体居中偏上，下方留标题文字空间`,
    `突出${title}的核心冲突与情绪张力`,
    `电影级光影，历史正剧质感`,
    `避免现代元素、水印、文字叠加`,
  ].join("，");
}
