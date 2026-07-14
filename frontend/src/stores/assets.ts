import { inject, reactive, readonly, type InjectionKey } from "vue";
import { apiFetch, notifyUnauthorized } from "../utils/api";

import type { ProjectStore } from "./project";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AssetsSnapshot {
  current_status: string | null;
  active_assets: {
    asset_manifest_record_id: string;
    source_asset_plan_record_id: string;
    manifest: {
      manifest_version: string;
      source_asset_plan_id: string;
      source_storyboard_record_id: string;
      source_script_record_id: string;
      execution_options: {
        execution_mode: string;
        voice_profile_id: string | null;
        enabled_provider_types: string[];
        allow_manual_placeholders: boolean;
      };
      executions: Array<{
        execution_id: string;
        task_id: string;
        task_type: string;
        status: string;
        origin: string;
        started_at: string | null;
        completed_at: string | null;
        provider_id: string | null;
        attempts: number;
        output_artifact_ids: string[];
        notes: string[];
      }>;
      artifacts: Array<{
        artifact_id: string;
        artifact_type: string;
        origin: string;
        file_uri: string;
        created_at: string;
        metadata: Record<string, unknown>;
      }>;
      audio_summary: Record<string, unknown>;
      segment_routes: Array<{
        segment_id: string;
        primary_visual_artifact_id: string | null;
        visual_route_type: string;
        readiness: string;
        [key: string]: unknown;
      }>;
      readiness: string;
      notes: string[];
    };
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

export interface AssetsStoreState {
  isLoading: boolean;
  isGenerating: boolean;
  generatingTaskIds: Set<string>;
  isUploading: string | null;
  generatingTaskId: string | null;
  loadError: string | null;
  snapshot: AssetsSnapshot | null;
}

export interface AssetsStore {
  state: Readonly<AssetsStoreState>;
  loadProject: () => Promise<void>;
  generateAssets: (options: { enabledProviderTypes?: string[]; mode?: string; taskIds?: string[] }) => Promise<void>;
  generateSingleTask: (taskId: string) => Promise<void>;
  upgradeSegmentToVideo: (segmentId: string) => Promise<void>;
  uploadArtifact: (taskId: string, file: File) => Promise<void>;
  acceptArtifact: (taskId: string, artifactId: string) => Promise<void>;
  artifactFileUrl: (artifactId: string) => string;
}

export const assetsStoreKey: InjectionKey<AssetsStore> = Symbol("assets-store");

// ---------------------------------------------------------------------------
// Fetch API adapter
// ---------------------------------------------------------------------------

export interface AssetsApi {
  loadProject(projectId: string): Promise<AssetsSnapshot>;
  generateAssets(projectId: string, options: { enabledProviderTypes?: string[]; mode?: string; taskIds?: string[] }): Promise<void>;
  generateSingleTask(projectId: string, taskId: string): Promise<void>;
  upgradeSegmentToVideo(projectId: string, segmentId: string): Promise<void>;
  uploadArtifact(projectId: string, taskId: string, file: File): Promise<void>;
  acceptArtifact(projectId: string, taskId: string, artifactId: string): Promise<void>;
}

export function createFetchAssetsApi(baseUrl = ""): AssetsApi {
  return {
    async loadProject(projectId) {
      const data = await apiFetch<Record<string, unknown>>(`${baseUrl}/api/projects/${projectId}`);
      return {
        current_status: data.current_status ?? null,
        active_assets: data.active_assets ?? null,
      };
    },

    async generateAssets(projectId, options) {
      const body: Record<string, unknown> = {};
      if (options.enabledProviderTypes) body.enabled_provider_types = options.enabledProviderTypes;
      if (options.mode) body.mode = options.mode;
      if (options.taskIds) body.task_ids = options.taskIds;
      await apiFetch(`${baseUrl}/api/projects/${projectId}/assets/generate`, { method: "POST", body });
    },

    async generateSingleTask(projectId, taskId) {
      await apiFetch(`${baseUrl}/api/projects/${projectId}/assets/tasks/${taskId}/generate`, { method: "POST", body: {} });
    },

    async upgradeSegmentToVideo(projectId, segmentId) {
      await apiFetch(`${baseUrl}/api/projects/${projectId}/assets/segments/${segmentId}/upgrade-video`, { method: "POST", body: {} });
    },

    async uploadArtifact(projectId, taskId, file) {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(
        `${baseUrl}/api/projects/${projectId}/assets/tasks/${taskId}/artifacts/upload`,
        { method: "POST", body: formData },
      );
      if (response.status === 401) {
        notifyUnauthorized();
      }
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as Record<string, unknown>).error as string ?? `asset_upload_failed:${response.status}`);
      }
    },

    async acceptArtifact(projectId, taskId, artifactId) {
      await apiFetch(`${baseUrl}/api/projects/${projectId}/assets/tasks/${taskId}/accept`, {
        method: "POST",
        body: { artifact_id: artifactId },
      });
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
  return "assets_load_failed";
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface CreateAssetsStoreInput {
  projectStore: ProjectStore;
  api: AssetsApi;
}

export function createAssetsStore(input: CreateAssetsStoreInput): AssetsStore {
  const state = reactive<AssetsStoreState>({
    isLoading: false,
    isGenerating: false,
    generatingTaskIds: new Set(),
    isUploading: null,
    generatingTaskId: null,
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
      state.isGenerating =
        snapshot.current_status === "assets_generating" ||
        snapshot.active_assets?.execution_state?.generating === true;

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

  async function generateAssets(options: { enabledProviderTypes?: string[]; mode?: string; taskIds?: string[] }) {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) return;

    state.isGenerating = true;
    state.loadError = null;
    if (options.taskIds?.length) {
      for (const tid of options.taskIds) state.generatingTaskIds.add(tid);
    }

    try {
      await input.api.generateAssets(projectId, options);
      await loadProject();
    } catch (error) {
      state.loadError = toErrorMessage(error);
    } finally {
      state.isGenerating = false;
      if (options.taskIds?.length) {
        for (const tid of options.taskIds) state.generatingTaskIds.delete(tid);
      }
    }
  }

  async function generateSingleTask(taskId: string) {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) return;

    state.isGenerating = true;
    state.generatingTaskId = taskId;
    state.generatingTaskIds.add(taskId);

    try {
      await input.api.generateSingleTask(projectId, taskId);
      await loadProject();
    } catch (error) {
      throw error;
    } finally {
      state.isGenerating = false;
      state.generatingTaskId = null;
      state.generatingTaskIds.delete(taskId);
    }
  }

  async function upgradeSegmentToVideo(segmentId: string) {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) return;

    state.isGenerating = true;
    try {
      await input.api.upgradeSegmentToVideo(projectId, segmentId);
      await loadProject();
    } catch (error) {
      throw error;
    } finally {
      state.isGenerating = false;
    }
  }

  async function uploadArtifact(taskId: string, file: File) {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) return;

    state.isUploading = taskId;
    state.loadError = null;

    try {
      await input.api.uploadArtifact(projectId, taskId, file);
      await loadProject();
    } catch (error) {
      state.loadError = toErrorMessage(error);
    } finally {
      state.isUploading = null;
    }
  }

  async function acceptArtifact(taskId: string, artifactId: string) {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) return;

    try {
      await input.api.acceptArtifact(projectId, taskId, artifactId);
      await loadProject();
    } catch (error) {
      state.loadError = toErrorMessage(error);
    }
  }

  function artifactFileUrl(artifactId: string): string {
    const projectId = input.projectStore.state.projectId;
    return `/api/projects/${projectId}/artifacts/${artifactId}/file`;
  }

  return {
    state: readonly(state),
    loadProject,
    generateAssets,
    generateSingleTask,
    upgradeSegmentToVideo,
    uploadArtifact,
    acceptArtifact,
    artifactFileUrl,
  };
}

// ---------------------------------------------------------------------------
// Inject helper
// ---------------------------------------------------------------------------

export function useAssetsStore(): AssetsStore {
  const store = inject(assetsStoreKey);
  if (!store) {
    throw new Error("assets_store_missing");
  }
  return store;
}
