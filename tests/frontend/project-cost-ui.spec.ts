// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { reactive } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

/** S2-2A 任务 11：成本明细页 失败测试（实现前红灯）。
 *
 * 覆盖实施计划任务 11 步骤 1 验收：
 * - 成本页区分估算、授权上界、执行后估算、provider actual；
 * - 按 capability/provider 分组展示；
 * - 超额授权标记。
 */

import ProjectCostSummary from "../../frontend/src/components/cost/ProjectCostSummary.vue";
import {
  generationCostStoreKey,
  type GenerationCostStore,
} from "../../frontend/src/stores/generation-cost";

function createMockCostStore(): GenerationCostStore {
  const state = reactive({
    lastQuote: null,
    costSummary: {
      data: {
        currency: "CNY",
        total_estimated_cost_cny: "3.200000",
        total_authorization_cost_cny: "3.800000",
        total_actual_cost_cny: "1.500000",
        quote_count: 2,
        consumed_quote_count: 1,
        over_budget_quote_count: 1,
        run_count: 2,
        run_status_counts: { pending_dispatch: 0, running: 0, succeeded: 1, failed: 1, needs_reconciliation: 0 },
        capability_breakdown: [
          { capability: "image.generate", estimated_cost_cny: "0.200000", actual_cost_cny: "0.200000", record_count: 1 },
          { capability: "tts.synthesize", estimated_cost_cny: "0.800000", actual_cost_cny: "0.000000", record_count: 1 },
        ],
      },
      loading: false,
      error: null,
    },
    costRecords: {
      data: {
        records: [
          {
            id: "usage_1",
            run_id: "run_1",
            run_status: "succeeded",
            snapshot_id: "snap_1",
            operation: "assets.generate",
            capability: "image.generate",
            provider_key: "dashscope",
            model_id: "wan2.6-t2i",
            status: "succeeded",
            unit_type: "image",
            input_units: 1,
            output_units: null,
            estimated_cost_cny: "0.200000",
            actual_cost_cny: "0.200000",
            cost_basis: "provider_usage",
            duration_ms: 1200,
            created_at: "2026-08-20T10:00:00.000Z",
          },
          {
            id: "usage_2",
            run_id: "run_2",
            run_status: "succeeded",
            snapshot_id: "snap_2",
            operation: "assets.generate",
            capability: "tts.synthesize",
            provider_key: "dashscope",
            model_id: "qwen3-tts",
            status: "succeeded",
            unit_type: "tts_character",
            input_units: 100,
            output_units: null,
            estimated_cost_cny: "0.800000",
            actual_cost_cny: null,
            cost_basis: "estimate",
            duration_ms: 800,
            created_at: "2026-08-20T11:00:00.000Z",
          },
        ],
        total: 2,
      },
      loading: false,
      error: null,
    },
  });
  return {
    state,
    createQuote: vi.fn(),
    loadCostSummary: vi.fn(async () => undefined),
    loadCostRecords: vi.fn(async () => undefined),
  } as unknown as GenerationCostStore;
}

function mountCostSummary(store: GenerationCostStore) {
  return mount(ProjectCostSummary, {
    props: { projectId: "proj-1", open: true },
    global: {
      plugins: [ElementPlus],
      provide: { [generationCostStoreKey as symbol]: store },
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProjectCostSummary", () => {
  it("加载 summary 与 records 并展示预计/实际/估算", async () => {
    const store = createMockCostStore();
    const wrapper = mountCostSummary(store);
    await flushPromises();

    expect(store.loadCostSummary).toHaveBeenCalledWith("proj-1");
    expect(store.loadCostRecords).toHaveBeenCalledWith("proj-1");

    const text = wrapper.text();
    expect(text).toContain("3.2"); // 总预计
    expect(text).toContain("1.5"); // 总实际（provider 已确认）
    expect(text).toContain("3.8"); // 授权上界
  });

  it("按 capability 分组展示 breakdown", async () => {
    const store = createMockCostStore();
    const wrapper = mountCostSummary(store);
    await flushPromises();

    const groups = wrapper.findAll('[data-testid="cost-capability-group"]');
    expect(groups.length).toBe(2);
    expect(groups[0]?.text()).toContain("image.generate");
    expect(groups[1]?.text()).toContain("tts.synthesize");
  });

  it("区分 provider actual（provider_usage）与估算（estimate）", async () => {
    const store = createMockCostStore();
    const wrapper = mountCostSummary(store);
    await flushPromises();

    const text = wrapper.text();
    // image.generate 记录为 provider_usage（已确认实际）
    expect(text).toContain("已确认实际");
    // tts.synthesize 记录为 estimate（估算）
    expect(text).toContain("估算");
  });

  it("超额授权标记（over_budget_quote_count > 0）", async () => {
    const store = createMockCostStore();
    const wrapper = mountCostSummary(store);
    await flushPromises();

    const badge = wrapper.find('[data-testid="over-budget-badge"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toContain("1");
  });

  it("金额展示保持字符串精度（不经 Number 计算）", async () => {
    const store = createMockCostStore();
    store.state.costSummary.data!.total_actual_cost_cny = "9007199254740993.120000";
    const wrapper = mountCostSummary(store);
    await flushPromises();

    expect(wrapper.text()).toContain("9007199254740993.12");
  });

  it("加载失败展示错误态", async () => {
    const store = createMockCostStore();
    store.state.costSummary.error = "cost_load_failed";
    const wrapper = mountCostSummary(store);
    await flushPromises();

    expect(wrapper.find('[data-testid="cost-load-error"]').exists()).toBe(true);
  });
});
