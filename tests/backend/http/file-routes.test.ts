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
