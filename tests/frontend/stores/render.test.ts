import { describe, expect, it, vi, beforeEach } from "vitest";
import { reactive } from "vue";

import type { ProjectStore } from "../../../frontend/src/stores/project.js";

function createMockProjectStore(): { state: { projectId: string; currentStatus: string; projects: unknown[] }; syncProject: ReturnType<typeof vi.fn> } & ProjectStore {
  return {
    state: reactive({ projectId: "proj_test_001", currentStatus: "compose_ready", projects: [] }),
    syncProject: vi.fn(),
  } as unknown as ReturnType<typeof createMockProjectStore>;
}

function createMockApi() {
  return {
    loadProject: vi.fn(),
    generateRender: vi.fn(),
  };
}

import { createRenderStore } from "../../../frontend/src/stores/render.js";

const MOCK_SNAPSHOT = {
  current_status: "render_ready",
  active_render: {
    render_job_record_id: "rjr_001",
    source_compose_record_id: "cr_001",
    source_asset_manifest_record_id: "amr_001",
    status: "completed",
    profile: {
      width: 1920,
      height: 1080,
      fps: 30,
    },
    output_artifact: {
      artifact_type: "video_mp4",
      file_uri: "/tmp/output.mp4",
      duration_sec: 60,
      width: 1920,
      height: 1080,
      fps: 30,
      metadata: {},
    },
    validation_result: {
      decision: "pass",
      errors: [],
      warnings: [],
    },
    execution_state: null,
    graph_trace_summary: null,
    runtime_diagnostics: null,
  },
};

describe("createRenderStore", () => {
  let mockProjectStore: ReturnType<typeof createMockProjectStore>;
  let mockApi: ReturnType<typeof createMockApi>;

  beforeEach(() => {
    mockProjectStore = createMockProjectStore();
    mockApi = createMockApi();
  });

  it("loadProject 加载快照并设置 state", async () => {
    mockApi.loadProject.mockResolvedValue(MOCK_SNAPSHOT);
    const store = createRenderStore({ projectStore: mockProjectStore, api: mockApi });

    await store.loadProject();

    expect(mockApi.loadProject).toHaveBeenCalledWith("proj_test_001");
    expect(store.state.snapshot).toEqual(MOCK_SNAPSHOT);
    expect(store.state.isLoading).toBe(false);
    expect(store.state.loadError).toBeNull();
  });

  it("generateRender 调用 API 并重新加载", async () => {
    mockApi.generateRender.mockResolvedValue(undefined);
    mockApi.loadProject.mockResolvedValue(MOCK_SNAPSHOT);
    const store = createRenderStore({ projectStore: mockProjectStore, api: mockApi });

    await store.generateRender();

    expect(mockApi.generateRender).toHaveBeenCalledWith("proj_test_001");
    expect(store.state.isGenerating).toBe(false);
    expect(store.state.snapshot).toEqual(MOCK_SNAPSHOT);
  });

  it("getPreviewUrl 返回正确的预览 URL", async () => {
    mockApi.loadProject.mockResolvedValue(MOCK_SNAPSHOT);
    const store = createRenderStore({ projectStore: mockProjectStore, api: mockApi });

    const url = store.getPreviewUrl();
    expect(url).toBe("/api/projects/proj_test_001/render/preview");
  });

  it("getDownloadUrl 返回正确的下载 URL", async () => {
    mockApi.loadProject.mockResolvedValue(MOCK_SNAPSHOT);
    const store = createRenderStore({ projectStore: mockProjectStore, api: mockApi });

    const url = store.getDownloadUrl();
    expect(url).toBe("/api/projects/proj_test_001/render/download");
  });
});
