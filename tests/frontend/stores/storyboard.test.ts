import { describe, expect, it, vi } from "vitest";

import {
  createFetchStoryboardApi,
  createStoryboardStore,
  type StoryboardApi,
} from "../../../frontend/src/stores/storyboard";
import type { ProjectStore } from "../../../frontend/src/stores/project";

/**
 * S2-2A 任务 4：storyboard store 合同测试。
 * - updateSegmentStrategy 发送新 API 合同（visual_strategy_override + expected_revision）。
 * - store 的本地更新不修改 plan（override 独立于 StoryboardPlan）。
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
  it("updateSegmentStrategyPreference calls API with visual_strategy_override and expected_revision", async () => {
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

    // store 调用不显式传 expected_revision（API 默认 null，首建路径）
    expect(updateSegmentStrategy).toHaveBeenCalledWith("p1", "sb_001", "api_video");
  });

  it("local update does not write override back into the plan segments", async () => {
    // API 失败时走本地兜底：plan 不被修改（override 独立）
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
        active_storyboard: { plan, validation_result: null, execution_state: null, graph_trace_summary: null, runtime_diagnostics: null },
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
    // 不写回 plan（visual_strategy_override 独立）
    expect(segment).not.toHaveProperty("visual_strategy_override");
    expect(segment).not.toHaveProperty("visual_strategy_preference");
    expect(segment.api_video_suitability).toBe("remotion_sufficient");
  });
});
