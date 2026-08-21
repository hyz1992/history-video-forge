import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildApp } from "../../../backend/src/app.js";
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { activateDatabase } from "../../../backend/src/db/database-activation.js";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";
import { hashPassword } from "../../../backend/src/auth/password-hash.js";
import { PrismaSessionStore } from "../../../backend/src/auth/session-store.js";
import { buildTestAuth } from "../auth/test-utils.js";

const USER_PASSWORD = "a-strong-user-password-99";

const MINIMAL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

function httpRequest(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const http = require("node:http");
    const bodyStr = body ? JSON.stringify(body) : "";
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(bodyStr),
          ...headers,
        },
      },
      (res: any) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          let parsed: any;
          try { parsed = JSON.parse(Buffer.concat(chunks).toString()); } catch { parsed = null; }
          resolve({ status: res.statusCode, body: parsed });
        });
      },
    );
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}

describe("upload + file serve integration", () => {
  let server: Server;
  let port: number;
  let app: ReturnType<typeof buildApp>;
  let storageRoot: string;
  let projectId: string;
  let createdUserId: string;
  const TEST_DIR = join(process.cwd(), ".test-e2e-smoke");

  beforeEach(async () => {
    storageRoot = join(TEST_DIR, `storage-${Date.now()}`);
    mkdirSync(storageRoot, { recursive: true });

    // S2-2A 起 createHttpServer 在存在 sessionStore 时强制鉴权，测试需先建库建
    // 用户并登录（与 auth-api.test.ts 同构），否则所有 /api 请求返回 401。
    const root = mkdtempSync(join(tmpdir(), "svf2-upload-serve-"));
    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();
    const client = await createPrismaClient(dbPath);
    await activateDatabase(client, { mode: "fresh" });
    const createdUser = await client.user.create({
      data: {
        username: "alice",
        displayName: "Alice",
        passwordHash: await hashPassword(USER_PASSWORD),
        role: "USER",
        status: "ACTIVE",
        mustChangePassword: false,
      },
    });
    createdUserId = createdUser.id;

    app = buildApp({ prismaClient: client, skipSnapshotLoad: true });
    const db = app.db;

    // Create project（owner 需为登录用户，guardOwnedRoute 强制所有权）
    const project = {
      id: db.generateId(),
      name: "E2E Test",
      status: "asset_plan_ready",
      storageRootDir: storageRoot,
      ownerId: createdUserId,
      activeTopicPackageId: "tp_001",
      activeScriptRecordId: "sc_001",
      activeStoryboardRecordId: "sb_001",
      activeAssetPlanRecordId: "ap_001",
      activeAssetManifestRecordId: null,
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
    };
    projectId = project.id;
    db.projects.set(projectId, project);

    // Create storyboard
    db.storyboardRecords.set("sb_001", {
      id: "sb_001",
      projectId,
      topicPackageId: "tp_001",
      scriptRecordId: "sc_001",
      planJson: {
        segments: [
          { segment_id: "seg_001", visual_description: "测试画面", narration_text: "测试旁白", duration_estimate_sec: 20 },
        ],
      },
      validationResultJson: { decision: "pass" },
      executionStateJson: {},
      graphTraceSummaryJson: {},
      runtimeDiagnosticsJson: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Create asset plan with image task that allows manual upload
    db.assetPlanRecords.set("ap_001", {
      id: "ap_001",
      projectId,
      topicPackageId: "tp_001",
      scriptRecordId: "sc_001",
      storyboardRecordId: "sb_001",
      planJson: {
        plan_version: "asset_plan_v1",
        source_storyboard_record_id: "sb_001",
        source_script_record_id: "sc_001",
        source_topic_package_id: "tp_001",
        art_bible: { era_style: "test", visual_tone: "test", characters: [], locations: [], props: [], global_prompt_prefix: "", global_negative_prompts: [], consistency_notes: [] },
        visual_budget: {},
        downgrade_policy: {},
        global_audio_strategy: {},
        tts_plan: {
          voice_profile_id: "voice_001",
          estimated_total_duration_sec: 20,
          chunking_strategy: "segment_boundary",
          chunks: [{ chunk_id: "chunk_1", order: 0, script_excerpt: "旁白", estimated_duration_sec: 20 }],
        },
        tasks: [
          {
            task_id: "tts_001", order: 0, task_type: "tts_audio",
            source_segment_id: null, source_excerpt: "全片", production_intent: "TTS",
            recommended_mode: "auto", provider_hint: "fake_tts", prompt_draft: null,
            parameters: {}, manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
            risk_notes: [], cost_tier: "low", initial_status: "planned",
          },
          {
            task_id: "img_001", order: 1, task_type: "image_still",
            source_segment_id: "seg_001", source_excerpt: "画面", production_intent: "图片",
            recommended_mode: "manual_allowed", provider_hint: "image_provider", prompt_draft: "测试图",
            parameters: {},
            manual_upload_policy: { allowed: true, required: false, accepted_file_types: ["image/png", "image/jpeg"], acceptance_notes: [] },
            risk_notes: [], cost_tier: "low", initial_status: "planned",
          },
          {
            task_id: "bgm_001", order: 2, task_type: "bgm_cue",
            source_segment_id: null, source_excerpt: "BGM", production_intent: "BGM",
            recommended_mode: "auto", provider_hint: null, prompt_draft: null,
            parameters: { scope: "global" },
            manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
            risk_notes: [], cost_tier: "medium", initial_status: "planned",
          },
        ],
        dependencies: [],
        cost_summary: { total_tasks: 3, by_type: {}, by_cost_tier: {}, estimated_provider_calls: 3, notes: [] },
        global_production_notes: [],
      } as any,
      validationResultJson: { decision: "pass" } as any,
      executionStateJson: {},
      graphTraceSummaryJson: {},
      runtimeDiagnosticsJson: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { createHttpServer } = await import("../../../backend/src/server.js");
    server = createHttpServer(app, { sessionStore: new PrismaSessionStore(client) });
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    port = (server.address() as any).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("full flow: generate with partial providers → upload → file serve", async () => {
    // 登录获取会话 cookie（server 级鉴权强制）
    const loginRes = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "alice", password: USER_PASSWORD }),
    });
    expect(loginRes.status).toBe(200);
    const setCookie = loginRes.headers.get("set-cookie");
    expect(setCookie).toContain("session=");
    const cookie = setCookie!.split(";")[0]!;

    // Step 1: Generate with enabled_provider_types excluding image
    const genResponse = await httpRequest(port, "POST", `/api/projects/${projectId}/assets/generate`, {
      voice_profile_id: "voice_001",
      execution_mode: "dry_run",
      enabled_provider_types: ["tts", "sfx", "bgm"],
    }, { cookie });
    expect(genResponse.status).toBe(200);
    expect(genResponse.body.manifest).toBeDefined();

    // Verify image task is waiting_manual_upload
    const manifest = genResponse.body.manifest;
    const imgExec = manifest.executions.find((e: any) => e.task_type === "image_still");
    expect(imgExec).toBeDefined();
    expect(imgExec.status).toBe("waiting_manual_upload");

    // Step 2: Upload image via app.inject (simulating multipart)。inject 不经过
    // createHttpServer 的会话中间件，需直接注入 auth 上下文（与其余 guardOwnedRoute
    // 测试同构）。
    const uploadResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/assets/tasks/img_001/artifacts/upload`,
      auth: buildTestAuth({ userId: createdUserId, role: "USER" }),
      payload: {
        file: {
          buffer: MINIMAL_PNG,
          originalName: "test.png",
          mimeType: "image/png",
          truncated: false,
        },
      },
    });
    expect(uploadResponse.statusCode).toBe(200);
    const uploadBody = uploadResponse.json();
    expect(uploadBody.manifest).toBeDefined();

    // Verify artifact registered
    const imgArtifact = uploadBody.manifest.artifacts.find((a: any) => a.artifact_type === "image");
    expect(imgArtifact).toBeDefined();
    expect(imgArtifact.metadata.width).toBe(1);

    // Verify segment route updated
    const route = uploadBody.manifest.segment_routes.find((r: any) => r.segment_id === "seg_001");
    expect(route).toBeDefined();
    expect(route.primary_visual_artifact_id).toBe(imgArtifact.artifact_id);

    // Step 3: File serve - get artifact via HTTP
    const fileResponse = await new Promise<{ status: number; headers: Record<string, string>; body: Buffer }>((resolve, reject) => {
      const http = require("node:http");
      const req = http.request(
        { hostname: "127.0.0.1", port, path: `/api/projects/${projectId}/artifacts/${imgArtifact.artifact_id}/file`, method: "GET", headers: { cookie } },
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
    expect(fileResponse.status).toBe(200);
    expect(fileResponse.headers["content-type"]).toBe("image/png");
  });
});
