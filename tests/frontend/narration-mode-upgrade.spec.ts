// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { reactive } from "vue";
import { describe, expect, it, vi } from "vitest";
import { storyboardTimingView, createFetchStoryboardApi } from "../../frontend/src/stores/storyboard";
import { narrationRangesFromManifest, narrationSpeechRanges, narrationRecordIdFromManifest, narrationPauseNote } from "../../frontend/src/stores/assets";
import { assetsStoreKey } from "../../frontend/src/stores/assets";
import { assetPlanningStoreKey } from "../../frontend/src/stores/asset-planning";
import NarrationModeUpgradeDialog from "../../frontend/src/components/storyboard/NarrationModeUpgradeDialog.vue";
import NarrationModeUpgradeEntry from "../../frontend/src/components/storyboard/NarrationModeUpgradeEntry.vue";
import SegmentAssetCard from "../../frontend/src/components/asset/SegmentAssetCard.vue";

vi.mock("../../frontend/src/utils/api", () => ({ apiFetch: vi.fn(async () => ({ current_status: "storyboard_ready", narration_timing_mode: "narration_first_v1", active_storyboard: { plan: {} }, active_storyboard_record_id: "sb" })) }));

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
  it("结合 timing tokens 派生真实发声区间与停顿秒，无 token 镜头不产出", () => {
    const segments = [
      { segment_id: "s1", source_start: 0, source_end: 10, start_hint_sec: 0, end_hint_sec: 8 },
      { segment_id: "s2", source_start: 10, source_end: 20, start_hint_sec: 8, end_hint_sec: 12 },
    ];
    const ranges = new Map([["s1", { startSec: 0, endSec: 8 }], ["s2", { startSec: 8, endSec: 12 }]]);
    const timing = { tokens: [
      { sourceStart: 0, sourceEnd: 4, startMs: 200, endMs: 3400 },
      { sourceStart: 4, sourceEnd: 10, startMs: 3500, endMs: 6500 },
    ] };
    const map = narrationSpeechRanges({ segments, ranges, timing });
    expect(map.get("s1")).toEqual({ startSec: 0.2, endSec: 6.5, pauseSec: 1.7 });
    expect(map.has("s2")).toBe(false);
  });
  it("storyboard 快照映射保留 narration_timing_mode", async () => {
    const api = createFetchStoryboardApi();
    const snap = await api.loadSnapshot("p1");
    expect(snap.narration_timing_mode).toBe("narration_first_v1");
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
  it("传入带 pauseSec 的 speechTime 时显示发声区间与真实停顿", () => {
    const w = mountCard({ speechTime: { startSec: 0, endSec: 6.5, pauseSec: 1.5 }, pauseNote: "句间停顿归前镜" });
    const text = w.get(".segment-header-time").text();
    expect(text).toContain("发声 0s - 6.5s");
    expect(text).toContain("画面 0s - 8s");
    expect(text).toContain("停顿 1.5 秒");
    expect(text).toContain("句间停顿归前镜");
    w.unmount();
  });
  it("无 pauseSec 时不以数字冒充停顿，仅显示归属", () => {
    const w = mountCard({ speechTime: { startSec: 0, endSec: 6.5 }, pauseNote: "句间停顿归前镜" });
    const text = w.get(".segment-header-time").text();
    expect(text).toContain("发声 0s - 6.5s");
    expect(text).toContain("停顿归属：句间停顿归前镜");
    expect(text).not.toContain("停顿 0.0 秒");
    w.unmount();
  });
  it("未传入 speechTime 保持既有展示", () => {
    const w = mountCard({});
    expect(w.get(".segment-header-time").text()).toContain("0s - 8s");
    expect(w.get(".segment-header-time").text()).not.toContain("发声");
    w.unmount();
  });
});

describe("升级对话框加载失败路径", () => {
  it("预览加载失败仍显示取消并可关闭", async () => {
    const api = fakeApi();
    api.preview = vi.fn(async () => { throw Error("network down"); });
    const w = mountDialog(api);
    await flushPromises();
    expect(w.text()).toContain("network down");
    await w.get("[data-testid=narration-upgrade-cancel]").trigger("click");
    expect(w.emitted("cancel")).toHaveLength(1);
    w.unmount();
  });
});

describe("旧项目升级入口", () => {
  it("legacy 项目显示入口，展开对话框并外传 upgraded", async () => {
    const api = fakeApi();
    const w = mount(NarrationModeUpgradeEntry, { props: { projectId: "p1", snapshotNarrationMode: "legacy_estimated", api }, global: { plugins: [ElementPlus] } });
    expect(w.get("[data-testid=narration-upgrade-entry]").text()).toContain("升级到口播前置模式");
    await w.get("[data-testid=narration-upgrade-entry]").trigger("click");
    await flushPromises();
    expect(api.preview).toHaveBeenCalledWith("p1");
    await w.get("[data-testid=narration-upgrade-confirm]").trigger("click");
    await flushPromises();
    expect(api.upgrade).toHaveBeenCalledTimes(1);
    expect(w.emitted("upgraded")).toHaveLength(1);
    // 升级成功后入口按钮重现，由宿主页面负责跳转文案页
    expect(w.find("[data-testid=narration-upgrade-entry]").exists()).toBe(true);
    w.unmount();
  });
  it("取消回到入口按钮且零请求", async () => {
    const api = fakeApi();
    const w = mount(NarrationModeUpgradeEntry, { props: { projectId: "p1", snapshotNarrationMode: "legacy_estimated", api }, global: { plugins: [ElementPlus] } });
    await w.get("[data-testid=narration-upgrade-entry]").trigger("click");
    await flushPromises();
    await w.get("[data-testid=narration-upgrade-cancel]").trigger("click");
    expect(api.upgrade).not.toHaveBeenCalled();
    expect(w.get("[data-testid=narration-upgrade-entry]").exists()).toBe(true);
    w.unmount();
  });
  it("新模式项目不显示升级入口", () => {
    const api = fakeApi();
    const w = mount(NarrationModeUpgradeEntry, { props: { projectId: "p1", snapshotNarrationMode: "narration_first_v1", api }, global: { plugins: [ElementPlus] } });
    expect(w.find("[data-testid=narration-upgrade-entry]").exists()).toBe(false);
    w.unmount();
  });
});

describe("manifest 口播引用与停顿归属文案", () => {
  it("从 v2 manifest 取口播记录 id，缺失/非法返回 null", () => {
    expect(narrationRecordIdFromManifest({ narration_reference: { narration_record_id: "n1" } })).toBe("n1");
    expect(narrationRecordIdFromManifest({ narration_reference: {} })).toBeNull();
    expect(narrationRecordIdFromManifest(null)).toBeNull();
  });
  it("停顿归属按首镜/中段/末镜/单镜区分", () => {
    expect(narrationPauseNote(0, 3)).toBe("首部静音与句间停顿归本镜");
    expect(narrationPauseNote(1, 3)).toBe("句间停顿归本镜末尾");
    expect(narrationPauseNote(2, 3)).toBe("句间停顿与尾部静音归本镜");
    expect(narrationPauseNote(0, 1)).toBe("首尾静音与停顿归本镜");
  });
});
describe("升级入口与推荐选中", () => {
  it("快照未加载时不显示升级入口（防 v1 项目闪现）", () => {
    const api = fakeApi();
    const w = mount(NarrationModeUpgradeEntry, { props: { projectId: "p1", snapshotNarrationMode: null, api }, global: { plugins: [ElementPlus] } });
    expect(w.find("[data-testid=narration-upgrade-entry]").exists()).toBe(false);
    w.unmount();
  });
  it("对话框默认选中推荐组合", async () => {
    const api = fakeApi();
    api.preview = vi.fn(async () => ({ ...previewFixture, options: [
      { provider_model_id: "other", voice_profile_id: "ov", model: "其他", voice: "音色", region: "cn-beijing", protocol: "dashscope_ws", parameters_version: "p1" },
      { provider_model_id: "m1", voice_profile_id: "v1", model: "Qwen", voice: "木灵", region: "cn-beijing", protocol: "dashscope_ws", parameters_version: "neutral-pcm24k-v1" },
    ] }));
    const w = mountDialog(api);
    await flushPromises();
    await w.get("[data-testid=narration-upgrade-confirm]").trigger("click");
    await flushPromises();
    const body = api.upgrade.mock.calls[0][1];
    expect(body.narration_selection).toMatchObject({ provider_model_id: "m1", voice_profile_id: "v1" });
    w.unmount();
  });
});
