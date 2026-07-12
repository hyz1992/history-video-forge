import { copyFile, mkdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export interface StagedArtifactFile {
  stagingPath: string;
  finalPath: string;
}

function assertInside(rootDir: string, targetPath: string): void {
  const relativePath = relative(resolve(rootDir), resolve(targetPath));
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(relativePath)) {
    throw new Error(`artifact_file_outside_root: ${targetPath}`);
  }
}

export function resolveStagedArtifactFile(input: {
  rootDir: string;
  operationId: string;
  relativeFinalPath: string;
}): StagedArtifactFile {
  const finalPath = resolve(input.rootDir, input.relativeFinalPath);
  const stagingPath = join(input.rootDir, ".staging", input.operationId, input.relativeFinalPath);
  assertInside(input.rootDir, finalPath);
  assertInside(input.rootDir, stagingPath);
  return { stagingPath, finalPath };
}

export async function writeStagedArtifactFile(
  file: StagedArtifactFile,
  data: string | Buffer,
): Promise<void> {
  await mkdir(dirname(file.stagingPath), { recursive: true });
  await writeFile(file.stagingPath, data);
}

export async function copyStagedArtifactFile(
  file: StagedArtifactFile,
  sourcePath: string,
): Promise<void> {
  await mkdir(dirname(file.stagingPath), { recursive: true });
  await copyFile(sourcePath, file.stagingPath);
}

export async function validateStagedArtifactFile(file: StagedArtifactFile): Promise<void> {
  const fileStat = await stat(file.stagingPath);
  if (!fileStat.isFile() || fileStat.size === 0) {
    throw new Error(`artifact_staging_invalid: ${file.stagingPath}`);
  }
}

export async function promoteStagedArtifactFile(file: StagedArtifactFile): Promise<void> {
  await validateStagedArtifactFile(file);
  await mkdir(dirname(file.finalPath), { recursive: true });
  await rename(file.stagingPath, file.finalPath);
}

export async function preserveArtifactAfterRegistrationFailure(file: StagedArtifactFile): Promise<void> {
  await mkdir(dirname(file.stagingPath), { recursive: true });
  await rename(file.finalPath, file.stagingPath);
}
