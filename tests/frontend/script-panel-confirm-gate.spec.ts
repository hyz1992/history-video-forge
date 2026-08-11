// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { reactive } from "vue";
import { describe, expect, it, vi } from "vitest";

import ScriptPanel from "../../frontend/src/components/script/ScriptPanel.vue";
import { createAppRouter } from "../../frontend/src/router/index.js";
import { projectStoreKey } from "../../frontend/src/stores/project";
import { scriptStoreKey } from "../../frontend/src/stores/script";
import { workspaceStoreKey } from "../../frontend/src/stores/workspace";

function pendingPromise() {
  return new Promise<void>(() => {});
}

function createProjectStoreStub() {
  const state = reactive({
    projectId: "project-script-gate",
    currentStatus: "script_ready",
    projects: [],
  });

  return {
    state,
    syncProject(snapshot: { project_id: string; current_status: string }) {
      state.projectId = snapshot.project_id;
      state.currentStatus = snapshot.current_status;
    },
    async loadProject() {},
    async loadProjects() {
      return [];
    },
    async createProject() {
      return null;
    },
    resolveProjectWorkspacePath() {
      return `/projects/${state.projectId}/script`;
    },
  };
}

function createWorkspaceStoreStub() {
  const state = reactive({ currentStep: 0 });
  return {
    state,
    setCurrentStep: vi.fn((step: number) => {
      state.currentStep = step;
    }),
  };
}

describe("script panel confirm gate", () => {
  it("disables confirmation and shows hard_fail tag + local cause when local validation hard-fails and semantic review is skipped", async () => {
    const router = createAppRouter();
    await router.push("/projects/project-script-gate/script");
    await router.isReady();
    const workspaceStore = createWorkspaceStoreStub();

    const wrapper = mount(ScriptPanel, {
      global: {
        plugins: [router, ElementPlus],
        provide: {
          [projectStoreKey as symbol]: createProjectStoreStub() as never,
          [workspaceStoreKey as symbol]: workspaceStore as never,
          [scriptStoreKey as symbol]: {
            state: reactive({
              snapshot: {
                project_id: "project-script-gate",
                current_status: "script_ready",
                active_script: {
                  script_record_id: "script-hard-fail",
                  script_text: "too short",
                  opening_span: "too",
                  ending_span: "short",
                  estimated_duration_sec: 45,
                  review_decision: "skipped",
                  patch_intent: null,
                  local_validation: {
                    stage: "script_local_validation",
                    decision: "hard_fail",
                    errors: ["duration_extreme"],
                    warnings: [],
                    metrics: {
                      script_char_count: 40,
                      min_script_chars_for_band: 180,
                    },
                  },
                  semantic_review: {
                    stage: "script_semantic_review",
                    decision: "skipped",
                    patch_intent: null,
                    summary: "稿件存在不可恢复的结构问题（如必填字段缺失或时长极端），已停止自动推进，未进入语义审校。",
                    soft_issues: [],
                  },
                  execution_state: {
                    patch_used: false,
                    regenerate_used: false,
                  },
                  created_at: "2026-07-19T00:00:00.000Z",
                },
              },
              history: [],
              selectedHistoryEntryId: null,
              isLoading: false,
              isRunningAction: false,
              loadError: null,
            }),
            async loadActiveScriptSnapshot() {},
            async retryLoadActiveScriptSnapshot() {},
            generateInitialScript: pendingPromise,
            selectHistoryEntry() {},
            runPatchOnce: pendingPromise,
            runRegenOnce: pendingPromise,
          } as never,
        },
      },
    });

    const confirmButton = wrapper.get(".script-confirm-btn");
    expect(confirmButton.attributes("disabled")).toBe("");

    const tags = wrapper.findAll(".script-review-heading .el-tag");
    const tagTexts = tags.map((t) => t.text());
    expect(tagTexts).toContain("需修改");
    expect(tagTexts).not.toContain("建议重生成");

    const issueTexts = wrapper.findAll(".script-review-issue").map((n) => n.text());
    const joined = issueTexts.join("\n");
    expect(joined).toContain("时长偏差过大");
    expect(joined).toContain("正文 40 字");
    expect(joined).toContain("篇幅下限 180");

    await confirmButton.trigger("click");
    expect(workspaceStore.setCurrentStep).not.toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe("/projects/project-script-gate/script");
    wrapper.unmount();
  });

  it("shows the regen escape button when local validation soft-fails after auto regen", async () => {
    const router = createAppRouter();
    await router.push("/projects/project-script-gate/script");
    await router.isReady();
    const workspaceStore = createWorkspaceStoreStub();

    const wrapper = mount(ScriptPanel, {
      global: {
        plugins: [router, ElementPlus],
        provide: {
          [projectStoreKey as symbol]: createProjectStoreStub() as never,
          [workspaceStoreKey as symbol]: workspaceStore as never,
          [scriptStoreKey as symbol]: {
            state: reactive({
              snapshot: {
                project_id: "project-script-gate",
                current_status: "script_ready",
                active_script: {
                  script_record_id: "script-regen-once",
                  script_text: "still too short after auto regen",
                  opening_span: "still",
                  ending_span: "short",
                  estimated_duration_sec: 45,
                  review_decision: "skipped",
                  patch_intent: null,
                  local_validation: {
                    stage: "script_local_validation",
                    decision: "regen_once",
                    errors: ["script_body_too_thin"],
                    warnings: [],
                    metrics: {
                      script_char_count: 232,
                      script_sentence_count: 5,
                      min_script_chars_for_band: 320,
                      min_sentence_count_for_band: 8,
                    },
                  },
                  semantic_review: {
                    stage: "script_semantic_review",
                    decision: "skipped",
                    patch_intent: null,
                    summary: "已自动重新生成一次，仍未达到本地结构下限，未进入语义审校。",
                    soft_issues: [],
                  },
                  execution_state: {
                    patch_used: false,
                    regenerate_used: true,
                  },
                  created_at: "2026-07-19T00:00:00.000Z",
                },
              },
              history: [],
              selectedHistoryEntryId: null,
              isLoading: false,
              isRunningAction: false,
              loadError: null,
            }),
            async loadActiveScriptSnapshot() {},
            async retryLoadActiveScriptSnapshot() {},
            generateInitialScript: pendingPromise,
            selectHistoryEntry() {},
            runPatchOnce: pendingPromise,
            runRegenOnce: pendingPromise,
          } as never,
        },
      },
    });

    const confirmButton = wrapper.get(".script-confirm-btn");
    expect(confirmButton.attributes("disabled")).toBe("");

    const tags = wrapper.findAll(".script-review-heading .el-tag");
    const tagTexts = tags.map((t) => t.text());
    expect(tagTexts).toContain("建议重生成");
    expect(tagTexts).not.toContain("需修改");

    const issueTexts = wrapper.findAll(".script-review-issue").map((n) => n.text());
    const joined = issueTexts.join("\n");
    expect(joined).toContain("篇幅偏薄");
    expect(joined).toContain("正文 232 字");
    expect(joined).toContain("篇幅下限 320");
    expect(joined).toContain("句子 5");
    expect(joined).toContain("下限 8");

    const regenButton = wrapper.find(".script-regen-btn");
    expect(regenButton.exists()).toBe(true);
    expect(regenButton.attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });
});
