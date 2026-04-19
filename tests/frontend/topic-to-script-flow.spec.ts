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
  it("navigates from the confirmed system topic flow into /script and renders the restored active script", async () => {
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
                title: "晏子使楚",
                one_line_angle: "他不是会说话，他是当场把局面翻过来了。",
                family_label: "court_showdown",
                scope_label: "single_turning_point",
                why_now: "羞辱与反击的冲突很适合短视频开场。",
                strong_scene: "楚王连番压场，晏子一句句顶回去。",
                must_cover_preview: ["楚王压场", "晏子反顶"],
                risk_hints: ["避免写成纯鸡汤"],
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
              canonical_title: "晏子使楚",
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
    expect(wrapper.get("[data-testid='script-text']").text()).toContain("晏子敢");
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
              script_text: "刷新后仍然可以恢复 active script。",
              opening_span: "刷新后开头。",
              ending_span: "刷新后结尾。",
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
    expect(wrapper.get("[data-testid='script-text']").text()).toContain(
      "刷新后仍然可以恢复 active script",
    );
  });
});
