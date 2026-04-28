import { afterEach, describe, expect, it, vi } from "vitest";

import { createFetchTopicApi, createTopicStore } from "../../frontend/src/stores/topic";

describe("topic store recommendation input", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds topic recommendation payloads from the current system filters instead of a fixed sample event", async () => {
    const fetchMock = vi.fn(async () => ({
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
    expect(body.canonical_name).toContain("元明清");
    expect(body.canonical_name).toContain("传播切口优先");
    expect(body.summary).toContain("元明清");
    expect(body.core_conflict).toContain("传播切口优先");
    expect(body.strong_scene).toContain("元明清");
    expect(body.tags).toContain("late_imperial");
    expect(body.tags).toContain("hook_first");
    expect(body.canonical_name).not.toContain("晏子使楚");
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
});
