// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S2-2D 任务 5：PublishPanel 报价流程接入（红灯先行）。
 *
 * - stub/fake 直连成功：不创建报价、不弹窗（现状回归锚点）；
 * - 409 paid_generation_quote_required → createQuote（operation publish.generate）
 *   → 报价弹窗 → 确认 → 生成请求携带 quote 字段；
 * - 取消：不提交。
 */

import PublishPanel from "../../frontend/src/components/publish/PublishPanel.vue";
import { createAppRouter } from "../../frontend/src/router/index.js";
import { projectStoreKey } from "../../frontend/src/stores/project";
import { publishStoreKey } from "../../frontend/src/stores/publish";
import { workspaceStoreKey } from "../../frontend/src/stores/workspace";
import { generationCostStoreKey } from "../../frontend/src/stores/generation-cost";
import { ApiError } from "../../frontend/src/utils/api";

const PAID_REQUIRED = new ApiError(409, "paid_generation_quote_required", "请先创建报价");

function makeQuote() {
  return {
    quote_id: "quote_pub_001",
    operation: "publish.generate",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    configuration_hash: "hash",
    pricing_versions: [],
    items: [],
    estimated_cost_cny: "0.600000",
    authorization_cost_cny: "0.600000",
    contains_unbounded_item: false,
    budget_limit_cny: null,
    over_budget: false,
    requires_budget_override: false,
  };
}

async function mountPublishPanel(options: {
  generatePackage: ReturnType<typeof vi.fn>;
  createQuote?: ReturnType<typeof vi.fn>;
}) {
  const router = createAppRouter();
  await router.push("/projects/project-pub-quote/publish");
  await router.isReady();
  const state = reactive({
    snapshot: {
      current_status: "publish_ready",
      active_publish_package: null,
      active_render: null,
    },
    isGenerating: false,
    isGeneratingCover: false,
    isOptimizingCover: false,
    isUploadingCover: false,
    loadError: null,
    exportManifest: null,
  });
  const publishStore = {
    state,
    loadProject: vi.fn(async () => undefined),
    generatePackage: options.generatePackage,
    generateCover: vi.fn(async () => undefined),
    optimizeCoverPrompt: vi.fn(async () => ({ optimized_prompt: "x" })),
    updatePackage: vi.fn(async () => undefined),
    uploadCover: vi.fn(async () => undefined),
    loadTitleCandidates: vi.fn(async () => ({ candidates: [] })),
    exportPackage: vi.fn(async () => undefined),
  };
  const costStore = {
    state: reactive({ lastQuote: null }),
    createQuote: options.createQuote ?? vi.fn(async () => ({ ok: true, value: { quote: makeQuote(), idempotencyKey: "key_pub_1" } })),
    loadCostSummary: vi.fn(),
    loadCostRecords: vi.fn(),
  };
  const wrapper = mount(PublishPanel, {
    global: {
      plugins: [router, ElementPlus],
      provide: {
        [projectStoreKey as symbol]: {
          state: reactive({ projectId: "project-pub-quote", currentStatus: "publish_ready", projects: [] }),
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
        [publishStoreKey as symbol]: publishStore as never,
        [generationCostStoreKey as symbol]: costStore as never,
      },
    },
  });
  await flushPromises();
  options.generatePackage.mockClear();
  return { wrapper, publishStore, costStore };
}

function generateButton(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll("button").find((b) => b.text().includes("生成发布包"));
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("PublishPanel 报价流程（S2-2D 任务 5）", () => {
  it("stub/fake 直连成功：不创建报价、不弹窗（现状回归）", async () => {
    const generatePackage = vi.fn(async () => undefined);
    const { wrapper, costStore } = await mountPublishPanel({ generatePackage });
    const button = generateButton(wrapper);
    if (!button) throw new Error("generate button not found");
    await button.trigger("click");
    await flushPromises();
    expect(generatePackage).toHaveBeenCalled();
    expect(costStore.createQuote).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="quote-estimated"]').exists()).toBe(false);
  });

  it("409 → 创建报价 → 弹窗 → 确认 → 生成请求携带 quote 字段", async () => {
    const generatePackage = vi
      .fn()
      .mockRejectedValueOnce(PAID_REQUIRED)
      .mockResolvedValueOnce(undefined);
    const { wrapper, costStore } = await mountPublishPanel({ generatePackage });
    const button = generateButton(wrapper);
    if (!button) throw new Error("generate button not found");
    await button.trigger("click");
    await flushPromises();

    expect(costStore.createQuote).toHaveBeenCalledWith("project-pub-quote", { operation: "publish.generate" });
    expect(wrapper.find('[data-testid="quote-estimated"]').text()).toContain("0.6");

    await wrapper.find('[data-testid="quote-confirm"]').trigger("click");
    await flushPromises();
    expect(generatePackage).toHaveBeenLastCalledWith({
      quoteId: "quote_pub_001",
      idempotencyKey: "key_pub_1",
      authorizeBudgetOverride: false,
    });
    expect(wrapper.find('[data-testid="quote-estimated"]').exists()).toBe(false);
  });

  it("取消：不提交 quote 字段", async () => {
    const generatePackage = vi
      .fn()
      .mockRejectedValueOnce(PAID_REQUIRED)
      .mockResolvedValueOnce(undefined);
    const { wrapper } = await mountPublishPanel({ generatePackage });
    const button = generateButton(wrapper);
    if (!button) throw new Error("generate button not found");
    await button.trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="quote-estimated"]').exists()).toBe(true);

    await wrapper.find('[data-testid="quote-cancel"]').trigger("click");
    await flushPromises();
    expect(generatePackage).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-testid="quote-estimated"]').exists()).toBe(false);
  });
});
