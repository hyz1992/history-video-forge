import { describe, expect, it, vi } from "vitest";

import {
  createStoryboardStore,
  type StoryboardApi,
} from "../../../frontend/src/stores/storyboard";
import type { ProjectStore } from "../../../frontend/src/stores/project";

/**
 * S2-2A 任务 4 整改：storyboard store 合同测试。
 * - updateSegmentStrategy 发送新 API 合同（visual_strategy_override + expected_revision）。
 * - store 从快照投影读取 override revision，后续 PATCH 携带真实 revision。
 * - 409 冲突不静默吞掉（strategyError 暴露）。
 * - 本地兜底不修改 plan。
 */

function makeProjectStore(): ProjectStore {
  return {
    state: { projectId: "p1", projectOwnerId: null, currentStatus: "storyboard_ready", publishIsReady: false, projects: [] } as never,
    createProject: vi.fn() as never,
    ensureProject: vi.fn() as never,
    deleteProject: vi.fn() as never,
    loadProject: vi.fn() as never,
    loadProjects: vi.fn() as never,
    resolveProjectWorkspacePath: vi.fn() as never,
    syncProject: vi.fn() as never,
    setPublishReady: vi.fn() as never,
  };
}

describe("storyboard store S2-2A override contract", () => {
  it("updateSegmentStrategyPreference calls API with override and null revision on first create", async () => {
    const updateSegmentStrategy = vi.fn().mockResolvedValue({ updated: true, revision: 1 });
    const api: StoryboardApi = {
      loadSnapshot: vi.fn().mockResolvedValue({ current_status: null, active_storyboard: null, active_storyboard_record_id: null }),
      generateStoryboard: vi.fn(),
      regenerateStoryboard: vi.fn(),
      updateSegmentStrategy,
      regenerateSegment: vi.fn(),
    };
    const store = createStoryboardStore({ projectStore: makeProjectStore(), api });
    await store.updateSegmentStrategyPreference("sb_001", "api_video");

    // 首建路径：expected_revision=null（无既有 override）
    expect(updateSegmentStrategy).toHaveBeenCalledWith("p1", "sb_001", "api_video", null);
  });

  it("subsequent PATCH carries the stored override revision from snapshot projection", async () => {
    const updateSegmentStrategy = vi.fn().mockResolvedValue({ updated: true, revision: 2 });
    const api: StoryboardApi = {
      loadSnapshot: vi.fn().mockResolvedValue({
        current_status: "storyboard_ready",
        active_storyboard: {
          plan: { plan_version: "storyboard_v1", segments: [] },
          validation_result: null,
          execution_state: null,
          graph_trace_summary: null,
          runtime_diagnostics: null,
          // 投影：已有 override revision=1
          segment_strategies: [
            { segment_id: "sb_001", api_video_suitability: "remotion_sufficient", strategy_override: "api_video", override_revision: 1, resolved_route: "api_video", reason_code: "segment_override_api_video" },
          ],
        },
        active_storyboard_record_id: "sb_rec_1",
      }),
      generateStoryboard: vi.fn(),
      regenerateStoryboard: vi.fn(),
      updateSegmentStrategy,
      regenerateSegment: vi.fn(),
    };
    const store = createStoryboardStore({ projectStore: makeProjectStore(), api });
    await store.loadActiveStoryboardSnapshot();
    await store.updateSegmentStrategyPreference("sb_001", "remotion_motion");

    // 第二次操作必须携带真实 revision（1），否则 409
    expect(updateSegmentStrategy).toHaveBeenCalledWith("p1", "sb_001", "remotion_motion", 1);
  });

  it("409 conflict is exposed via strategyError instead of being swallowed", async () => {
    const updateSegmentStrategy = vi.fn().mockRejectedValue(new Error("storyboard_segment_override_revision_conflict"));
    const api: StoryboardApi = {
      loadSnapshot: vi.fn().mockResolvedValue({
        current_status: "storyboard_ready",
        active_storyboard: {
          plan: { plan_version: "storyboard_v1", segments: [] },
          validation_result: null,
          execution_state: null,
          graph_trace_summary: null,
          runtime_diagnostics: null,
          segment_strategies: [
            { segment_id: "sb_001", api_video_suitability: "remotion_sufficient", strategy_override: "api_video", override_revision: 1, resolved_route: "api_video", reason_code: "segment_override_api_video" },
          ],
        },
        active_storyboard_record_id: "sb_rec_1",
      }),
      generateStoryboard: vi.fn(),
      regenerateStoryboard: vi.fn(),
      updateSegmentStrategy,
      regenerateSegment: vi.fn(),
    };
    const store = createStoryboardStore({ projectStore: makeProjectStore(), api });
    await store.loadActiveStoryboardSnapshot();
    await store.updateSegmentStrategyPreference("sb_001", "remotion_motion");

    // 冲突必须暴露，不静默吞掉
    expect(store.state.strategyError).toContain("已被其他操作更新");
  });

  it("local fallback does not write override back into the plan segments", async () => {
    const plan = {
      plan_version: "storyboard_v1",
      segments: [
        {
          segment_id: "sb_001",
          narrative_role: "opening",
          script_excerpt: "楚王压场。",
          api_video_suitability: "remotion_sufficient",
        },
      ],
    };
    const api: StoryboardApi = {
      loadSnapshot: vi.fn().mockResolvedValue({
        current_status: "storyboard_ready",
        active_storyboard: { plan, validation_result: null, execution_state: null, graph_trace_summary: null, runtime_diagnostics: null, segment_strategies: [] },
        active_storyboard_record_id: "sb_rec_1",
      }),
      generateStoryboard: vi.fn(),
      regenerateStoryboard: vi.fn(),
      updateSegmentStrategy: vi.fn().mockRejectedValue(new Error("offline")),
      regenerateSegment: vi.fn(),
    };
    const store = createStoryboardStore({ projectStore: makeProjectStore(), api });
    await store.loadActiveStoryboardSnapshot();
    await store.updateSegmentStrategyPreference("sb_001", "api_video");

    const storedPlan = store.state.snapshot?.active_storyboard?.plan;
    const segment = storedPlan?.segments[0] as Record<string, unknown>;
    expect(segment).not.toHaveProperty("visual_strategy_override");
    expect(segment).not.toHaveProperty("visual_strategy_preference");
    expect(segment.api_video_suitability).toBe("remotion_sufficient");
  });
});
