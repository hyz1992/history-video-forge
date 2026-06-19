import { describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app";

describe("project deletion route", () => {
  it("deletes the project and its topic candidate state", async () => {
    const app = buildApp();
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "Delete Route Test" },
    });
    const project = createResponse.json();
    app.topicCandidateStore.set(project.project_id, {
      candidatesById: new Map(),
      rounds: [],
    });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/projects/${project.project_id}`,
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toEqual({ deleted: true });
    expect(app.db.projects.has(project.project_id)).toBe(false);
    expect(app.topicCandidateStore.has(project.project_id)).toBe(false);
  });
});
