import { inject, reactive, readonly, type InjectionKey } from "vue";
import { apiFetch, ApiError } from "../utils/api";

/**
 * S2-2A 任务 11：报价与成本 store。
 *
 * - 付费生成前必须先向后端取 quote（estimated/authorization/unbounded/预算）；
 * - 每次 quote 保存幂等 key；用户改变配置/任务后生成新 key 与新 quote；
 *   网络重试复用同 key 同 payload；
 * - 金额一律十进制微元字符串；展示格式化用字符串运算，禁止 Number 处理
 *   超安全整数；
 * - 成本摘要/台账按 capability/provider 分组展示，区分 provider actual
 *   与估算（cost_basis），超额授权标记来自 over_budget_quote_count。
 */

export interface GenerationQuoteItemDto {
  capability: string;
  provider_model_id: string;
  unit_type: "token" | "image" | "video_second" | "tts_character" | "request";
  estimated_cost_cny: string;
  authorization_cost_cny: string;
  unbounded: boolean;
}

export interface GenerationQuoteDto {
  quote_id: string;
  operation: string;
  expires_at: string;
  configuration_hash: string;
  pricing_versions: string[];
  items: GenerationQuoteItemDto[];
  estimated_cost_cny: string;
  authorization_cost_cny: string;
  contains_unbounded_item: boolean;
  budget_limit_cny: string | null;
  over_budget: boolean;
  requires_budget_override: boolean;
}

export interface ProjectCostSummaryDto {
  currency: "CNY";
  total_estimated_cost_cny: string;
  total_authorization_cost_cny: string;
  total_actual_cost_cny: string;
  quote_count: number;
  consumed_quote_count: number;
  over_budget_quote_count: number;
  run_count: number;
  run_status_counts: {
    pending_dispatch: number;
    running: number;
    succeeded: number;
    failed: number;
    needs_reconciliation: number;
  };
  capability_breakdown: Array<{
    capability: string;
    estimated_cost_cny: string;
    actual_cost_cny: string;
    record_count: number;
  }>;
}

export interface ProjectCostRecordDto {
  id: string;
  run_id: string | null;
  run_status: string | null;
  snapshot_id: string;
  operation: string;
  capability: string;
  provider_key: string;
  model_id: string;
  status: "planned" | "submitted" | "succeeded" | "failed" | "canceled";
  unit_type: "token" | "image" | "video_second" | "tts_character" | "request";
  input_units: number | null;
  output_units: number | null;
  estimated_cost_cny: string;
  actual_cost_cny: string | null;
  cost_basis: "estimate" | "provider_usage" | "provider_invoice";
  duration_ms: number | null;
  created_at: string;
}

export interface QuoteRequestInput {
  operation: string;
  runOverrides?: Record<string, unknown>;
  selection?: { mode?: "missing_only"; task_ids?: string[] };
  enabledProviderTypes?: string[];
}

/**
 * S2-2D：生成请求携带的报价提交字段（映射 cost_quote_id / idempotency_key /
 * authorize_budget_override）。四 LLM 生成 store 的生成函数透传同一组字段。
 */
export interface QuoteSubmitFields {
  quoteId: string;
  idempotencyKey: string;
  authorizeBudgetOverride?: boolean;
}

/**
 * S2-2D：报价提交字段 → 生成请求体映射（四 LLM 生成 store 共用）。
 * 缺省返回空对象：免 quote 路径请求体与现状完全一致。
 */
export function quoteSubmitBody(submit?: QuoteSubmitFields): Record<string, unknown> {
  if (!submit) return {};
  return {
    cost_quote_id: submit.quoteId,
    idempotency_key: submit.idempotencyKey,
    ...(submit.authorizeBudgetOverride !== undefined
      ? { authorize_budget_override: submit.authorizeBudgetOverride }
      : {}),
  };
}

/**
 * S2-2D：付费部署闸门 409（paid_generation_quote_required）识别。
 * store 层对这类错误上抛（不吞进 loadError），交面板报价编排处理；
 * 其余错误保持现状（loadError 展示）。
 */
export function isPaidQuoteRequiredError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    String(error.code).includes("paid_generation_quote_required")
  );
}

export interface GenerationCostApi {
  createQuote(projectId: string, request: QuoteRequestInput): Promise<GenerationQuoteDto>;
  getCostSummary(projectId: string): Promise<ProjectCostSummaryDto>;
  getCostRecords(projectId: string): Promise<{ records: ProjectCostRecordDto[]; total: number }>;
}

export function createFetchGenerationCostApi(baseUrl = ""): GenerationCostApi {
  return {
    async createQuote(projectId, request) {
      const body: Record<string, unknown> = { operation: request.operation };
      if (request.runOverrides) body.run_overrides = request.runOverrides;
      if (request.selection) body.selection = request.selection;
      if (request.enabledProviderTypes !== undefined) {
        body.enabled_provider_types = request.enabledProviderTypes;
      }
      return await apiFetch<GenerationQuoteDto>(
        `${baseUrl}/api/projects/${projectId}/generation-cost-quotes`,
        { method: "POST", body },
      );
    },
    async getCostSummary(projectId) {
      return await apiFetch<ProjectCostSummaryDto>(
        `${baseUrl}/api/projects/${projectId}/costs/summary`,
      );
    },
    async getCostRecords(projectId) {
      return await apiFetch<{ records: ProjectCostRecordDto[]; total: number }>(
        `${baseUrl}/api/projects/${projectId}/costs/records`,
      );
    },
  };
}

// --- 金额展示（字符串运算，不经 Number） ------------------------------------

/** 十进制微元字符串（"12.340000"）→ 展示串（截去尾零）。 */
export function microsDecimalToCnyDisplay(decimal: string): string {
  const [intPart, fracPart = ""] = decimal.split(".");
  const trimmedFrac = fracPart.replace(/0+$/, "");
  return trimmedFrac ? `${intPart}.${trimmedFrac}` : intPart;
}

/** quote 是否已过期（now 缺省用当前时间）。 */
export function isQuoteExpired(quote: GenerationQuoteDto, now: Date = new Date()): boolean {
  return now.getTime() >= new Date(quote.expires_at).getTime();
}

/** 生成幂等 key（注入函数便于测试与 SSR 环境）。 */
export function createIdempotencyKey(): string {
  const cryptoObj = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof cryptoObj?.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  return `key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// --- store ------------------------------------------------------------------

interface CostSummarySlice {
  data: ProjectCostSummaryDto | null;
  loading: boolean;
  error: string | null;
}

interface CostRecordsSlice {
  data: { records: ProjectCostRecordDto[]; total: number } | null;
  loading: boolean;
  error: string | null;
}

export interface GenerationCostStoreState {
  /** 最近一次成功创建的 quote 及其幂等 key（同 key 重试复用，改任务/配置后换新）。 */
  lastQuote: {
    quote: GenerationQuoteDto;
    idempotencyKey: string;
  } | null;
  costSummary: CostSummarySlice;
  costRecords: CostRecordsSlice;
}

export interface GenerationCostStore {
  state: Readonly<GenerationCostStoreState>;
  createQuote: (
    projectId: string,
    request: QuoteRequestInput,
    options?: { idempotencyKey?: string },
  ) => Promise<{ ok: true; value: { quote: GenerationQuoteDto; idempotencyKey: string } } | { ok: false; error: { code: string } }>;
  loadCostSummary: (projectId: string) => Promise<void>;
  loadCostRecords: (projectId: string) => Promise<void>;
}

export const generationCostStoreKey: InjectionKey<GenerationCostStore> = Symbol("generation-cost-store");

export function createGenerationCostStore(api: GenerationCostApi): GenerationCostStore {
  const state = reactive<GenerationCostStoreState>({
    lastQuote: null,
    costSummary: { data: null, loading: false, error: null },
    costRecords: { data: null, loading: false, error: null },
  });

  async function createQuote(
    projectId: string,
    request: QuoteRequestInput,
    options: { idempotencyKey?: string } = {},
  ): Promise<{ ok: true; value: { quote: GenerationQuoteDto; idempotencyKey: string } } | { ok: false; error: { code: string } }> {
    try {
      const quote = await api.createQuote(projectId, request);
      const idempotencyKey = options.idempotencyKey ?? createIdempotencyKey();
      state.lastQuote = { quote, idempotencyKey };
      return { ok: true, value: { quote, idempotencyKey } };
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code: unknown }).code)
          : "quote_failed";
      return { ok: false, error: { code } };
    }
  }

  async function loadCostSummary(projectId: string): Promise<void> {
    state.costSummary.loading = true;
    state.costSummary.error = null;
    try {
      state.costSummary.data = await api.getCostSummary(projectId);
    } catch (error) {
      state.costSummary.error = error instanceof Error ? error.message : "cost_load_failed";
    } finally {
      state.costSummary.loading = false;
    }
  }

  async function loadCostRecords(projectId: string): Promise<void> {
    state.costRecords.loading = true;
    state.costRecords.error = null;
    try {
      state.costRecords.data = await api.getCostRecords(projectId);
    } catch (error) {
      state.costRecords.error = error instanceof Error ? error.message : "cost_load_failed";
    } finally {
      state.costRecords.loading = false;
    }
  }

  return {
    state: readonly(state),
    createQuote,
    loadCostSummary,
    loadCostRecords,
  };
}

export function useGenerationCostStore(): GenerationCostStore {
  const store = inject(generationCostStoreKey);
  if (store) return store;
  // 页面局部兜底：未全局 provide 时自建（与 generation-config 同模式）
  return createGenerationCostStore(createFetchGenerationCostApi());
}
