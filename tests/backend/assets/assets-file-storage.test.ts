import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  assertLocalFileArtifact,
  copyAssetFile,
  hashFileSha256,
  resolveAssetsRunStorage,
  writeAssetFile,
} from "../../../backend/src/modules/assets/assets-file-storage.js";

describe("assets file storage", () => {
  it("writes files under an assets run directory and hashes them", async () => {
    const root = await mkdtemp(join(tmpdir(), "assets-storage-"));
    try {
      const storage = resolveAssetsRunStorage({
        projectStorageRootDir: root,
        runId: "assets_run_001",
      });

      const written = await writeAssetFile({
        storage,
        category: "subtitles",
        fileName: "main.srt",
        data: "1\n00:00:00,000 --> 00:00:01,000\nhello\n",
      });

      expect(written.fileUri.replaceAll("\\", "/")).toContain(
        "assets-runs/assets_run_001/subtitles/main.srt",
      );
      expect(await readFile(written.absolutePath, "utf8")).toContain("hello");

      const hash = await hashFileSha256(written.absolutePath);
      expect(hash).toMatch(/^sha256:/);

      await expect(
        assertLocalFileArtifact({
          fileUri: written.fileUri,
          projectStorageRootDir: root,
        }),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("copies source files into a run category", async () => {
    const root = await mkdtemp(join(tmpdir(), "assets-storage-"));
    try {
      const source = join(root, "source.txt");
      await writeFile(source, "copied");
      const storage = resolveAssetsRunStorage({
        projectStorageRootDir: root,
        runId: "assets_run_002",
      });

      const copied = await copyAssetFile({
        storage,
        category: "images",
        sourcePath: source,
        fileName: "copied.txt",
      });

      expect(await readFile(copied.absolutePath, "utf8")).toBe("copied");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
