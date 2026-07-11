import { afterEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import { existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildApp } from "../../backend/src/app.js";
import { createHttpServer, startServer } from "../../backend/src/server.js";
import { resolveServerHost } from "../../backend/src/server.js";

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
    const server = createHttpServer();
    servers.push(server);
    const port = await listen(server);

    const response = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "HTTP Server Contract",
      }),
    });
    const body = (await response.json()) as {
      project_id: string;
      current_status: string;
    };

    expect(response.status).toBe(201);
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
          migrationApplied: true,
          pragmasValid: true,
          legacyImportVerified: false,
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
      const started = await startServer({ host: "127.0.0.1", port: 0 });
      expect(existsSync(databasePath)).toBe(false);
      await close(started.server);
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
});
