import { inject, reactive, readonly, type InjectionKey } from "vue";

import type { ProjectStore } from "./project";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComposeSnapshot {
  current_status: string | null;
  active_compose: {
    compose_record_id: string;
    source_asset_manifest_record_id: string;
    timeline: {
      output_profile: string;
      duration_sec: number;
      tracks: Array<{
        track_id: string;
        track_type: string;
        clips: Array<{
          clip_id: string;
          start_sec: number;
          end_sec: number;
          source_artifact_id: string | null;
          [key: string]: unknown;
        }>;
        [key: string]: unknown;
      }>;
      segments: Array<{
        segment_id: string;
        start_sec: number;
        end_sec: number;
        [key: string]: unknown;
      }>;
      readiness: string;
      notes: string[];
    } | null;
    local_validation: {
      decision: string;
      errors?: string[];
      warnings?: string[];
    } | null;
    execution_state: Record<string, unknown> | null;
    graph_trace_summary: Record<string, unknown> | null;
    runtime_diagnostics: Record<string, unknown> | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Store state & interface
// ---------------------------------------------------------------------------

export interface ComposeStoreState {
  isLoading: boolean;
  isGenerating: boolean;
  loadError: string | null;
  snapshot: ComposeSnapshot | null;
}

export interface ComposeStore {
  state: Readonly<ComposeStoreState>;
  loadProject: () => Promise<void>;
  generateCompose: () => Promise<void>;
}

export const composeStoreKey: InjectionKey<ComposeStore> = Symbol("compose-store");

// ---------------------------------------------------------------------------
// Fetch API adapter
// ---------------------------------------------------------------------------

export interface ComposeApi {
  loadProject(projectId: string): Promise<ComposeSnapshot>;
  generateCompose(projectId: string): Promise<void>;
}

export function createFetchComposeApi(baseUrl = ""): ComposeApi {
  return {
    async loadProject(projectId) {
      const response = await fetch(`${baseUrl}/api/projects/${projectId}`);
      if (!response.ok) throw new Error(`compose_load_failed:${response.status}`);
      const data = await response.json();
      return {
        current_status: data.current_status ?? null,
        active_compose: data.active_compose ?? null,
      };
    },

    async generateCompose(projectId) {
      const response = await fetch(
        `${baseUrl}/api/projects/${projectId}/compose/generate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
        },
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as Record<string, unknown>).error as string ?? `compose_generate_failed:${response.status}`);
      }
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
  return "compose_load_failed";
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface CreateComposeStoreInput {
  projectStore: ProjectStore;
  api: ComposeApi;
}

export function createComposeStore(input: CreateComposeStoreInput): ComposeStore {
  const state = reactive<ComposeStoreState>({
    isLoading: false,
    isGenerating: false,
    loadError: null,
    snapshot: null,
  });

  async function loadProject() {
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

  async function generateCompose() {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) return;

    state.isGenerating = true;
    state.loadError = null;

    try {
      await input.api.generateCompose(projectId);
      await loadProject();
    } catch (error) {
      state.loadError = toErrorMessage(error);
    } finally {
      state.isGenerating = false;
    }
  }

  return {
    state: readonly(state),
    loadProject,
    generateCompose,
  };
}

// ---------------------------------------------------------------------------
// Inject helper
// ---------------------------------------------------------------------------

export function useComposeStore(): ComposeStore {
  const store = inject(composeStoreKey);
  if (!store) {
    throw new Error("compose_store_missing");
  }
  return store;
}
