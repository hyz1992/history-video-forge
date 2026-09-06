import type { AppInstance } from "../app.js";
import type { ServerResponse } from "node:http";
import { writeFileStream } from "./file-response.js";
import { exportPublishPackage } from "../modules/publish/publish-export.service.js";
import type { AuthContext } from "../auth/auth-context.js";
import { createAnonymousAuthContext } from "../auth/auth-context.js";
import { NarrationRepository } from '../modules/narration/narration.repository.js';
import { NarrationBundleStorage } from '../modules/narration/narration-bundle-storage.js';
import { resolveProjectStorageRoot } from '../db/repositories/prisma-first-aggregate-hydrator.js';
import {
  AuthorizationError,
  handleControllerAuthError,
  requireOwner,
  requireUser,
} from "../auth/authorization.js";

interface FileRouteMatch {
  type: "artifact_file" | "render_preview" | "render_download" | "publish_export" | 'narration_file' | 'narration_subtitle_file';
  projectId: string;
  artifactId?: string;
  recordId?: string;
  revisionId?: string;
  kind?: string;
}

export function matchFileRoute(method: string, pathname: string): FileRouteMatch | null {
  if (method !== "GET") return null;
  const narration = pathname.match(/^\/api\/projects\/([A-Za-z0-9_-]+)\/script\/narrations\/([A-Za-z0-9_-]+)\/files\/(audio|timing|events)$/);
  if(narration)return {type:'narration_file',projectId:narration[1]!,recordId:narration[2]!,kind:narration[3]!};
  const subtitle = pathname.match(/^\/api\/projects\/([A-Za-z0-9_-]+)\/script\/narrations\/([A-Za-z0-9_-]+)\/subtitles\/([A-Za-z0-9_-]+)\/files\/(srt|vtt)$/);
  if(subtitle)return {type:'narration_subtitle_file',projectId:subtitle[1]!,recordId:subtitle[2]!,revisionId:subtitle[3]!,kind:subtitle[4]!};
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
    if(match.type==='narration_file'||match.type==='narration_subtitle_file'){
      const client=app.db.narrationPersistence.prismaClient??app.db.firstAggregateWriter?.narrationPrismaClient;
      if(!client&&(app.db.firstAggregateWriter||app.db.secondAggregateWriter||app.db.thirdAggregateWriter))throw new Error('narration_persistence_client_missing');
      const project=client?await client.project.findFirst({where:{id:match.projectId,archivedAt:null}}):app.db.projects.get(match.projectId);
      if(!project)throw new AuthorizationError(404,'project_not_found','project_not_found');
      requireOwner(user,project.ownerId);
      const repo=new NarrationRepository(app.db);
      const record=await repo.findByIdForOwner(match.projectId,project.ownerId,match.recordId??'');
      if(!record?.output||record.projectId!==match.projectId||record.id!==match.recordId){endJson(response,404,{error:'narration_not_found'});return;}
      const revision=match.type==='narration_subtitle_file'?await repo.findSubtitleForOwner(match.projectId,project.ownerId,match.revisionId??''):undefined;
      if(match.type==='narration_subtitle_file'&&(!revision||revision.projectId!==match.projectId||revision.narrationRecordId!==record.id||revision.id!==match.revisionId)){
        endJson(response,404,{error:'narration_subtitle_not_found'});return;
      }
      let storageRootDir:string;
      if('storageKey' in project){
        const shortId=`p_${(project.id.replace(/[^a-zA-Z0-9]/g,'').toLowerCase().slice(0,8)||'00000000').padEnd(8,'0')}`;
        storageRootDir=resolveProjectStorageRoot({storageRoot:app.storageBaseDir,createdAt:project.createdAt,displayName:project.storageDisplayName,shortId,storageKey:project.storageKey});
      }else storageRootDir=project.storageRootDir;
      const store=new NarrationBundleStorage({projectId:project.id,storageRootDir});
      const bytes=await store.readFile({record,kind:match.kind,...(revision?{revision}:{})});
      writeNarrationBytes(response,bytes,match.kind!);return;
    }
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

function writeNarrationBytes(response:ServerResponse,data:Buffer,kind:string):void{
  const mime:Record<string,string>={audio:'audio/wav',timing:'application/json; charset=utf-8',events:'application/json; charset=utf-8',srt:'application/x-subrip; charset=utf-8',vtt:'text/vtt; charset=utf-8'};
  response.setHeader('content-type',mime[kind]!);response.setHeader('x-content-type-options','nosniff');
  response.setHeader('cache-control','private, no-store');
  if(kind==='audio'){
    response.setHeader('accept-ranges','bytes');
    const range=response.req?.headers.range;
    if(range){
      const match=/^bytes=(\d*)-(\d*)$/.exec(range);
      let start=0,end=data.length-1;
      if(match){
        if(!match[1]){const suffix=Number(match[2]);start=Math.max(0,data.length-suffix);if(suffix<=0)start=data.length;}
        else {start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),data.length-1):end;}
      }
      if(!match||(!match[1]&&!match[2])||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=data.length||start>end){
        response.statusCode=416;response.setHeader('content-range',`bytes */${data.length}`);response.end();return;
      }
      response.statusCode=206;response.setHeader('content-range',`bytes ${start}-${end}/${data.length}`);response.setHeader('content-length',end-start+1);response.end(data.subarray(start,end+1));return;
    }
  }
  response.statusCode=200;response.setHeader('content-length',data.length);response.end(data);
}
