import { reactive } from "vue";
import { ApiError } from "../utils/api";
import {
  isPaidQuoteRequiredError,
  isQuoteExpired,
  type GenerationCostStore,
  type GenerationQuoteDto,
  type QuoteRequestInput,
  type QuoteSubmitFields,
} from "../stores/generation-cost";

/**
 * S2-2D（详细设计 §3）：LLM 生成面板的"免 quote 优先 → 409 进报价"编排。
 *
 * 模式（voice.preview 先例 + AssetPanel quoteAndGenerate 语义）：
 * - 先按现状免 quote 直连（stub/fake 部署直接成功，零行为变化）；
 * - 仅当 409 paid_generation_quote_required 时进入报价流程：
 *   createQuote → 弹窗确认 → 提交同一张 quote（cost_quote_id + idempotency_key
 *   + authorize_budget_override）；
 * - 报价创建失败（resolution_failed / unquotable）→ 提示"报价服务暂不可用"并
 *   回退免 quote 本地路径（与 AssetPanel LOCAL_QUOTE_UNAVAILABLE_CODES 同语义）；
 * - 提交 409/422 业务冲突 → 关闭弹窗提示重新报价（不重放旧 quote）；
 *   网络失败 → 保留弹窗复用同一 quote+key 重试；quote 过期 → 重新创建。
 */

/** 本地部署不可报价错误码（回退免 quote 路径，不阻塞 stub/fake 部署）。 */
export const LOCAL_QUOTE_UNAVAILABLE_CODES = [
  "generation_quote_resolution_failed",
  "generation_quote_unquotable",
] as const;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface QuoteAwareGenerationDeps<T> {
  /** 报价 operation（topic.generate / script.generate / storyboard.generate / publish.generate）。 */
  operation: string;
  /** 报价请求输入（selection/enabledProviderTypes/runOverrides 等原生成参数）。 */
  createQuoteRequest: () => QuoteRequestInput;
  /** 免 quote 直连尝试（stub/fake 部署直接成功）。 */
  tryDirect: () => Promise<T>;
  /** 携带报价提交（store 透传 quote 字段的生成函数）。 */
  submitWithQuote: (submit: QuoteSubmitFields) => Promise<T>;
  /** generation-cost store（createQuote 保存 quote + 幂等 key）。 */
  costStore: GenerationCostStore;
  projectId: () => string;
  /** 报价服务暂不可用（回退免 quote 本地路径）时的提示回调。 */
  onQuoteUnavailable?: (message: string) => void;
}

export type QuoteAwareRunResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "error"; message: string }
  | { ok: false; reason: "quote_unavailable"; message: string }
  | { ok: false; reason: "pending_confirmation" };

export type QuoteAwareConfirmResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "expired" }
  | { ok: false; reason: "conflict"; message: string }
  | { ok: false; reason: "error"; message: string };

export function createQuoteAwareGeneration<T>(deps: QuoteAwareGenerationDeps<T>) {
  const state = reactive({
    quote: null as GenerationQuoteDto | null,
    idempotencyKey: "",
    pending: false,
    confirmVisible: false,
  });

  async function run(): Promise<QuoteAwareRunResult<T>> {
    // 1. 免 quote 直连（stub/fake 部署直接成功）
    try {
      const value = await deps.tryDirect();
      return { ok: true, value };
    } catch (error) {
      if (!isPaidQuoteRequiredError(error)) {
        return { ok: false, reason: "error", message: messageOf(error) };
      }
    }
    // 2. 409 paid_generation_quote_required → 报价流程
    state.pending = true;
    try {
      const projectId = deps.projectId();
      const created = await deps.costStore.createQuote(
        projectId,
        deps.createQuoteRequest(),
      );
      if (!created.ok) {
        if ((LOCAL_QUOTE_UNAVAILABLE_CODES as readonly string[]).includes(created.error.code)) {
          const message = "当前部署报价服务暂不可用，已按本地路径继续（演示/开发模式）。";
          deps.onQuoteUnavailable?.(message);
          return { ok: false, reason: "quote_unavailable", message };
        }
        return { ok: false, reason: "error", message: created.error.code };
      }
      state.quote = created.value.quote;
      state.idempotencyKey = created.value.idempotencyKey;
      state.confirmVisible = true;
      return { ok: false, reason: "pending_confirmation" };
    } catch (error) {
      return { ok: false, reason: "error", message: messageOf(error) };
    } finally {
      state.pending = false;
    }
  }

  async function confirm(
    authorizeBudgetOverride: boolean,
  ): Promise<QuoteAwareConfirmResult<T>> {
    if (!state.quote) {
      return { ok: false, reason: "error", message: "no quote available" };
    }
    // 过期：关闭弹窗，调用方重新 run() 走重新报价
    if (isQuoteExpired(state.quote)) {
      state.confirmVisible = false;
      state.quote = null;
      return { ok: false, reason: "expired" };
    }
    try {
      const value = await deps.submitWithQuote({
        quoteId: state.quote.quote_id,
        idempotencyKey: state.idempotencyKey,
        authorizeBudgetOverride,
      });
      state.confirmVisible = false;
      state.quote = null;
      return { ok: true, value };
    } catch (error) {
      // 409/422 业务冲突（配置漂移/计划绑定等）：关闭弹窗，必须重新报价
      if (error instanceof ApiError && (error.status === 409 || error.status === 422)) {
        state.confirmVisible = false;
        state.quote = null;
        return { ok: false, reason: "conflict", message: messageOf(error) };
      }
      // 网络不确定失败：保留弹窗，复用同一 quote + key 重试
      return { ok: false, reason: "error", message: messageOf(error) };
    }
  }

  function cancel(): void {
    state.confirmVisible = false;
    state.quote = null;
  }

  return { state, run, confirm, cancel };
}
