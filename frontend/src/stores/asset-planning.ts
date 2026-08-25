import { inject, reactive, readonly, type InjectionKey } from "vue";
import { apiFetch, ApiError } from "../utils/api";

import type { ProjectStore } from "./project";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArtBible {
  era_style?: string;
  visual_tone?: string;
  characters?: readonly unknown[];
  locations?: readonly unknown[];
  props?: readonly unknown[];
}

export interface TtsPlanChunk {
  chunk_id?: string;
  text?: string;
  voice_id?: string;
}

export interface TtsPlan {
  voice_profile_id?: string;
  estimated_total_duration_sec?: number;
  chunking_strategy?: string;
  chunks?: readonly TtsPlanChunk[];
}

export interface AssetTask {
  task_id: string;
  task_type: string;
  source_segment_id: string | null;
  production_intent?: string;
  prompt_draft?: string | null;
  parameters?: Record<string, unknown>;
  risk_notes?: readonly string[];
  cost_tier?: string;
  recommended_mode?: string;
  static_fallback_task_id?: string;
  manual_upload_policy?: { allowed: boolean; required: boolean; accepted_file_types: string[]; acceptance_notes?: string[] };
}

export interface AssetDependency {
  dependency_id: string;
  task_id: string;
  depends_on_task_id: string;
  dependency_type: string;
}

export interface CostSummary {
  total_tasks?: number;
  by_type?: Readonly<Record<string, number>>;
  by_cost_tier?: Readonly<Record<string, number>>;
  estimated_provider_calls?: number;
  notes?: readonly string[];
}

export interface AssetPlan {
  plan_version: string;
  art_bible: ArtBible;
  visual_budget: Record<string, unknown>;
  downgrade_policy: Record<string, unknown>;
  global_audio_strategy: Record<string, unknown>;
  tts_plan: TtsPlan;
  tasks: readonly AssetTask[];
  dependencies: readonly AssetDependency[];
  cost_summary: CostSummary;
  global_production_notes: readonly string[];
}

export interface ValidationResult {
  stage: string;
  decision: string;
  errors?: readonly string[];
  warnings?: readonly string[];
  metrics?: Readonly<Record<string, unknown>>;
}

export interface ActiveAssetPlanSnapshot {
  plan: AssetPlan | null;
  validation_result: ValidationResult | null;
  local_validation?: ValidationResult | null;
  execution_state: Record<string, unknown> | null;
  graph_trace_summary: Record<string, unknown> | null;
  runtime_diagnostics: Record<string, unknown> | null;
}

export interface AssetPlanSnapshot {
  current_status: string | null;
  active_asset_plan: ActiveAssetPlanSnapshot | null;
  active_asset_plan_record_id: string | null;
  /** 2026-08-25：最近一次资产规划 run 的失败原因（error_code，如 rate_limited）。 */
  latest_asset_plan_run: { failure_reason: string | null } | null;
}

export interface AssetPlanningApi {
  loadProject(projectId: string): Promise<AssetPlanSnapshot>;
  generateAssetPlan(projectId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Store state & interface
// ---------------------------------------------------------------------------

export interface AssetPlanningStoreState {
  isLoading: boolean;
  isGenerating: boolean;
  loadError: string | null;
  snapshot: AssetPlanSnapshot | null;
}

export interface AssetPlanningStore {
  state: Readonly<AssetPlanningStoreState>;
  loadActiveAssetPlanSnapshot: () => Promise<void>;
  generateAssetPlan: () => Promise<void>;
  retryLoad: () => Promise<void>;
}

export const assetPlanningStoreKey: InjectionKey<AssetPlanningStore> =
  Symbol("asset-planning-store");

// ---------------------------------------------------------------------------
// Fetch API adapter
// ---------------------------------------------------------------------------

export function createFetchAssetPlanningApi(baseUrl = ""): AssetPlanningApi {
  return {
    async loadProject(projectId) {
      const data = await apiFetch<Record<string, unknown>>(`${baseUrl}/api/projects/${projectId}`);
      const latestRun = (data.trace_summary as Record<string, unknown> | undefined)
        ?.latest_asset_plan_run as Record<string, unknown> | undefined;
      return {
        current_status: data.current_status ?? null,
        active_asset_plan: data.active_asset_plan ?? null,
        active_asset_plan_record_id: data.active_asset_plan_record_id ?? null,
        latest_asset_plan_run: latestRun
          ? {
              failure_reason:
                typeof latestRun.failure_reason === "string" ? latestRun.failure_reason : null,
            }
          : null,
      };
    },
    async generateAssetPlan(projectId) {
      await apiFetch(`${baseUrl}/api/projects/${projectId}/asset-plan/generate`, { method: "POST" });
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "asset_plan_load_failed";
}

/** 2026-08-25：资产规划失败原因 → 用户可读文案（rate_limited 等透传自后端 error_code）。 */
const ASSET_PLAN_FAILURE_LABELS: Record<string, string> = {
  rate_limited: "LLM 限流，请稍后重试",
};

function assetPlanFailureText(reason: string | null | undefined): string {
  if (!reason) return "资产规划生成失败";
  return ASSET_PLAN_FAILURE_LABELS[reason] ?? `资产规划生成失败（${reason}）`;
}

export function isAssetPlanSnapshotGenerating(
  snapshot: AssetPlanSnapshot | null,
): boolean {
  const activePlan = snapshot?.active_asset_plan ?? null;
  const validationDecision =
    activePlan?.validation_result?.decision ??
    activePlan?.local_validation?.decision ??
    null;

  return (
    snapshot?.current_status === "asset_plan_generating" ||
    activePlan?.execution_state?.generating === true ||
    validationDecision === "generating"
  );
}

export function hasReadyAssetPlanSnapshot(
  snapshot: AssetPlanSnapshot | null,
): boolean {
  return (
    Boolean(snapshot?.active_asset_plan) &&
    !isAssetPlanSnapshotGenerating(snapshot)
  );
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface CreateAssetPlanningStoreInput {
  projectStore: ProjectStore;
  api: AssetPlanningApi;
}

export function createAssetPlanningStore(
  input: CreateAssetPlanningStoreInput,
): AssetPlanningStore {
  const state = reactive<AssetPlanningStoreState>({
    isLoading: false,
    isGenerating: false,
    loadError: null,
    snapshot: null,
  });

  async function loadActiveAssetPlanSnapshot() {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) {
      state.snapshot = null;
      state.loadError = null;
      return;
    }

    state.isLoading = true;
    try {
      const snapshot = await input.api.loadProject(projectId);
      state.snapshot = snapshot;
      state.loadError = null;

      if (snapshot.current_status) {
        input.projectStore.syncProject({
          project_id: projectId,
          current_status: snapshot.current_status,
        });
      }
    } catch (error) {
      state.loadError = toErrorMessage(error);
    } finally {
      state.isLoading = false;
    }
  }

  async function generateAssetPlan() {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) {
      return;
    }

    state.isGenerating = true;
    state.loadError = null;

    // Optimistic status update
    if (state.snapshot) {
      state.snapshot.current_status = "asset_plan_generating";
    } else {
      state.snapshot = {
        current_status: "asset_plan_generating",
        active_asset_plan: null,
        active_asset_plan_record_id: null,
      };
    }
    input.projectStore.syncProject({
      project_id: projectId,
      current_status: "asset_plan_generating",
    });

    try {
      // Fire the POST and capture any immediate error
      let postError: string | null = null;
      input.api.generateAssetPlan(projectId).catch((err) => {
        // 2026-08-25：并发触发被后端阶段锁拒绝（另一请求已在进行）时，
        // 视为"已在生成"，继续轮询等待，不向用户报错。
        if (err instanceof ApiError && err.code === "project_stage_run_in_progress") return;
        postError = err instanceof Error ? err.message : String(err);
      });

      // Poll snapshot until the plan appears or generation fails.
      const maxPolls = 120; // ~10 minutes at 5s intervals
      for (let i = 0; i < maxPolls; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        try {
          await loadActiveAssetPlanSnapshot();
        } catch {
          // snapshot load failed; keep polling
        }
        const s = state.snapshot;
        if (hasReadyAssetPlanSnapshot(s)) break; // plan is ready
        if (s?.current_status === "asset_plan_failed") {
          state.loadError = assetPlanFailureText(s.latest_asset_plan_run?.failure_reason);
          break;
        }
        // If POST errored early and no plan appeared after a few polls, give up
        if (postError && i >= 3) {
          state.loadError = postError;
          if (state.snapshot) state.snapshot.current_status = "asset_plan_failed";
          input.projectStore.syncProject({
            project_id: projectId,
            current_status: "asset_plan_failed",
          });
          break;
        }
      }

      // Final snapshot load
      if (!hasReadyAssetPlanSnapshot(state.snapshot) && !state.loadError) {
        await loadActiveAssetPlanSnapshot();
        if (!hasReadyAssetPlanSnapshot(state.snapshot) && !state.loadError) {
          state.loadError = "资产规划生成超时，请重试";
        }
      }
    } catch (error) {
      state.loadError = toErrorMessage(error);
      if (state.snapshot) {
        state.snapshot.current_status = "asset_plan_failed";
      }
      input.projectStore.syncProject({
        project_id: projectId,
        current_status: "asset_plan_failed",
      });
    } finally {
      state.isGenerating = false;
    }
  }

  async function retryLoad() {
    await loadActiveAssetPlanSnapshot();
  }

  return {
    state: readonly(state),
    loadActiveAssetPlanSnapshot,
    generateAssetPlan,
    retryLoad,
  };
}

// ---------------------------------------------------------------------------
// Inject helper
// ---------------------------------------------------------------------------

export function useAssetPlanningStore(): AssetPlanningStore {
  const store = inject(assetPlanningStoreKey);
  if (!store) {
    throw new Error("asset_planning_store_missing");
  }
  return store;
}
