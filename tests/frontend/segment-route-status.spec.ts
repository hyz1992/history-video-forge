// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { reactive } from "vue";
import { describe, expect, it } from "vitest";

/** S2-2A 任务 11 轮 1：SegmentAssetCard 的 route 状态标签/按钮渲染测试。
 *
 * 覆盖 C1 修复（computed 在 script 内生效）：
 * - automatic_fallback 事件 → 自动降级标签（含可见原因）；
 * - readiness=blocked_waiting_user → 严格失败标签 + 处理按钮 → emit。
 */

import SegmentAssetCard from "../../frontend/src/components/asset/SegmentAssetCard.vue";
import { assetsStoreKey } from "../../frontend/src/stores/assets";
import { assetPlanningStoreKey } from "../../frontend/src/stores/asset-planning";

const SEGMENT = {
  segment_id: "seg_1",
  order: 0,
  script_excerpt: "楚王压场，晏子顶回。",
  start_hint_sec: 0,
  end_hint_sec: 8,
  narrative_role: "opening",
  visual_intent: "朝堂对峙",
  scene_description: "大殿",
  visual_elements: ["晏子"],
  framing_hint: "medium",
  content_type: "live_action",
  motion_hint: "push_in",
  editing_hint: "single",
  on_screen_text: [],
  linked_beats: [],
  linked_quotes: [],
  risk_notes: [],
  api_video_suitability: "api_video_strongly_recommended",
};

function mountCard(routeReadiness: string | null, routeEvents: Array<{ event_type?: string; reason_code?: string }> | null) {
  const assetsState = reactive({
    snapshot: null,
    isLoading: false,
    isGenerating: false,
    isUploading: null,
    generatingTaskId: null,
    generatingTaskIds: new Set<string>(),
    loadError: null,
  });
  const planState = reactive({
    snapshot: null,
    isLoading: false,
    isGenerating: false,
    loadError: null,
  });
  return mount(SegmentAssetCard, {
    props: {
      segment: SEGMENT as never,
      segmentIndex: 0,
      imageTasks: [],
      videoTasks: [],
      executionsByTaskId: new Map(),
      artifactsById: new Map(),
      uploadingTaskId: null,
      generatingTaskIds: new Set<string>(),
      projectId: "proj-1",
      focusTaskId: null,
      routeReadiness,
      routeEvents,
    },
    global: {
      plugins: [ElementPlus],
      provide: {
        [assetsStoreKey as symbol]: {
          state: assetsState,
          loadProject: async () => undefined,
          generateAssets: async () => undefined,
          generateSingleTask: async () => undefined,
          upgradeSegmentToVideo: async () => undefined,
          uploadArtifact: async () => undefined,
          acceptArtifact: async () => undefined,
          acceptFallback: async () => undefined,
          artifactFileUrl: () => "",
        } as never,
        [assetPlanningStoreKey as symbol]: {
          state: planState,
          loadActiveAssetPlanSnapshot: async () => undefined,
          retryLoad: async () => undefined,
          generateAssetPlan: async () => undefined,
        } as never,
      },
    },
  });
}

describe("SegmentAssetCard route status（任务 11 轮 1）", () => {
  it("automatic_fallback 事件渲染自动降级标签（含可见原因）", async () => {
    const wrapper = mountCard("ready", [
      { event_type: "automatic_fallback", reason_code: "video_api_quota_exceeded" },
    ]);
    await flushPromises();

    const badge = wrapper.find('[data-testid="auto-downgraded-badge"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toContain("已自动降级");
    expect(badge.text()).toContain("video_api_quota_exceeded");
    expect(wrapper.find('[data-testid="strict-blocked-badge"]').exists()).toBe(false);
  });

  it("blocked_waiting_user 渲染严格失败标签与处理按钮，点击 emit", async () => {
    const wrapper = mountCard("blocked_waiting_user", []);
    await flushPromises();

    expect(wrapper.find('[data-testid="strict-blocked-badge"]').exists()).toBe(true);
    const button = wrapper.find('[data-testid="strict-handle-button"]');
    expect(button.exists()).toBe(true);
    await button.trigger("click");
    expect(wrapper.emitted("handle-strict-fallback")?.[0]?.[0]).toBe("seg_1");
  });

  it("无 route 状态时不渲染任何标签", async () => {
    const wrapper = mountCard("ready", []);
    await flushPromises();

    expect(wrapper.find('[data-testid="auto-downgraded-badge"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="strict-blocked-badge"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="strict-handle-button"]').exists()).toBe(false);
  });
});
