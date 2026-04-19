import { inject, reactive, readonly, type InjectionKey } from "vue";

import type { ProjectStore } from "./project";

export interface ScriptSnapshot {
  project_id: string;
  current_status: string;
  active_script: {
    script_record_id: string;
    script_text: string;
    opening_span: string;
    ending_span: string;
    review_decision: "pass" | "patch_once" | "regen_once" | "return_topic";
    patch_intent: "fix" | "lift" | null;
    local_validation: {
      stage: string;
      decision: string;
    };
    semantic_review: {
      stage: string;
      decision: string;
      patch_intent: "fix" | "lift" | null;
    };
    execution_state: {
      patch_used: boolean;
      regenerate_used: boolean;
    };
  } | null;
}

export interface ScriptApi {
  loadSnapshot(projectId: string): Promise<ScriptSnapshot>;
  runPatchOnce(projectId: string): Promise<void>;
  runRegenOnce(projectId: string): Promise<void>;
}

export interface ScriptStoreState {
  snapshot: ScriptSnapshot | null;
  isLoading: boolean;
  isRunningAction: boolean;
}

export interface ScriptStore {
  state: Readonly<ScriptStoreState>;
  loadActiveScriptSnapshot: () => Promise<void>;
  runPatchOnce: () => Promise<void>;
  runRegenOnce: () => Promise<void>;
}

export interface CreateScriptStoreInput {
  projectStore: ProjectStore;
  api: ScriptApi;
}

export const scriptStoreKey: InjectionKey<ScriptStore> = Symbol("script-store");

export function createFetchScriptApi(baseUrl = ""): ScriptApi {
  return {
    async loadSnapshot(projectId) {
      const response = await fetch(`${baseUrl}/api/projects/${projectId}`);
      return response.json();
    },
    async runPatchOnce(projectId) {
      await fetch(`${baseUrl}/api/projects/${projectId}/script/generate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          allow_patch: true,
          allow_regen: false,
        }),
      });
    },
    async runRegenOnce(projectId) {
      await fetch(`${baseUrl}/api/projects/${projectId}/script/generate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          allow_patch: false,
          allow_regen: true,
        }),
      });
    },
  };
}

export function createScriptStore(input: CreateScriptStoreInput): ScriptStore {
  const state = reactive<ScriptStoreState>({
    snapshot: null,
    isLoading: false,
    isRunningAction: false,
  });

  async function loadActiveScriptSnapshot() {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) {
      state.snapshot = null;
      return;
    }

    state.isLoading = true;
    try {
      const snapshot = await input.api.loadSnapshot(projectId);
      state.snapshot = snapshot;
      input.projectStore.syncProject({
        project_id: snapshot.project_id,
        current_status: snapshot.current_status,
      });
    } finally {
      state.isLoading = false;
    }
  }

  async function runPatchOnce() {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) {
      return;
    }

    state.isRunningAction = true;
    try {
      await input.api.runPatchOnce(projectId);
      await loadActiveScriptSnapshot();
    } finally {
      state.isRunningAction = false;
    }
  }

  async function runRegenOnce() {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) {
      return;
    }

    state.isRunningAction = true;
    try {
      await input.api.runRegenOnce(projectId);
      await loadActiveScriptSnapshot();
    } finally {
      state.isRunningAction = false;
    }
  }

  return {
    state: readonly(state),
    loadActiveScriptSnapshot,
    runPatchOnce,
    runRegenOnce,
  };
}

export function useScriptStore() {
  const store = inject(scriptStoreKey);
  if (!store) {
    throw new Error("script_store_missing");
  }

  return store;
}
