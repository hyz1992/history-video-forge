import { describe, expect, it, vi, beforeEach } from "vitest";
import { reactive } from "vue";

import type { ProjectStore } from "../../../frontend/src/stores/project.js";

function createMockProjectStore(): { state: { projectId: string; currentStatus: string; projects: unknown[] }; syncProject: ReturnType<typeof vi.fn> } & ProjectStore {
  return {
    state: reactive({ projectId: "proj_test_001", currentStatus: "asset_plan_ready", projects: [] }),
    syncProject: vi.fn(),
  } as unknown as ReturnType<typeof createMockProjectStore>;
}

function createMockApi() {
  return {
    loadProject: vi.fn(),
    generateAssets: vi.fn(),
    generateSingleTask: vi.fn(),
    upgradeSegmentToVideo: vi.fn(),
    uploadArtifact: vi.fn(),
    acceptArtifact: vi.fn(),
  };
}

import { createAssetsStore } from "../../../frontend/src/stores/assets.js";

const MOCK_SNAPSHOT = {
  current_status: "assets_ready",
  active_assets: {
    asset_manifest_record_id: "amr_001",
    source_asset_plan_record_id: "apr_001",
    manifest: {
      manifest_version: "asset_manifest_v1",
      source_asset_plan_id: "plan_001",
      source_storyboard_record_id: "sbr_001",
      source_script_record_id: "scr_001",
      execution_options: {
        execution_mode: "auto_available",
        voice_profile_id: null,
        enabled_provider_types: ["tts", "sfx", "bgm"],
        allow_manual_placeholders: false,
      },
      executions: [
        {
          execution_id: "exec_img1",
          task_id: "task_img1",
          task_type: "image_still",
          status: "waiting_manual_upload",
          origin: "manual_upload",
          started_at: null,
          completed_at: null,
          provider_id: null,
          attempts: 0,
          output_artifact_ids: [],
          notes: [],
        },
        {
          execution_id: "exec_tts1",
          task_id: "task_tts1",
          task_type: "tts_audio",
          status: "completed",
          origin: "provider",
          started_at: "2026-05-27T10:00:00Z",
          completed_at: "2026-05-27T10:00:05Z",
          provider_id: "fake",
          attempts: 1,
          output_artifact_ids: ["art_tts1"],
          notes: [],
        },
      ],
      artifacts: [
        {
          artifact_id: "art_tts1",
          artifact_type: "tts_merged_audio",
          origin: "provider",
          file_uri: "/tmp/tts.wav",
          created_at: "2026-05-27T10:00:05Z",
          metadata: { duration_sec: 10, voice_profile_id: "vp1", chunk_artifact_ids: [] },
        },
      ],
      audio_summary: {
        voice_profile_id: "vp1",
        tts_total_duration_sec: 10,
        tts_chunk_artifact_ids: [],
        tts_chunk_routes: [],
        tts_merged_artifact_id: "art_tts1",
        subtitle_artifact_id: null,
        bgm_placements: [],
        sfx_artifact_ids: [],
      },
      segment_routes: [
        {
          segment_id: "seg1",
          tts_artifact_id: "art_tts1",
          subtitle_artifact_id: null,
          primary_visual_artifact_id: null,
          visual_route_type: "missing",
          motion_artifact_id: null,
          fallback_visual_artifact_id: null,
          sfx_artifact_ids: [],
          bgm_placement_ids: [],
          readiness: "blocked",
          notes: [],
        },
      ],
      readiness: "partial",
      notes: [],
    },
    local_validation: { decision: "partial", errors: [], warnings: ["visual assets missing"] },
    execution_state: {},
    graph_trace_summary: null,
    runtime_diagnostics: null,
  },
};

describe("createAssetsStore", () => {
  let mockProjectStore: ReturnType<typeof createMockProjectStore>;
  let mockApi: ReturnType<typeof createMockApi>;

  beforeEach(() => {
    mockProjectStore = createMockProjectStore();
    mockApi = createMockApi();
  });

  it("loadProject 加载快照并设置 state", async () => {
    mockApi.loadProject.mockResolvedValue(MOCK_SNAPSHOT);
    const store = createAssetsStore({ projectStore: mockProjectStore, api: mockApi });

    await store.loadProject();

    expect(mockApi.loadProject).toHaveBeenCalledWith("proj_test_001");
    expect(store.state.snapshot).toEqual(MOCK_SNAPSHOT);
    expect(store.state.isLoading).toBe(false);
    expect(store.state.loadError).toBeNull();
  });

  it("loadProject 在 snapshot 仍为 assets_generating 时保持生成中状态", async () => {
    mockApi.loadProject.mockResolvedValue({
      ...MOCK_SNAPSHOT,
      current_status: "assets_generating",
      active_assets: {
        ...MOCK_SNAPSHOT.active_assets,
        execution_state: { generating: true },
      },
    });
    const store = createAssetsStore({ projectStore: mockProjectStore, api: mockApi });

    await store.loadProject();

    expect(store.state.isGenerating).toBe(true);
  });

  it("loadProject 失败时设置 loadError", async () => {
    mockApi.loadProject.mockRejectedValue(new Error("network_error"));
    const store = createAssetsStore({ projectStore: mockProjectStore, api: mockApi });

    await store.loadProject();

    expect(store.state.loadError).toBe("network_error");
    expect(store.state.snapshot).toBeNull();
  });

  it("generateAssets 调用 API 并重新加载", async () => {
    mockApi.generateAssets.mockResolvedValue(undefined);
    mockApi.loadProject.mockResolvedValue(MOCK_SNAPSHOT);
    const store = createAssetsStore({ projectStore: mockProjectStore, api: mockApi });

    await store.generateAssets({ enabledProviderTypes: ["tts", "sfx", "bgm"] });

    expect(mockApi.generateAssets).toHaveBeenCalledWith("proj_test_001", {
      enabledProviderTypes: ["tts", "sfx", "bgm"],
    });
    expect(store.state.isGenerating).toBe(false);
  });

  it("generateAssets 不传参数时全量生成", async () => {
    mockApi.generateAssets.mockResolvedValue(undefined);
    mockApi.loadProject.mockResolvedValue(MOCK_SNAPSHOT);
    const store = createAssetsStore({ projectStore: mockProjectStore, api: mockApi });

    await store.generateAssets({});

    expect(mockApi.generateAssets).toHaveBeenCalledWith("proj_test_001", {});
  });

  it("uploadArtifact 构造 FormData 并调用 API", async () => {
    const file = new File(["test"], "image.png", { type: "image/png" });
    mockApi.uploadArtifact.mockResolvedValue(undefined);
    mockApi.loadProject.mockResolvedValue(MOCK_SNAPSHOT);
    const store = createAssetsStore({ projectStore: mockProjectStore, api: mockApi });

    await store.uploadArtifact("task_img1", file);

    expect(mockApi.uploadArtifact).toHaveBeenCalledWith("proj_test_001", "task_img1", file);
    expect(store.state.isUploading).toBeNull();
  });

  it("uploadArtifact 设置 isUploading 为当前 taskId", async () => {
    const file = new File(["test"], "image.png", { type: "image/png" });
    let resolveUpload: () => void;
    mockApi.uploadArtifact.mockReturnValue(new Promise<void>((r) => { resolveUpload = r; }));
    const store = createAssetsStore({ projectStore: mockProjectStore, api: mockApi });

    const promise = store.uploadArtifact("task_img1", file);
    expect(store.state.isUploading).toBe("task_img1");

    resolveUpload!();
    await promise;
    expect(store.state.isUploading).toBeNull();
  });

  it("acceptArtifact 调用 API 并重新加载", async () => {
    mockApi.acceptArtifact.mockResolvedValue(undefined);
    mockApi.loadProject.mockResolvedValue(MOCK_SNAPSHOT);
    const store = createAssetsStore({ projectStore: mockProjectStore, api: mockApi });

    await store.acceptArtifact("task_img1", "art_img1_new");

    expect(mockApi.acceptArtifact).toHaveBeenCalledWith("proj_test_001", "task_img1", "art_img1_new");
  });

  it("artifactFileUrl 返回正确的预览 URL", async () => {
    mockApi.loadProject.mockResolvedValue(MOCK_SNAPSHOT);
    const store = createAssetsStore({ projectStore: mockProjectStore, api: mockApi });

    const url = store.artifactFileUrl("art_tts1");
    expect(url).toBe("/api/projects/proj_test_001/artifacts/art_tts1/file");
  });
});
