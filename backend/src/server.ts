import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { buildApp, type AppInstance } from "./app";

async function readPayload(request: IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  if (!rawBody) {
    return undefined;
  }

  const contentType = request.headers["content-type"] ?? "";
  if (contentType.includes("application/json")) {
    return JSON.parse(rawBody);
  }

  return rawBody;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

export function createHttpServer(app: AppInstance = buildApp()): Server {
  return createServer(async (request, response) => {
    if (!request.method || !request.url) {
      writeJson(response, 400, {
        error: "invalid_http_request",
      });
      return;
    }

    if (request.method === "GET" && request.url === "/healthz") {
      writeJson(response, 200, app.healthcheck());
      return;
    }

    let payload: unknown;
    try {
      payload = await readPayload(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid_request_payload";
      writeJson(response, 400, {
        error: "invalid_request_payload",
        message,
      });
      return;
    }

    try {
      const requestUrl = new URL(request.url, "http://127.0.0.1");
      const appResponse = await app.inject({
        method: request.method,
        url: requestUrl.pathname,
        payload,
      });

      writeJson(response, appResponse.statusCode, appResponse.json());
    } catch (error) {
      const message = error instanceof Error ? error.message : "internal_server_error";
      writeJson(response, 500, {
        error: "internal_server_error",
        message,
      });
    }
  });
}

export async function startServer(options?: {
  app?: AppInstance;
  host?: string;
  port?: number;
}) {
  const host = options?.host ?? "127.0.0.1";
  const port = options?.port ?? 3000;
  const server = createHttpServer(options?.app);

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(port, host, () => {
      server.off("error", rejectPromise);
      resolvePromise();
    });
  });

  return {
    host,
    port,
    server,
  };
}

function isDirectRun() {
  return !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  startServer()
    .then(({ host, port }) => {
      console.log(JSON.stringify({
        status: "backend-server-ready",
        host,
        port,
      }));
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : "server_start_failed";
      console.error(JSON.stringify({
        status: "backend-server-failed",
        message,
      }));
      process.exitCode = 1;
    });
}
