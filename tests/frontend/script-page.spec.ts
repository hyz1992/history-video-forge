// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { createAppRouter } from "../../frontend/src/router/index.js";

import ScriptPage from "../../frontend/src/views/ScriptPage.vue";
import {
  createProjectStore,
  projectStoreKey,
} from "../../frontend/src/stores/project";
import {
  createScriptStore,
  scriptStoreKey,
} from "../../frontend/src/stores/script";

function flushPromises() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function createScriptRouter(projectId: string) {
  const router = createAppRouter();
  await router.push(`/projects/${projectId}/script`);
  await router.isReady();
  return router;
}

describe("script page", () => {
  it("loads active script snapshot and renders draft/local validation/semantic review", async () => {
    const calls = {
      loadSnapshot: [] as string[],
      patch: [] as string[],
      regen: [] as string[],
    };

    const router = await createScriptRouter("project-1");

    const projectStore = createProjectStore({
      async createProject() {
        return {
          project_id: "project-1",
          current_status: "script_ready",
        };
      },
    });
    projectStore.syncProject({
      project_id: "project-1",
      current_status: "script_ready",
    });

    const scriptStore = createScriptStore({
      projectStore,
      api: {
        async loadSnapshot(projectId) {
          calls.loadSnapshot.push(projectId);
          return {
            project_id: projectId,
            current_status: "script_ready",
            active_script: {
              script_record_id: "script-1",
              script_text:
                "如果有人当着所有人的面羞辱你，你敢不敢当场顶回去？晏子敢。",
              opening_span: "如果有人当着所有人的面羞辱你，你敢不敢当场顶回去？",
              ending_span: "这种场面，一退掉的就不只是自己。",
              review_decision: "pass",
              patch_intent: "lift",
              local_validation: {
                stage: "script_local_validation",
                decision: "pass",
              },
              semantic_review: {
                stage: "script_semantic_review",
                decision: "pass",
                patch_intent: "lift",
              },
              execution_state: {
                patch_used: true,
                regenerate_used: false,
              },
            },
          };
        },
        async runPatchOnce(projectId) {
          calls.patch.push(projectId);
          throw new Error("patch should not be called in this case");
        },
        async runRegenOnce(projectId) {
          calls.regen.push(projectId);
          throw new Error("regen should not be called in this case");
        },
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

    await flushPromises();

    expect(calls.loadSnapshot).toEqual(["project-1"]);
    expect(wrapper.get("[data-testid='script-status']").text()).toContain(
      "script_ready",
    );
    expect(wrapper.get("[data-testid='script-page-header']").text()).toContain("文案工作区");
    expect(wrapper.get("[data-testid='script-main-panel']").text()).toContain("当前文案");
    expect(wrapper.get("[data-testid='script-text']").text()).toContain("晏子敢");
    expect(wrapper.get("[data-testid='local-validation']").text()).toContain(
      "script_local_validation",
    );
    expect(wrapper.get("[data-testid='semantic-review']").text()).toContain(
      "script_semantic_review",
    );
    expect(wrapper.get("[data-testid='script-risk-panel']").text()).toContain("风险");
    expect(wrapper.get("[data-testid='script-trace-entry']").text()).toContain("查看运行详情");
    expect(wrapper.find("[data-testid='patch-once']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='regen-once']").exists()).toBe(false);
  });

  it("shows patch/regen actions when review allows them and refreshes snapshot after the action", async () => {
    const calls = {
      loadSnapshot: [] as string[],
      patch: [] as string[],
      regen: [] as string[],
    };

    const snapshots = [
      {
        project_id: "project-2",
        current_status: "script_ready",
        active_script: {
          script_record_id: "script-2",
          script_text: "初版脚本，开头力度还不够。",
          opening_span: "开头力度还不够。",
          ending_span: "尾巴也比较弱。",
          review_decision: "patch_once",
          patch_intent: "lift",
          local_validation: {
            stage: "script_local_validation",
            decision: "pass",
          },
          semantic_review: {
            stage: "script_semantic_review",
            decision: "patch_once",
            patch_intent: "lift",
          },
          execution_state: {
            patch_used: false,
            regenerate_used: false,
          },
        },
      },
      {
        project_id: "project-2",
        current_status: "script_ready",
        active_script: {
          script_record_id: "script-2",
          script_text: "如果有人当着所有人的面羞辱你，你敢不敢当场顶回去？修补后通过。",
          opening_span: "如果有人当着所有人的面羞辱你，你敢不敢当场顶回去？",
          ending_span: "修补后，尾巴也立住了。",
          review_decision: "regen_once",
          patch_intent: null,
          local_validation: {
            stage: "script_local_validation",
            decision: "pass",
          },
          semantic_review: {
            stage: "script_semantic_review",
            decision: "regen_once",
            patch_intent: null,
          },
          execution_state: {
            patch_used: true,
            regenerate_used: false,
          },
        },
      },
      {
        project_id: "project-2",
        current_status: "script_ready",
        active_script: {
          script_record_id: "script-2",
          script_text: "重生后最终通过。",
          opening_span: "重生后的开头。",
          ending_span: "重生后的结尾。",
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
            patch_used: true,
            regenerate_used: true,
          },
        },
      },
    ];

    const router = await createScriptRouter("project-2");

    const projectStore = createProjectStore({
      async createProject() {
        return {
          project_id: "project-2",
          current_status: "script_ready",
        };
      },
    });
    projectStore.syncProject({
      project_id: "project-2",
      current_status: "script_ready",
    });

    const scriptStore = createScriptStore({
      projectStore,
      api: {
        async loadSnapshot(projectId) {
          calls.loadSnapshot.push(projectId);
          const next = snapshots.shift();
          if (!next) {
            throw new Error("snapshot queue exhausted");
          }
          return next;
        },
        async runPatchOnce(projectId) {
          calls.patch.push(projectId);
        },
        async runRegenOnce(projectId) {
          calls.regen.push(projectId);
        },
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

    await flushPromises();

    expect(wrapper.get("[data-testid='patch-once']").text()).toContain("patch_once");
    await wrapper.get("[data-testid='patch-once']").trigger("click");
    await flushPromises();

    expect(calls.patch).toEqual(["project-2"]);
    expect(wrapper.get("[data-testid='regen-once']").text()).toContain("regen_once");

    await wrapper.get("[data-testid='regen-once']").trigger("click");
    await flushPromises();

    expect(calls.regen).toEqual(["project-2"]);
    expect(calls.loadSnapshot).toEqual(["project-2", "project-2", "project-2"]);
    expect(wrapper.get("[data-testid='script-text']").text()).toContain("重生后最终通过");
    expect(wrapper.get("[data-testid='script-action-panel']").text()).toContain("可执行动作");
    expect(wrapper.get("[data-testid='history-entry-0']").text()).toContain("重生后最终通过");
    expect(wrapper.get("[data-testid='history-entry-1']").text()).toContain("修补后通过");
    expect(wrapper.get("[data-testid='history-entry-2']").text()).toContain("初版脚本");
    expect(wrapper.find("[data-testid='patch-once']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='regen-once']").exists()).toBe(false);
  });

  it("requires a second confirmation before returning from script to topic", async () => {
    const router = createAppRouter();
    await router.push("/projects/project-3/script");
    await router.isReady();

    const projectStore = createProjectStore({
      async createProject() {
        return {
          project_id: "project-3",
          current_status: "script_ready",
        };
      },
    });
    projectStore.syncProject({
      project_id: "project-3",
      current_status: "script_ready",
    });

    const scriptStore = createScriptStore({
      projectStore,
      api: {
        async loadSnapshot(projectId) {
          return {
            project_id: projectId,
            current_status: "script_ready",
            active_script: {
              script_record_id: "script-3",
              script_text: "Current draft",
              opening_span: "Current opening",
              ending_span: "Current ending",
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
            },
          };
        },
        async runPatchOnce() {
          throw new Error("patch should not be called");
        },
        async runRegenOnce() {
          throw new Error("regen should not be called");
        },
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

    await flushPromises();

    await wrapper.get("[data-testid='return-topic']").trigger("click");
    await flushPromises();

    expect(router.currentRoute.value.fullPath).toBe("/projects/project-3/script");
    expect(wrapper.get("[data-testid='confirm-return-topic']").text()).toContain("确认");

    await wrapper.get("[data-testid='confirm-return-topic']").trigger("click");
    await flushPromises();

    expect(router.currentRoute.value.fullPath).toBe("/projects/project-3/topic");
  });
});
