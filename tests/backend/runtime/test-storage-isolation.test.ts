import { existsSync, readdirSync } from "node:fs";
import { isAbsolute } from "node:path";
import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { createProjectRunInteractionLogWriter, createProjectStorageProfile } from "../../../backend/src/runtime/trace/project-storage.js";

function workspaceProjectEntries(): string[] {
  return readdirSync("storage/projects", { recursive: true, encoding: "utf8" }).sort();
}

describe("test storage isolation", () => {
  it("writes traces below the configured test storage root", async () => {
    const before = workspaceProjectEntries();
    const db = createDbClient();
    const project = await createProject(db, { name: "storage isolation" });
    const writer = createProjectRunInteractionLogWriter({ project, phase: "topic", runId: "run_1" });

    writer.write({
      generatedAt: new Date().toISOString(),
      provider: "stub",
      model: "test-model",
      operationName: "storage-isolation",
      promptId: "test.prompt",
      promptStage: "topic.selector",
      promptLanguage: "zh-CN",
      promptFilePath: "harness/prompts/test.md",
      systemPrompt: "test",
      input: {},
      rawOutput: "{}",
    });

    expect(workspaceProjectEntries()).toEqual(before);
    const projectRoot = isAbsolute(project.storageRootDir)
      ? project.storageRootDir
      : `${process.env.STORAGE_ROOT_DIR}/${project.storageRootDir}`;
    expect(existsSync(`${projectRoot}/trace/topic-runs/run_1/llm-interactions/01-storage-isolation.md`)).toBe(true);
  });

  it("maps publish phase to publish_runs_dir not assets_runs_dir", () => {
    const profile = createProjectStorageProfile({
      projectId: "test-publish-id",
      projectName: "publish phase test",
      createdAt: new Date(),
    });

    expect(profile.publish_runs_dir).toContain("/trace/publish-runs");
    expect(profile.publish_runs_dir).not.toContain("/trace/assets-runs");
  });
});
