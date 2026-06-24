import { inject, reactive, readonly, type InjectionKey } from "vue";

import type { ProjectStore } from "./project";

export interface ScriptTraceNode {
  node_name: string;
  input_ref: string;
  output_ref: string;
  failure_reason: string | null;
}

export interface RuntimeDiagnosticCheck {
  code: string;
  level: string;
}

export interface ActiveScriptSnapshot {
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
    summary?: string;
    hard_issues?: ReadonlyArray<string | { code?: string; message?: string }>;
    soft_issues?: ReadonlyArray<string | { code?: string; message?: string }>;
    patch_targets?: ReadonlyArray<string>;
    confidence?: number;
  };
  execution_state: {
    patch_used: boolean;
    regenerate_used: boolean;
    generating?: boolean;
    run_id?: string;
  };
  graph_trace_summary?: {
    nodes: ReadonlyArray<ScriptTraceNode>;
  } | null;
  runtime_diagnostics?: {
    checks: ReadonlyArray<RuntimeDiagnosticCheck>;
  } | null;
}

export interface ScriptSnapshot {
  project_id: string;
  current_status: string;
  active_topic_package?: {
    topic_package_id: string;
    canonical_title?: string;
  } | null;
  active_script: ActiveScriptSnapshot | null;
}

export interface ScriptHistoryEntry {
  entry_id: string;
  label: string;
  script: ActiveScriptSnapshot;
}

export interface ScriptApi {
  loadSnapshot(projectId: string): Promise<ScriptSnapshot>;
  generateInitialScript(projectId: string): Promise<void>;
  runPatchOnce(projectId: string): Promise<void>;
  runRegenOnce(projectId: string, userFeedback?: string): Promise<void>;
}

export interface ScriptStoreState {
  snapshot: ScriptSnapshot | null;
  history: ScriptHistoryEntry[];
  selectedHistoryEntryId: string | null;
  isLoading: boolean;
  isRunningAction: boolean;
  loadError: string | null;
}

export interface ScriptStore {
  state: Readonly<ScriptStoreState>;
  generateInitialScript: () => Promise<void>;
  loadActiveScriptSnapshot: () => Promise<void>;
  retryLoadActiveScriptSnapshot: () => Promise<void>;
  selectHistoryEntry: (entryId: string) => void;
  runPatchOnce: () => Promise<void>;
  runRegenOnce: (userFeedback?: string) => Promise<void>;
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
      if (!response.ok) throw new Error(`script_load_failed:${response.status}`);
      return response.json();
    },
    async generateInitialScript(projectId) {
      const response = await fetch(`${baseUrl}/api/projects/${projectId}/script/generate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          allow_patch: false,
          allow_regen: false,
        }),
      });
      if (!response.ok) throw new Error(`script_generate_failed:${response.status}`);
    },
    async runPatchOnce(projectId) {
      const response = await fetch(`${baseUrl}/api/projects/${projectId}/script/generate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          allow_patch: true,
          allow_regen: false,
        }),
      });
      if (!response.ok) throw new Error(`script_patch_failed:${response.status}`);
    },
    async runRegenOnce(projectId, userFeedback) {
      const response = await fetch(`${baseUrl}/api/projects/${projectId}/script/generate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          allow_patch: false,
          allow_regen: true,
          force_regen: true,
          user_feedback: userFeedback || null,
        }),
      });
      if (!response.ok) throw new Error(`script_regen_failed:${response.status}`);
    },
  };
}

function cloneActiveScriptSnapshot(activeScript: ActiveScriptSnapshot): ActiveScriptSnapshot {
  return {
    ...activeScript,
    local_validation: {
      ...activeScript.local_validation,
    },
    semantic_review: {
      ...activeScript.semantic_review,
    },
    execution_state: {
      ...activeScript.execution_state,
    },
    graph_trace_summary: activeScript.graph_trace_summary
      ? {
          nodes: activeScript.graph_trace_summary.nodes.map((node) => ({
            ...node,
          })),
        }
      : null,
    runtime_diagnostics: activeScript.runtime_diagnostics
      ? {
          checks: activeScript.runtime_diagnostics.checks.map((check) => ({
            ...check,
          })),
        }
      : null,
  };
}

function createHistoryLabel(activeScript: ActiveScriptSnapshot) {
  return `${activeScript.script_text.slice(0, 32)} (${activeScript.review_decision})`;
}

function canAppendHistoryEntry(activeScript: ActiveScriptSnapshot) {
  return (
    activeScript.execution_state?.generating !== true &&
    activeScript.script_text.trim().length > 0
  );
}

function isSameHistoryEntry(a: ActiveScriptSnapshot, b: ActiveScriptSnapshot) {
  return (
    a.script_text === b.script_text &&
    a.review_decision === b.review_decision &&
    a.patch_intent === b.patch_intent &&
    a.execution_state.patch_used === b.execution_state.patch_used &&
    a.execution_state.regenerate_used === b.execution_state.regenerate_used
  );
}

function appendHistoryEntry(
  history: ScriptHistoryEntry[],
  activeScript: ActiveScriptSnapshot,
): ScriptHistoryEntry[] {
  if (!canAppendHistoryEntry(activeScript)) {
    return history;
  }

  const nextScript = cloneActiveScriptSnapshot(activeScript);
  const latest = history[0];

  if (latest && isSameHistoryEntry(latest.script, nextScript)) {
    return history;
  }

  return [
    {
      entry_id: `${nextScript.script_record_id}:${history.length + 1}`,
      label: createHistoryLabel(nextScript),
      script: nextScript,
    },
    ...history,
  ];
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "script_snapshot_load_failed";
}

function getLatestHistoryEntry(history: ScriptHistoryEntry[]) {
  return history[0] ?? null;
}

export function createScriptStore(input: CreateScriptStoreInput): ScriptStore {
  const state = reactive<ScriptStoreState>({
    snapshot: null,
    history: [],
    selectedHistoryEntryId: null,
    isLoading: false,
    isRunningAction: false,
    loadError: null,
  });

  let lastLoadedProjectId: string | null = null;

  async function loadActiveScriptSnapshot() {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) {
      state.snapshot = null;
      state.history = [];
      state.selectedHistoryEntryId = null;
      state.loadError = null;
      lastLoadedProjectId = null;
      return;
    }

    state.isLoading = true;

    if (lastLoadedProjectId !== projectId) {
      state.snapshot = null;
      state.history = [];
      state.selectedHistoryEntryId = null;
      lastLoadedProjectId = projectId;
    }

    try {
      const snapshot = await input.api.loadSnapshot(projectId);
      state.snapshot = snapshot;
      state.loadError = null;
      input.projectStore.syncProject({
        project_id: snapshot.project_id,
        current_status: snapshot.current_status,
      });

      if (snapshot.active_script) {
        state.history = appendHistoryEntry(state.history, snapshot.active_script);
        state.selectedHistoryEntryId = state.history[0]?.entry_id ?? null;
      }
    } catch (error) {
      state.loadError = toErrorMessage(error);
    } finally {
      state.isLoading = false;
    }
  }

  async function retryLoadActiveScriptSnapshot() {
    await loadActiveScriptSnapshot();
  }

  async function generateInitialScript() {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) {
      return;
    }

    state.isLoading = true;
    state.loadError = null;
    state.snapshot = {
      project_id: projectId,
      current_status: "script_generating",
      active_topic_package: state.snapshot?.active_topic_package ?? null,
      active_script: null,
    };
    input.projectStore.syncProject({
      project_id: projectId,
      current_status: "script_generating",
    });

    try {
      await input.api.generateInitialScript(projectId);
      await loadActiveScriptSnapshot();
      // Verify the backend actually produced a script
      if (!state.snapshot?.active_script) {
        state.loadError = "文案生成未完成，请重试";
        state.snapshot = {
          project_id: projectId,
          current_status: "script_failed",
          active_topic_package: state.snapshot?.active_topic_package ?? null,
          active_script: null,
        };
        input.projectStore.syncProject({
          project_id: projectId,
          current_status: "script_failed",
        });
      }
    } catch (error) {
      state.loadError = toErrorMessage(error);
      state.snapshot = {
        project_id: projectId,
        current_status: "script_failed",
        active_topic_package: state.snapshot?.active_topic_package ?? null,
        active_script: null,
      };
      input.projectStore.syncProject({
        project_id: projectId,
        current_status: "script_failed",
      });
    } finally {
      state.isLoading = false;
    }
  }

  function selectHistoryEntry(entryId: string) {
    state.selectedHistoryEntryId = entryId;
    input.projectStore.syncProject({
      project_id: input.projectStore.state.projectId ?? state.snapshot?.project_id ?? "",
      current_status:
        entryId === getLatestHistoryEntry(state.history)?.entry_id
          ? (state.snapshot?.current_status ?? "script_ready")
          : "history_restored",
    });
  }

  async function runPatchOnce() {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) {
      return;
    }

    state.isRunningAction = true;
    if (state.snapshot) {
      state.snapshot = {
        ...state.snapshot,
        current_status: "script_reviewing",
      };
    }
    input.projectStore.syncProject({
      project_id: projectId,
      current_status: "script_reviewing",
    });
    try {
      await input.api.runPatchOnce(projectId);
      await loadActiveScriptSnapshot();
    } finally {
      state.isRunningAction = false;
    }
  }

  async function runRegenOnce(userFeedback?: string) {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) {
      return;
    }

    state.isRunningAction = true;
    if (state.snapshot) {
      state.snapshot = {
        ...state.snapshot,
        current_status: "script_reviewing",
      };
    }
    input.projectStore.syncProject({
      project_id: projectId,
      current_status: "script_reviewing",
    });
    try {
      await input.api.runRegenOnce(projectId, userFeedback);
      await loadActiveScriptSnapshot();
    } finally {
      state.isRunningAction = false;
    }
  }

  const frozen: ScriptStore = {
    state: readonly(state) as unknown as Readonly<ScriptStoreState>,
    generateInitialScript,
    loadActiveScriptSnapshot,
    retryLoadActiveScriptSnapshot,
    selectHistoryEntry,
    runPatchOnce,
    runRegenOnce,
  };

  return frozen;
}

export function useScriptStore() {
  const store = inject(scriptStoreKey);
  if (!store) {
    throw new Error("script_store_missing");
  }

  return store;
}
