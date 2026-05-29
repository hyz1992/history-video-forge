import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { matchFileRoute, handleFileRoute } from "../../../backend/src/http/file-routes.js";
import { buildApp, type AppInstance } from "../../../backend/src/app.js";
import { createServer, type Server } from "node:http";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

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

describe("handleFileRoute via HTTP server", () => {
  let server: Server;
  let port: number;
  let app: AppInstance;
  let storageRoot: string;
  const TEST_DIR = join(process.cwd(), ".test-file-routes");

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
    // Create a project
    const db = app.db;
    db.projects.set("test-project", {
      id: "test-project",
      name: "Test Project",
      status: "assets_ready",
      storageRootDir: storageRoot,
      activeTopicPackageId: null,
      activeScriptRecordId: null,
      activeStoryboardRecordId: null,
      activeAssetPlanRecordId: null,
      activeAssetManifestRecordId: "manifest_001",
      activeComposeRecordId: null,
      activeRenderJobRecordId: null,
      latestTopicRunTraceJson: null,
      latestScriptRunTraceJson: null,
      latestStoryboardRunTraceJson: null,
      latestAssetPlanRunTraceJson: null,
      latestAssetsRunTraceJson: null,
      latestComposeRunTraceJson: null,
      latestRenderRunTraceJson: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Create manifest record with an image artifact
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

  it("返回 artifact 文件", async () => {
    const { status, headers, body } = await request("/api/projects/test-project/artifacts/artifact_img_001/file");
    expect(status).toBe(200);
    expect(headers["content-type"]).toBe("image/png");
    expect(body.length).toBe(6);
  });

  it("不存在的 artifact 返回 404", async () => {
    const { status, body } = await request("/api/projects/test-project/artifacts/nonexistent/file");
    expect(status).toBe(404);
    expect(JSON.parse(body.toString()).error).toBe("artifact_not_found");
  });

  it("不存在的项目返回 404", async () => {
    const { status } = await request("/api/projects/nonexistent/artifacts/a1/file");
    expect(status).toBe(404);
  });

  it("render preview 无输出返回 404", async () => {
    const { status } = await request("/api/projects/test-project/render/preview");
    expect(status).toBe(404);
    // body is JSON with error
  });
});
