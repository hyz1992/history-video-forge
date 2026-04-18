// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import TopicPage from "../../frontend/src/views/TopicPage.vue";
import {
  createProjectStore,
  projectStoreKey,
} from "../../frontend/src/stores/project";
import {
  createTopicStore,
  topicStoreKey,
} from "../../frontend/src/stores/topic";

function flushPromises() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("topic page", () => {
  it("switches tabs and completes the minimal system recommendation flow", async () => {
    const calls = {
      createProject: 0,
      recommend: [] as string[],
      confirm: [] as Array<{ projectId: string; candidateId: string }>,
    };

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
                must_include_beats: ["楚王压场", "晏子反顶"],
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

    const wrapper = mount(TopicPage, {
      global: {
        provide: {
          [projectStoreKey as symbol]: projectStore,
          [topicStoreKey as symbol]: topicStore,
        },
      },
    });

    expect(wrapper.get("[data-testid='tab-system']").attributes("aria-pressed")).toBe(
      "true",
    );

    await wrapper.get("[data-testid='tab-library']").trigger("click");
    expect(wrapper.get("[data-testid='panel-library']").text()).toContain("事件库入口");

    await wrapper.get("[data-testid='tab-custom']").trigger("click");
    expect(wrapper.get("[data-testid='panel-custom']").text()).toContain("自定义主题入口");

    await wrapper.get("[data-testid='tab-system']").trigger("click");
    await wrapper.get("[data-testid='system-generate']").trigger("click");
    await flushPromises();

    expect(calls.createProject).toBe(1);
    expect(calls.recommend).toEqual(["project-1"]);
    expect(wrapper.get("[data-testid='candidate-item-candidate-1']").text()).toContain(
      "晏子使楚",
    );

    await wrapper.get("[data-testid='candidate-item-candidate-1']").trigger("click");
    expect(wrapper.get("[data-testid='candidate-drawer']").text()).toContain(
      "楚王连番压场，晏子一句句顶回去。",
    );

    await wrapper.get("[data-testid='confirm-candidate']").trigger("click");
    await flushPromises();

    expect(calls.confirm).toEqual([
      {
        projectId: "project-1",
        candidateId: "candidate-1",
      },
    ]);
    expect(wrapper.get("[data-testid='topic-status']").text()).toContain("script_ready");
  });
});
