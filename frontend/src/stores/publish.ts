import { inject, reactive, readonly, type InjectionKey } from "vue";

import type { ProjectStore } from "./project";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CoverArtifactSummary {
  artifact_id: string;
  file_uri: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  metadata: Record<string, unknown>;
}

export interface VideoOutputSummary {
  artifact_type: string;
  file_uri: string;
  duration_sec: number;
  width: number;
  height: number;
  fps: number;
  mime_type?: string;
  metadata?: Record<string, unknown>;
}

export interface TitleCandidate {
  candidate_id: string;
  text: string;
  style: "standard" | "suspense" | "knowledge" | "emotional";
}

export interface PublishPackageData {
  package_version: string;
  source_render_job_record_id: string;
  video_export_artifact_id: string;
  cover_artifact_id: string | null;
  cover_prompt_draft: string | null;
  cover_origin: string;
  title_candidates: TitleCandidate[];
  selected_title: string;
  description: string;
  hashtags: string[];
  platform_profile: string;
  readiness: string;
  notes: string[];
}

export interface PublishSnapshot {
  current_status: string | null;
  active_render: {
    render_job_record_id: string;
    status: string;
    profile: Record<string, unknown>;
    output_artifact: VideoOutputSummary | null;
  } | null;
  active_publish_package: {
    publish_package_record_id: string;
    source_render_job_record_id: string;
    package: PublishPackageData;
    is_stale: boolean;
    stale_reason: string | null;
    cover_artifact: CoverArtifactSummary | null;
    validation_result: Record<string, unknown> | null;
    execution_state: Record<string, unknown> | null;
  } | null;
}

export interface OptimizeResult {
  optimized_prompt: string;
  change_summary: string[];
}

export interface TitleCandidatesResult {
  candidates: TitleCandidate[];
  _fallback?: boolean;
}

// ---------------------------------------------------------------------------
// Store state & interface
// ---------------------------------------------------------------------------

export interface ExportManifest {
  project_id: string;
  project_title: string;
  files: string[];
  title: string;
  description: string;
  hashtags: string[];
  cover_origin: string;
  has_cover_image: boolean;
  has_video: boolean;
  exported_at: string;
  readiness: string;
  missing_fields: string[];
}

export interface PublishStoreState {
  isLoading: boolean;
  isGenerating: boolean;
  isOptimizingCover: boolean;
  isUploadingCover: boolean;
  isGeneratingCover: boolean;
  isLoadingTitleCandidates: boolean;
  isExporting: boolean;
  exportManifest: ExportManifest | null;
  loadError: string | null;
  snapshot: PublishSnapshot | null;
}

export interface PublishStore {
  state: Readonly<PublishStoreState>;
  loadProject: () => Promise<void>;
  generatePackage: () => Promise<void>;
  updatePackage: (updates: Record<string, unknown>) => Promise<void>;
  optimizeCoverPrompt: () => Promise<OptimizeResult>;
  uploadCover: (fileUri: string, mimeType?: string, width?: number, height?: number) => Promise<void>;
  generateCover: () => Promise<void>;
  loadTitleCandidates: () => Promise<TitleCandidatesResult>;
  exportPackage: () => Promise<ExportManifest>;
}

export const publishStoreKey: InjectionKey<PublishStore> = Symbol("publish-store");

// ---------------------------------------------------------------------------
// Fetch API adapter
// ---------------------------------------------------------------------------

export interface PublishApi {
  loadProject(projectId: string): Promise<PublishSnapshot>;
  generatePackage(projectId: string): Promise<PublishSnapshot>;
  updatePackage(projectId: string, updates: Record<string, unknown>): Promise<PublishSnapshot>;
  optimizeCoverPrompt(projectId: string): Promise<OptimizeResult>;
  uploadCover(projectId: string, fileUri: string, mimeType: string, width?: number, height?: number): Promise<PublishSnapshot>;
  generateCover(projectId: string): Promise<PublishSnapshot>;
  loadTitleCandidates(projectId: string): Promise<TitleCandidatesResult>;
  exportPackage(projectId: string): Promise<ExportManifest>;
}

export function createFetchPublishApi(baseUrl = ""): PublishApi {
  return {
    async loadProject(projectId) {
      const response = await fetch(`${baseUrl}/api/projects/${projectId}`);
      if (!response.ok) throw new Error(`publish_load_failed:${response.status}`);
      const data = await response.json();
      return {
        current_status: data.current_status ?? null,
        active_publish_package: data.active_publish_package ?? null,
        active_render: data.active_render ?? null,
      };
    },

    async generatePackage(projectId) {
      const response = await fetch(`${baseUrl}/api/projects/${projectId}/publish/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(
          (err as Record<string, unknown>).error as string ?? `publish_generate_failed:${response.status}`,
        );
      }
      const data = await response.json();
      return {
        current_status: data.current_status ?? null,
        active_publish_package: data.active_publish_package ?? null,
        active_render: data.active_render ?? null,
      };
    },

    async updatePackage(projectId, updates) {
      const response = await fetch(`${baseUrl}/api/projects/${projectId}/publish`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(
          (err as Record<string, unknown>).error as string ?? `publish_update_failed:${response.status}`,
        );
      }
      const data = await response.json();
      return {
        current_status: data.current_status ?? null,
        active_publish_package: data.active_publish_package ?? null,
        active_render: data.active_render ?? null,
      };
    },

    async optimizeCoverPrompt(projectId) {
      const response = await fetch(`${baseUrl}/api/projects/${projectId}/publish/cover/prompt/optimize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(
          (err as Record<string, unknown>).error as string ?? `cover_optimize_failed:${response.status}`,
        );
      }
      return response.json();
    },

    async uploadCover(projectId, fileUri, mimeType, width, height) {
      const response = await fetch(`${baseUrl}/api/projects/${projectId}/publish/cover/upload`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file_uri: fileUri, mime_type: mimeType, width, height }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(
          (err as Record<string, unknown>).error as string ?? `cover_upload_failed:${response.status}`,
        );
      }
      const data = await response.json();
      return {
        current_status: data.current_status ?? null,
        active_publish_package: data.active_publish_package ?? null,
        active_render: data.active_render ?? null,
      };
    },

    async generateCover(projectId) {
      const response = await fetch(`${baseUrl}/api/projects/${projectId}/publish/cover/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(
          (err as Record<string, unknown>).error as string ?? `cover_generate_failed:${response.status}`,
        );
      }
      const data = await response.json();
      return {
        current_status: data.current_status ?? null,
        active_publish_package: data.active_publish_package ?? null,
        active_render: data.active_render ?? null,
      };
    },

    async loadTitleCandidates(projectId) {
      const response = await fetch(`${baseUrl}/api/projects/${projectId}/publish/title/candidates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(
          (err as Record<string, unknown>).error as string ?? `title_candidates_failed:${response.status}`,
        );
      }
      return response.json();
    },

    async exportPackage(projectId) {
      const response = await fetch(`${baseUrl}/api/projects/${projectId}/publish/export`);
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(
          (err as Record<string, unknown>).error as string ?? `export_failed:${response.status}`,
        );
      }
      // Read manifest from header
      const manifestHeader = response.headers.get("x-export-manifest");
      const manifest: ExportManifest = manifestHeader
        ? JSON.parse(decodeURIComponent(manifestHeader))
        : { project_id: projectId, project_title: "", files: [], title: "", description: "", hashtags: [], cover_origin: "", has_cover_image: false, has_video: false, exported_at: "", readiness: "draft", missing_fields: [] };

      // Trigger file download
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const disposition = response.headers.get("content-disposition") || "";
      const filenameMatch = disposition.match(/filename="?([^";\n]+)"?/);
      a.download = filenameMatch?.[1] || `publish-package-${projectId}.zip`;
      a.href = url;
      a.click();
      URL.revokeObjectURL(url);

      return manifest;
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
  return "publish_load_failed";
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface CreatePublishStoreInput {
  projectStore: ProjectStore;
  api: PublishApi;
}

export function createPublishStore(input: CreatePublishStoreInput): PublishStore {
  const state = reactive<PublishStoreState>({
    isLoading: false,
    isGenerating: false,
    isOptimizingCover: false,
    isUploadingCover: false,
    isGeneratingCover: false,
    isLoadingTitleCandidates: false,
    isExporting: false,
    exportManifest: null,
    loadError: null,
    snapshot: null,
  });

  function syncPublishReadiness(snapshot: PublishSnapshot) {
    const readiness = snapshot.active_publish_package?.package?.readiness;
    input.projectStore.setPublishReady(readiness === "ready");
  }

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

      syncPublishReadiness(snapshot);
    } catch (error) {
      state.loadError = toErrorMessage(error);
    } finally {
      state.isLoading = false;
    }
  }

  async function generatePackage() {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) return;

    state.isGenerating = true;
    state.loadError = null;
    try {
      state.snapshot = await input.api.generatePackage(projectId);
      syncPublishReadiness(state.snapshot);
    } catch (error) {
      state.loadError = toErrorMessage(error);
    } finally {
      state.isGenerating = false;
    }
  }

  async function updatePackage(updates: Record<string, unknown>) {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) return;

    state.loadError = null;
    try {
      state.snapshot = await input.api.updatePackage(projectId, updates);
      syncPublishReadiness(state.snapshot);
    } catch (error) {
      state.loadError = toErrorMessage(error);
    }
  }

  async function optimizeCoverPrompt(): Promise<OptimizeResult> {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) throw new Error("no_project");

    state.isOptimizingCover = true;
    state.loadError = null;
    try {
      const result = await input.api.optimizeCoverPrompt(projectId);
      return result;
    } catch (error) {
      state.loadError = toErrorMessage(error);
      throw error;
    } finally {
      state.isOptimizingCover = false;
    }
  }

  async function uploadCover(fileUri: string, mimeType = "image/png", width?: number, height?: number) {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) return;

    state.isUploadingCover = true;
    state.loadError = null;
    try {
      state.snapshot = await input.api.uploadCover(projectId, fileUri, mimeType, width, height);
    } catch (error) {
      state.loadError = toErrorMessage(error);
    } finally {
      state.isUploadingCover = false;
    }
  }

  async function generateCover() {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) return;

    state.isGeneratingCover = true;
    state.loadError = null;
    try {
      state.snapshot = await input.api.generateCover(projectId);
    } catch (error) {
      state.loadError = toErrorMessage(error);
    } finally {
      state.isGeneratingCover = false;
    }
  }

  async function loadTitleCandidates(): Promise<TitleCandidatesResult> {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) throw new Error("no_project");

    state.isLoadingTitleCandidates = true;
    state.loadError = null;
    try {
      return await input.api.loadTitleCandidates(projectId);
    } catch (error) {
      state.loadError = toErrorMessage(error);
      throw error;
    } finally {
      state.isLoadingTitleCandidates = false;
    }
  }

  async function exportPackage(): Promise<ExportManifest> {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) throw new Error("no_project");

    state.isExporting = true;
    state.loadError = null;
    try {
      const manifest = await input.api.exportPackage(projectId);
      state.exportManifest = manifest;
      return manifest;
    } catch (error) {
      state.loadError = toErrorMessage(error);
      throw error;
    } finally {
      state.isExporting = false;
    }
  }

  return {
    state: readonly(state),
    loadProject,
    generatePackage,
    updatePackage,
    optimizeCoverPrompt,
    uploadCover,
    generateCover,
    loadTitleCandidates,
    exportPackage,
  };
}

// ---------------------------------------------------------------------------
// Inject helper
// ---------------------------------------------------------------------------

export function usePublishStore(): PublishStore {
  const store = inject(publishStoreKey);
  if (!store) {
    throw new Error("publish_store_missing");
  }
  return store;
}
