import { describe, expect, it, vi } from "vitest";

import { createProjectStore } from "../../frontend/src/stores/project";

describe("project store", () => {
  it("reloads the project list after deleting a project", async () => {
    const api = {
      createProject: vi.fn(),
      deleteProject: vi.fn(async () => undefined),
      listProjects: vi
        .fn()
        .mockResolvedValueOnce([
          {
            project_id: "project-1",
            display_name: "保留项目",
            current_status: "script_ready",
            is_draft: false,
            updated_at: "2026-06-19T10:00:00.000Z",
          },
          {
            project_id: "project-2",
            display_name: "待删除项目",
            current_status: "topic_pending",
            is_draft: true,
            updated_at: "2026-06-19T09:00:00.000Z",
          },
        ])
        .mockResolvedValueOnce([
          {
            project_id: "project-1",
            display_name: "保留项目",
            current_status: "script_ready",
            is_draft: false,
            updated_at: "2026-06-19T10:00:00.000Z",
          },
        ]),
    };
    const store = createProjectStore(api);

    await store.loadProjects();
    expect(store.state.projects.map((project) => project.project_id)).toEqual([
      "project-1",
      "project-2",
    ]);

    await store.deleteProject("project-2");

    expect(api.deleteProject).toHaveBeenCalledWith("project-2");
    expect(api.listProjects).toHaveBeenCalledTimes(2);
    expect(store.state.projects.map((project) => project.project_id)).toEqual([
      "project-1",
    ]);
  });
});
