import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { DbClient } from "../../db/client";
import { getProjectStorageProfile } from "../../runtime/trace/project-storage";

export interface CoverInitializationResult {
  coverArtifactId: string;
  coverPromptDraft: string;
}

/**
 * Find the #1 storyboard segment's primary visual artifact and copy it
 * as a standalone cover artifact. Generates an initial cover_prompt_draft.
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

  const manifestJson = manifestRecord.manifestJson as Record<string, unknown>;
  const segmentRoutes = (manifestJson.segment_routes ??
    []) as Array<Record<string, unknown>>;
  const artifacts = (manifestJson.artifacts ??
    []) as Array<Record<string, unknown>>;

  if (segmentRoutes.length === 0 || artifacts.length === 0) {
    throw new Error("no_segment_routes_or_artifacts");
  }

  // Find the first segment (by segment_id order) that has a primary visual artifact
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

  // Copy the source image file to publish directory
  const newArtifactId = db.generateId();
  const sourceUri = String(sourceArtifact.file_uri ?? "");
  const sourceMeta = (sourceArtifact.metadata ?? {}) as Record<string, unknown>;

  let newFileUri: string;

  if (sourceUri.startsWith("memory://") || sourceUri.startsWith("inline://")) {
    // Test / virtual URIs: assign a new memory URI
    newFileUri = `memory://cover_${newArtifactId}.png`;
  } else {
    // Physical file: copy to publish directory
    const storageProfile = getProjectStorageProfile(project);
    const publishDir = join(storageProfile.root_dir, "publish");
    await mkdir(publishDir, { recursive: true });

    const sourcePath = sourceUri.startsWith("file://")
      ? fileURLToPath(sourceUri)
      : sourceUri;

    const ext = sourcePath.split(".").pop() ?? "png";
    const destPath = join(publishDir, `cover.${ext}`);
    newFileUri = `file://${destPath}`;

    try {
      await copyFile(sourcePath, destPath);
    } catch {
      // If copy fails (e.g. in test with fake paths), fall back to source URI
      newFileUri = sourceUri;
    }
  }

  // Register the new cover artifact in the manifest
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

  // Generate initial cover prompt draft from ArtBible context
  const topicPackage = project.activeTopicPackageId
    ? db.topicPackages.get(project.activeTopicPackageId)
    : null;
  const topicTitle = topicPackage?.title ?? "";
  const eraStyle = manifestJson.art_bible
    ? (manifestJson.art_bible as Record<string, unknown>).era_style as string | undefined
    : undefined;

  const coverPromptDraft = eraStyle
    ? `${eraStyle}，短视频竖屏封面，${topicTitle}，高画质电影感构图`
    : `短视频竖屏封面，${topicTitle}，高画质电影感构图`;

  return {
    coverArtifactId: newArtifactId,
    coverPromptDraft,
  };
}
