// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { mount } from "@vue/test-utils";
import { h, reactive } from "vue";
import { RouterView } from "vue-router";
import { describe, expect, it } from "vitest";

import { createAppRouter } from "../../frontend/src/router/index.js";
import TopicPage from "../../frontend/src/views/TopicPage.vue";
import { projectStoreKey } from "../../frontend/src/stores/project";
import { scriptStoreKey } from "../../frontend/src/stores/script";
import { topicStoreKey } from "../../frontend/src/stores/topic";

function flushPromises() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createProjectStoreStub() {
  const state = reactive({
    projectId: null as string | null,
    currentStatus: "topic_pending",
    projects: [
      {
        project_id: "project-pending",
        display_name: "商鞅变法",
        current_status: "topic_pending",
        is_draft: true,
        updated_at: "2026-04-22T09:00:00.000Z",
      },
      {
        project_id: "project-formal",
        display_name: "晏子使楚",
        current_status: "script_ready",
        is_draft: false,
        updated_at: "2026-04-21T09:00:00.000Z",
      },
      {
        project_id: "project-draft",
        display_name: "荆轲刺秦",
        current_status: "topic_candidates_ready",
        is_draft: true,
        updated_at: "2026-04-23T08:00:00.000Z",
      },
    ],
  });

  return {
    state,
    syncProject(snapshot: { project_id: string; current_status: string }) {
      state.projectId = snapshot.project_id;
      state.currentStatus = snapshot.current_status;
    },
    async loadProjects() {
      return state.projects;
    },
    async createProject() {
      state.projectId = "project-new";
      state.currentStatus = "topic_pending";
      return {
        project_id: "project-new",
        current_status: "topic_pending",
        is_draft: true,
      };
    },
    resolveProjectWorkspacePath(projectId: string, currentStatus: string) {
      return currentStatus === "script_ready"
        ? `/projects/${projectId}/script`
        : `/projects/${projectId}/topic`;
    },
  };
}

function createTopicStoreStub() {
  const state = reactive({
    activeTab: "system",
    candidates: [],
    currentRound: null,
    historyRounds: [],
    selectedCandidate: null,
    selectedRoundId: null,
    isGenerating: false,
    isConfirming: false,
    confirmedTopicPackageId: null,
  });

  return {
    state,
    selectTab() {},
    async generateSystemRecommendations() {},
    openCandidate() {},
    closeCandidate() {},
    async confirmSelectedCandidate() {},
  };
}

function createScriptStoreStub() {
  const state = reactive({
    snapshot: null,
    history: [],
    selectedHistoryEntryId: null,
    isLoading: false,
    isRunningAction: false,
    loadError: null,
  });

  return {
    state,
    async loadActiveScriptSnapshot() {},
    async retryLoadActiveScriptSnapshot() {},
    selectHistoryEntry() {},
    async runPatchOnce() {},
    async runRegenOnce() {},
  };
}

async function mountAt(path: string) {
  const router = createAppRouter();
  await router.push(path);
  await router.isReady();

  const wrapper = mount(
    {
      render: () => h(RouterView),
    },
    {
      global: {
        plugins: [router],
        provide: {
          [projectStoreKey as symbol]: createProjectStoreStub() as never,
          [topicStoreKey as symbol]: createTopicStoreStub() as never,
          [scriptStoreKey as symbol]: createScriptStoreStub() as never,
        },
      },
    },
  );

  await flushPromises();
  return { router, wrapper };
}

describe("phase 4 app shell", () => {
  it("renders the home page with project entry CTAs", async () => {
    const { router, wrapper } = await mountAt("/");
    const homeSource = readFileSync("frontend/src/views/HomePage.vue", "utf8");

    expect(router.currentRoute.value.path).toBe("/");
    expect(wrapper.get("[data-testid='home-hero']").exists()).toBe(true);
    expect(wrapper.get("[data-testid='home-tagline']").text()).toContain("历史叙事短视频工作台");
    expect(wrapper.get("[data-testid='home-feature-rail']").text()).toContain("选题生成");
    expect(wrapper.get("[data-testid='home-feature-rail']").text()).toContain("文案生成");
    expect(wrapper.get("[data-testid='home-flow-strip']").text()).toContain("当前阶段聚焦 Topic 与 Script");
    expect(wrapper.text()).not.toContain("正式工作区能力");
    expect(wrapper.text()).not.toContain("WORKSPACE");
    expect(wrapper.find("[data-testid='home-kicker']").exists()).toBe(false);
    expect(wrapper.get("[data-testid='home-heading']").text()).toContain("Story Video Forge");
    expect(wrapper.get("[data-testid='home-primary-cta']").text()).toContain("我的项目");
    expect(wrapper.get("[data-testid='home-primary-cta']").attributes("href")).toBe("/projects");
    expect(wrapper.get("[data-testid='home-primary-cta']").classes()).toContain("btn-primary");
    expect(wrapper.get("[data-testid='home-primary-cta']").classes()).not.toContain(
      "hero-cta-filled",
    );
    expect(wrapper.get("[data-testid='home-secondary-cta']").classes()).toContain("btn-secondary");
    expect(wrapper.get("[data-testid='home-secondary-cta']").classes()).not.toContain(
      "hero-cta-filled",
    );
    expect(homeSource).toContain(".landing-page {");
    expect(homeSource).toContain("display: grid;");
    expect(homeSource).toContain(".hero {");
    expect(homeSource).toContain("align-items: center;");
    expect(homeSource).toContain("min-height: 100vh;");

    await wrapper.get("[data-testid='home-secondary-cta']").trigger("click");
    await flushPromises();

    expect(router.currentRoute.value.path).toBe("/projects/project-new/topic");
  });

  it("renders the projects page as a bounded project table with a draft drawer", async () => {
    const { router, wrapper } = await mountAt("/projects");
    const projectsSource = readFileSync("frontend/src/views/ProjectsPage.vue", "utf8");

    expect(router.currentRoute.value.path).toBe("/projects");
    expect(wrapper.get("[data-testid='projects-heading']").text()).toContain("我的项目");
    expect(wrapper.find("[data-testid='projects-kicker']").exists()).toBe(false);
    expect(wrapper.get("[data-testid='projects-content-column']").exists()).toBe(true);
    expect(wrapper.get("[data-testid='projects-header-actions']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='projects-toolbar']").exists()).toBe(false);
    expect(wrapper.get("[data-testid='projects-table-shell']").exists()).toBe(true);
    expect(wrapper.get("[data-testid='projects-table-toolbar']").text()).toContain("搜索项目");
    expect(wrapper.get("[data-testid='projects-table-toolbar']").text()).toContain("阶段");
    expect(wrapper.get("[data-testid='projects-search-shell']").classes()).toContain(
      "projects-filter-field--wide",
    );
    expect(wrapper.get("[data-testid='projects-stage-filter-shell']").classes()).toContain(
      "projects-filter-field--select",
    );
    expect(wrapper.get("[data-testid='projects-table-head']").text()).toContain("标题");
    expect(wrapper.get("[data-testid='projects-table-head']").text()).toContain("生成时间");
    expect(wrapper.get("[data-testid='projects-table-head']").text()).toContain("阶段");
    expect(wrapper.text()).not.toContain("正式项目");
    expect(wrapper.get("[data-testid='projects-draft-button']").text()).toContain("草稿箱");
    expect(wrapper.get("[data-testid='projects-draft-button']").classes()).toContain("projects-draft-button");
    expect(wrapper.get("[data-testid='projects-draft-button']").classes()).toContain(
      "projects-header-button",
    );
    expect(wrapper.get("[data-testid='create-project']").classes()).toContain(
      "projects-header-button",
    );
    expect(wrapper.find("[data-testid='projects-draft-drawer']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='project-card-project-draft']").exists()).toBe(false);
    expect(wrapper.text()).toContain("晏子使楚");
    expect(wrapper.text()).toContain("商鞅变法");
    expect(wrapper.text()).not.toContain("荆轲刺秦");
    expect(wrapper.get("[data-testid='projects-search']").attributes("placeholder")).toContain(
      "搜索项目",
    );
    expect(wrapper.get("[data-testid='projects-sort-updated-at']").attributes("type")).toBe("button");
    expect(wrapper.get("[data-testid='projects-sort-stage']").attributes("type")).toBe("button");
    expect(wrapper.get("[data-testid='project-row-project-pending']").text()).toContain("打开");
    expect(wrapper.get("[data-testid='project-row-project-formal']").find("[data-testid='project-stage-project-formal']").exists()).toBe(true);
    expect(wrapper.get("[data-testid='delete-project-project-formal']").classes()).toContain("btn-icon");
    expect(wrapper.get("[data-testid='open-project-project-formal']").classes()).toContain(
      "projects-row-open",
    );
    expect(wrapper.get("[data-testid='projects-table-footer']").text()).toContain("2 个项目");

    await wrapper.get("[data-testid='projects-sort-updated-at']").trigger("click");
    await flushPromises();

    expect(wrapper.findAll("[data-testid^='project-row-']")[0]?.text()).toContain("晏子使楚");

    await wrapper.get("[data-testid='projects-stage-filter']").setValue("topic_pending");
    await flushPromises();

    expect(wrapper.text()).toContain("商鞅变法");
    expect(wrapper.text()).not.toContain("晏子使楚");

    await wrapper.get("[data-testid='projects-draft-button']").trigger("click");
    await flushPromises();

    expect(wrapper.text()).not.toContain("搜索草稿");
    expect(wrapper.get("[data-testid='projects-draft-close']").attributes("aria-label")).toBe(
      "关闭草稿箱",
    );
    expect(wrapper.get("[data-testid='projects-draft-close']").classes()).toContain(
      "projects-draft-close-button",
    );
    expect(wrapper.get("[data-testid='projects-draft-drawer']").text()).toContain("草稿箱");
    expect(wrapper.get("[data-testid='projects-draft-drawer']").text()).toContain(
      "仅显示已生成候选题、但尚未确认主题的项目",
    );
    expect(wrapper.get("[data-testid='projects-draft-card-list']").exists()).toBe(true);
    expect(wrapper.get("[data-testid='project-card-project-draft']").text()).toContain("继续查看");
    expect(wrapper.get("[data-testid='project-card-project-draft']").text()).toContain("荆轲刺秦");
    expect(wrapper.get("[data-testid='project-card-project-draft']").text()).toContain("候选题已生成");
    expect(wrapper.get("[data-testid='projects-draft-drawer']").text()).not.toContain("商鞅变法");
    expect(projectsSource).toContain("width: min(100%, 1000px);");
    expect(projectsSource).toContain("font-size: 48px;");
    expect(projectsSource).toContain("line-height: 56px;");
    expect(projectsSource).toContain("gap: 12px;");
    expect(projectsSource).toContain("max-width: 560px;");
    expect(projectsSource).toContain("flex: 0 0 140px;");
    expect(projectsSource).toContain("min-height: 40px;");
    expect(projectsSource).toContain("border-radius: 8px;");
    expect(projectsSource).toContain("min-height: 48px;");
    expect(projectsSource).toContain("min-height: 64px;");
    expect(projectsSource).toContain("width: 360px;");
    expect(projectsSource).toContain("grid-template-rows: auto auto 1fr;");
    expect(projectsSource).toContain("align-self: end;");
    expect(projectsSource).not.toMatch(
      /@media \(max-width: 960px\)\s*{\s*\.projects-table-toolbar,\s*\.projects-header\s*{\s*align-items: stretch;\s*flex-direction: column;/,
    );
    expect(projectsSource).not.toMatch(
      /\.projects-header-actions\s*{\s*flex-direction: column;\s*align-items: stretch;/,
    );
    expect(projectsSource).toContain("justify-self: center;");
    expect(projectsSource).toContain("text-align: center;");
    expect(projectsSource).toContain("@media (max-width: 1279px)");
    expect(projectsSource).toContain("width: min(100%, 960px);");
    expect(projectsSource).toContain("@media (max-width: 819px)");
    expect(projectsSource).toContain("grid-template-columns: minmax(0, 280px) 140px;");
    expect(projectsSource).toContain("justify-content: center;");
    expect(projectsSource).toContain("@media (max-width: 479px)");
    expect(projectsSource).toContain("grid-template-columns: 1fr;");
    expect(projectsSource).toContain("width: 140px;");
    expect(projectsSource).toContain(".projects-page {");
    expect(projectsSource).toContain("justify-items: center;");
    expect(projectsSource).toContain("margin: 0 auto;");
  });
});

describe("topic workspace rounds", () => {
  it("renders the current round separately from candidate history and allows confirming from history", async () => {
    const router = createAppRouter();
    await router.push("/projects/project-1/topic");
    await router.isReady();

    const projectStore = createProjectStoreStub();
    projectStore.syncProject({
      project_id: "project-1",
      current_status: "topic_candidates_ready",
    });

    const calls = {
      confirm: [] as Array<{ roundId: string; candidateId: string }>,
    };

    const topicState = reactive({
        activeTab: "system",
        candidates: [],
        currentRound: {
          round_id: "round-2",
          label: "第 2 轮",
          candidates: [
            {
              candidate_id: "candidate-current",
              title: "当前轮主题",
              one_line_angle: "当前轮角度",
              family_label: "family",
              scope_label: "scope",
              strong_scene: "当前轮场景",
              risk_hints: [],
            },
          ],
        },
        historyRounds: [
          {
            round_id: "round-1",
            label: "第 1 轮",
            candidates: [
              {
                candidate_id: "candidate-history",
                title: "历史轮主题",
                one_line_angle: "历史轮角度",
                family_label: "family",
                scope_label: "scope",
                strong_scene: "历史轮场景",
                risk_hints: [],
              },
            ],
          },
        ],
        selectedCandidate: null as null | {
          candidate_id: string;
          title: string;
          one_line_angle: string;
          family_label: string;
          scope_label: string;
          strong_scene: string;
          risk_hints: string[];
        },
        selectedRoundId: null as string | null,
        isGenerating: false,
        isConfirming: false,
        confirmedTopicPackageId: null,
      });
    const topicStore = {
      state: topicState,
      selectTab() {},
      async generateSystemRecommendations() {},
      openCandidate(candidate: { candidate_id: string }, roundId = "round-2") {
        topicState.selectedCandidate = candidate;
        topicState.selectedRoundId = roundId;
      },
      closeCandidate() {
        topicState.selectedCandidate = null;
        topicState.selectedRoundId = null;
      },
      async confirmSelectedCandidate() {
        if (!topicState.selectedCandidate || !topicState.selectedRoundId) {
          return;
        }

        calls.confirm.push({
          roundId: topicState.selectedRoundId,
          candidateId: topicState.selectedCandidate.candidate_id,
        });
      },
    };

    const wrapper = mount(TopicPage, {
      global: {
        plugins: [router],
        provide: {
          [projectStoreKey as symbol]: projectStore as never,
          [topicStoreKey as symbol]: topicStore as never,
        },
      },
    });

    const mainSource = readFileSync("frontend/src/main.ts", "utf8");
    const topicSource = readFileSync("frontend/src/views/TopicPage.vue", "utf8");
    const topicTabsSource = readFileSync("frontend/src/components/topic/TopicTabs.vue", "utf8");
    const candidateListSource = readFileSync(
      "frontend/src/components/topic/TopicCandidateList.vue",
      "utf8",
    );
    const topicDrawerSource = readFileSync(
      "frontend/src/components/topic/TopicCandidateDrawer.vue",
      "utf8",
    );

    expect(mainSource).toContain('import "./styles/main.css";');
    expect(wrapper.classes()).toContain("workspace-shell");
    expect(wrapper.classes()).toContain("workspace-shell--topic");
    expect(wrapper.find("[data-testid='topic-page-header']").exists()).toBe(false);
    expect(wrapper.get("[data-testid='topic-workspace']").exists()).toBe(true);
    expect(wrapper.get("[data-testid='topic-pipeline-tabs']").text()).toContain("① 选题");
    expect(wrapper.get("[data-testid='topic-pipeline-tabs']").text()).toContain("② 文案");
    expect(wrapper.get("[data-testid='topic-pipeline-tabs']").text()).toContain("↔");
    expect(wrapper.get("[data-testid='topic-entry-tabs']").text()).toContain("系统自动推荐");
    expect(wrapper.get("[data-testid='topic-entry-tabs']").text()).toContain("事件库");
    expect(wrapper.get("[data-testid='topic-entry-tabs']").text()).toContain("自定义主题");
    expect(wrapper.get("[data-testid='topic-toolbar']").text()).toContain("历史时期");
    expect(wrapper.get("[data-testid='topic-toolbar']").text()).toContain("叙事张力");
    expect(wrapper.get("[data-testid='system-generate']").text()).toContain("开始生成选题");
    expect(wrapper.get("[data-testid='system-generate']").classes()).toContain("btn-primary");
    expect(wrapper.get("[data-testid='topic-results-shell']").text()).toContain("当前轮主题");
    expect(wrapper.get("[data-testid='topic-history-shell']").text()).toContain("历史轮主题");
    expect(topicSource).toContain("width: min(100%, 1000px);");
    expect(topicSource).toContain("grid-template-columns: minmax(0, 1fr) auto;");
    expect(topicSource).toContain("justify-self: end;");
    expect(topicSource).toContain("background: transparent;");
    expect(topicSource).toContain("position: relative;");
    expect(topicTabsSource).toContain("topic-pipeline-tabs");
    expect(topicTabsSource).toContain("topic-entry-tabs");
    expect(topicTabsSource).toContain("① 选题");
    expect(topicTabsSource).toContain("↔");
    expect(topicTabsSource).toContain("background: linear-gradient(135deg, #c0392b, #96281b);");
    expect(topicTabsSource).toContain("border-bottom: 2px solid rgba(212, 163, 95, 0.18);");
    expect(topicTabsSource).toContain("topic-entry-tab--active");
    expect(topicTabsSource).toContain("border-bottom-color: var(--workspace-accent);");
    expect(candidateListSource).toContain("grid-template-columns: minmax(0, 1fr) auto;");
    expect(candidateListSource).toContain("align-items: center;");
    expect(candidateListSource).toContain("min-height: 96px;");
    expect(candidateListSource).toContain("padding: 1.125rem 1.25rem;");
    expect(topicDrawerSource).toContain("position: fixed;");
    expect(topicDrawerSource).toContain("right: 0;");
    expect(topicDrawerSource).toContain("确认主题，生成文案");

    await wrapper.get("[data-testid='candidate-item-candidate-history']").trigger("click");
    await wrapper.get("[data-testid='confirm-candidate']").trigger("click");

    expect(calls.confirm).toEqual([
      {
        roundId: "round-1",
        candidateId: "candidate-history",
      },
    ]);
  });

  it("renders an empty history section when no previous rounds exist", async () => {
    const router = createAppRouter();
    await router.push("/projects/project-1/topic");
    await router.isReady();

    const projectStore = createProjectStoreStub();
    projectStore.syncProject({
      project_id: "project-1",
      current_status: "topic_candidates_ready",
    });

    const topicState = reactive({
      activeTab: "system",
      candidates: [],
      currentRound: {
        round_id: "round-1",
        label: "第 1 轮",
        candidates: [
          {
            candidate_id: "candidate-current",
            title: "当前轮主题",
            one_line_angle: "当前轮角度",
            family_label: "family",
            scope_label: "scope",
            strong_scene: "当前轮场景",
            risk_hints: [],
          },
        ],
      },
      historyRounds: [],
      selectedCandidate: null,
      selectedRoundId: null,
      isGenerating: false,
      isConfirming: false,
      confirmedTopicPackageId: null,
    });
    const topicStore = {
      state: topicState,
      selectTab() {},
      async generateSystemRecommendations() {},
      openCandidate() {},
      closeCandidate() {},
      async confirmSelectedCandidate() {},
    };

    const wrapper = mount(TopicPage, {
      global: {
        plugins: [router],
        provide: {
          [projectStoreKey as symbol]: projectStore as never,
          [topicStoreKey as symbol]: topicStore as never,
        },
      },
    });

    expect(wrapper.get("[data-testid='topic-history-shell']").text()).toContain("候选历史");
    expect(wrapper.get("[data-testid='topic-history-shell']").text()).toContain("暂无历史轮次");
    expect(wrapper.find("[data-testid='topic-history-empty']").exists()).toBe(true);
  });
});
