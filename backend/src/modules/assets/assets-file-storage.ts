import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join, normalize } from "node:path";

// ─── Types ──────────────────────────────────────────────────────────────────────

export type AssetStorageCategory =
  | "images"
  | "videos"
  | "audio/tts"
  | "audio/sfx"
  | "audio/bgm"
  | "subtitles"
  | "remotion"
  | "diagnostics";

export interface AssetsRunStorage {
  rootDir: string;
  runId: string;
  runDir: string;
}

export interface WrittenAssetFile {
  absolutePath: string;
  fileUri: string;
  relativePath: string;
  fileHash: string;
}

export async function preserveAssetsRunStorage(storage: AssetsRunStorage): Promise<string> {
  const stagingParent = join(storage.rootDir, ".staging", storage.runId);
  const stagingDir = join(stagingParent, "assets-run");
  await mkdir(stagingParent, { recursive: true });
  await rename(storage.runDir, stagingDir);
  return stagingDir;
}

// ─── Resolve run storage ─────────────────────────────────────────────────────────

export function resolveAssetsRunStorage(input: {
  projectStorageRootDir: string;
  runId: string;
}): AssetsRunStorage {
  return {
    rootDir: input.projectStorageRootDir,
    runId: input.runId,
    runDir: join(input.projectStorageRootDir, "assets-runs", input.runId),
  };
}

// ─── SHA-256 hashing ─────────────────────────────────────────────────────────────

export async function hashFileSha256(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  const hex = createHash("sha256").update(content).digest("hex");
  return `sha256:${hex}`;
}

// ─── Path safety helper ──────────────────────────────────────────────────────────

function assertInsideRunDir(storage: AssetsRunStorage, targetPath: string): void {
  const normalizedTarget = normalize(targetPath);
  const normalizedRunDir = normalize(storage.runDir);
  if (!normalizedTarget.startsWith(normalizedRunDir)) {
    throw new Error(
      `asset_file_outside_run_dir: path "${targetPath}" is outside run directory "${storage.runDir}"`,
    );
  }
}

// ─── Write asset file ────────────────────────────────────────────────────────────

export async function writeAssetFile(input: {
  storage: AssetsRunStorage;
  category: AssetStorageCategory;
  fileName: string;
  data: string | Buffer;
}): Promise<WrittenAssetFile> {
  const { storage, category, fileName, data } = input;

  const absolutePath = join(storage.runDir, category, fileName);
  assertInsideRunDir(storage, absolutePath);

  const dir = join(storage.runDir, category);
  await mkdir(dir, { recursive: true });

  await writeFile(absolutePath, data);

  const fileHash = await hashFileSha256(absolutePath);
  const relativePath = join("assets-runs", storage.runId, category, fileName);

  return {
    absolutePath,
    fileUri: absolutePath,
    relativePath,
    fileHash,
  };
}

// ─── Copy asset file ─────────────────────────────────────────────────────────────

export async function copyAssetFile(input: {
  storage: AssetsRunStorage;
  category: AssetStorageCategory;
  sourcePath: string;
  fileName: string;
}): Promise<WrittenAssetFile> {
  const { storage, category, sourcePath, fileName } = input;

  const absolutePath = join(storage.runDir, category, fileName);
  assertInsideRunDir(storage, absolutePath);

  const dir = join(storage.runDir, category);
  await mkdir(dir, { recursive: true });

  await copyFile(sourcePath, absolutePath);

  const fileHash = await hashFileSha256(absolutePath);
  const relativePath = join("assets-runs", storage.runId, category, fileName);

  return {
    absolutePath,
    fileUri: absolutePath,
    relativePath,
    fileHash,
  };
}

// ─── Assert local file artifact ──────────────────────────────────────────────────

export async function assertLocalFileArtifact(input: {
  fileUri: string;
  projectStorageRootDir: string;
}): Promise<void> {
  const { fileUri, projectStorageRootDir } = input;

  const normalizedFileUri = normalize(fileUri);
  const normalizedRoot = normalize(projectStorageRootDir);

  if (!normalizedFileUri.startsWith(normalizedRoot)) {
    throw new Error(
      `asset_file_outside_project_storage: file "${fileUri}" is outside project storage "${projectStorageRootDir}"`,
    );
  }

  try {
    await stat(fileUri);
  } catch {
    throw new Error(`asset_file_missing: file "${fileUri}" does not exist`);
  }
}
