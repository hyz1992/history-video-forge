// @vitest-environment jsdom
import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import NarrationEntryCard from "../../frontend/src/components/script/NarrationEntryCard.vue";
import NarrationGenerateDialog from "../../frontend/src/components/script/NarrationGenerateDialog.vue";

interface StoreMockOptions { status?: string; confirmed?: boolean; durationMs?: number; errorCode?: string; scriptConfirmed?: boolean; error?: string | null }
function makeStore(opts: StoreMockOptions = {}) {
  const status = opts.status ?? "empty";
  const store: any = {
    state: reactive({
      busy: false,
      loading: false,
      error: opts.error ?? null,
      context: {
        options: [{ provider_model_id: "q", voice_profile_id: "v", model: "Qwen", voice: "木灵", supported_tones: ["neutral"], supported_rates: [1] }],
        configuration: { capabilities: { "tts.synthesize": { provider_model_id: "q" } }, creative: { voice_profile_id: "v" } },
        target_duration_band: { minMs: 1000, maxMs: 5000 },
      },
      snapshot: {
        script_confirmation: opts.scriptConfirmed === false ? null : {},
        narration_readiness: { ready: opts.confirmed ?? false },
        active_narration: null,
        latest_narration_candidate: null,
      },
      detail: status === "empty" ? null : {
        effective_status: status,
        record: {
          id: "n",
          errorCode: opts.errorCode ?? null,
          settings: { model: "Qwen", voice: "木灵" },
          output: { durationMs: opts.durationMs ?? 4000 },
        },
        files: { audio: "/audio" },
        subtitle: null,
      },
    }),
    refresh: vi.fn(),
    generate: vi.fn(),
    confirm: vi.fn(),
    cancel: vi.fn(),
    saveSettings: vi.fn(),
    confirmScript: vi.fn(),
    canProceed: () => store.state.snapshot.narration_readiness.ready,
  };
  return store;
}


// 弹窗经 Teleport 挂到 body：与项目现有 modal 测试一致，用 document 查询。
function q(selector: string): HTMLElement {
  const el = document.querySelector(selector) as HTMLElement | null;
  expect(el).not.toBeNull();
  return el!;
}
describe("NarrationEntryCard", () => {
  it("未生成时显示虚线占位与生成入口", () => {
    const store = makeStore({ status: "empty" });
    const w = mount(NarrationEntryCard, { props: { store } });
    expect(w.find("[data-testid=narration-audio-placeholder]").exists()).toBe(true);
    expect(w.find("[data-testid=narration-entry-status]").text()).toContain("尚未生成口播");
    expect(w.get("[data-testid=narration-entry-open]").text()).toBe("生成口播");
    w.unmount();
  });

  it.each(["ready", "confirmed", "generating", "failed", "stale"] as const)("状态文案与入口按钮 %s", (status) => {
    const store = makeStore({ status });
    const w = mount(NarrationEntryCard, { props: { store } });
    expect(w.find("[data-testid=narration-entry-status]").text()).toBeTruthy();
    const label = w.get("[data-testid=narration-entry-open]").text();
    if (status === "ready") expect(label).toBe("试听口播");
    if (status === "confirmed") expect(label).toBe("查看口播");
    if (status === "generating") expect(label).toBe("生成中…");
    w.unmount();
  });

  it("已生成时展示真实音频控件", () => {
    const store = makeStore({ status: "ready" });
    const w = mount(NarrationEntryCard, { props: { store } });
    expect(w.find("[data-testid=narration-entry-audio]").exists()).toBe(true);
    expect(w.find("[data-testid=narration-audio-placeholder]").exists()).toBe(false);
    w.unmount();
  });

  it("点击入口发出 open 事件", async () => {
    const store = makeStore({ status: "empty" });
    const w = mount(NarrationEntryCard, { props: { store } });
    await w.get("[data-testid=narration-entry-open]").trigger("click");
    expect(w.emitted("open")).toHaveLength(1);
    w.unmount();
  });
});

describe("NarrationGenerateDialog", () => {
  it("打开时刷新状态", async () => {
    const store = makeStore();
    const w = mount(NarrationGenerateDialog, { props: { store, visible: true, estimatedDurationSec: 4 } });
    await flushPromises();
    expect(store.refresh).toHaveBeenCalled();
    w.unmount();
  });

  it("声音摘要显示人类可读名称而非内部 ID", () => {
    const store = makeStore();
    const w = mount(NarrationGenerateDialog, { props: { store, visible: true, estimatedDurationSec: 4 } });
    expect(q("[data-testid=narration-voice-summary]").textContent).toContain("木灵");
    expect(q("[data-testid=narration-voice-summary]").textContent).not.toContain("provider_model_id");
    w.unmount();
  });

  it("生成前自动确认正文", async () => {
    const store = makeStore({ scriptConfirmed: false });
    store.confirmScript.mockImplementation(async () => { store.state.snapshot.script_confirmation = {}; });
    const w = mount(NarrationGenerateDialog, { props: { store, visible: true, estimatedDurationSec: 4 } });
    q("[data-testid=narration-generate]").click();
    await flushPromises();
    expect(store.confirmScript).toHaveBeenCalled();
    expect(store.generate).toHaveBeenCalled();
    w.unmount();
  });

  it("设置区默认折叠，展开后收起不保存", async () => {
    const store = makeStore();
    const w = mount(NarrationGenerateDialog, { props: { store, visible: true, estimatedDurationSec: 4 } });
    expect(document.querySelector("[data-testid=narration-settings]")).toBeNull();
    q("[data-testid=edit-narration-settings]").click();
    await flushPromises();
    expect(document.querySelector("[data-testid=narration-settings]")).not.toBeNull();
    expect((q("[data-testid=narration-tone]") as HTMLSelectElement).disabled).toBe(true);
    q("[data-testid=edit-narration-settings]").click();
    await flushPromises();
    expect(document.querySelector("[data-testid=narration-settings]")).toBeNull();
    expect(store.saveSettings).not.toHaveBeenCalled();
    w.unmount();
  });

  it("超时长必须明确接受后确认", async () => {
    const store = makeStore({ status: "ready", durationMs: 6000 });
    const w = mount(NarrationGenerateDialog, { props: { store, visible: true, estimatedDurationSec: 4 } });
    expect((q("[data-testid=narration-confirm]") as HTMLButtonElement).disabled).toBe(true);
    (q("[data-testid=accept-duration]") as HTMLInputElement).click();
    await flushPromises();
    expect((q("[data-testid=narration-confirm]") as HTMLButtonElement).disabled).toBe(false);
    q("[data-testid=narration-confirm]").click();
    await flushPromises();
    expect(store.confirm).toHaveBeenCalledWith(true);
    w.unmount();
  });

  it.each(["narration_timing_invalid", "narration_provider_unknown"] as const)("失败原因展示 %s", (code) => {
    const store = makeStore({ status: "failed", errorCode: code });
    const w = mount(NarrationGenerateDialog, { props: { store, visible: true, estimatedDurationSec: 4 } });
    expect(q("[data-testid=narration-failure-reason]").textContent).toBeTruthy();
    w.unmount();
  });

  it("即时错误按标签映射展示，未识别码回退原文", async () => {
    const store = makeStore({ error: "narration_text_unsupported_chars" });
    const w = mount(NarrationGenerateDialog, { props: { store, visible: true, estimatedDurationSec: 4 } });
    expect(q("[role=alert]").textContent).toContain("文案包含口播未覆盖的字符");
    store.state.error = "some_unknown_code";
    await flushPromises();
    expect(q("[role=alert]").textContent).toBe("some_unknown_code");
    w.unmount();
  });

  it("失败后重新生成按钮可点击", async () => {
    const store = makeStore({ status: "failed" });
    const w = mount(NarrationGenerateDialog, { props: { store, visible: true, estimatedDurationSec: 4 } });
    const gen = q("[data-testid=narration-generate]") as HTMLButtonElement;
    expect(gen.disabled).toBe(false);
    gen.click();
    await flushPromises();
    expect(store.generate).toHaveBeenCalled();
    w.unmount();
  });

  it("生成中展示进度与取消入口", () => {
    const store = makeStore({ status: "generating" });
    const w = mount(NarrationGenerateDialog, { props: { store, visible: true, estimatedDurationSec: 4 } });
    expect(document.querySelector("[data-testid=narration-generating]")).not.toBeNull();
    expect(document.querySelector("[data-testid=narration-cancel]")).not.toBeNull();
    w.unmount();
  });

  it("确认成功且就绪后关闭弹窗", async () => {
    const store = makeStore({ status: "ready" });
    store.confirm.mockImplementation(async () => { store.state.snapshot.narration_readiness.ready = true; });
    const w = mount(NarrationGenerateDialog, { props: { store, visible: true, estimatedDurationSec: 4 } });
    q("[data-testid=narration-confirm]").click();
    await flushPromises();
    expect(w.emitted("update:visible")?.[0]).toEqual([false]);
    w.unmount();
  });
});
