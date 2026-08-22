// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S2-2D 任务 2：TopicPanel 报价流程接入（红灯先行）。
 *
 * - stub/fake 部署直连成功：不创建报价、不弹窗（现状回归锚点）；
 * - 409 paid_generation_quote_required → createQuote（operation topic.generate）
 *   → 报价弹窗 → 确认 → 生成请求携带 quote 字段；
 * - 取消：不提交；
 * - 提交 409 业务冲突：弹窗关闭、提示重新报价；
 * - 报价创建失败（unquotable）：提示报价服务暂不可用，弹窗不出现。
 */

import TopicPanel from "../../frontend/src/components/topic/TopicPanel.vue";
import { createAppRouter } from "../../frontend/src/router/index.js";
import { projectStoreKey } from "../../frontend/src/stores/project";
import { topicStoreKey } from "../../frontend/src/stores/topic";
import { workspaceStoreKey } from "../../frontend/src/stores/workspace";
import { generationCostStoreKey } from "../../frontend/src/stores/generation-cost";
import { ApiError } from "../../frontend/src/utils/api";

const PAID_REQUIRED = new ApiError(409, "paid_generation_quote_required", "请先创建报价");

function makeQuote() {
  return {
    quote_id: "quote_topic_001",
    operation: "topic.generate",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    configuration_hash: "hash",
    pricing_versions: [],
    items: [],
    estimated_cost_cny: "0.500000",
    authorization_cost_cny: "0.500000",
    contains_unbounded_item: false,
    budget_limit_cny: null,
    over_budget: false,
    requires_budget_override: false,
  };
}

async function mountTopicPanel(options: {
  generateSystemRecommendations: ReturnType<typeof vi.fn>;
  createQuote?: ReturnType<typeof vi.fn>;
}) {
  const router = createAppRouter();
  await router.push("/projects/project-quote/topic");
  await router.isReady();
  const state = reactive({
    activeTab: "system" as const,
    candidates: [],
    currentRound: null,
    historyRounds: [],
    selectedCandidate: null,
    selectedRoundId: null,
    isGenerating: false,
    isConfirming: false,
    confirmedTopicPackageId: null,
    loadError: "generation_failed",
    snapshot: { current_status: "topic_failed" },
    generationSource: null,
  });
  const topicStore = {
    state,
    selectTab: vi.fn(),
    generateSystemRecommendations: options.generateSystemRecommendations,
    openCandidate: vi.fn(),
    closeCandidate: vi.fn(),
    confirmSelectedCandidate: vi.fn(async () => undefined),
    loadExistingTopic: vi.fn(async () => undefined),
    loadSnapshot: vi.fn(async () => ({
      active_topic_package: null,
      current_status: "topic_candidates_ready",
      topic_candidates: null,
    })),
  };
  const costStore = {
    state: reactive({ lastQuote: null }),
    createQuote: options.createQuote ?? vi.fn(async () => ({ ok: true, value: { quote: makeQuote(), idempotencyKey: "key_topic_1" } })),
    loadCostSummary: vi.fn(),
    loadCostRecords: vi.fn(),
  };
  const wrapper = mount(TopicPanel, {
    global: {
      plugins: [router, ElementPlus],
      provide: {
        [projectStoreKey as symbol]: {
          state: reactive({ projectId: "project-quote", currentStatus: "topic_candidates_ready", projects: [] }),
          loadProject: vi.fn(async () => undefined),
          ensureProject: vi.fn(async () => "project-quote"),
          createProject: vi.fn(),
          loadProjects: vi.fn(async () => []),
          deleteProject: vi.fn(),
          resolveProjectWorkspacePath: vi.fn(),
          syncProject: vi.fn(),
        } as never,
        [workspaceStoreKey as symbol]: {
          state: reactive({ currentStep: 0 }),
          setCurrentStep: vi.fn(),
        } as never,
        [topicStoreKey as symbol]: topicStore as never,
        [generationCostStoreKey as symbol]: costStore as never,
      },
    },
  });
  await Promise.resolve();
  await Promise.resolve();
  return { wrapper, topicStore, costStore };
}

function regenerateButton(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll("button").find((button) => button.text() === "重新生成");
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("TopicPanel 报价流程（S2-2D 任务 2）", () => {
  it("stub/fake 直连成功：不创建报价、不弹窗（现状回归）", async () => {
    const generateSystemRecommendations = vi.fn(async () => undefined);
    const { wrapper, costStore } = await mountTopicPanel({ generateSystemRecommendations });
    await regenerateButton(wrapper)!.trigger("click");
    await Promise.resolve();
    expect(generateSystemRecommendations).toHaveBeenCalledTimes(1);
    expect(generateSystemRecommendations).toHaveBeenCalledWith(expect.any(Object));
    expect(costStore.createQuote).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="quote-estimated"]').exists()).toBe(false);
  });

  it("409 → 创建报价 → 弹窗 → 确认 → 生成请求携带 quote 字段", async () => {
    const generateSystemRecommendations = vi
      .fn()
      .mockRejectedValueOnce(PAID_REQUIRED)
      .mockResolvedValueOnce(undefined);
    const { wrapper, costStore, topicStore } = await mountTopicPanel({ generateSystemRecommendations });

    await regenerateButton(wrapper)!.trigger("click");
    await Promise.resolve();
    await Promise.resolve();

    // 报价已创建、弹窗渲染金额
    expect(costStore.createQuote).toHaveBeenCalledWith("project-quote", { operation: "topic.generate" });
    expect(wrapper.find('[data-testid="quote-estimated"]').text()).toContain("0.5");

    // 确认 → 提交携带 quote 字段
    await wrapper.find('[data-testid="quote-confirm"]').trigger("click");
    await Promise.resolve();
    expect(topicStore.generateSystemRecommendations).toHaveBeenLastCalledWith(
      expect.any(Object),
      {
        quoteId: "quote_topic_001",
        idempotencyKey: "key_topic_1",
        authorizeBudgetOverride: false,
      },
    );
    expect(wrapper.find('[data-testid="quote-estimated"]').exists()).toBe(false);
  });

  it("取消：不提交 quote 字段", async () => {
    const generateSystemRecommendations = vi
      .fn()
      .mockRejectedValueOnce(PAID_REQUIRED)
      .mockResolvedValueOnce(undefined);
    const { wrapper, topicStore } = await mountTopicPanel({ generateSystemRecommendations });

    await regenerateButton(wrapper)!.trigger("click");
    await Promise.resolve();
    await Promise.resolve();
    expect(wrapper.find('[data-testid="quote-estimated"]').exists()).toBe(true);

    await wrapper.find('[data-testid="quote-cancel"]').trigger("click");
    await Promise.resolve();
    expect(topicStore.generateSystemRecommendations).toHaveBeenCalledTimes(1); // 只有免 quote 尝试
    expect(wrapper.find('[data-testid="quote-estimated"]').exists()).toBe(false);
  });

  it("提交 409 业务冲突：弹窗关闭（提示重新报价）", async () => {
    const generateSystemRecommendations = vi
      .fn()
      .mockRejectedValueOnce(PAID_REQUIRED)
      .mockRejectedValueOnce(new ApiError(409, "generation_quote_configuration_changed", "漂移"));
    const { wrapper } = await mountTopicPanel({ generateSystemRecommendations });

    await regenerateButton(wrapper)!.trigger("click");
    await Promise.resolve();
    await Promise.resolve();
    expect(wrapper.find('[data-testid="quote-estimated"]').exists()).toBe(true);

    await wrapper.find('[data-testid="quote-confirm"]').trigger("click");
    await Promise.resolve();
    await Promise.resolve();
    expect(wrapper.find('[data-testid="quote-estimated"]').exists()).toBe(false);
  });

  it("报价创建失败（unquotable）：弹窗不出现", async () => {
    const generateSystemRecommendations = vi.fn().mockRejectedValueOnce(PAID_REQUIRED);
    const createQuote = vi.fn(async () => ({ ok: false, error: { code: "generation_quote_unquotable" } }));
    const { wrapper, costStore } = await mountTopicPanel({ generateSystemRecommendations, createQuote });

    await regenerateButton(wrapper)!.trigger("click");
    await Promise.resolve();
    await Promise.resolve();
    expect(costStore.createQuote).toHaveBeenCalled();
    expect(wrapper.find('[data-testid="quote-estimated"]').exists()).toBe(false);
  });
});
