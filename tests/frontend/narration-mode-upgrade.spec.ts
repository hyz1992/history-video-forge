// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { reactive } from "vue";
import { describe, expect, it, vi } from "vitest";
import { storyboardTimingView } from "../../frontend/src/stores/storyboard";
import { narrationRangesFromManifest } from "../../frontend/src/stores/assets";
import { assetsStoreKey } from "../../frontend/src/stores/assets";
import { assetPlanningStoreKey } from "../../frontend/src/stores/asset-planning";
import NarrationModeUpgradeDialog from "../../frontend/src/components/storyboard/NarrationModeUpgradeDialog.vue";
import SegmentAssetCard from "../../frontend/src/components/asset/SegmentAssetCard.vue";

describe("分镜真实时长视图", () => {
  it("v2 计划显示实际时长（口播实测）", () => {
    expect(storyboardTimingView({ plan_version: "storyboard_v2", estimated_total_duration_sec: 8, segments: [{ visual_start_ms: 0, visual_end_ms: 8000 }] })).toEqual({ kind: "actual", totalSec: 8 });
  });
  it("v1 计划标记为估算", () => {
    expect(storyboardTimingView({ plan_version: "storyboard_v1", estimated_total_duration_sec: 5, segments: [] })).toEqual({ kind: "estimated", totalSec: 5 });
  });
  it("v2 缺真实时间不回落估算", () => {
    expect(storyboardTimingView({ plan_version: "storyboard_v2", estimated_total_duration_sec: 5, segments: [{ start_hint_sec: 0 }] })).toEqual({ kind: "missing_actual" });
    expect(storyboardTimingView({ plan_version: "storyboard_v2", estimated_total_duration_sec: 5, segments: [] })).toEqual({ kind: "missing_actual" });
    expect(storyboardTimingView({ plan_version: "storyboard_v2", estimated_total_duration_sec: 5 })).toEqual({ kind: "missing_actual" });
  });
  it("空计划为 none", () => {
    expect(storyboardTimingView(null)).toEqual({ kind: "none" });
  });
});

describe("资产 manifest v2 发声区间", () => {
  it("从 segment_routes.narrationRange 派生每镜发声区间", () => {
    const map = narrationRangesFromManifest({ segment_routes: [
      { segment_id: "s1", narrationRange: { startMs: 0, endMs: 3000 } },
      { segment_id: "s2", narrationRange: { startMs: 3000, endMs: 8000 } },
      { segment_id: "s3" },
    ] });
    expect(map.get("s1")).toEqual({ startSec: 0, endSec: 3 });
    expect(map.get("s2")).toEqual({ startSec: 3, endSec: 8 });
    expect(map.has("s3")).toBe(false);
  });
  it("空 manifest 返回空表", () => {
    expect(narrationRangesFromManifest(null).size).toBe(0);
    expect(narrationRangesFromManifest({ segment_routes: [] }).size).toBe(0);
  });
});

const previewFixture = {
  narration_timing_mode: "legacy_estimated",
  upgrade_available: true,
  policy_version: "narration-first-qwen-neutral-20260906-v1",
  recommended: { provider_model_id: "m1", voice_profile_id: "v1" },
  options: [{ provider_model_id: "m1", voice_profile_id: "v1", model: "Qwen", voice: "木灵", region: "cn-beijing", protocol: "dashscope_ws", parameters_version: "neutral-pcm24k-v1" }],
  current_configuration: { revision: 3, tts_mode: "auto", provider_model_id: null, voice_profile_id: null },
  script: { active_script_record_id: "script_1", estimated_duration_sec: 42 },
  affected: [
    { stage: "storyboard", record_id: "sb_1" },
    { stage: "publish", record_id: "pb_1" },
  ],
};

function fakeApi() {
  return {
    preview: vi.fn(async () => previewFixture),
    upgrade: vi.fn(async () => ({ upgraded: true, configuration_revision: 4 })),
  };
}

function mountDialog(api: ReturnType<typeof fakeApi>) {
  return mount(NarrationModeUpgradeDialog, { props: { projectId: "p1", api }, global: { plugins: [ElementPlus] } });
}

describe("旧项目升级对话框", () => {
  it("挂载加载预览：失效产物、模型音色变化与合格选项", async () => {
    const api = fakeApi();
    const w = mountDialog(api);
    await flushPromises();
    expect(api.preview).toHaveBeenCalledWith("p1");
    const text = w.text();
    expect(text).toContain("分镜");
    expect(text).toContain("发布交付");
    expect(text).toContain("自动（跟随全局默认）");
    expect(text).toContain("Qwen · 木灵");
    expect(w.findAll("[data-testid=narration-upgrade-option]").length).toBe(1);
    w.unmount();
  });
  it("取消不发送升级请求", async () => {
    const api = fakeApi();
    const w = mountDialog(api);
    await flushPromises();
    await w.get("[data-testid=narration-upgrade-cancel]").trigger("click");
    expect(api.upgrade).not.toHaveBeenCalled();
    expect(w.emitted("cancel")).toHaveLength(1);
    w.unmount();
  });
  it("确认携带预期版本、下游指针与 confirm_invalidation 并发出 upgraded", async () => {
    const api = fakeApi();
    const w = mountDialog(api);
    await flushPromises();
    await w.get("[data-testid=narration-upgrade-confirm]").trigger("click");
    await flushPromises();
    expect(api.upgrade).toHaveBeenCalledTimes(1);
    const body = api.upgrade.mock.calls[0][1];
    expect(body).toMatchObject({
      expected_active_script_record_id: "script_1",
      expected_configuration_revision: 3,
      confirm_invalidation: true,
      narration_selection: { provider_model_id: "m1", voice_profile_id: "v1", policy_version: "narration-first-qwen-neutral-20260906-v1" },
    });
    expect(body.expected_downstream).toEqual({ storyboard_record_id: "sb_1", asset_plan_record_id: null, asset_manifest_record_id: null, compose_record_id: null, render_job_record_id: null, publish_package_record_id: "pb_1" });
    expect(w.emitted("upgraded")).toHaveLength(1);
    w.unmount();
  });
  it("升级冲突展示错误且不发 upgraded", async () => {
    const api = fakeApi();
    api.upgrade = vi.fn(async () => { throw Error("narration_upgrade_conflict"); });
    const w = mountDialog(api);
    await flushPromises();
    await w.get("[data-testid=narration-upgrade-confirm]").trigger("click");
    await flushPromises();
    expect(w.text()).toContain("narration_upgrade_conflict");
    expect(w.emitted("upgraded")).toBeUndefined();
    w.unmount();
  });
  it("开关关闭时提示不可升级且确认不可用", async () => {
    const api = fakeApi();
    api.preview = vi.fn(async () => ({ ...previewFixture, upgrade_available: false }));
    const w = mountDialog(api);
    await flushPromises();
    expect(w.text()).toContain("尚未开放");
    expect(w.get("[data-testid=narration-upgrade-confirm]").attributes("disabled")).toBeDefined();
    w.unmount();
  });
});

const SEGMENT = {
  segment_id: "seg_1", order: 0, script_excerpt: "楚王压场。", start_hint_sec: 0, end_hint_sec: 8,
  narrative_role: "opening", visual_intent: "朝堂对峙", scene_description: "大殿", visual_elements: ["晏子"],
  framing_hint: "medium", content_type: "live_action", motion_hint: "push_in", editing_hint: "single",
  on_screen_text: [], linked_beats: [], linked_quotes: [], risk_notes: [], api_video_suitability: "api_video_strongly_recommended",
};

function mountCard(props: Record<string, unknown>) {
  const assetsState = reactive({ snapshot: null, isLoading: false, isGenerating: false, isUploading: null, generatingTaskId: null, generatingTaskIds: new Set<string>(), loadError: null });
  const planState = reactive({ snapshot: null, isLoading: false, isGenerating: false, loadError: null });
  return mount(SegmentAssetCard, {
    props: { segment: SEGMENT as never, segmentIndex: 0, imageTasks: [], videoTasks: [], executionsByTaskId: new Map(), artifactsById: new Map(), uploadingTaskId: null, generatingTaskIds: new Set<string>(), projectId: "proj-1", focusTaskId: null, routeReadiness: null, routeEvents: null, ...props } as never,
    global: {
      plugins: [ElementPlus],
      provide: {
        [assetsStoreKey as symbol]: { state: assetsState, loadProject: async () => undefined, generateAssets: async () => undefined, generateSingleTask: async () => undefined, upgradeSegmentToVideo: async () => undefined, uploadArtifact: async () => undefined, acceptArtifact: async () => undefined, acceptFallback: async () => undefined, artifactFileUrl: () => "" } as never,
        [assetPlanningStoreKey as symbol]: { state: planState, loadActiveAssetPlanSnapshot: async () => undefined, retryLoad: async () => undefined, generateAssetPlan: async () => undefined } as never,
      },
    },
  });
}

describe("资产卡片发声区间与停顿归属", () => {
  it("传入 speechTime 时显示发声区间与停顿归属", () => {
    const w = mountCard({ speechTime: { startSec: 0, endSec: 6.5 }, pauseNote: "句间停顿归前镜" });
    const text = w.get(".segment-header-time").text();
    expect(text).toContain("发声 0s - 6.5s");
    expect(text).toContain("画面 0s - 8s");
    expect(text).toContain("停顿 1.5 秒");
    expect(text).toContain("句间停顿归前镜");
    w.unmount();
  });
  it("未传入 speechTime 保持既有展示", () => {
    const w = mountCard({});
    expect(w.get(".segment-header-time").text()).toContain("0s - 8s");
    expect(w.get(".segment-header-time").text()).not.toContain("发声");
    w.unmount();
  });
});
