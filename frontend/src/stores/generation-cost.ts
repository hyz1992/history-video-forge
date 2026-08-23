import { inject, reactive, readonly, type InjectionKey } from "vue";
import { apiFetch, ApiError } from "../utils/api";

/**
 * S2-2 成本只读 store（2026-08-23 报价体系移除后保留）。
 *
 * - 金额一律十进制微元字符串；展示格式化用字符串运算，禁止 Number 处理
 *   超安全整数；
 * - 成本摘要/台账按 capability/provider 分组展示，区分 provider actual
 *   与估算（cost_basis）。
 */

export interface ProjectCostSummaryDto {
  currency: "CNY";
  total_estimated_cost_cny: string;
  total_actual_cost_cny: string;
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

export interface GenerationCostApi {
  getCostSummary(projectId: string): Promise<ProjectCostSummaryDto>;
  getCostRecords(projectId: string): Promise<{ records: ProjectCostRecordDto[]; total: number }>;
}

export function createFetchGenerationCostApi(baseUrl = ""): GenerationCostApi {
  return {
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
  costSummary: CostSummarySlice;
  costRecords: CostRecordsSlice;
}

export interface GenerationCostStore {
  state: Readonly<GenerationCostStoreState>;
  loadCostSummary: (projectId: string) => Promise<void>;
  loadCostRecords: (projectId: string) => Promise<void>;
}

export const generationCostStoreKey: InjectionKey<GenerationCostStore> = Symbol("generation-cost-store");

export function createGenerationCostStore(api: GenerationCostApi): GenerationCostStore {
  const state = reactive<GenerationCostStoreState>({
    costSummary: { data: null, loading: false, error: null },
    costRecords: { data: null, loading: false, error: null },
  });

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
