import { afterEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import { existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import { buildApp } from "../../backend/src/app.js";
import { createHttpServer, startServer } from "../../backend/src/server.js";
import { buildTestAuth } from "./auth/test-utils.js";
import { resolveServerHost } from "../../backend/src/server.js";
import { createPrismaClient } from "../../backend/src/db/prisma-client.js";
import { syncEventLibraryFromFiles } from "../../backend/src/modules/event-library/event-library-sync.service.js";
import { applyAllDatabaseMigrations } from "./db/migration-test-utils.js";

async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("server_address_unavailable");
  }

  return address.port;
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

describe("backend http server", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    while (servers.length > 0) {
      const server = servers.pop();
      if (server) {
        await close(server);
      }
    }
  });

  it("exposes the app healthcheck over real HTTP", async () => {
    const server = createHttpServer();
    servers.push(server);
    const port = await listen(server);

    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    const body = (await response.json()) as {
      status: string;
      nodeEnv: string;
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      nodeEnv: expect.any(String),
    });
  });

  it("accepts JSON requests for the existing API routes", async () => {
    const app = buildApp();
    const auth = buildTestAuth();

    const response = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "HTTP Server Contract",
      },
      auth,
    });
    const body = response.json() as {
      project_id: string;
      current_status: string;
    };

    expect(response.statusCode).toBe(201);
    expect(body.project_id).toBeTypeOf("string");
    expect(body.current_status).toBe("topic_pending");
  });

  it("returns readiness separately from process liveness", async () => {
    const app = buildApp({ skipSnapshotLoad: true });
    const server = createHttpServer(app);
    servers.push(server);
    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/readyz`);
    expect(response.status).toBe(503);
    expect((await response.json()) as { status: string }).toMatchObject({ status: "not_ready" });
  });

  it("includes database readiness and returns 503 when the database gate fails", async () => {
    const app = buildApp({
      skipSnapshotLoad: true,
      databaseReadiness: async () => ({
        ready: false,
        error: "legacy_import_unverified",
        checks: {
          queryable: true,
          writable: true,
          migrationsValid: true,
          pragmasValid: true,
          integrityValid: true,
          activated: false,
        },
      }),
    });
    app.persistenceHealth.loaded = true;
    app.mediaLibraryHealth.loaded = true;
    const server = createHttpServer(app);
    servers.push(server);
    const port = await listen(server);

    const response = await fetch(`http://127.0.0.1:${port}/readyz`);
    const body = await response.json() as { database: { error: string } };
    expect(response.status).toBe(503);
    expect(body.database.error).toBe("legacy_import_unverified");
  });

  it("disconnects an owned Prisma client when the server closes", async () => {
    const disconnect = vi.fn(async () => undefined);
    const app = buildApp({ skipSnapshotLoad: true });
    const started = await startServer({
      app,
      prismaClient: { $disconnect: disconnect } as never,
      host: "127.0.0.1",
      port: 0,
    });
    await close(started.server);
    await vi.waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1));
  });

  it("does not silently create a missing production database", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-missing-database-"));
    const databasePath = join(root, "missing.db");
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousRenderAdapter = process.env.RENDER_ADAPTER;
    process.env.DATABASE_URL = databasePath;
    process.env.RENDER_ADAPTER = "fake";
    try {
      await expect(startServer({ host: "127.0.0.1", port: 0 })).rejects.toThrow("database_not_initialized");
      expect(existsSync(databasePath)).toBe(false);
    } finally {
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
      if (previousRenderAdapter === undefined) delete process.env.RENDER_ADAPTER;
      else process.env.RENDER_ADAPTER = previousRenderAdapter;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exposes isolated snapshot load failures through persistence health", () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-app-persistence-"));
    mkdirSync(join(root, "storage"), { recursive: true });
    writeFileSync(join(root, "storage", "db-snapshot.json"), "{broken", "utf8");

    const app = buildApp({ storageBaseDir: root });

    expect(app.persistenceHealth).toMatchObject({
      loaded: false,
      source: "none",
      error: expect.any(String),
    });
  });

  it("returns 503 when an isolated state-changing request cannot persist", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-app-persistence-failure-"));
    mkdirSync(join(root, "storage", "db-snapshot.json"), { recursive: true });
    const app = buildApp({ storageBaseDir: root });

    const response = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "persistence failure" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "persistence_failed" });
  });

  it("rejects unauthenticated remote binding without explicit opt-in", () => {
    expect(resolveServerHost({ host: "127.0.0.1", allowUnauthenticatedRemote: false })).toBe("127.0.0.1");
    expect(() => resolveServerHost({ host: "0.0.0.0", allowUnauthenticatedRemote: false }))
      .toThrow("unsafe_unauthenticated_remote_bind");
    expect(resolveServerHost({ host: "0.0.0.0", allowUnauthenticatedRemote: true })).toBe("0.0.0.0");
  });

  it("rejects concurrent generation requests for the same project stage", async () => {
    const app = buildApp({ skipSnapshotLoad: true });
    let resolveFirst!: () => void;
    const firstFinished = new Promise<void>((resolve) => { resolveFirst = resolve; });
    app.addRoute("POST", "/api/projects/:projectId/script/generate-lock-test", async () => {
      await firstFinished;
      return { statusCode: 200, body: { ok: true } };
    });

    const first = app.inject({ method: "POST", url: "/api/projects/p1/script/generate-lock-test" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await app.inject({ method: "POST", url: "/api/projects/p1/script/generate-lock-test" });
    expect(second.statusCode).toBe(409);
    resolveFirst();
    expect((await first).statusCode).toBe(200);
  });

  it("passes GET query params to event-library list filter", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-http-query-"));
    const libDir = join(root, "storage", "event-library");
    mkdirSync(join(libDir, "tang"), { recursive: true });

    const makeJson = (overrides: Record<string, unknown>) => JSON.stringify({
      schemaVersion: 1,
      canonicalTitle: "X",
      summary: "X",
      eventRegistryCanonicalName: "X",
      aliases: [],
      dynasty: "唐",
      era: "初唐",
      characterTags: [],
      eventTypeTags: [],
      conflictTypeTags: [],
      themeMotifs: [],
      timeRange: { start: "600", end: "700", display: "七世纪" },
      locationTags: [],
      relationshipTags: [],
      sourceAnchorRefs: [],
      credibilityLevel: "high",
      disputeNotes: null,
      origin: "builtin",
      angles: [],
      ...overrides,
    });

    writeFileSync(join(libDir, "tang", "event_a.json"), makeJson({
      canonicalTitle: "事件A", eventRegistryCanonicalName: "事件A", dynasty: "唐",
    }), "utf8");
    writeFileSync(join(libDir, "tang", "event_b.json"), makeJson({
      canonicalTitle: "事件B", eventRegistryCanonicalName: "事件B", dynasty: "宋",
    }), "utf8");

    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const prismaClient = await createPrismaClient(dbPath);
    try {
      await syncEventLibraryFromFiles(prismaClient, root);
      const app = buildApp({ storageBaseDir: root, prismaClient, skipSnapshotLoad: true });
      const server = createHttpServer(app);
      servers.push(server);
      const port = await listen(server);

      // 无筛选：应返回全部 2 条
      const rAll = await fetch(`http://127.0.0.1:${port}/api/event-library/entries`);
      const bodyAll = await rAll.json() as { total: number };
      expect(bodyAll.total).toBe(2);

      // 按 dynasty=唐 筛选：应只返回 1 条
      const rTang = await fetch(`http://127.0.0.1:${port}/api/event-library/entries?dynasty=唐`);
      const bodyTang = await rTang.json() as { total: number; entries: Array<{ canonical_title: string }> };
      expect(bodyTang.total).toBe(1);
      expect(bodyTang.entries[0].canonical_title).toBe("事件A");

      // 按 dynasty=宋 筛选
      const rSong = await fetch(`http://127.0.0.1:${port}/api/event-library/entries?dynasty=宋`);
      const bodySong = await rSong.json() as { total: number };
      expect(bodySong.total).toBe(1);

      // 按 q=事件A 搜索
      const rQ = await fetch(`http://127.0.0.1:${port}/api/event-library/entries?q=事件A`);
      const bodyQ = await rQ.json() as { total: number };
      expect(bodyQ.total).toBe(1);
    } finally {
      await prismaClient.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
