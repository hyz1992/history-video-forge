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

/**
 * Validate that filePath is inside root and return the resolved absolute path.
 * Handles three file_uri formats:
 *   1. Relative to cwd           (assets:     "storage/projects/<date>/<name>/assets-runs/...")
 *   2. Relative to storageRoot   (renders:    "renders/<jobId>/output.mp4")
 *   3. Absolute from old machine (migration:  "D:\\old-path\\storage\\projects\\<date>/<name>/renders/...")
 */
function resolveAndValidatePath(filePath: string, root: string): string | null {
  const rootAbs = resolve(root);

  // --- Case 1: filePath is relative to cwd (e.g. "storage/projects/.../assets-runs/...") ---
  // Must come first: asset file_uri uses cwd-relative paths. If Case 2 ran first,
  // resolve(rootAbs, filePath) would double the "storage/projects/..." prefix.
  const resolvedFromCwd = resolve(filePath);
  const rel = relative(rootAbs, resolvedFromCwd);
  if (rel !== "" && rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel)) {
    return resolvedFromCwd;
  }

  // --- Case 2: filePath is relative to storageRoot (e.g. "renders/xxx/output.mp4") ---
  const resolvedFromRoot = resolve(rootAbs, filePath);
  const rel2 = relative(rootAbs, resolvedFromRoot);
  if (rel2 !== "" && rel2 !== ".." && !rel2.startsWith(".." + sep) && !isAbsolute(rel2)) {
    return resolvedFromRoot;
  }

  // --- Case 3: filePath is an absolute path from another machine (migrated data) ---
  if (isAbsolute(filePath)) {
    const normalized = filePath.replace(/\\/g, "/");
    const marker = "/storage/projects/";
    const idx = normalized.indexOf(marker);
    if (idx !== -1) {
      const afterMarker = normalized.slice(idx + marker.length);
      const segments = afterMarker.split("/");
      if (segments.length > 2) {
        const relativeFromProject = segments.slice(2).join("/");
        const reconstructed = resolve(rootAbs, relativeFromProject);
        const rel3 = relative(rootAbs, reconstructed);
        if (rel3 !== "" && rel3 !== ".." && !rel3.startsWith(".." + sep) && !isAbsolute(rel3)) {
          return reconstructed;
        }
      }
    }
  }

  return null;
}

export function writeFileStream(
  response: ServerResponse,
  filePath: string,
  storageRoot: string,
  options: FileResponseOptions = {},
): void {
  const resolved = resolveAndValidatePath(filePath, storageRoot);
  if (resolved === null) {
    response.statusCode = 403;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: "path_traversal_denied" }));
    return;
  }

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
