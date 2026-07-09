import { createReadStream, statSync } from "node:fs";
import { extname, resolve, relative, isAbsolute, sep, basename } from "node:path";
import type { ServerResponse } from "node:http";

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".srt": "text/plain",
  ".vtt": "text/plain",
};

export interface FileResponseOptions {
  disposition?: "inline" | "attachment";
  filename?: string;
}

function isPathInside(filePath: string, root: string): boolean {
  const rootAbs = resolve(root);
  const fileAbs = resolve(filePath);
  const rel = relative(rootAbs, fileAbs);
  if (rel !== "" && rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel)) {
    return true;
  }
  // Handle migrated data where file_uri is an absolute path from another machine.
  // Old path format: <any-prefix>/storage/projects/<date>/<name> [<id>]/renders/.../output.mp4
  // New path: after resolve(storageRoot) it becomes <cwd>/storage/projects/<date>/<name> [<id>]
  // We need to extract the part after the project root and reconstruct.
  if (isAbsolute(filePath)) {
    const normalized = filePath.replace(/\\/g, "/");
    const marker = "/storage/projects/";
    const idx = normalized.indexOf(marker);
    if (idx !== -1) {
      // after marker: "<date>/<name> [<id>]/(renders|assets-runs)/..."
      const afterMarker = normalized.slice(idx + marker.length);
      const segments = afterMarker.split("/");
      // Project root = 2 segments: date + displayName[shortId]
      if (segments.length > 2) {
        const relativeFromProject = segments.slice(2).join("/");
        const reconstructed = resolve(rootAbs, relativeFromProject);
        const rel2 = relative(rootAbs, reconstructed);
        return rel2 !== "" && rel2 !== ".." && !rel2.startsWith(".." + sep) && !isAbsolute(rel2);
      }
    }
  }
  return false;
}

export function writeFileStream(
  response: ServerResponse,
  filePath: string,
  storageRoot: string,
  options: FileResponseOptions = {},
): void {
  if (!isPathInside(filePath, storageRoot)) {
    response.statusCode = 403;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: "path_traversal_denied" }));
    return;
  }

  const resolved = resolve(filePath);
  let fileStat;
  try {
    fileStat = statSync(resolved);
    if (!fileStat.isFile()) {
      response.statusCode = 403;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ error: "not_a_file" }));
      return;
    }
  } catch {
    response.statusCode = 404;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: "file_not_found" }));
    return;
  }

  const ext = extname(resolved).toLowerCase();
  const contentType = MIME_MAP[ext] ?? "application/octet-stream";

  response.setHeader("content-type", contentType);
  response.setHeader("accept-ranges", "bytes");

  const disposition = options.disposition ?? "inline";
  const downloadName = options.filename ?? basename(resolved);

  // RFC 5987: encode non-ASCII characters for Content-Disposition
  const hasNonAscii = /[^\x00-\x7F]/.test(downloadName);
  if (hasNonAscii) {
    const encoded = encodeURIComponent(downloadName);
    // ASCII-safe fallback for legacy clients
    const asciiFallback = downloadName.replace(/[^\x00-\x7F]/g, "_");
    response.setHeader(
      "content-disposition",
      `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`,
    );
  } else {
    response.setHeader(
      "content-disposition",
      `${disposition}; filename="${downloadName}"`,
    );
  }

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

  response.statusCode = 200;
  response.setHeader("content-length", fileStat.size);
  createReadStream(resolved).pipe(response);
}
