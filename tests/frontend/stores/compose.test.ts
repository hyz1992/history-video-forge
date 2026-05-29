import { describe, expect, it, vi, beforeEach } from "vitest";
import { reactive } from "vue";

import type { ProjectStore } from "../../../frontend/src/stores/project.js";

function createMockProjectStore(): { state: { projectId: string; currentStatus: string; projects: unknown[] }; syncProject: ReturnType<typeof vi.fn> } & ProjectStore {
  return {
    state: reactive({ projectId: "proj_test_001", currentStatus: "assets_ready", projects: [] }),
    syncProject: vi.fn(),
  } as unknown as ReturnType<typeof createMockProjectStore>;
}

function createMockApi() {
  return {
    loadProject: vi.fn(),
    generateCompose: vi.fn(),
  };
}

import { createComposeStore } from "../../../frontend/src/stores/compose.js";

const MOCK_SNAPSHOT = {
  current_status: "composed",
  active_compose: {
    compose_record_id: "cr_001",
    source_asset_manifest_record_id: "amr_001",
    timeline: {
      output_profile: "default",
      duration_sec: 30,
      tracks: [
        {
          track_id: "track_video",
          track_type: "video",
          clips: [
            {
              clip_id: "clip_1",
              start_sec: 0,
              end_sec: 10,
              source_artifact_id: "art_img1",
            },
          ],
        },
        {
          track_id: "track_audio",
          track_type: "audio",
          clips: [
            {
              clip_id: "clip_a1",
              start_sec: 0,
              end_sec: 10,
              source_artifact_id: "art_tts1",
            },
          ],
        },
      ],
      segments: [
        {
          segment_id: "seg1",
          start_sec: 0,
          end_sec: 10,
        },
      ],
      readiness: "ready",
      notes: [],
    },
    local_validation: { decision: "pass", errors: [], warnings: [] },
    execution_state: {},
    graph_trace_summary: null,
    runtime_diagnostics: null,
  },
};

describe("createComposeStore", () => {
  let mockProjectStore: ReturnType<typeof createMockProjectStore>;
  let mockApi: ReturnType<typeof createMockApi>;

  beforeEach(() => {
    mockProjectStore = createMockProjectStore();
    mockApi = createMockApi();
  });

  it("loadProject 加载快照并设置 state", async () => {
    mockApi.loadProject.mockResolvedValue(MOCK_SNAPSHOT);
    const store = createComposeStore({ projectStore: mockProjectStore, api: mockApi });

    await store.loadProject();

    expect(mockApi.loadProject).toHaveBeenCalledWith("proj_test_001");
    expect(store.state.snapshot).toEqual(MOCK_SNAPSHOT);
    expect(store.state.isLoading).toBe(false);
    expect(store.state.loadError).toBeNull();
  });

  it("generateCompose 调用 API 并重新加载", async () => {
    mockApi.generateCompose.mockResolvedValue(undefined);
    mockApi.loadProject.mockResolvedValue(MOCK_SNAPSHOT);
    const store = createComposeStore({ projectStore: mockProjectStore, api: mockApi });

    await store.generateCompose();

    expect(mockApi.generateCompose).toHaveBeenCalledWith("proj_test_001");
    expect(mockApi.loadProject).toHaveBeenCalledWith("proj_test_001");
    expect(store.state.isGenerating).toBe(false);
  });

  it("loadProject 失败时设置 loadError", async () => {
    mockApi.loadProject.mockRejectedValue(new Error("network_error"));
    const store = createComposeStore({ projectStore: mockProjectStore, api: mockApi });

    await store.loadProject();

    expect(store.state.loadError).toBe("network_error");
    expect(store.state.snapshot).toBeNull();
  });
});
