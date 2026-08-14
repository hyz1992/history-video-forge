import { describe, expect, it, vi } from "vitest";

import { createFetchProjectApi, createProjectStore } from "../../frontend/src/stores/project";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  } as Response;
}

const initialProjects = [
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
];

describe("project store", () => {
  it("removes a project locally after a successful delete request", async () => {
    const api = {
      createProject: vi.fn(),
      deleteProject: vi.fn(async () => undefined),
      listProjects: vi.fn().mockResolvedValue(initialProjects),
    };
    const store = createProjectStore(api);

    await store.loadProjects();
    expect(store.state.projects.map((project) => project.project_id)).toEqual([
      "project-1",
      "project-2",
    ]);

    await store.deleteProject("project-2");

    expect(api.deleteProject).toHaveBeenCalledWith("project-2");
    expect(api.listProjects).toHaveBeenCalledTimes(1);
    expect(store.state.projects.map((project) => project.project_id)).toEqual([
      "project-1",
    ]);
  });

  it("restores the project row when delete fails", async () => {
    const api = {
      createProject: vi.fn(),
      deleteProject: vi.fn(async () => {
        throw new Error("delete_failed");
      }),
      listProjects: vi.fn().mockResolvedValue(initialProjects),
    };
    const store = createProjectStore(api);

    await store.loadProjects();
    await expect(store.deleteProject("project-2")).rejects.toThrow("delete_failed");

    expect(store.state.projects.map((project) => project.project_id)).toEqual([
      "project-1",
      "project-2",
    ]);
  });
});

describe("project store owner_id propagation", () => {
  it("loadProject writes owner_id into store when backend returns it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        project_id: "proj-2",
        name: "他人项目",
        owner_id: "user-other",
        current_status: "script_ready",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const api = createFetchProjectApi();
      const store = createProjectStore(api);

      await store.loadProject("proj-2");

      expect(store.state.projectId).toBe("proj-2");
      expect(store.state.projectOwnerId).toBe("user-other");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("loadProject sets projectOwnerId to null when backend omits owner_id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        project_id: "proj-3",
        name: "无owner项目",
        current_status: "topic_pending",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const api = createFetchProjectApi();
      const store = createProjectStore(api);

      await store.loadProject("proj-3");

      expect(store.state.projectId).toBe("proj-3");
      expect(store.state.projectOwnerId).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("project store S2-2A snapshot fields propagation", () => {
  it("loadProject keeps generation configuration fields in store.state.projects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        project_id: "proj-s2a",
        name: "S2-2A项目",
        current_status: "topic_pending",
        generation_configuration: {
          configuration: { schema_version: "generation_configuration_v1" },
          revision: 2,
          source: "stored",
          source_user_preference_revision: 1,
          updated_at: "2026-08-14T00:00:00.000Z",
        },
        generation_configuration_version: 2,
        configuration_invalidation_preview: {
          affected_stages: ["asset_planning"],
          note: "配置变更仅保存，不自动触发下游生成。",
        },
        cost_summary: {
          total_estimated_cost_micros: "0",
          total_actual_cost_micros: "0",
          record_count: 0,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const api = createFetchProjectApi();
      const store = createProjectStore(api);
      await store.loadProject("proj-s2a");

      const row = store.state.projects.find((p) => p.project_id === "proj-s2a");
      expect(row).toBeDefined();
      // 关键：字段必须进入 store.state（经 syncProject → toProjectListItem 不被丢弃）
      expect(row!.generation_configuration?.revision).toBe(2);
      expect(row!.generation_configuration?.source).toBe("stored");
      expect(row!.generation_configuration_version).toBe(2);
      expect(row!.configuration_invalidation_preview?.affected_stages).toEqual(["asset_planning"]);
      expect(row!.cost_summary?.record_count).toBe(0);
      expect(row!.cost_summary?.total_estimated_cost_micros).toBe("0");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("status-only syncProject keeps previously loaded generation config fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        project_id: "proj-s2a",
        name: "S2-2A项目",
        current_status: "topic_pending",
        generation_configuration: {
          configuration: { schema_version: "generation_configuration_v1" },
          revision: 2,
          source: "stored",
          source_user_preference_revision: 1,
          updated_at: "2026-08-14T00:00:00.000Z",
        },
        generation_configuration_version: 2,
        configuration_invalidation_preview: {
          affected_stages: ["asset_planning"],
          note: "配置变更仅保存，不自动触发下游生成。",
        },
        cost_summary: {
          total_estimated_cost_micros: "0",
          total_actual_cost_micros: "0",
          record_count: 0,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const api = createFetchProjectApi();
      const store = createProjectStore(api);
      await store.loadProject("proj-s2a");

      // 模拟下游 store（script/assets 等）只同步状态
      store.syncProject({ project_id: "proj-s2a", current_status: "script_ready" });

      const row = store.state.projects.find((p) => p.project_id === "proj-s2a");
      expect(row).toBeDefined();
      // 关键：状态型 sync 不能清空已加载的生成配置字段
      expect(row!.generation_configuration?.revision).toBe(2);
      expect(row!.generation_configuration_version).toBe(2);
      expect(row!.configuration_invalidation_preview?.affected_stages).toEqual(["asset_planning"]);
      expect(row!.cost_summary?.record_count).toBe(0);
      // 状态本身更新
      expect(row!.current_status).toBe("script_ready");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("explicit null generation_configuration clears the field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        project_id: "proj-clear",
        name: "清除项目",
        current_status: "topic_pending",
        generation_configuration: {
          configuration: { schema_version: "generation_configuration_v1" },
          revision: 1,
          source: "stored",
          source_user_preference_revision: null,
          updated_at: "2026-08-14T00:00:00.000Z",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const api = createFetchProjectApi();
      const store = createProjectStore(api);
      await store.loadProject("proj-clear");
      expect(store.state.projects.find((p) => p.project_id === "proj-clear")?.generation_configuration?.revision).toBe(1);

      // 明确传 null → 清空
      store.syncProject({ project_id: "proj-clear", current_status: "script_ready", generation_configuration: null });
      const row = store.state.projects.find((p) => p.project_id === "proj-clear");
      expect(row!.generation_configuration).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("getProject leaves new fields undefined when backend omits them", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        project_id: "proj-legacy",
        name: "旧快照",
        current_status: "script_ready",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const api = createFetchProjectApi();
      const snapshot = await api.getProject!("proj-legacy");

      expect(snapshot.generation_configuration).toBeNull();
      expect(snapshot.generation_configuration_version).toBeUndefined();
      expect(snapshot.configuration_invalidation_preview).toBeUndefined();
      expect(snapshot.cost_summary).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
