import { afterEach, describe, expect, it, vi } from "vitest";

import { createFetchTopicApi, createTopicStore } from "../../frontend/src/stores/topic";

describe("topic store recommendation input", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends canonical recommendation seed fields derived from system filters", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
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
      headers: new Headers({ "content-type": "application/json" }),
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

  it("prefers backend error message over generic error code when topic generation fails", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        error: "topic_generate_failed",
        message: "LLM provider timeout after 120 seconds",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createFetchTopicApi();

    await expect(
      api.generateSystemRecommendations("project-1", {
        era: "ancient",
        tension: "high",
      }),
    ).rejects.toThrow("LLM provider timeout after 120 seconds");
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

  it("clears cached recommendation rounds before loading a different project", async () => {
    const api = {
      generateSystemRecommendations: vi.fn(async () => ({
        project_id: "project-1",
        candidates: [
          {
            candidate_id: "old-candidate",
            title: "OLD_PROJECT_TOPIC",
            one_line_angle: "old angle",
            family_label: "old family",
            scope_label: "old scope",
            strong_scene: "old scene",
            risk_hints: [],
          },
        ],
        current_round: {
          round_id: "old-round",
          candidates: [
            {
              candidate_id: "old-candidate",
              title: "OLD_PROJECT_TOPIC",
              one_line_angle: "old angle",
              family_label: "old family",
              scope_label: "old scope",
              strong_scene: "old scene",
              risk_hints: [],
            },
          ],
        },
        history_rounds: [],
      })),
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
        currentStatus: "topic_candidates_ready",
        projects: [],
      },
      async ensureProject() {
        return projectStore.state.projectId;
      },
      async createProject() {
        throw new Error("not used");
      },
      async loadProjects() {
        return [];
      },
      resolveProjectWorkspacePath() {
        return `/projects/${projectStore.state.projectId}/topic`;
      },
      syncProject: vi.fn(),
    };
    const store = createTopicStore({
      projectStore,
      api,
    });

    await store.generateSystemRecommendations();
    expect(store.state.candidates[0]?.title).toBe("OLD_PROJECT_TOPIC");

    projectStore.state.projectId = "project-2";
    projectStore.state.currentStatus = "topic_pending";

    await store.loadExistingTopic();

    expect(api.loadSnapshot).toHaveBeenCalledWith("project-2");
    expect(store.state.candidates).toEqual([]);
    expect(store.state.currentRound).toBeNull();
    expect(store.state.selectedCandidate).toBeNull();
  });

  it("restores the full confirmed candidate from persisted rounds instead of the skeletal topic package", async () => {
    const restored = {
      candidate_id: "candidate-1", title: "晏子使楚", one_line_angle: "外交反击",
      family_label: "外交", scope_label: "单事件", why_this_now: "冲突鲜明",
      strong_scene: "朝堂", risk_hints: ["勿夸张"], core_conflict: "羞辱与反击",
      source_hint: "史记", viral_rubric: { hook_power: "high" }, must_cover_preview: ["入楚", "设局", "反击"],
    };
    const api = {
      generateSystemRecommendations: vi.fn(), confirmCandidate: vi.fn(),
      loadSnapshot: vi.fn(async () => ({
        current_status: "script_ready",
        active_topic_package: { topic_package_id: "topic-1", canonical_title: restored.title, selected_angle: restored.one_line_angle, family_label: restored.family_label, scope_label: restored.scope_label },
        topic_candidates: { candidate_rounds: [{ round_id: "round-3", round_index: 3, candidates: [restored] }] },
      })),
    };
    const projectStore = {
      state: { projectId: "project-1", currentStatus: "script_ready", projects: [] },
      ensureProject: async () => "project-1", createProject: async () => "project-1", loadProjects: async () => [],
      resolveProjectWorkspacePath: () => "/projects/project-1/topic", syncProject: vi.fn(),
    };
    const store = createTopicStore({ projectStore, api });
    await store.loadExistingTopic();
    expect(store.state.selectedCandidate).toMatchObject({
      candidate_id: "candidate-1", core_conflict: "羞辱与反击",
      must_cover_preview: ["入楚", "设局", "反击"], viral_rubric: { hook_power: "high" },
    });
    expect(store.state.selectedRoundId).toBe("round-3");
  });
});
