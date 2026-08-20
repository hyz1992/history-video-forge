// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { reactive } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

/** S2-2A 任务 11：报价确认 store/组件 失败测试（实现前红灯）。
 *
 * 覆盖实施计划任务 11 步骤 1 验收：
 * - 付费生成前先向后端取 quote，显示 estimated 与 authorization bound；
 * - unbounded item 和超预算必须显式二次确认；
 * - quote 过期后重新报价，不重放旧提交；
 * - 所有金额从微元字符串解析；禁止 Number 直接处理超安全整数。
 */

import GenerationQuoteDialog from "../../frontend/src/components/asset/GenerationQuoteDialog.vue";
import {
  createFetchGenerationCostApi,
  createGenerationCostStore,
  isQuoteExpired,
  microsDecimalToCnyDisplay,
  type GenerationQuoteDto,
} from "../../frontend/src/stores/generation-cost";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  } as Response;
}

const SAMPLE_QUOTE: GenerationQuoteDto = {
  quote_id: "quote_001",
  operation: "assets.generate",
  expires_at: "2026-08-20T12:00:00.000Z",
  configuration_hash: "fnv1a64:abc",
  pricing_versions: ["dashscope-cn-2026-08-12"],
  items: [
    {
      capability: "image.generate",
      provider_model_id: "dashscope:wan2.6-t2i",
      unit_type: "image",
      estimated_cost_cny: "0.200000",
      authorization_cost_cny: "0.200000",
      unbounded: false,
    },
    {
      capability: "video.image_to_video",
      provider_model_id: "dashscope:wan2.7-i2v",
      unit_type: "video_second",
      estimated_cost_cny: "3.000000",
      authorization_cost_cny: "3.600000",
      unbounded: false,
    },
  ],
  estimated_cost_cny: "3.200000",
  authorization_cost_cny: "3.800000",
  contains_unbounded_item: false,
  budget_limit_cny: "5.000000",
  over_budget: false,
  requires_budget_override: false,
};

describe("money formatting (微元字符串展示，不经 Number)", () => {
  it("十进制 CNY 字符串 → 展示（截尾零）", () => {
    expect(microsDecimalToCnyDisplay("12.340000")).toBe("12.34");
    expect(microsDecimalToCnyDisplay("0.500000")).toBe("0.5");
    expect(microsDecimalToCnyDisplay("0.000000")).toBe("0");
    expect(microsDecimalToCnyDisplay("3.200000")).toBe("3.2");
  });

  it("超大金额保持字符串精度（不 Number 化）", () => {
    const huge = "9007199254740993.120000";
    const display = microsDecimalToCnyDisplay(huge);
    expect(display).toBe("9007199254740993.12");
  });
});

describe("quote expiry", () => {
  it("过期判断基于 expires_at", () => {
    const now = new Date("2026-08-20T12:05:00.000Z");
    expect(isQuoteExpired(SAMPLE_QUOTE, now)).toBe(true);
    expect(isQuoteExpired(SAMPLE_QUOTE, new Date("2026-08-20T11:59:00.000Z"))).toBe(false);
  });
});

describe("generation cost store", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("createQuote 请求后端并保存 quote 与 idempotency key", async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, SAMPLE_QUOTE));
    vi.stubGlobal("fetch", fetchMock);
    const store = createGenerationCostStore(createFetchGenerationCostApi());

    const result = await store.createQuote("proj-1", {
      operation: "assets.generate",
      selection: { task_ids: [] },
      enabledProviderTypes: ["tts", "sfx", "bgm"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.quote.quote_id).toBe("quote_001");
    expect(store.state.lastQuote?.idempotencyKey).toBeTruthy();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.operation).toBe("assets.generate");
    expect(body.selection).toEqual({ task_ids: [] });
    expect(body.enabled_provider_types).toEqual(["tts", "sfx", "bgm"]);
  });

  it("createQuote 失败时返回错误，不污染 lastQuote", async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(422, { error: "generation_quote_unquotable" }));
    vi.stubGlobal("fetch", fetchMock);
    const store = createGenerationCostStore(createFetchGenerationCostApi());

    const result = await store.createQuote("proj-1", { operation: "assets.generate" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("generation_quote_unquotable");
    expect(store.state.lastQuote).toBeNull();
  });

  it("loadCostSummary 与 loadCostRecords 拉取成本数据", async () => {
    fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, {
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
          { capability: "image.generate", estimated_cost_cny: "0.200000", actual_cost_cny: "0.000000", record_count: 1 },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse(200, {
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
        ],
        total: 1,
      }));
    vi.stubGlobal("fetch", fetchMock);
    const store = createGenerationCostStore(createFetchGenerationCostApi());

    await store.loadCostSummary("proj-1");
    await store.loadCostRecords("proj-1");

    expect(store.state.costSummary?.data?.total_estimated_cost_cny).toBe("3.200000");
    expect(store.state.costSummary?.data?.total_actual_cost_cny).toBe("1.500000");
    expect(store.state.costRecords.data?.records.length).toBe(1);
    expect(store.state.costRecords.data?.records[0]?.cost_basis).toBe("provider_usage");
  });
});

describe("GenerationQuoteDialog", () => {
  function mountDialog(quote: GenerationQuoteDto | null, extra = {}) {
    return mount(GenerationQuoteDialog, {
      props: {
        open: true,
        quote,
        loading: false,
        ...extra,
      },
      global: { plugins: [ElementPlus] },
    });
  }

  it("显示 estimated、authorization bound 与预算", async () => {
    const wrapper = mountDialog(SAMPLE_QUOTE);
    await flushPromises();

    const text = wrapper.text();
    expect(text).toContain("3.2"); // estimated
    expect(text).toContain("3.8"); // authorization
    expect(text).toContain("5"); // budget limit
  });

  it("超预算（over_budget）时要求显式二次确认（复选框+授权按钮）", async () => {
    const wrapper = mountDialog(
      { ...SAMPLE_QUOTE, over_budget: true, requires_budget_override: true, budget_limit_cny: "2.000000" },
    );
    await flushPromises();

    const check = wrapper.find('[data-testid="quote-authorize-check"]');
    expect(check.exists()).toBe(true);
    const confirm = wrapper.find('[data-testid="quote-confirm"]');
    expect(confirm.attributes("disabled")).toBeDefined();
    await check.setValue();
    expect(confirm.attributes("disabled")).toBeUndefined();
    await confirm.trigger("click");
    expect(wrapper.emitted("confirm")?.[0]?.[0]).toEqual({ authorizeBudgetOverride: true });
  });

  it("unbounded item 显示风险提示并要求显式确认", async () => {
    const wrapper = mountDialog({
      ...SAMPLE_QUOTE,
      contains_unbounded_item: true,
      items: [
        {
          capability: "video.image_to_video",
          provider_model_id: "dashscope:wan2.7-i2v",
          unit_type: "video_second",
          estimated_cost_cny: "0.000000",
          authorization_cost_cny: "0.000000",
          unbounded: true,
        },
      ],
    });
    await flushPromises();

    expect(wrapper.text()).toContain("无法给出可靠上限");
    const confirm = wrapper.find('[data-testid="quote-confirm"]');
    expect(confirm.attributes("disabled")).toBeDefined();
  });

  it("正常 quote（未超预算且无 unbounded）确认不需二次授权", async () => {
    const wrapper = mountDialog(SAMPLE_QUOTE);
    await flushPromises();

    const confirm = wrapper.find('[data-testid="quote-confirm"]');
    expect(confirm.attributes("disabled")).toBeUndefined();
    await confirm.trigger("click");
    expect(wrapper.emitted("confirm")?.[0]?.[0]).toEqual({ authorizeBudgetOverride: false });
  });

  it("取消不触发 confirm", async () => {
    const wrapper = mountDialog(SAMPLE_QUOTE);
    await flushPromises();

    await wrapper.find('[data-testid="quote-cancel"]').trigger("click");
    expect(wrapper.emitted("cancel")).toBeTruthy();
    expect(wrapper.emitted("confirm")).toBeUndefined();
  });

  it("报价加载中展示 loading 态", async () => {
    const wrapper = mountDialog(null, { loading: true });
    await flushPromises();

    expect(wrapper.text()).toContain("正在向后端请求报价");
    // 无报价时不渲染确认按钮
    expect(wrapper.find('[data-testid="quote-confirm"]').exists()).toBe(false);
  });
});
