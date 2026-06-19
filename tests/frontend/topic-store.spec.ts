import { afterEach, describe, expect, it, vi } from "vitest";

import { createFetchTopicApi, createTopicStore } from "../../frontend/src/stores/topic";

describe("topic store recommendation input", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends canonical recommendation seed fields derived from system filters", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        project_id: "project-1",
        candidates: [],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createFetchTopicApi();

    await api.generateSystemRecommendations("project-1", {
      era: "late-imperial",
      tension: "hook-first",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project-1/topic/recommendations",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: expect.any(String),
      }),
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      canonical_name: expect.stringContaining("元明清"),
      summary: expect.stringContaining("元明清"),
      core_conflict: expect.stringContaining("传播切口优先"),
      strong_scene: expect.stringContaining("元明清"),
      source_hint: expect.stringContaining("元明清"),
      recent_usage_hint: expect.stringContaining("元明清"),
    });
    expect(body.tags).toEqual(
      expect.arrayContaining([
        "late_imperial",
        "hook_first",
        "system_recommendation",
        "single_event",
        "concrete_scene",
        "strict_era_boundary",
      ]),
    );
    expect(body.canonical_name).not.toContain("晏子使楚");
    expect(body.summary).toContain("具体");
    expect(body.summary).toContain("历史事件");
    expect(body.summary).toContain("禁止返回");
    expect(body.summary).toContain("不得超出元明清范围");
    expect(body.strong_scene).toContain("宫廷");
    expect(body.strong_scene).toContain("当众对抗");
    expect(body.strong_scene).toContain("必须发生在元明清范围内");
    expect(body.source_hint).toContain("超出元明清");
    expect(body.recent_usage_hint).toContain("严格排除超出元明清范围");
  });

  it("throws instead of treating non-2xx topic recommendation responses as successful candidates", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        error: "invalid_topic_recommendation_seed",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createFetchTopicApi();

    await expect(
      api.generateSystemRecommendations("project-1", {
        era: "medieval",
        tension: "balanced",
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("invalid_topic_recommendation_seed"),
    });
  });

  it("forwards system filters through the topic store when generating recommendations", async () => {
    const api = {
      generateSystemRecommendations: vi.fn(async () => ({
        project_id: "project-1",
        candidates: [],
        current_round: null,
        history_rounds: [],
      })),
      confirmCandidate: vi.fn(),
    };
    const projectStore = {
      state: {
        projectId: "project-1",
        currentStatus: "topic_pending",
        projects: [],
      },
      async ensureProject() {
        return "project-1";
      },
      async createProject() {
        throw new Error("not used");
      },
      async loadProjects() {
        return [];
      },
      resolveProjectWorkspacePath() {
        return "/projects/project-1/topic";
      },
      syncProject() {},
    };
    const store = createTopicStore({
      projectStore,
      api,
    });

    await store.generateSystemRecommendations({
      era: "medieval",
      tension: "balanced",
    });

    expect(api.generateSystemRecommendations).toHaveBeenCalledWith("project-1", {
      era: "medieval",
      tension: "balanced",
    });
  });

  it("returns the loaded snapshot so polling can inspect topic generation status", async () => {
    const snapshot = {
      active_topic_package: null,
      current_status: "topic_generating",
      topic_candidates: null,
    };
    const api = {
      generateSystemRecommendations: vi.fn(),
      confirmCandidate: vi.fn(),
      loadSnapshot: vi.fn(async () => snapshot),
    };
    const projectStore = {
      state: {
        projectId: "project-1",
        currentStatus: "topic_generating",
        projects: [],
      },
      async ensureProject() {
        return "project-1";
      },
      async createProject() {
        throw new Error("not used");
      },
      async loadProjects() {
        return [];
      },
      resolveProjectWorkspacePath() {
        return "/projects/project-1/topic";
      },
      syncProject: vi.fn(),
    };
    const store = createTopicStore({
      projectStore,
      api,
    });

    await expect(store.loadSnapshot()).resolves.toBe(snapshot);
  });

  it("does not let a stale topic_pending snapshot hide local generation progress", async () => {
    let resolveGeneration!: (value: {
      project_id: string;
      candidates: never[];
      current_round: null;
      history_rounds: never[];
    }) => void;
    const api = {
      generateSystemRecommendations: vi.fn(
        () =>
          new Promise<{
            project_id: string;
            candidates: never[];
            current_round: null;
            history_rounds: never[];
          }>((resolve) => {
            resolveGeneration = resolve;
          }),
      ),
      confirmCandidate: vi.fn(),
      loadSnapshot: vi.fn(async () => ({
        active_topic_package: null,
        current_status: "topic_pending",
        topic_candidates: null,
      })),
    };
    const projectStore = {
      state: {
        projectId: "project-1",
        currentStatus: "topic_pending",
        projects: [],
      },
      async ensureProject() {
        return "project-1";
      },
      async createProject() {
        throw new Error("not used");
      },
      async loadProjects() {
        return [];
      },
      resolveProjectWorkspacePath() {
        return "/projects/project-1/topic";
      },
      syncProject: vi.fn(),
    };
    const store = createTopicStore({
      projectStore,
      api,
    });

    const generating = store.generateSystemRecommendations();
    await Promise.resolve();

    const snapshot = await store.loadSnapshot();
    expect(snapshot?.current_status).toBe("topic_generating");
    expect(store.state.snapshot?.current_status).toBe("topic_generating");

    resolveGeneration({
      project_id: "project-1",
      candidates: [],
      current_round: null,
      history_rounds: [],
    });
    await generating;
  });
});
