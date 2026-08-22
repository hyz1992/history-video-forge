// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S2-2D 任务 4：StoryboardPanel 报价流程接入（红灯先行）。
 *
 * - stub/fake 直连成功：不创建报价、不弹窗（现状回归锚点）；
 * - 409 paid_generation_quote_required → createQuote（operation storyboard.generate）
 *   → 报价弹窗 → 确认 → 生成请求携带 quote 字段；
 * - 取消：不提交；
 * - store 层：regenerateSegment 对 409 上抛（不吞成 false）。
 */

import StoryboardPanel from "../../frontend/src/components/storyboard/StoryboardPanel.vue";
import { createAppRouter } from "../../frontend/src/router/index.js";
import { projectStoreKey } from "../../frontend/src/stores/project";
import { storyboardStoreKey } from "../../frontend/src/stores/storyboard";
import { workspaceStoreKey } from "../../frontend/src/stores/workspace";
import { generationCostStoreKey } from "../../frontend/src/stores/generation-cost";
import {
  createStoryboardStore,
  type StoryboardApi,
} from "../../frontend/src/stores/storyboard";
import { ApiError } from "../../frontend/src/utils/api";

const PAID_REQUIRED = new ApiError(409, "paid_generation_quote_required", "请先创建报价");

function makeQuote() {
  return {
    quote_id: "quote_sb_001",
    operation: "storyboard.generate",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    configuration_hash: "hash",
    pricing_versions: [],
    items: [],
    estimated_cost_cny: "0.800000",
    authorization_cost_cny: "0.800000",
    contains_unbounded_item: false,
    budget_limit_cny: null,
    over_budget: false,
    requires_budget_override: false,
  };
}

async function mountStoryboardPanel(options: {
  generateStoryboard: ReturnType<typeof vi.fn>;
  createQuote?: ReturnType<typeof vi.fn>;
}) {
  const router = createAppRouter();
  await router.push("/projects/project-sb-quote/storyboard");
  await router.isReady();
  const state = reactive({
    snapshot: {
      current_status: "storyboard_ready",
      active_storyboard: null,
      active_storyboard_record_id: null,
    },
    segmentStrategyError: null,
    isLoading: false,
    isGenerating: false,
    loadError: null,
    strategyError: null,
  });
  const api: StoryboardApi = {
    loadSnapshot: vi.fn(async () => ({
      current_status: "storyboard_ready",
      active_storyboard: null,
      active_storyboard_record_id: null,
    })),
    generateStoryboard: options.generateStoryboard,
    regenerateStoryboard: vi.fn(),
    updateSegmentStrategy: vi.fn(),
    regenerateSegment: vi.fn(),
  };
  const storyboardStore = createStoryboardStore({
    projectStore: {
      state: reactive({ projectId: "project-sb-quote", currentStatus: "storyboard_ready", projects: [] }),
      loadProject: vi.fn(async () => undefined),
      syncProject: vi.fn(),
    } as never,
    api,
  });
  Object.assign(storyboardStore.state, state);
  const costStore = {
    state: reactive({ lastQuote: null }),
    createQuote: options.createQuote ?? vi.fn(async () => ({ ok: true, value: { quote: makeQuote(), idempotencyKey: "key_sb_1" } })),
    loadCostSummary: vi.fn(),
    loadCostRecords: vi.fn(),
  };
  const wrapper = mount(StoryboardPanel, {
    global: {
      plugins: [router, ElementPlus],
      provide: {
        [projectStoreKey as symbol]: {
          state: reactive({ projectId: "project-sb-quote", currentStatus: "storyboard_ready", projects: [] }),
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
        [storyboardStoreKey as symbol]: storyboardStore as never,
        [generationCostStoreKey as symbol]: costStore as never,
      },
    },
  });
  await flushPromises();
  options.generateStoryboard.mockClear();
  return { wrapper, storyboardStore, costStore };
}

function generateButton(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll("button").find((b) => b.text().includes("开始生成分镜"));
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("StoryboardPanel 报价流程（S2-2D 任务 4）", () => {
  it("stub/fake 直连成功：不创建报价、不弹窗（现状回归）", async () => {
    const generateStoryboard = vi.fn(async () => undefined);
    const { wrapper, costStore, storyboardStore } = await mountStoryboardPanel({ generateStoryboard });
    const button = generateButton(wrapper);
    if (button) await button.trigger("click");
    await Promise.resolve();
    expect(storyboardStore.state.snapshot).toBeTruthy();
    expect(costStore.createQuote).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="quote-estimated"]').exists()).toBe(false);
  });

  it("409 → 创建报价 → 弹窗 → 确认 → 生成请求携带 quote 字段", async () => {
    const generateStoryboard = vi
      .fn()
      .mockRejectedValueOnce(PAID_REQUIRED)
      .mockResolvedValueOnce(undefined);
    const { wrapper, costStore } = await mountStoryboardPanel({ generateStoryboard });
    const button = generateButton(wrapper);
    if (!button) throw new Error("generate button not found");
    await button.trigger("click");
    await Promise.resolve();
    await Promise.resolve();

    expect(costStore.createQuote).toHaveBeenCalledWith("project-sb-quote", { operation: "storyboard.generate" });
    expect(wrapper.find('[data-testid="quote-estimated"]').text()).toContain("0.8");

    await wrapper.find('[data-testid="quote-confirm"]').trigger("click");
    await flushPromises();
    expect(generateStoryboard).toHaveBeenLastCalledWith("project-sb-quote", {
      quoteId: "quote_sb_001",
      idempotencyKey: "key_sb_1",
      authorizeBudgetOverride: false,
    });
    expect(wrapper.find('[data-testid="quote-estimated"]').exists()).toBe(false);
  });

  it("取消：不提交 quote 字段", async () => {
    const generateStoryboard = vi
      .fn()
      .mockRejectedValueOnce(PAID_REQUIRED)
      .mockResolvedValueOnce(undefined);
    const { wrapper } = await mountStoryboardPanel({ generateStoryboard });
    const button = generateButton(wrapper);
    if (!button) throw new Error("generate button not found");
    await button.trigger("click");
    await Promise.resolve();
    await Promise.resolve();
    expect(wrapper.find('[data-testid="quote-estimated"]').exists()).toBe(true);

    await wrapper.find('[data-testid="quote-cancel"]').trigger("click");
    await Promise.resolve();
    expect(generateStoryboard).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-testid="quote-estimated"]').exists()).toBe(false);
  });

  it("store 层：regenerateSegment 对 409 上抛（不吞成 false）", async () => {
    const api: StoryboardApi = {
      loadSnapshot: vi.fn(async () => ({
        current_status: "storyboard_ready",
        active_storyboard: null,
        active_storyboard_record_id: null,
      })),
      generateStoryboard: vi.fn(),
      regenerateStoryboard: vi.fn(),
      updateSegmentStrategy: vi.fn(),
      regenerateSegment: vi.fn().mockRejectedValueOnce(PAID_REQUIRED),
    };
    const store = createStoryboardStore({
      projectStore: {
        state: { projectId: "p1", currentStatus: "storyboard_ready" },
        syncProject: vi.fn(),
      } as never,
      api,
    });
    await expect(store.regenerateSegment("sb-1", "feedback")).rejects.toMatchObject({
      status: 409,
    });
    expect(store.state.loadError).toBeNull(); // 409 不进 loadError
  });
});
