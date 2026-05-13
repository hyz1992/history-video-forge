import { inject, reactive, readonly, type InjectionKey } from "vue";

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
  chunks?: readonly TtsPlanChunk[];
}

export interface AssetTask {
  task_id: string;
  task_type: string;
  source_segment_id: string;
  production_intent?: string;
  prompt_draft?: string;
  parameters?: Record<string, unknown>;
  risk_notes?: readonly string[];
  cost_tier?: string;
  recommended_mode?: string;
  static_fallback_task_id?: string;
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
  execution_state: Record<string, unknown> | null;
  graph_trace_summary: Record<string, unknown> | null;
  runtime_diagnostics: Record<string, unknown> | null;
}

export interface AssetPlanSnapshot {
  current_status: string | null;
  active_asset_plan: ActiveAssetPlanSnapshot | null;
  active_asset_plan_record_id: string | null;
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
      const response = await fetch(`${baseUrl}/api/projects/${projectId}`);
      const data = await response.json();
      return {
        current_status: data.current_status ?? null,
        active_asset_plan: data.active_asset_plan ?? null,
        active_asset_plan_record_id:
          data.active_asset_plan_record_id ?? null,
      };
    },
    async generateAssetPlan(projectId) {
      await fetch(
        `${baseUrl}/api/projects/${projectId}/asset-plan/generate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
        },
      );
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
      await input.api.generateAssetPlan(projectId);
      await loadActiveAssetPlanSnapshot();
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
