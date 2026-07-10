import { describe, expect, it } from "vitest";

import { createProjectStageLockRegistry } from "../../../backend/src/runtime/concurrency/project-stage-lock.js";

describe("project stage lock", () => {
  it("rejects duplicate runs for the same project and stage", () => {
    const locks = createProjectStageLockRegistry();
    const release = locks.acquire("project_1", "assets");
    expect(() => locks.acquire("project_1", "assets")).toThrow("project_stage_run_in_progress");
    expect(() => locks.acquire("project_1", "script")).not.toThrow();
    release();
    expect(() => locks.acquire("project_1", "assets")).not.toThrow();
  });
});
