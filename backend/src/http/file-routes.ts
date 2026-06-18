import type { AppInstance } from "../app.js";
import type { ServerResponse } from "node:http";
import { writeFileStream } from "./file-response.js";
import { exportPublishPackage } from "../modules/publish/publish-export.service.js";

interface FileRouteMatch {
  type: "artifact_file" | "render_preview" | "render_download" | "publish_export";
  projectId: string;
  artifactId?: string;
}

export function matchFileRoute(method: string, pathname: string): FileRouteMatch | null {
  if (method !== "GET") return null;
  // GET /api/projects/:projectId/artifacts/:artifactId/file
  let match = pathname.match(/^\/api\/projects\/([^/]+)\/artifacts\/([^/]+)\/file$/);
  if (match) return { type: "artifact_file", projectId: match[1]!, artifactId: match[2]! };
  // GET /api/projects/:projectId/render/preview
  match = pathname.match(/^\/api\/projects\/([^/]+)\/render\/preview$/);
  if (match) return { type: "render_preview", projectId: match[1]! };
  // GET /api/projects/:projectId/render/download
  match = pathname.match(/^\/api\/projects\/([^/]+)\/render\/download$/);
  if (match) return { type: "render_download", projectId: match[1]! };
  // GET /api/projects/:projectId/publish/export
  match = pathname.match(/^\/api\/projects\/([^/]+)\/publish\/export$/);
  if (match) return { type: "publish_export", projectId: match[1]! };
  return null;
}

export async function handleFileRoute(
  match: FileRouteMatch,
  response: ServerResponse,
  app: AppInstance,
): Promise<void> {
  const project = app.db.projects.get(match.projectId);
  if (!project) {
    response.statusCode = 404;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: "project_not_found" }));
    return;
  }

  const storageRoot = project.storageRootDir;

  if (match.type === "artifact_file" && match.artifactId) {
    const manifestData = project.activeAssetManifestRecordId
      ? app.db.assetManifestRecords.get(project.activeAssetManifestRecordId)?.manifestJson
      : undefined;
    const artifacts = (manifestData as { artifacts?: Array<{ artifact_id: string; file_uri: string }> } | undefined)?.artifacts;
    const artifact = artifacts?.find((a) => a.artifact_id === match.artifactId);
    if (!artifact) {
      response.statusCode = 404;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ error: "artifact_not_found" }));
      return;
    }
    writeFileStream(response, artifact.file_uri, storageRoot, { disposition: "inline" });
  } else if (match.type === "render_preview" || match.type === "render_download") {
    const renderRecord = project.activeRenderJobRecordId
      ? app.db.renderJobRecords.get(project.activeRenderJobRecordId)
      : undefined;
    const renderArtifact = renderRecord?.outputArtifactJson;
    if (!renderArtifact) {
      response.statusCode = 404;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ error: "render_output_not_found" }));
      return;
    }
    writeFileStream(response, renderArtifact.file_uri, storageRoot, {
      disposition: match.type === "render_preview" ? "inline" : "attachment",
      filename: match.type === "render_download" ? `${project.name}.mp4` : undefined,
    });
  } else if (match.type === "publish_export") {
    try {
      const result = await exportPublishPackage(app.db, match.projectId);
      response.statusCode = 200;
      const isZip = result.filename.endsWith(".zip");
      response.setHeader("content-type", isZip ? "application/zip" : "application/json; charset=utf-8");
      const safeFilename = result.filename.replace(/[/\\:*?"<>|]/g, "_");
      const asciiFallback = safeFilename.replace(/[^\x00-\x7F]/g, "_").replace(/_+/g, "_");
      response.setHeader(
        "content-disposition",
        `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(safeFilename)}`,
      );
      response.setHeader("x-export-manifest", encodeURIComponent(JSON.stringify(result.manifest)));
      response.setHeader("content-length", result.zipBuffer.length);
      response.end(result.zipBuffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : "export_failed";
      if (message === "project_not_found") {
        response.statusCode = 404;
      } else if (message === "no_active_publish_package" || message === "publish_package_not_found") {
        response.statusCode = 409;
      } else {
        response.statusCode = 500;
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ error: message }));
    }
  }
}
