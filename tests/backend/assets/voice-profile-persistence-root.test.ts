import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";

describe("workspace voice profile persistence root", () => {
  it("does not derive the global voice root from the first project", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-voice-root-"));
    const app = buildApp({ storageBaseDir: root, skipSnapshotLoad: true });
    const first = await createProject(app.db, { name: "first" });
    const second = await createProject(app.db, { name: "second" });

    expect(app.db.voiceProfilePersistence.rootDir).toBe(root);
    expect(app.db.voiceProfilePersistence.rootDir).not.toBe(first.storageRootDir);
    expect(app.db.voiceProfilePersistence.rootDir).not.toBe(second.storageRootDir);
  });
});
