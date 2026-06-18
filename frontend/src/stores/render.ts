import { inject, reactive, readonly, type InjectionKey } from "vue";

import type { ProjectStore } from "./project";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RenderSnapshot {
  current_status: string | null;
  active_render: {
    render_job_record_id: string;
    source_compose_record_id: string;
    source_asset_manifest_record_id: string;
    status: string;
    profile: {
      width: number;
      height: number;
      fps: number;
    };
    output_artifact: {
      artifact_type: string;
      file_uri: string;
      duration_sec: number;
      width: number;
      height: number;
      fps: number;
      metadata: Record<string, unknown>;
    } | null;
    validation_result: {
      decision: string;
      errors?: string[];
      warnings?: string[];
    } | null;
    execution_state: Record<string, unknown> | null;
    graph_trace_summary: Record<string, unknown> | null;
    runtime_diagnostics: Record<string, unknown> | null;
  } | null;
  active_compose?: {
    compose_record_id: string;
    timeline?: Record<string, unknown>;
    local_validation?: { decision: string; errors?: string[]; warnings?: string[] } | null;
  } | null;
  active_assets?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Store state & interface
// ---------------------------------------------------------------------------

export interface RenderStoreState {
  isLoading: boolean;
  isGenerating: boolean;
  loadError: string | null;
  snapshot: RenderSnapshot | null;
}

export interface RenderStore {
  state: Readonly<RenderStoreState>;
  loadProject: () => Promise<void>;
  generateRender: () => Promise<void>;
  getPreviewUrl: () => string;
  getDownloadUrl: () => string;
}

export const renderStoreKey: InjectionKey<RenderStore> = Symbol("render-store");

// ---------------------------------------------------------------------------
// Fetch API adapter
// ---------------------------------------------------------------------------

export interface RenderApi {
  loadProject(projectId: string): Promise<RenderSnapshot>;
  generateRender(projectId: string): Promise<void>;
}

export function createFetchRenderApi(baseUrl = ""): RenderApi {
  return {
    async loadProject(projectId) {
      const response = await fetch(`${baseUrl}/api/projects/${projectId}`);
      if (!response.ok) throw new Error(`render_load_failed:${response.status}`);
      const data = await response.json();
      return {
        current_status: data.current_status ?? null,
        active_render: data.active_render ?? null,
        active_compose: data.active_compose ?? null,
        active_assets: data.active_assets ?? null,
      };
    },

    async generateRender(projectId) {
      const response = await fetch(
        `${baseUrl}/api/projects/${projectId}/render/generate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
        },
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        const validation = (err as Record<string, unknown>).local_validation as
          | { errors?: string[]; warnings?: string[]; decision?: string }
          | undefined;
        const details = validation?.errors?.length
          ? `：${validation.errors.slice(0, 3).join("；")}`
          : "";
        throw new Error(
          ((err as Record<string, unknown>).error as string ?? `render_generate_failed:${response.status}`) +
            details,
        );
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
  return "render_load_failed";
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface CreateRenderStoreInput {
  projectStore: ProjectStore;
  api: RenderApi;
}

export function createRenderStore(input: CreateRenderStoreInput): RenderStore {
  const state = reactive<RenderStoreState>({
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

  async function generateRender() {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) return;

    state.isGenerating = true;
    state.loadError = null;

    try {
      await input.api.generateRender(projectId);
    } catch (error) {
      state.loadError = toErrorMessage(error);
    } finally {
      state.isGenerating = false;
    }

    // Always reload snapshot so the frontend sees the latest render job status
    // (completed / failed / rendering — survives page refresh)
    await loadProject();
  }

  function getPreviewUrl(): string {
    const projectId = input.projectStore.state.projectId;
    return `/api/projects/${projectId}/render/preview`;
  }

  function getDownloadUrl(): string {
    const projectId = input.projectStore.state.projectId;
    return `/api/projects/${projectId}/render/download`;
  }

  return {
    state: readonly(state),
    loadProject,
    generateRender,
    getPreviewUrl,
    getDownloadUrl,
  };
}

// ---------------------------------------------------------------------------
// Inject helper
// ---------------------------------------------------------------------------

export function useRenderStore(): RenderStore {
  const store = inject(renderStoreKey);
  if (!store) {
    throw new Error("render_store_missing");
  }
  return store;
}
