import { describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app";
import { createLegacyProject } from "../projects/legacy-project.fixture.js";
import { createAuthenticatedAuthContext } from "../../../backend/src/auth/auth-context";

describe("project deletion route", () => {
  it("deletes the project and its topic candidate state", async () => {
    const app = buildApp();
    const auth = createAuthenticatedAuthContext({
      userId: "u1", username: "a", displayName: "A", role: "ADMIN", sessionId: "s1",
    });
    // 口播前置定版后创建入口要求口播资格选择；删除路由验证经 legacy 夹具直造
    const createdProject = await createLegacyProject(app.db, { name: "Delete Route Test", ownerId: "u1", createdById: "u1" });
    const project = { project_id: createdProject.id };
    app.topicCandidateStore.set(project.project_id, {
      candidatesById: new Map(),
      rounds: [],
    });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/projects/${project.project_id}`,
      auth,
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toEqual({ deleted: true });
    expect(app.db.projects.has(project.project_id)).toBe(false);
    expect(app.topicCandidateStore.has(project.project_id)).toBe(false);
  });
});
