import type { AppInstance } from "../app.js";
import type { ServerResponse } from "node:http";
import { writeFileStream } from "./file-response.js";
import { exportPublishPackage } from "../modules/publish/publish-export.service.js";
import type { AuthContext } from "../auth/auth-context.js";
import { createAnonymousAuthContext } from "../auth/auth-context.js";
import {
  AuthorizationError,
  handleControllerAuthError,
  requireOwner,
  requireUser,
} from "../auth/authorization.js";

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

function endJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

export async function handleFileRoute(
  match: FileRouteMatch,
  response: ServerResponse,
  app: AppInstance,
  auth: AuthContext = createAnonymousAuthContext(),
): Promise<void> {
  try {
    const user = requireUser(auth);
    const project = app.db.projects.get(match.projectId);
    if (!project) {
      throw new AuthorizationError(404, "project_not_found", "project_not_found");
    }
    requireOwner(user, project.ownerId);

    const storageRoot = project.storageRootDir;

    if (match.type === "artifact_file" && match.artifactId) {
      const manifestData = project.activeAssetManifestRecordId
        ? app.db.assetManifestRecords.get(project.activeAssetManifestRecordId)?.manifestJson
        : undefined;
      const artifacts = (manifestData as { artifacts?: Array<{ artifact_id: string; file_uri: string }> } | undefined)?.artifacts;
      const artifact = artifacts?.find((a) => a.artifact_id === match.artifactId);
      if (!artifact) {
        endJson(response, 404, { error: "artifact_not_found" });
        return;
      }
      writeFileStream(response, artifact.file_uri, storageRoot, { disposition: "inline" });
    } else if (match.type === "render_preview" || match.type === "render_download") {
      const renderRecord = project.activeRenderJobRecordId
        ? app.db.renderJobRecords.get(project.activeRenderJobRecordId)
        : undefined;
      const renderArtifact = renderRecord?.outputArtifactJson;
      if (!renderArtifact) {
        endJson(response, 404, { error: "render_output_not_found" });
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
        response.setHeader("content-type", "application/zip");
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
          endJson(response, 404, { error: message });
        } else if (message === "no_active_publish_package" || message === "publish_package_not_found") {
          endJson(response, 409, { error: message });
        } else {
          endJson(response, 500, { error: message });
        }
      }
    }
  } catch (error) {
    const handled = handleControllerAuthError(error);
    if (handled) {
      endJson(response, handled.statusCode, handled.body);
      return;
    }
    endJson(response, 500, { error: "file_serve_error" });
  }
}
