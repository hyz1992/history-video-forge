// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

/**
 * S2-2D 任务 1：共享编排 helper（免 quote 优先 → 409 进报价）单测。
 *
 * 覆盖（详细设计 §4 语义表）：
 * - 免 quote 直连成功：不创建报价、不弹窗；
 * - 409 paid_generation_quote_required → createQuote + 弹窗可见；
 * - 非 409 错误原样返回；
 * - 报价创建失败（unquotable/resolution_failed）→ quote_unavailable + 回调；
 *   其他错误码不回退；
 * - 确认提交成功（携带 quoteId/key/authorizeBudgetOverride）；
 * - 确认时过期 → expired（不提交）；
 * - 提交 409 业务冲突 → conflict + 弹窗关闭（不复用旧 quote）；
 * - 提交网络失败 → error + 弹窗保留（复用同一 quote+key）；
 * - 取消 → 弹窗关闭。
 */

import { reactive } from "vue";
import { ApiError } from "../../../frontend/src/utils/api";
import { createQuoteAwareGeneration } from "../../../frontend/src/composables/useQuoteAwareGeneration";
import {
  isPaidQuoteRequiredError,
  type GenerationCostStore,
  type GenerationQuoteDto,
} from "../../../frontend/src/stores/generation-cost";

function makeQuote(overrides: Partial<GenerationQuoteDto> = {}): GenerationQuoteDto {
  return {
    quote_id: "quote_d2_001",
    operation: "topic.generate",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    configuration_hash: "hash",
    pricing_versions: [],
    items: [],
    estimated_cost_cny: "1.20",
    authorization_cost_cny: "1.20",
    contains_unbounded_item: false,
    budget_limit_cny: null,
    over_budget: false,
    requires_budget_override: false,
    ...overrides,
  };
}

function makeCostStore(quote: GenerationQuoteDto | null): GenerationCostStore {
  return {
    state: reactive({ lastQuote: null }),
    createQuote: vi.fn(async () =>
      quote
        ? { ok: true, value: { quote, idempotencyKey: "key_d2_001" } }
        : { ok: false, error: { code: "generation_quote_unquotable" } },
    ),
    loadCostSummary: vi.fn(),
    loadCostRecords: vi.fn(),
  } as unknown as GenerationCostStore;
}

const GENERIC_ERROR = new Error("boom");
const PAID_REQUIRED = new ApiError(409, "paid_generation_quote_required", "请先创建报价");

describe("isPaidQuoteRequiredError", () => {
  it("仅识别 409 paid_generation_quote_required", () => {
    expect(isPaidQuoteRequiredError(PAID_REQUIRED)).toBe(true);
    expect(isPaidQuoteRequiredError(new ApiError(409, "generation_preference_revision_conflict", "x"))).toBe(false);
    expect(isPaidQuoteRequiredError(new ApiError(500, "paid_generation_quote_required", "x"))).toBe(false);
    expect(isPaidQuoteRequiredError(GENERIC_ERROR)).toBe(false);
  });
});

describe("createQuoteAwareGeneration 编排（S2-2D 任务 1）", () => {
  function makeDeps(overrides: Record<string, unknown> = {}) {
    const tryDirect = vi.fn(async () => ({ ok: "direct" as const }));
    const submitWithQuote = vi.fn(async () => ({ ok: "submitted" as const }));
    const onQuoteUnavailable = vi.fn();
    const costStore = makeCostStore(makeQuote());
    const deps = {
      operation: "topic.generate",
      createQuoteRequest: () => ({ operation: "topic.generate" }),
      tryDirect,
      submitWithQuote,
      costStore,
      projectId: () => "proj-1",
      onQuoteUnavailable,
      ...overrides,
    };
    return deps;
  }

  it("免 quote 直连成功：不创建报价、不弹窗", async () => {
    const deps = makeDeps();
    const runner = createQuoteAwareGeneration(deps);
    const result = await runner.run();
    expect(result).toEqual({ ok: true, value: { ok: "direct" } });
    expect(deps.costStore.createQuote).not.toHaveBeenCalled();
    expect(runner.state.confirmVisible).toBe(false);
  });

  it("非 409 错误原样返回（不进入报价）", async () => {
    const deps = makeDeps({ tryDirect: vi.fn(async () => { throw GENERIC_ERROR; }) });
    const runner = createQuoteAwareGeneration(deps);
    const result = await runner.run();
    expect(result).toEqual({ ok: false, reason: "error", message: "boom" });
    expect(deps.costStore.createQuote).not.toHaveBeenCalled();
  });

  it("409 → createQuote + 弹窗可见（等待确认）", async () => {
    const deps = makeDeps({ tryDirect: vi.fn(async () => { throw PAID_REQUIRED; }) });
    const runner = createQuoteAwareGeneration(deps);
    const result = await runner.run();
    expect(result).toEqual({ ok: false, reason: "pending_confirmation" });
    expect(deps.costStore.createQuote).toHaveBeenCalledWith("proj-1", { operation: "topic.generate" });
    expect(runner.state.confirmVisible).toBe(true);
    expect(runner.state.quote?.quote_id).toBe("quote_d2_001");
    expect(runner.state.idempotencyKey).toBe("key_d2_001");
  });

  it("报价创建失败（unquotable）→ quote_unavailable + 回调（回退本地路径）", async () => {
    const deps = makeDeps({
      tryDirect: vi.fn(async () => { throw PAID_REQUIRED; }),
      costStore: makeCostStore(null),
    });
    const runner = createQuoteAwareGeneration(deps);
    const result = await runner.run();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("quote_unavailable");
    expect(deps.onQuoteUnavailable).toHaveBeenCalled();
    expect(runner.state.confirmVisible).toBe(false);
  });

  it("报价创建失败（其他错误码）→ error 不回退", async () => {
    const costStore = makeCostStore(null);
    (costStore.createQuote as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "generation_quote_invalid_input" },
    });
    const deps = makeDeps({
      tryDirect: vi.fn(async () => { throw PAID_REQUIRED; }),
      costStore,
    });
    const runner = createQuoteAwareGeneration(deps);
    const result = await runner.run();
    expect(result).toEqual({ ok: false, reason: "error", message: "generation_quote_invalid_input" });
    expect(deps.onQuoteUnavailable).not.toHaveBeenCalled();
  });

  it("确认提交成功：携带 quoteId/key/authorizeBudgetOverride", async () => {
    const deps = makeDeps({ tryDirect: vi.fn(async () => { throw PAID_REQUIRED; }) });
    const runner = createQuoteAwareGeneration(deps);
    await runner.run();
    const result = await runner.confirm(true);
    expect(result).toEqual({ ok: true, value: { ok: "submitted" } });
    expect(deps.submitWithQuote).toHaveBeenCalledWith({
      quoteId: "quote_d2_001",
      idempotencyKey: "key_d2_001",
      authorizeBudgetOverride: true,
    });
    expect(runner.state.confirmVisible).toBe(false);
  });

  it("确认时 quote 过期 → expired（不提交）", async () => {
    const deps = makeDeps({
      tryDirect: vi.fn(async () => { throw PAID_REQUIRED; }),
      costStore: makeCostStore(makeQuote({ expires_at: new Date(Date.now() - 1000).toISOString() })),
    });
    const runner = createQuoteAwareGeneration(deps);
    await runner.run();
    const result = await runner.confirm(false);
    expect(result).toEqual({ ok: false, reason: "expired" });
    expect(deps.submitWithQuote).not.toHaveBeenCalled();
    expect(runner.state.confirmVisible).toBe(false);
  });

  it("提交 409 业务冲突 → conflict + 弹窗关闭（不复用旧 quote）", async () => {
    const deps = makeDeps({
      tryDirect: vi.fn(async () => { throw PAID_REQUIRED; }),
      submitWithQuote: vi.fn(async () => {
        throw new ApiError(409, "generation_quote_configuration_changed", "漂移");
      }),
    });
    const runner = createQuoteAwareGeneration(deps);
    await runner.run();
    const result = await runner.confirm(false);
    expect(result).toEqual({ ok: false, reason: "conflict", message: "漂移" });
    expect(runner.state.confirmVisible).toBe(false);
    expect(runner.state.quote).toBeNull();
  });

  it("提交网络失败 → error + 弹窗保留（复用同一 quote+key 重试）", async () => {
    const deps = makeDeps({
      tryDirect: vi.fn(async () => { throw PAID_REQUIRED; }),
      submitWithQuote: vi.fn(async () => { throw new Error("network down"); }),
    });
    const runner = createQuoteAwareGeneration(deps);
    await runner.run();
    const result = await runner.confirm(false);
    expect(result).toEqual({ ok: false, reason: "error", message: "network down" });
    // 弹窗保留、quote 与 key 未清——调用方可直接再次 confirm 重试
    expect(runner.state.confirmVisible).toBe(true);
    expect(runner.state.quote?.quote_id).toBe("quote_d2_001");
    expect(runner.state.idempotencyKey).toBe("key_d2_001");
  });

  it("取消 → 弹窗关闭、quote 清空", async () => {
    const deps = makeDeps({ tryDirect: vi.fn(async () => { throw PAID_REQUIRED; }) });
    const runner = createQuoteAwareGeneration(deps);
    await runner.run();
    runner.cancel();
    expect(runner.state.confirmVisible).toBe(false);
    expect(runner.state.quote).toBeNull();
  });
});
