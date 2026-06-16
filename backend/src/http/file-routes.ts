import type { AppInstance } from "../app.js";
import type { ServerResponse } from "node:http";
import { writeFileStream } from "./file-response.js";

interface FileRouteMatch {
  type: "artifact_file" | "render_preview" | "render_download";
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
  }
}
