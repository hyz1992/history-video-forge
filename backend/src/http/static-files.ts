import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import type { ServerResponse } from "node:http";

const WEB_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".map": "application/json",
};

function serveFile(
  response: ServerResponse,
  filePath: string,
  rootDir: string,
): void {
  const resolved = resolve(filePath);
  const rootResolved = resolve(rootDir);

  if (!resolved.startsWith(rootResolved)) {
    response.statusCode = 403;
    response.end("Forbidden");
    return;
  }

  let fileStat: ReturnType<typeof statSync>;
  try {
    fileStat = statSync(resolved);
    if (!fileStat.isFile()) {
      response.statusCode = 404;
      response.end("Not Found");
      return;
    }
  } catch {
    response.statusCode = 404;
    response.end("Not Found");
    return;
  }

  const ext = extname(resolved).toLowerCase();
  const contentType = WEB_MIME[ext] ?? "application/octet-stream";

  response.statusCode = 200;
  response.setHeader("content-type", contentType);
  response.setHeader("content-length", fileStat.size);

  const range = response.req?.headers.range;
  if (range) {
    const total = fileStat.size;
    const match = /bytes=(\d+)-(\d*)/.exec(range);
    if (match) {
      const start = parseInt(match[1]!, 10);
      const end = match[2] ? parseInt(match[2], 10) : total - 1;
      if (start >= total || end >= total || start > end) {
        response.statusCode = 416;
        response.setHeader("content-range", `bytes */${total}`);
        response.end();
        return;
      }
      const chunkSize = end - start + 1;
      response.statusCode = 206;
      response.setHeader("content-range", `bytes ${start}-${end}/${total}`);
      response.setHeader("content-length", chunkSize);
      createReadStream(resolved, { start, end }).pipe(response);
      return;
    }
  }

  createReadStream(resolved).pipe(response);
}

export function tryServeStatic(
  response: ServerResponse,
  urlPath: string,
  publicDir: string,
): boolean {
  const safePath = urlPath === "/" ? "/index.html" : urlPath;

  if (safePath.includes("..")) {
    return false;
  }

  const filePath = join(publicDir, safePath);

  if (existsSync(filePath)) {
    const stat = statSync(filePath);
    if (stat.isFile()) {
      serveFile(response, filePath, publicDir);
      return true;
    }
  }

  const hasExtension = extname(safePath) !== "";
  if (!hasExtension) {
    const indexPath = join(publicDir, "index.html");
    if (existsSync(indexPath)) {
      serveFile(response, indexPath, publicDir);
      return true;
    }
  }

  return false;
}
