import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  preserveArtifactAfterRegistrationFailure,
  promoteStagedArtifactFile,
  resolveStagedArtifactFile,
  writeStagedArtifactFile,
} from "../../../backend/src/runtime/files/artifact-file-commit.js";

describe("artifact file commit protocol", () => {
  it("writes to identifiable staging and atomically promotes a validated file", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "artifact-commit-"));
    const file = resolveStagedArtifactFile({
      rootDir,
      operationId: "render-job-1",
      relativeFinalPath: "renders/render-job-1/output.mp4",
    });

    await writeStagedArtifactFile(file, "rendered-video");
    await expect(stat(file.finalPath)).rejects.toThrow();
    await promoteStagedArtifactFile(file);

    expect(await readFile(file.finalPath, "utf8")).toBe("rendered-video");
    await expect(stat(file.stagingPath)).rejects.toThrow();
  });

  it("moves a promoted file back to staging when database registration fails", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "artifact-rollback-"));
    const file = resolveStagedArtifactFile({
      rootDir,
      operationId: "cover-1",
      relativeFinalPath: "publish/cover-1.png",
    });
    await writeStagedArtifactFile(file, "cover");
    await promoteStagedArtifactFile(file);

    await preserveArtifactAfterRegistrationFailure(file);

    expect(await readFile(file.stagingPath, "utf8")).toBe("cover");
    await expect(stat(file.finalPath)).rejects.toThrow();
  });

  it("rejects traversal outside project storage", () => {
    expect(() => resolveStagedArtifactFile({
      rootDir: "D:/project-storage",
      operationId: "job-1",
      relativeFinalPath: "../outside.mp4",
    })).toThrow("artifact_file_outside_root");
  });

  it("rejects empty staged files", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "artifact-empty-"));
    const file = resolveStagedArtifactFile({
      rootDir,
      operationId: "job-empty",
      relativeFinalPath: "renders/job-empty/output.mp4",
    });
    await writeStagedArtifactFile(file, Buffer.alloc(0));

    await expect(promoteStagedArtifactFile(file)).rejects.toThrow("artifact_staging_invalid");
  });
});
