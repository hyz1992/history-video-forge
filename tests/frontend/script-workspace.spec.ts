// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { describe, expect, it, vi } from "vitest";

import { createAppRouter } from "../../frontend/src/router/index.js";
import ScriptPage from "../../frontend/src/views/ScriptPage.vue";
import {
  createProjectStore,
  projectStoreKey,
} from "../../frontend/src/stores/project";
import {
  createScriptStore,
  scriptStoreKey,
  type ScriptSnapshot,
} from "../../frontend/src/stores/script";

function flushPromises() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

function createSnapshot(
  scriptText: string,
  nodeName: string,
  diagnosticCode: string,
): ScriptSnapshot {
  return {
    project_id: "project-6",
    current_status: "script_ready",
    active_script: {
      script_record_id: "script-6",
      script_text: scriptText,
      opening_span: `${scriptText} opening`,
      ending_span: `${scriptText} ending`,
      review_decision: "pass",
      patch_intent: null,
      local_validation: {
        stage: "script_local_validation",
        decision: "pass",
      },
      semantic_review: {
        stage: "script_semantic_review",
        decision: "pass",
        patch_intent: null,
      },
      execution_state: {
        patch_used: false,
        regenerate_used: false,
      },
      graph_trace_summary: {
        nodes: [
          {
            node_name: nodeName,
            input_ref: "script-input-bundle:project-6",
            output_ref: "script-draft:current",
            failure_reason: null,
          },
        ],
      },
      runtime_diagnostics: {
        checks: [
          {
            code: diagnosticCode,
            level: "info",
          },
        ],
      },
    },
  };
}

async function mountScriptPage(loadSnapshot: (projectId: string) => Promise<ScriptSnapshot>) {
  const router = createAppRouter();
  await router.push("/projects/project-6/script");
  await router.isReady();

  const projectStore = createProjectStore({
    async createProject() {
      return {
        project_id: "project-6",
        current_status: "script_ready",
      };
    },
  });
  projectStore.syncProject({
    project_id: "project-6",
    current_status: "script_ready",
  });

  const scriptStore = createScriptStore({
    projectStore,
    api: {
      loadSnapshot,
      async generateInitialScript() {},
      async runPatchOnce() {},
      async runRegenOnce() {},
    },
  });

  const wrapper = mount(ScriptPage, {
    global: {
      plugins: [router],
      provide: {
        [projectStoreKey as symbol]: projectStore,
        [scriptStoreKey as symbol]: scriptStore,
      },
    },
  });

  return {
    wrapper,
    scriptStore,
  };
}

describe("script workspace", () => {
  it("shows loading, failure, and retry states before restoring the latest script", async () => {
    const firstLoad = createDeferred<ScriptSnapshot>();
    const secondLoad = createDeferred<ScriptSnapshot>();
    const loadSnapshot = vi
      .fn<(projectId: string) => Promise<ScriptSnapshot>>()
      .mockImplementationOnce(() => firstLoad.promise)
      .mockImplementationOnce(() => secondLoad.promise);

    const { wrapper } = await mountScriptPage(loadSnapshot);

    await nextTick();
    expect(wrapper.text()).toContain("正在加载脚本快照");

    firstLoad.reject(new Error("snapshot temporarily unavailable"));
    await flushPromises();

    expect(wrapper.get("[data-testid='script-load-error']").text()).toContain(
      "snapshot temporarily unavailable",
    );
    expect(wrapper.get("[data-testid='retry-load']").text()).toContain("重试加载");

    const retryRequest = wrapper.get("[data-testid='retry-load']").trigger("click");
    await nextTick();
    expect(wrapper.get("[data-testid='retry-load']").text()).toContain("正在重试");

    secondLoad.resolve(
      createSnapshot(
        "Second attempt draft",
        "semantic-review",
        "semantic_review_passed",
      ),
    );

    await retryRequest;
    await flushPromises();

    expect(loadSnapshot).toHaveBeenCalledTimes(2);
    expect(wrapper.find("[data-testid='script-load-error']").exists()).toBe(false);
    expect(wrapper.get("[data-testid='script-text']").text()).toContain(
      "Second attempt draft",
    );
  });

  it("renders the current graph trace summary and lets the user restore an earlier local snapshot", async () => {
    const snapshots = [
      createSnapshot("First draft", "script-generate", "draft_created"),
      createSnapshot("Second draft", "patch-script", "patch_applied"),
    ];

    const { wrapper, scriptStore } = await mountScriptPage(async () => {
      const snapshot = snapshots.shift();
      if (!snapshot) {
        throw new Error("snapshot queue exhausted");
      }
      return snapshot;
    });

    await flushPromises();
    expect(wrapper.get("[data-testid='trace-node-0']").text()).toContain("script-generate");
    expect(wrapper.get("[data-testid='runtime-diagnostic-0']").text()).toContain(
      "draft_created",
    );

    await scriptStore.loadActiveScriptSnapshot();
    await flushPromises();

    expect(wrapper.get("[data-testid='script-text']").text()).toContain("Second draft");
    expect(wrapper.get("[data-testid='trace-node-0']").text()).toContain("patch-script");
    expect(wrapper.get("[data-testid='history-entry-0']").text()).toContain("Second draft");
    expect(wrapper.get("[data-testid='history-entry-1']").text()).toContain("First draft");

    await wrapper.get("[data-testid='restore-history-1']").trigger("click");
    await flushPromises();

    expect(wrapper.get("[data-testid='history-viewing']").text()).toContain("历史版本");
    expect(wrapper.get("[data-testid='script-text']").text()).toContain("First draft");
    expect(wrapper.get("[data-testid='trace-node-0']").text()).toContain("script-generate");
  });

  it("shows an in-progress workspace state instead of an empty placeholder when the first script run has started", async () => {
    const { wrapper } = await mountScriptPage(async () => ({
      project_id: "project-6",
      current_status: "script_generating",
      active_script: null,
    }));

    await flushPromises();

    expect(wrapper.find("[data-testid='script-empty']").exists()).toBe(false);
    expect(wrapper.get("[data-testid='script-running-state']").text()).toContain("正在生成文案");
  });

  it("shows a failed workspace state instead of an empty placeholder when no current script is available", async () => {
    const { wrapper } = await mountScriptPage(async () => ({
      project_id: "project-6",
      current_status: "script_failed",
      active_script: null,
    }));

    await flushPromises();

    expect(wrapper.find("[data-testid='script-empty']").exists()).toBe(false);
    expect(wrapper.get("[data-testid='script-failed-state']").text()).toContain("生成失败");
  });
});
