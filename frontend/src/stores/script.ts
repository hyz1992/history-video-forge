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
  };
  execution_state: {
    patch_used: boolean;
    regenerate_used: boolean;
  };
  graph_trace_summary?: {
    nodes: ScriptTraceNode[];
  } | null;
  runtime_diagnostics?: {
    checks: RuntimeDiagnosticCheck[];
  } | null;
}

export interface ScriptSnapshot {
  project_id: string;
  current_status: string;
  active_script: ActiveScriptSnapshot | null;
}

export interface ScriptHistoryEntry {
  entry_id: string;
  label: string;
  script: ActiveScriptSnapshot;
}

export interface ScriptApi {
  loadSnapshot(projectId: string): Promise<ScriptSnapshot>;
  runPatchOnce(projectId: string): Promise<void>;
  runRegenOnce(projectId: string): Promise<void>;
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
  loadActiveScriptSnapshot: () => Promise<void>;
  retryLoadActiveScriptSnapshot: () => Promise<void>;
  selectHistoryEntry: (entryId: string) => void;
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

export function createScriptStore(input: CreateScriptStoreInput): ScriptStore {
  const state = reactive<ScriptStoreState>({
    snapshot: null,
    history: [],
    selectedHistoryEntryId: null,
    isLoading: false,
    isRunningAction: false,
    loadError: null,
  });

  async function loadActiveScriptSnapshot() {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) {
      state.snapshot = null;
      state.history = [];
      state.selectedHistoryEntryId = null;
      state.loadError = null;
      return;
    }

    state.isLoading = true;
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
      } else {
        state.history = [];
        state.selectedHistoryEntryId = null;
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

  function selectHistoryEntry(entryId: string) {
    state.selectedHistoryEntryId = entryId;
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
    retryLoadActiveScriptSnapshot,
    selectHistoryEntry,
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
