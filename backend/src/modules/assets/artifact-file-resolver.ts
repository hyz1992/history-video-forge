import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Workspace root directory — the absolute path of the project root.
 * All `storage/projects/...` workspace-relative paths resolve from here.
 */
let _workspaceRoot: string | null = null;
function getWorkspaceRoot(): string {
  if (!_workspaceRoot) {
    _workspaceRoot = resolve(
      fileURLToPath(new URL("../../../", import.meta.url)),
    );
  }
  return _workspaceRoot;
}

/**
 * Resolve an artifact's file_uri to an absolute filesystem path.
 *
 * Supported formats:
 * - `local://relative/path`  → resolved against projectStorageRootDir
 * - `file:///absolute/path`  → fileURLToPath
 * - `C:\...` or `/...`      → absolute path, returned as-is
 * - `storage/projects/...`  → workspace-relative, resolved from repo root
 * - other relative paths    → project-relative, resolved against projectStorageRootDir
 * - `memory://`, `inline://`, `planned://`, `http://`, `https://`, etc. → returns null (not checkable on disk)
 */
export function resolveArtifactFileUri(input: {
  fileUri: string;
  projectStorageRootDir?: string;
}): string | null {
  const { fileUri, projectStorageRootDir } = input;

  // --- protocol-based URIs that are always checkable ---
  if (fileUri.startsWith("local://")) {
    const relative = fileUri.slice("local://".length);
    if (!projectStorageRootDir) return null;
    return join(projectStorageRootDir, relative);
  }

  if (fileUri.startsWith("file://")) {
    return fileURLToPath(fileUri);
  }

  // --- URIs that are never local files ---
  if (
    fileUri.startsWith("memory://") ||
    fileUri.startsWith("inline://") ||
    fileUri.startsWith("planned://") ||
    fileUri.startsWith("external://") ||
    fileUri.startsWith("http://") ||
    fileUri.startsWith("https://") ||
    fileUri.startsWith("data:")
  ) {
    return null;
  }

  // --- Absolute filesystem path (Unix or Windows) ---
  if (isAbsolute(fileUri)) {
    return fileUri;
  }

  // --- Workspace-relative path — resolves from repo root ---
  // Providers (DashScope TTS, image, etc.) write artifacts under
  // `storage/projects/<date>/<name> [<id>]/assets-runs/...`.
  // These are relative to the workspace root, NOT the project storage dir.
  const normalized = fileUri.replace(/\\/g, "/");
  if (normalized.startsWith("storage/")) {
    return join(getWorkspaceRoot(), fileUri);
  }

  // --- Project-relative path — resolves from project storage root ---
  if (projectStorageRootDir) {
    return join(projectStorageRootDir, fileUri);
  }

  return null;
}

/**
 * Resolve an artifact's file_uri for use in Remotion / browser rendering.
 * Returns a `file://` URL when the path is a local file, or the original
 * URI for HTTP/data URIs, or null if unresolvable.
 */
import { pathToFileURL } from "node:url";

export function resolveArtifactFileUriForRemotion(input: {
  fileUri: string;
  projectStorageRootDir?: string;
  assetBaseDir?: string;
}): string | null {
  const { fileUri, projectStorageRootDir, assetBaseDir } = input;

  // HTTP / data URIs → pass through
  if (
    fileUri.startsWith("http://") ||
    fileUri.startsWith("https://") ||
    fileUri.startsWith("data:")
  ) {
    return fileUri;
  }

  // file:// → pass through
  if (fileUri.startsWith("file://")) {
    return fileUri;
  }

  // Resolve to absolute path first
  const resolved = resolveArtifactFileUri({ fileUri, projectStorageRootDir });
  if (!resolved) return null;

  // Remotion works with file:// URLs or absolute paths
  return pathToFileURL(resolved).href;
}
