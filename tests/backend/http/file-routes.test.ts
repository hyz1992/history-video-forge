import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../backend/src/http/file-response.js", () => ({
  writeFileStream: vi.fn((response: any) => {
    response.statusCode = 200;
    response.setHeader("content-type", "image/png");
    response.end();
  }),
}));

import { matchFileRoute, handleFileRoute } from "../../../backend/src/http/file-routes.js";
import { buildApp, type AppInstance } from "../../../backend/src/app.js";
import { createServer, type Server } from "node:http";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ServerResponse } from "node:http";
import type { AuthenticatedAuthContext } from "../../../backend/src/auth/auth-context.js";
import { createAuthenticatedAuthContext, createAnonymousAuthContext } from "../../../backend/src/auth/auth-context.js";
import { NarrationRepository } from '../../../backend/src/modules/narration/narration.repository.js';
import { NarrationBundleStorage } from '../../../backend/src/modules/narration/narration-bundle-storage.js';
import { buildProjectStorageRelativeDir } from '../../../backend/src/runtime/trace/project-storage.js';

const OWNER_USER_ID = "owner-1";

function buildAuth(overrides: { userId?: string; role?: "ADMIN" | "USER" } = {}): AuthenticatedAuthContext {
  return createAuthenticatedAuthContext({
    userId: overrides.userId ?? OWNER_USER_ID,
    username: overrides.userId ?? OWNER_USER_ID,
    displayName: overrides.userId ?? OWNER_USER_ID,
    role: overrides.role ?? "USER",
    sessionId: "session-1",
  });
}

class MockResponse {
  statusCode = 200;
  headers: Record<string, string | string[]> = {};
  body: string = "";
  ended = false;

  setHeader(name: string, value: string | string[]): void {
    this.headers[name.toLowerCase()] = value;
  }

  end(data?: unknown): void {
    if (data !== undefined) this.body = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
    this.ended = true;
  }

  get bodyJson(): unknown {
    return JSON.parse(this.body);
  }
}

describe("matchFileRoute", () => {
  it("GET artifact file 匹配", () => {
    const result = matchFileRoute("GET", "/api/projects/p1/artifacts/a1/file");
    expect(result).toEqual({ type: "artifact_file", projectId: "p1", artifactId: "a1" });
  });

  it("GET render preview 匹配", () => {
    const result = matchFileRoute("GET", "/api/projects/p1/render/preview");
    expect(result).toEqual({ type: "render_preview", projectId: "p1" });
  });

  it("GET render download 匹配", () => {
    const result = matchFileRoute("GET", "/api/projects/p1/render/download");
    expect(result).toEqual({ type: "render_download", projectId: "p1" });
  });

  it("POST 不匹配", () => {
    expect(matchFileRoute("POST", "/api/projects/p1/artifacts/a1/file")).toBeNull();
  });

  it("不相关路径不匹配", () => {
    expect(matchFileRoute("GET", "/api/projects/p1/assets/generate")).toBeNull();
  });
  it('新口播仅匹配记录标识及白名单kind，拒绝编码/路径',()=>{
    expect(matchFileRoute('GET','/api/projects/p1/script/narrations/n1/files/audio')).toMatchObject({type:'narration_file',projectId:'p1',recordId:'n1',kind:'audio'});
    expect(matchFileRoute('GET','/api/projects/p1/script/narrations/n1/subtitles/s1/files/srt')).toMatchObject({type:'narration_subtitle_file',revisionId:'s1',kind:'srt'});
    for(const path of ['files/srt','files/manifest','files/..%2faudio','subtitles/s1/files/audio','subtitles/%2e%2e/files/vtt'])expect(matchFileRoute('GET',`/api/projects/p1/script/narrations/n1/${path}`)).toBeNull();
  });
});

describe("handleFileRoute authorization", () => {
  let app: AppInstance;
  let storageRoot: string;
  const TEST_DIR = join(process.cwd(), ".test-file-routes");

  beforeEach(() => {
    storageRoot = join(TEST_DIR, `storage-${Date.now()}`);
    mkdirSync(storageRoot, { recursive: true });

    app = buildApp();
    const db = app.db;
    db.projects.set("test-project", {
      id: "test-project",
      name: "Test Project",
      ownerId: OWNER_USER_ID,
      createdById: OWNER_USER_ID,
      status: "assets_ready",
      storageRootDir: storageRoot,
      storageDisplayName: "Test Project",
      storageShortId: "test-proj",
      storageRenameLocked: false,
      activeTopicPackageId: null,
      activeScriptRecordId: null,
      activeStoryboardRecordId: null,
      activeAssetPlanRecordId: null,
      activeAssetManifestRecordId: "manifest_001",
      activeComposeRecordId: null,
      activeRenderJobRecordId: null,
      activePublishPackageRecordId: null,
      latestTopicRunTraceJson: null,
      latestScriptRunTraceJson: null,
      latestStoryboardRunTraceJson: null,
      latestAssetPlanRunTraceJson: null,
      latestAssetsRunTraceJson: null,
      latestComposeRunTraceJson: null,
      latestRenderRunTraceJson: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const artifactDir = join(storageRoot, "assets-runs", "manifest_001");
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, "test.png"), Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x00, 0x00]));

    db.assetManifestRecords.set("manifest_001", {
      id: "manifest_001",
      projectId: "test-project",
      topicPackageId: "tp_001",
      scriptRecordId: "sc_001",
      storyboardRecordId: "sb_001",
      assetPlanRecordId: "ap_001",
      manifestJson: {
        artifacts: [
          { artifact_id: "artifact_img_001", file_uri: join(artifactDir, "test.png") },
        ],
      } as any,
      validationResultJson: { decision: "blocked" } as any,
      executionStateJson: {},
      graphTraceSummaryJson: {},
      runtimeDiagnosticsJson: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  async function callHandleFileRoute(
    match: ReturnType<typeof matchFileRoute>,
    auth: Parameters<typeof handleFileRoute>[3],
  ): Promise<MockResponse> {
    const res = new MockResponse();
    await handleFileRoute(match!, res as unknown as ServerResponse, app, auth);
    return res;
  }

  it("匿名访问 artifact 文件返回 401", async () => {
    const match = matchFileRoute("GET", "/api/projects/test-project/artifacts/artifact_img_001/file");
    const res = await callHandleFileRoute(match, createAnonymousAuthContext());
    expect(res.statusCode).toBe(401);
    expect(res.bodyJson).toMatchObject({ error: "unauthorized" });
  });

  it("owner 访问自己的 artifact 文件返回 200", async () => {
    const match = matchFileRoute("GET", "/api/projects/test-project/artifacts/artifact_img_001/file");
    const res = await callHandleFileRoute(match, buildAuth({ userId: OWNER_USER_ID }));
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
  });

  it("普通 user 访问他人项目 artifact 返回 404", async () => {
    const match = matchFileRoute("GET", "/api/projects/test-project/artifacts/artifact_img_001/file");
    const res = await callHandleFileRoute(match, buildAuth({ userId: "user-b" }));
    expect(res.statusCode).toBe(404);
    expect(res.bodyJson).toMatchObject({ error: "project_not_found" });
  });

  it("ADMIN 访问他人项目 artifact 返回 200", async () => {
    const match = matchFileRoute("GET", "/api/projects/test-project/artifacts/artifact_img_001/file");
    const res = await callHandleFileRoute(match, buildAuth({ userId: "admin-x", role: "ADMIN" }));
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
  });

  it("无效/不存在项目返回 404", async () => {
    const match = matchFileRoute("GET", "/api/projects/nonexistent/artifacts/a1/file");
    const res = await callHandleFileRoute(match, buildAuth());
    expect(res.statusCode).toBe(404);
    expect(res.bodyJson).toMatchObject({ error: "project_not_found" });
  });

  it("owner 访问 render preview 无输出返回 404", async () => {
    const match = matchFileRoute("GET", "/api/projects/test-project/render/preview");
    const res = await callHandleFileRoute(match, buildAuth());
    expect(res.statusCode).toBe(404);
    expect(res.bodyJson).toMatchObject({ error: "render_output_not_found" });
  });

  it("owner 访问不存在的 artifact 返回 404", async () => {
    const match = matchFileRoute("GET", "/api/projects/test-project/artifacts/nonexistent/file");
    const res = await callHandleFileRoute(match, buildAuth());
    expect(res.statusCode).toBe(404);
    expect(res.bodyJson).toMatchObject({ error: "artifact_not_found" });
  });
  it('口播文件授权：owner/ADMIN可读，其他用户拒绝且不读取媒体',async()=>{
    const record={id:'n1',projectId:'test-project',generationRunId:'run1',output:{audio:{sha256:'a'.repeat(64)}}};
    const repo=vi.spyOn(NarrationRepository.prototype,'findByIdForOwner').mockResolvedValue(record as never);
    const read=vi.spyOn(NarrationBundleStorage.prototype,'readFile').mockResolvedValue(Buffer.from('audio bytes'));
    const match=matchFileRoute('GET','/api/projects/test-project/script/narrations/n1/files/audio');
    expect((await callHandleFileRoute(match,buildAuth())).statusCode).toBe(200);
    expect((await callHandleFileRoute(match,buildAuth({userId:'admin',role:'ADMIN'}))).statusCode).toBe(200);
    expect(repo).toHaveBeenLastCalledWith('test-project',OWNER_USER_ID,'n1');
    expect((await callHandleFileRoute(match,buildAuth({userId:'other'}))).statusCode).toBe(404);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('Prisma项目归属为权威，Map伪owner不能越权且缺client failclosed',async()=>{
    const client={project:{findFirst:vi.fn().mockResolvedValue({id:'test-project',ownerId:'real-owner',createdAt:new Date(),displayName:'DB项目',storageKey:'test-project'})}};
    app.db.narrationPersistence.prismaClient=client as never;
    const match=matchFileRoute('GET','/api/projects/test-project/script/narrations/n1/files/audio');
    expect((await callHandleFileRoute(match,buildAuth())).statusCode).toBe(404);
    app.db.narrationPersistence.prismaClient=undefined;
    app.db.firstAggregateWriter={} as never;
    expect((await callHandleFileRoute(match,buildAuth())).statusCode).toBe(500);
  });
  it('同owner另一项目的字幕来源拒绝',async()=>{
    vi.spyOn(NarrationRepository.prototype,'findByIdForOwner').mockResolvedValue({id:'n1',projectId:'test-project',output:{}} as never);
    vi.spyOn(NarrationRepository.prototype,'findSubtitleForOwner').mockResolvedValue({id:'s1',projectId:'p2',narrationRecordId:'n1'} as never);
    const read=vi.spyOn(NarrationBundleStorage.prototype,'readFile').mockResolvedValue(Buffer.from('srt'));
    const res=await callHandleFileRoute(matchFileRoute('GET','/api/projects/test-project/script/narrations/n1/subtitles/s1/files/srt'),buildAuth());
    expect(res.statusCode).toBe(404);expect(read).not.toHaveBeenCalled();
  });
  it('冷Prisma读取使用配置storageBaseDir和DB日期布局，缺Map不影响owner',async()=>{
    app.storageBaseDir=TEST_DIR;
    const createdAt=new Date('2026-09-06T10:00:00.000Z'),displayName='数据库项目';
    const expected=join(TEST_DIR,buildProjectStorageRelativeDir({createdAt,displayName,shortId:'p_testproj'}));
    mkdirSync(join(expected,'narration-runs'),{recursive:true});
    app.db.projects.clear();
    app.db.narrationPersistence.prismaClient={project:{findFirst:vi.fn().mockResolvedValue({id:'test-project',ownerId:OWNER_USER_ID,createdAt,storageDisplayName:displayName,storageKey:'test-project'})}} as never;
    vi.spyOn(NarrationRepository.prototype,'findByIdForOwner').mockResolvedValue({id:'n1',projectId:'test-project',output:{}} as never);
    vi.spyOn(NarrationBundleStorage.prototype,'readFile').mockImplementation(async function(this: NarrationBundleStorage){
      expect((this as unknown as {options:{storageRootDir:string}}).options.storageRootDir).toBe(expected);
      return Buffer.from('audio');
    });
    const res=await callHandleFileRoute(matchFileRoute('GET','/api/projects/test-project/script/narrations/n1/files/audio'),buildAuth());
    expect(res.statusCode).toBe(200);
  });
  it('已校验音频bytes支持Range/206和416',async()=>{
    vi.spyOn(NarrationRepository.prototype,'findByIdForOwner').mockResolvedValue({id:'n1',projectId:'test-project',output:{}} as never);
    vi.spyOn(NarrationBundleStorage.prototype,'readFile').mockResolvedValue(Buffer.from('0123456789'));
    for(const [range,status,body] of [['bytes=2-4',206,'234'],['bytes=-2',206,'89'],['bytes=99-',416,'']] as const){
      const res=new MockResponse();(res as any).req={headers:{range}};
      await handleFileRoute(matchFileRoute('GET','/api/projects/test-project/script/narrations/n1/files/audio')!,res as unknown as ServerResponse,app,buildAuth());
      expect(res.statusCode).toBe(status);expect(res.body).toBe(body);
    }
  });
});

describe("handleFileRoute via HTTP server (anonymous)", () => {
  let server: Server;
  let port: number;
  let app: AppInstance;
  let storageRoot: string;
  const TEST_DIR = join(process.cwd(), ".test-file-routes-http");

  function request(
    path: string,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
    return new Promise((resolve, reject) => {
      const http = require("node:http");
      const req = http.request(
        { hostname: "127.0.0.1", port, path, method: "GET", headers },
        (res: any) => {
          const chunks: Buffer[] = [];
          const resHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === "string") resHeaders[k] = v;
            else if (Array.isArray(v)) resHeaders[k] = v.join(", ");
          }
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => resolve({ status: res.statusCode, headers: resHeaders, body: Buffer.concat(chunks) }));
        },
      );
      req.on("error", reject);
      req.end();
    });
  }

  beforeEach(async () => {
    storageRoot = join(TEST_DIR, `storage-${Date.now()}`);
    mkdirSync(storageRoot, { recursive: true });

    app = buildApp();
    const db = app.db;
    db.projects.set("test-project", {
      id: "test-project",
      name: "Test Project",
      ownerId: OWNER_USER_ID,
      createdById: OWNER_USER_ID,
      status: "assets_ready",
      storageRootDir: storageRoot,
      storageDisplayName: "Test Project",
      storageShortId: "test-proj",
      storageRenameLocked: false,
      activeTopicPackageId: null,
      activeScriptRecordId: null,
      activeStoryboardRecordId: null,
      activeAssetPlanRecordId: null,
      activeAssetManifestRecordId: "manifest_001",
      activeComposeRecordId: null,
      activeRenderJobRecordId: null,
      activePublishPackageRecordId: null,
      latestTopicRunTraceJson: null,
      latestScriptRunTraceJson: null,
      latestStoryboardRunTraceJson: null,
      latestAssetPlanRunTraceJson: null,
      latestAssetsRunTraceJson: null,
      latestComposeRunTraceJson: null,
      latestRenderRunTraceJson: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const artifactDir = join(storageRoot, "assets-runs", "manifest_001");
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, "test.png"), Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x00, 0x00]));

    db.assetManifestRecords.set("manifest_001", {
      id: "manifest_001",
      projectId: "test-project",
      topicPackageId: "tp_001",
      scriptRecordId: "sc_001",
      storyboardRecordId: "sb_001",
      assetPlanRecordId: "ap_001",
      manifestJson: {
        artifacts: [
          { artifact_id: "artifact_img_001", file_uri: join(artifactDir, "test.png") },
        ],
      } as any,
      validationResultJson: { decision: "blocked" } as any,
      executionStateJson: {},
      graphTraceSummaryJson: {},
      runtimeDiagnosticsJson: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { createHttpServer } = await import("../../../backend/src/server.js");
    server = createHttpServer(app);
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    port = (server.address() as any).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("匿名 HTTP 访问 artifact 文件返回 401", async () => {
    const { status, body } = await request("/api/projects/test-project/artifacts/artifact_img_001/file");
    expect(status).toBe(401);
    expect(JSON.parse(body.toString()).error).toBe("unauthorized");
  });

  it("匿名 HTTP 访问不存在项目返回 401（先认证再 404）", async () => {
    const { status } = await request("/api/projects/nonexistent/artifacts/a1/file");
    expect(status).toBe(401);
  });
});
