import { inject, reactive, readonly, type InjectionKey } from "vue";

import type { ProjectStore } from "./project";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

export interface StoryboardSegment {
  segment_id: string;
  narrative_role: string;
  script_excerpt: string;
  visual_intent: string;
  scene_description: string;
  motion_hint: string;
  framing_hint: string;
  start_hint_sec: number;
  end_hint_sec: number;
}

export interface StoryboardPlan {
  plan_version: string;
  segments: StoryboardSegment[];
  [key: string]: unknown;
}

export interface StoryboardValidationResult {
  stage: string;
  decision: string;
  errors: string[];
  warnings: string[];
  metrics: Record<string, unknown>;
}

export interface ActiveStoryboardSnapshot {
  plan: StoryboardPlan | null;
  validation_result: StoryboardValidationResult | null;
  execution_state: Record<string, unknown> | null;
  graph_trace_summary: Record<string, unknown> | null;
  runtime_diagnostics: Record<string, unknown> | null;
}

export interface StoryboardSnapshot {
  current_status: string | null;
  active_storyboard: ActiveStoryboardSnapshot | null;
  active_storyboard_record_id: string | null;
}

/* -------------------------------------------------------------------------- */
/*  API adapter                                                               */
/* -------------------------------------------------------------------------- */

export interface StoryboardApi {
  loadSnapshot(projectId: string): Promise<StoryboardSnapshot>;
  generateStoryboard(projectId: string): Promise<void>;
}

export function createFetchStoryboardApi(baseUrl = ""): StoryboardApi {
  return {
    async loadSnapshot(projectId) {
      const response = await fetch(`${baseUrl}/api/projects/${projectId}`);
      const data = await response.json();

      const snapshot: StoryboardSnapshot = {
        current_status: data.current_status ?? null,
        active_storyboard: data.active_storyboard ?? null,
        active_storyboard_record_id: data.active_storyboard_record_id ?? null,
      };

      return snapshot;
    },
    async generateStoryboard(projectId) {
      await fetch(
        `${baseUrl}/api/projects/${projectId}/storyboard/generate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
        },
      );
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Store state                                                               */
/* -------------------------------------------------------------------------- */

export interface StoryboardStoreState {
  isLoading: boolean;
  isGenerating: boolean;
  loadError: string | null;
  snapshot: StoryboardSnapshot | null;
}

export interface StoryboardStore {
  state: Readonly<StoryboardStoreState>;
  loadActiveStoryboardSnapshot: () => Promise<void>;
  generateStoryboard: () => Promise<void>;
  retryLoad: () => Promise<void>;
}

/* -------------------------------------------------------------------------- */
/*  Factory                                                                   */
/* -------------------------------------------------------------------------- */

export interface CreateStoryboardStoreInput {
  projectStore: ProjectStore;
  api: StoryboardApi;
}

export const storyboardStoreKey: InjectionKey<StoryboardStore> =
  Symbol("storyboard-store");

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "storyboard_snapshot_load_failed";
}

export function createStoryboardStore(
  input: CreateStoryboardStoreInput,
): StoryboardStore {
  const state = reactive<StoryboardStoreState>({
    isLoading: false,
    isGenerating: false,
    loadError: null,
    snapshot: null,
  });

  async function loadActiveStoryboardSnapshot() {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) {
      state.snapshot = null;
      state.loadError = null;
      return;
    }

    state.isLoading = true;
    try {
      const snapshot = await input.api.loadSnapshot(projectId);
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

  async function generateStoryboard() {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) {
      return;
    }

    state.isGenerating = true;
    state.loadError = null;

    // Optimistically update status to indicate generation in progress
    const previousStatus =
      state.snapshot?.current_status ??
      input.projectStore.state.currentStatus;
    state.snapshot = {
      current_status: "storyboard_generating",
      active_storyboard: state.snapshot?.active_storyboard ?? null,
      active_storyboard_record_id:
        state.snapshot?.active_storyboard_record_id ?? null,
    };
    input.projectStore.syncProject({
      project_id: projectId,
      current_status: "storyboard_generating",
    });

    try {
      await input.api.generateStoryboard(projectId);
      await loadActiveStoryboardSnapshot();
    } catch (error) {
      state.loadError = toErrorMessage(error);
      state.snapshot = {
        current_status: previousStatus,
        active_storyboard: state.snapshot?.active_storyboard ?? null,
        active_storyboard_record_id:
          state.snapshot?.active_storyboard_record_id ?? null,
      };
      input.projectStore.syncProject({
        project_id: projectId,
        current_status: previousStatus,
      });
    } finally {
      state.isGenerating = false;
    }
  }

  async function retryLoad() {
    await loadActiveStoryboardSnapshot();
  }

  return {
    state: readonly(state),
    loadActiveStoryboardSnapshot,
    generateStoryboard,
    retryLoad,
  };
}

export function useStoryboardStore(): StoryboardStore {
  const store = inject(storyboardStoreKey);
  if (!store) {
    throw new Error("storyboard_store_missing");
  }
  return store;
}
