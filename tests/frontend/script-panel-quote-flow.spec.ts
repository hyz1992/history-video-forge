// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S2-2D 任务 3：ScriptPanel 报价流程接入（红灯先行）。
 *
 * - stub/fake 直连成功：不创建报价、不弹窗（现状回归锚点）；
 * - 409 paid_generation_quote_required → createQuote（operation script.generate）
 *   → 报价弹窗 → 确认 → 生成请求携带 quote 字段；
 * - 取消：不提交；
 * - 提交 409 业务冲突：弹窗关闭。
 */

import ScriptPanel from "../../frontend/src/components/script/ScriptPanel.vue";
import { createAppRouter } from "../../frontend/src/router/index.js";
import { projectStoreKey } from "../../frontend/src/stores/project";
import { scriptStoreKey } from "../../frontend/src/stores/script";
import { workspaceStoreKey } from "../../frontend/src/stores/workspace";
import { generationCostStoreKey } from "../../frontend/src/stores/generation-cost";
import { ApiError } from "../../frontend/src/utils/api";

const PAID_REQUIRED = new ApiError(409, "paid_generation_quote_required", "请先创建报价");

function makeQuote() {
  return {
    quote_id: "quote_script_001",
    operation: "script.generate",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    configuration_hash: "hash",
    pricing_versions: [],
    items: [],
    estimated_cost_cny: "0.300000",
    authorization_cost_cny: "0.300000",
    contains_unbounded_item: false,
    budget_limit_cny: null,
    over_budget: false,
    requires_budget_override: false,
  };
}

async function mountScriptPanel(options: {
  runRegenOnce: ReturnType<typeof vi.fn>;
  createQuote?: ReturnType<typeof vi.fn>;
}) {
  const router = createAppRouter();
  await router.push("/projects/project-script-quote/script");
  await router.isReady();
  const activeScript = {
    script_record_id: "script-1",
    script_text: "测试文案。",
    opening_span: "开头",
    ending_span: "结尾",
    estimated_duration_sec: 82,
    beat_trace: [],
    quote_trace: [],
    review_status: "approved",
    created_at: "2026-08-22T00:00:00.000Z",
    updated_at: "2026-08-22T00:00:00.000Z",
  };
  const state = reactive({
    snapshot: {
      project_id: "project-script-quote",
      current_status: "script_ready",
      active_topic_package: { topic_package_id: "tp-1", canonical_title: "T" },
      active_script: activeScript,
    },
    history: [{ entry_id: "h1", label: "v1", script: activeScript }],
    selectedHistoryEntryId: "h1",
    isLoading: false,
    isRunningAction: false,
    loadError: null,
  });
  const scriptStore = {
    state,
    generateInitialScript: vi.fn(async () => undefined),
    loadActiveScriptSnapshot: vi.fn(async () => undefined),
    retryLoadActiveScriptSnapshot: vi.fn(async () => undefined),
    selectHistoryEntry: vi.fn(),
    runPatchOnce: vi.fn(async () => undefined),
    runRegenOnce: options.runRegenOnce,
  };
  const costStore = {
    state: reactive({ lastQuote: null }),
    createQuote: options.createQuote ?? vi.fn(async () => ({ ok: true, value: { quote: makeQuote(), idempotencyKey: "key_script_1" } })),
    loadCostSummary: vi.fn(),
    loadCostRecords: vi.fn(),
  };
  const wrapper = mount(ScriptPanel, {
    attachTo: document.body,
    global: {
      plugins: [router, ElementPlus],
      provide: {
        [projectStoreKey as symbol]: {
          state: reactive({ projectId: "project-script-quote", currentStatus: "script_ready", projects: [] }),
          loadProject: vi.fn(async () => undefined),
          syncProject: vi.fn(),
          loadProjects: vi.fn(async () => []),
          createProject: vi.fn(),
          resolveProjectWorkspacePath: vi.fn(),
        } as never,
        [workspaceStoreKey as symbol]: {
          state: reactive({ currentStep: 0 }),
          setCurrentStep: vi.fn(),
        } as never,
        [scriptStoreKey as symbol]: scriptStore as never,
        [generationCostStoreKey as symbol]: costStore as never,
      },
    },
  });
  await Promise.resolve();
  await Promise.resolve();
  options.runRegenOnce.mockClear();
  return { wrapper, scriptStore, costStore };
}

/** 触发"重新生成"：打开反馈弹窗 → 提交。 */
async function triggerRegen(wrapper: ReturnType<typeof mount>): Promise<void> {
  const regenButton = wrapper.findAll("button").find((b) => b.text().includes("重新生成"));
  if (!regenButton) throw new Error("regen button not found");
  await regenButton.trigger("click");
  await Promise.resolve();
  // RegenFeedbackModal 用 Teleport 渲染到 body；无审校建议时反馈必填
  const textarea = document.querySelector("textarea");
  if (textarea) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set;
    setter!.call(textarea, "请优化节奏");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  }
  const buttons = [...document.querySelectorAll("button")];
  const submitBtn = buttons.find((b) => b.textContent?.includes("提交重新生成"));
  if (!submitBtn) throw new Error("regen submit button not found");
  submitBtn.click();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("ScriptPanel 报价流程（S2-2D 任务 3）", () => {
  it("stub/fake 直连成功：不创建报价、不弹窗（现状回归）", async () => {
    const runRegenOnce = vi.fn(async () => undefined);
    const { wrapper, costStore, scriptStore } = await mountScriptPanel({ runRegenOnce });
    await triggerRegen(wrapper);
    expect(scriptStore.runRegenOnce).toHaveBeenCalled();
    expect(costStore.createQuote).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="quote-estimated"]').exists()).toBe(false);
  });

  it("409 → 创建报价 → 弹窗 → 确认 → 生成请求携带 quote 字段", async () => {
    const runRegenOnce = vi
      .fn()
      .mockRejectedValueOnce(PAID_REQUIRED)
      .mockResolvedValueOnce(undefined);
    const { wrapper, costStore, scriptStore } = await mountScriptPanel({ runRegenOnce });
    await triggerRegen(wrapper);

    expect(costStore.createQuote).toHaveBeenCalledWith("project-script-quote", { operation: "script.generate" });
    expect(wrapper.find('[data-testid="quote-estimated"]').text()).toContain("0.3");

    await wrapper.find('[data-testid="quote-confirm"]').trigger("click");
    await Promise.resolve();
    expect(scriptStore.runRegenOnce).toHaveBeenLastCalledWith("请优化节奏", {
      quoteId: "quote_script_001",
      idempotencyKey: "key_script_1",
      authorizeBudgetOverride: false,
    });
    expect(wrapper.find('[data-testid="quote-estimated"]').exists()).toBe(false);
  });

  it("取消：不提交 quote 字段", async () => {
    const runRegenOnce = vi
      .fn()
      .mockRejectedValueOnce(PAID_REQUIRED)
      .mockResolvedValueOnce(undefined);
    const { wrapper, scriptStore } = await mountScriptPanel({ runRegenOnce });
    await triggerRegen(wrapper);
    expect(wrapper.find('[data-testid="quote-estimated"]').exists()).toBe(true);

    await wrapper.find('[data-testid="quote-cancel"]').trigger("click");
    await Promise.resolve();
    expect(scriptStore.runRegenOnce).toHaveBeenCalledTimes(1); // 只有免 quote 尝试
    expect(wrapper.find('[data-testid="quote-estimated"]').exists()).toBe(false);
  });

  it("提交 409 业务冲突：弹窗关闭", async () => {
    const runRegenOnce = vi
      .fn()
      .mockRejectedValueOnce(PAID_REQUIRED)
      .mockRejectedValueOnce(new ApiError(409, "generation_quote_configuration_changed", "漂移"));
    const { wrapper } = await mountScriptPanel({ runRegenOnce });
    await triggerRegen(wrapper);
    expect(wrapper.find('[data-testid="quote-estimated"]').exists()).toBe(true);

    await wrapper.find('[data-testid="quote-confirm"]').trigger("click");
    await Promise.resolve();
    await Promise.resolve();
    expect(wrapper.find('[data-testid="quote-estimated"]').exists()).toBe(false);
  });
});
