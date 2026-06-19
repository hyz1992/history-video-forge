import { describe, expect, it, vi } from "vitest";

import {
  createScriptStore,
  type ActiveScriptSnapshot,
  type ScriptSnapshot,
} from "../../frontend/src/stores/script";

function createProjectStore() {
  return {
    state: {
      projectId: "project-1",
      currentStatus: "script_generating",
      projects: [],
    },
    ensureProject: vi.fn(async () => "project-1"),
    createProject: vi.fn(),
    loadProjects: vi.fn(async () => []),
    resolveProjectWorkspacePath: vi.fn(() => "/projects/project-1/script"),
    syncProject: vi.fn(),
  };
}

function createScript(overrides: Partial<ActiveScriptSnapshot>): ActiveScriptSnapshot {
  return {
    script_record_id: "script-1",
    script_text: "真实文案内容，应该进入历史版本。",
    opening_span: "真实开头",
    ending_span: "真实结尾",
    review_decision: "pass",
    patch_intent: null,
    local_validation: {
      stage: "local",
      decision: "pass",
    },
    semantic_review: {
      stage: "semantic",
      decision: "pass",
      patch_intent: null,
    },
    execution_state: {
      patch_used: false,
      regenerate_used: false,
    },
    ...overrides,
  };
}

describe("script store history", () => {
  it("does not append generating placeholders to script history", async () => {
    const snapshots: ScriptSnapshot[] = [
      {
        project_id: "project-1",
        current_status: "script_generating",
        active_script: createScript({
          script_record_id: "script-generating",
          script_text: "",
          opening_span: "",
          ending_span: "",
          review_decision: "pass",
          execution_state: {
            patch_used: false,
            regenerate_used: false,
            generating: true,
          },
        }),
      },
      {
        project_id: "project-1",
        current_status: "script_ready",
        active_script: createScript({
          script_record_id: "script-ready",
        }),
      },
    ];
    const api = {
      loadSnapshot: vi.fn(async () => snapshots.shift()!),
      generateInitialScript: vi.fn(),
      runPatchOnce: vi.fn(),
      runRegenOnce: vi.fn(),
    };
    const store = createScriptStore({
      projectStore: createProjectStore() as never,
      api,
    });

    await store.loadActiveScriptSnapshot();
    expect(store.state.history).toHaveLength(0);
    expect(store.state.selectedHistoryEntryId).toBeNull();

    await store.loadActiveScriptSnapshot();
    expect(store.state.history).toHaveLength(1);
    expect(store.state.history[0]?.label).not.toContain("generating");
    expect(store.state.history[0]?.script.script_record_id).toBe("script-ready");
  });
});
