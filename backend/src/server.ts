import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { buildApp, type AppInstance } from "./app";
import { createLocalRemotionRenderAdapter } from "./modules/render/local-remotion-render-adapter.js";
import type { RenderAdapter } from "./modules/render/render-adapter.js";

function resolveRenderAdapter(): RenderAdapter | undefined {
  const mode = (process.env.RENDER_ADAPTER ?? "remotion").toLowerCase();
  if (mode === "remotion") return createLocalRemotionRenderAdapter();
  if (mode === "fake") return undefined;
  console.warn(`Unknown RENDER_ADAPTER "${mode}", falling back to fake`);
  return undefined;
}
import { matchFileRoute, handleFileRoute } from "./http/file-routes.js";
import { parseMultipart } from "./http/multipart.js";
import { tryServeStatic } from "./http/static-files.js";

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

export function createHttpServer(
  app: AppInstance = buildApp({ renderAdapter: resolveRenderAdapter() }),
  options?: { publicDir?: string },
): Server {
  const isProduction = process.env.NODE_ENV === "production";
  const publicDir = options?.publicDir ?? resolve(process.cwd(), "frontend", "dist");
  const canServeStatic = isProduction && !!publicDir && existsSync(publicDir);

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

    const requestUrl = new URL(request.url, "http://127.0.0.1");

    // 生产模式：托管前端静态资源（单端口部署）
    if (canServeStatic && request.method === "GET" && !requestUrl.pathname.startsWith("/api")) {
      if (tryServeStatic(response, requestUrl.pathname, publicDir)) {
        return;
      }
      writeJson(response, 404, { error: "Not Found" });
      return;
    }

    // 1. File service routes (bypass app.inject, don't consume request body)
    const fileMatch = matchFileRoute(request.method, requestUrl.pathname);
    if (fileMatch) {
      try {
        await handleFileRoute(fileMatch, response, app);
      } catch (error) {
        response.statusCode = 500;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ error: "file_serve_error" }));
      }
      return;
    }

    // 2. Multipart upload (parse then pass to app.inject, skip readPayload)
    const contentType = request.headers["content-type"] ?? "";
    if (request.method === "POST" && contentType.includes("multipart/form-data")) {
      try {
        const multipartResult = await parseMultipart(request);
        const appResponse = await app.inject({
          method: request.method,
          url: requestUrl.pathname,
          payload: { file: multipartResult.file },
        });
        writeJson(response, appResponse.statusCode, appResponse.json());
      } catch (error) {
        response.statusCode = 400;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ error: "multipart_parse_error" }));
      }
      return;
    }

    // 3. All other routes: existing readPayload + app.inject flow
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
  publicDir?: string;
}) {
  const host = options?.host ?? process.env.SERVER_HOST ?? "127.0.0.1";
  const port = options?.port ?? (Number(process.env.SERVER_PORT) || 3000);
  const publicDir = options?.publicDir ?? process.env.PUBLIC_DIR;
  const server = createHttpServer(options?.app, { publicDir });

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
