// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { reactive } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

/** 2026-08-23：项目费用清单面板（跨阶段共用，默认收起）。
 *
 * 覆盖：
 * - 打开时加载 summary 与 records，展示总预计/已确认实际；
 * - 按流水线阶段分组（operation → 阶段 key 映射）；
 * - 明细行区分 provider actual（provider_usage）与估算（estimate）；
 * - 金额展示保持字符串精度（不经 Number 计算）；
 * - 加载失败展示错误态。
 */

import ProjectCostPanel from "../../frontend/src/components/cost/ProjectCostPanel.vue";
import {
  generationCostStoreKey,
  type GenerationCostStore,
} from "../../frontend/src/stores/generation-cost";

function createMockCostStore(): GenerationCostStore {
  const state = reactive({
    costSummary: {
      data: {
        currency: "CNY",
        total_estimated_cost_cny: "3.200000",
        total_actual_cost_cny: "1.500000",
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
            operation_name: null,

          },
          {
            id: "usage_2",
            run_id: "run_1",
            run_status: "succeeded",
            snapshot_id: "snap_1",
            operation: "script.generate",
            capability: "llm.smart",
            provider_key: "deepseek",
            model_id: "deepseek-v4-pro",
            status: "succeeded",
            unit_type: "token",
            input_units: 500,
            output_units: 300,
            estimated_cost_cny: "2.200000",
            actual_cost_cny: "1.300000",
            cost_basis: "provider_usage",
            duration_ms: 3400,
            created_at: "2026-08-20T09:00:00.000Z",
            operation_name: "script.writer",

          },
          {
            id: "usage_2b",
            run_id: "run_1",
            run_status: "succeeded",
            snapshot_id: "snap_1",
            operation: "script.generate",
            capability: "llm.smart",
            provider_key: "deepseek",
            model_id: "deepseek-v4-pro",
            status: "succeeded",
            unit_type: "token",
            input_units: 300,
            output_units: 200,
            estimated_cost_cny: "0.900000",
            actual_cost_cny: "0.500000",
            cost_basis: "provider_usage",
            duration_ms: 2100,
            created_at: "2026-08-20T09:01:00.000Z",
            operation_name: "script.semantic-reviewer",

          },
          {
            id: "usage_2c",
            run_id: "run_3",
            run_status: "succeeded",
            snapshot_id: "snap_3",
            operation: "script.generate",
            capability: "llm.smart",
            provider_key: "deepseek",
            model_id: "deepseek-v4-pro",
            status: "succeeded",
            unit_type: "token",
            input_units: 120,
            output_units: 60,
            estimated_cost_cny: "0.400000",
            actual_cost_cny: "0.200000",
            cost_basis: "provider_usage",
            duration_ms: 900,
            created_at: "2026-08-20T09:02:00.000Z",
            operation_name: "script.writer",
          },
          {
            id: "usage_3",
            run_id: "run_2",
            run_status: "succeeded",
            snapshot_id: "snap_2",
            operation: "assets.generate",
            capability: "tts.synthesize",
            provider_key: "dashscope",
            model_id: "qwen3-tts-instruct-flash",
            status: "succeeded",
            unit_type: "tts_character",
            input_units: 820,
            output_units: null,
            estimated_cost_cny: "0.800000",
            actual_cost_cny: null,
            cost_basis: "estimate",
            duration_ms: 900,
            created_at: "2026-08-20T08:00:00.000Z",
            operation_name: null,
          },
          {
            id: "usage_4",
            run_id: "run_2",
            run_status: "succeeded",
            snapshot_id: "snap_2",
            operation: "asset_plan.generate",
            capability: "llm.smart",
            provider_key: "deepseek",
            model_id: "deepseek-v4-pro",
            status: "succeeded",
            unit_type: "token",
            input_units: 1000,
            output_units: 500,
            estimated_cost_cny: "0.100000",
            actual_cost_cny: "0.100000",
            cost_basis: "provider_usage",
            duration_ms: 3000,
            created_at: "2026-08-20T07:00:00.000Z",
            operation_name: "asset-planning.planner",
          },
          {
            id: "usage_5",
            run_id: "run_2",
            run_status: "succeeded",
            snapshot_id: "snap_2",
            operation: "asset_plan.generate",
            capability: "llm.smart",
            provider_key: "deepseek",
            model_id: "deepseek-v4-pro",
            status: "succeeded",
            unit_type: "token",
            input_units: 800,
            output_units: 400,
            estimated_cost_cny: "0.080000",
            actual_cost_cny: "0.080000",
            cost_basis: "provider_usage",
            duration_ms: 2600,
            created_at: "2026-08-20T07:01:00.000Z",
            operation_name: "asset-planning.segment-intent-planner",
          },
        ],
        total: 7,
      },
      loading: false,
      error: null,
    },
  });

  return {
    state,
    async loadCostSummary() {},
    async loadCostRecords() {},
  };
}

function mountPanel(store: GenerationCostStore, open = true, projectId = "proj-1") {
  return mount(ProjectCostPanel, {
    props: { projectId, open },
    global: {
      plugins: [ElementPlus],
      provide: {
        [generationCostStoreKey as symbol]: store,
      },
    },
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ProjectCostPanel（费用清单面板）", () => {
  it("打开时加载 summary 与 records 并展示总预计/已确认实际（仅媒体金额）", async () => {
    const store = createMockCostStore();
    const loadSummary = vi.spyOn(store, "loadCostSummary");
    const loadRecords = vi.spyOn(store, "loadCostRecords");
    const wrapper = mountPanel(store);
    await flushPromises();

    expect(loadSummary).toHaveBeenCalledWith("proj-1");
    expect(loadRecords).toHaveBeenCalledWith("proj-1");
    const text = wrapper.text();
    expect(text).toContain("总预计费用");
    // 顶部总额排除 LLM（媒体：image 0.2 + tts 0.8）
    expect(text).toContain("¥1");
    expect(text).toContain("已确认实际");
    expect(text).toContain("¥0.2");
    expect(text).toContain("成功 1");
  });

  it("按流水线阶段分组（assets.generate → 资产，script.generate → 文案）", async () => {
    const store = createMockCostStore();
    const wrapper = mountPanel(store);
    await flushPromises();

    const groups = wrapper.findAll('[data-testid="cost-stage-group"]');
    expect(groups.length).toBe(2);
    expect(groups[0]!.text()).toContain("文案");
    expect(groups[0]!.text()).toContain("deepseek-v4-pro");
    expect(groups[1]!.text()).toContain("资产");
    expect(groups[1]!.text()).toContain("wan2.6-t2i");
    expect(groups[1]!.text()).toContain("qwen3-tts-instruct-flash");
  });

  it("LLM 记录逐条列举并标注具体用处，非首次运行标注重跑", async () => {
    const store = createMockCostStore();
    const wrapper = mountPanel(store);
    await flushPromises();

    // 文案阶段 3 条 LLM 记录（2 次首次运行调用 + 1 次重跑）
    const scriptGroup = wrapper.findAll('[data-testid="cost-stage-group"]')[0]!;
    const llmRows = scriptGroup.findAll('[data-testid="cost-record"]');
    expect(llmRows.length).toBe(3);
    expect(llmRows[0]!.text()).toContain("剧本写作");
    expect(llmRows[0]!.text()).toContain("500token 输入 · 300token 输出");
    expect(llmRows[1]!.text()).toContain("语义审校");
    // 重跑（run_3）单独标注
    expect(llmRows[2]!.text()).toContain("剧本写作");
    expect(llmRows[2]!.text()).toContain("重跑");
    expect(scriptGroup.findAll('[data-testid="cost-record-rerun"]').length).toBe(1);
  });

  it("资产阶段 LLM 记录合并为一行：标注调用次数与角色", async () => {
    const store = createMockCostStore();
    const wrapper = mountPanel(store);
    await flushPromises();

    const assetGroup = wrapper.findAll('[data-testid="cost-stage-group"]')[1]!;
    const text = assetGroup.text();
    expect(text).toContain("×2 次调用");
    expect(text).toContain("资产全局规划");
    expect(text).toContain("分段意图规划");
    // 合并后 token 合计：1000+800 输入，500+400 输出
    expect(text).toContain("1800token 输入");
    expect(text).toContain("900token 输出");
  });

  it("展示每条记录耗时与阶段总耗时", async () => {
    const store = createMockCostStore();
    const wrapper = mountPanel(store);
    await flushPromises();

    const scriptGroup = wrapper.findAll('[data-testid="cost-stage-group"]')[0]!;
    const scriptText = scriptGroup.text();
    expect(scriptText).toContain("3.4秒"); // 剧本写作
    expect(scriptText).toContain("2.1秒"); // 语义审校
    expect(scriptText).toContain("900毫秒"); // 重跑记录（<1s 用毫秒）
    // 文案阶段总耗时 3400+2100+900=6400ms
    expect(scriptText).toContain("耗时 6.4秒");

    const assetGroup = wrapper.findAll('[data-testid="cost-stage-group"]')[1]!;
    const assetText = assetGroup.text();
    // 资产合并行合计 3000+2600=5600ms
    expect(assetText).toContain("5.6秒");
    // 资产阶段总耗时 1200+900+3000+2600=7700ms
    expect(assetText).toContain("耗时 7.7秒");
  });

  it("LLM 消费只展示用量不展示金额，其余记录区分 provider actual 与估算", async () => {
    const store = createMockCostStore();
    const wrapper = mountPanel(store);
    await flushPromises();

    const text = wrapper.text();
    // LLM 行金额占位 "—"，不出现 LLM 金额（文案 3 行 + 资产合并 1 行）
    expect(wrapper.findAll('[data-testid="cost-record-unpriced"]').length).toBe(4);
    expect(text).not.toContain("¥2.2");
    expect(text).not.toContain("¥1.3");
    // 媒体行保留 basis 标注
    expect(text).toContain("已确认实际");
    expect(text).toContain("估算");
    // LLM 用量说明
    expect(text).toContain("LLM 消费按 token 用量展示");
  });

  it("金额展示保持字符串精度（不经 Number 计算）", async () => {
    const store = createMockCostStore();
    const wrapper = mountPanel(store);
    await flushPromises();

    const text = wrapper.text();
    expect(text).toContain("¥0.2");
    expect(text).toContain("¥0.8");
  });

  it("无记录时展示空状态", async () => {
    const store = createMockCostStore();
    store.state.costRecords.data!.records = [];
    store.state.costSummary.data!.total_estimated_cost_cny = "0.000000";
    const wrapper = mountPanel(store);
    await flushPromises();

    expect(wrapper.find('[data-testid="cost-empty"]').exists()).toBe(true);
  });

  it("加载失败展示错误态并可重试", async () => {
    const store = createMockCostStore();
    store.state.costSummary.error = "network down";
    const loadSummary = vi.spyOn(store, "loadCostSummary");
    const wrapper = mountPanel(store);
    await flushPromises();

    expect(wrapper.find('[data-testid="cost-load-error"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("network down");
    await wrapper.find('[data-testid="cost-load-error"] button').trigger("click");
    expect(loadSummary).toHaveBeenCalled();
  });
});
