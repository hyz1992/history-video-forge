import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildApp } from "../../backend/src/app.js";
import { createHttpServer } from "../../backend/src/server.js";

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
});
