// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { h } from "vue";
import { RouterView } from "vue-router";
import { describe, expect, it } from "vitest";

import { createAppRouter } from "../../frontend/src/router/index.js";
import {
  createProjectStore,
  projectStoreKey,
} from "../../frontend/src/stores/project";
import {
  createScriptStore,
  scriptStoreKey,
} from "../../frontend/src/stores/script";
import {
  createTopicStore,
  topicStoreKey,
} from "../../frontend/src/stores/topic";

function flushPromises() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("topic to script flow", () => {
  it("navigates from topic confirmation into /script and renders trace plus history panels", async () => {
    const calls = {
      createProject: 0,
      recommend: [] as string[],
      confirm: [] as Array<{ projectId: string; candidateId: string }>,
      loadSnapshot: [] as string[],
    };

    const router = createAppRouter();
    await router.push("/topic");
    await router.isReady();

    const projectStore = createProjectStore({
      async createProject() {
        calls.createProject += 1;
        return {
          project_id: "project-1",
          current_status: "topic_pending",
        };
      },
    });

    const topicStore = createTopicStore({
      projectStore,
      api: {
        async generateSystemRecommendations(projectId) {
          calls.recommend.push(projectId);
          return {
            project_id: projectId,
            candidates: [
              {
                candidate_id: "candidate-1",
                title: "Yanzi mission",
                one_line_angle: "The king pressed in public, and Yanzi hit back in public.",
                family_label: "court_showdown",
                scope_label: "single_turning_point",
                why_now: "Short-form story needs immediate public pressure.",
                strong_scene: "The king keeps escalating and Yanzi answers in place.",
                must_cover_preview: ["public pressure", "public comeback"],
                risk_hints: ["avoid classroom tone"],
              },
            ],
          };
        },
        async confirmCandidate(projectId, candidateId) {
          calls.confirm.push({
            projectId,
            candidateId,
          });
          return {
            project_id: projectId,
            current_status: "script_ready",
            topic_package: {
              topic_package_id: "topic-package-1",
              canonical_title: "Yanzi mission",
            },
          };
        },
      },
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
              script_text: "First script draft",
              opening_span: "Opening hook",
              ending_span: "Closing residue",
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
              graph_trace_summary: {
                nodes: [
                  {
                    node_name: "script-generate",
                    input_ref: "script-input-bundle:project-1",
                    output_ref: "script-draft:current",
                    failure_reason: null,
                  },
                ],
              },
              runtime_diagnostics: {
                checks: [
                  {
                    code: "semantic_review_passed",
                    level: "info",
                  },
                ],
              },
            },
          };
        },
        async runPatchOnce() {},
        async runRegenOnce() {},
      },
    });

    const wrapper = mount(
      {
        render: () => h(RouterView),
      },
      {
        global: {
          plugins: [router],
          provide: {
            [projectStoreKey as symbol]: projectStore,
            [topicStoreKey as symbol]: topicStore,
            [scriptStoreKey as symbol]: scriptStore,
          },
        },
      },
    );

    await wrapper.get("[data-testid='system-generate']").trigger("click");
    await flushPromises();
    await wrapper.get("[data-testid='candidate-item-candidate-1']").trigger("click");
    await wrapper.get("[data-testid='confirm-candidate']").trigger("click");
    await flushPromises();
    await router.isReady();

    expect(router.currentRoute.value.path).toBe("/script");
    expect(calls.confirm).toEqual([
      {
        projectId: "project-1",
        candidateId: "candidate-1",
      },
    ]);
    expect(calls.loadSnapshot).toEqual(["project-1"]);
    expect(wrapper.get("[data-testid='script-text']").text()).toContain("First script");
    expect(wrapper.get("[data-testid='script-trace-panel']").text()).toContain(
      "script-generate",
    );
    expect(wrapper.get("[data-testid='script-history-panel']").text()).toContain(
      "历史版本",
    );
  });

  it("restores the active script when the page reloads directly on /script", async () => {
    const calls = {
      loadSnapshot: [] as string[],
    };

    const router = createAppRouter();
    await router.push("/script");
    await router.isReady();

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

    const topicStore = createTopicStore({
      projectStore,
      api: {
        async generateSystemRecommendations() {
          throw new Error("topic recommendations should not run on script reload");
        },
        async confirmCandidate() {
          throw new Error("confirm should not run on script reload");
        },
      },
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
              script_record_id: "script-2",
              script_text: "Reloaded script draft",
              opening_span: "Reloaded opening",
              ending_span: "Reloaded ending",
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
                    node_name: "script-generate",
                    input_ref: "script-input-bundle:project-2",
                    output_ref: "script-draft:current",
                    failure_reason: null,
                  },
                ],
              },
              runtime_diagnostics: {
                checks: [
                  {
                    code: "script_snapshot_restored",
                    level: "info",
                  },
                ],
              },
            },
          };
        },
        async runPatchOnce() {},
        async runRegenOnce() {},
      },
    });

    const wrapper = mount(
      {
        render: () => h(RouterView),
      },
      {
        global: {
          plugins: [router],
          provide: {
            [projectStoreKey as symbol]: projectStore,
            [topicStoreKey as symbol]: topicStore,
            [scriptStoreKey as symbol]: scriptStore,
          },
        },
      },
    );

    await flushPromises();

    expect(router.currentRoute.value.path).toBe("/script");
    expect(calls.loadSnapshot).toEqual(["project-2"]);
    expect(wrapper.get("[data-testid='script-text']").text()).toContain("Reloaded script");
    expect(wrapper.get("[data-testid='script-trace-panel']").text()).toContain(
      "script-generate",
    );
  });
});
