import { describe, expect, it } from "vitest";

import {
  auditUiAcceptancePageSnapshots,
  type UiAcceptancePageSnapshot,
} from "../../harness/scripts/ui-acceptance/page-rules";

describe("ui acceptance page rules", () => {
  it("passes the required home, projects, topic, and script structure rules", () => {
    const result = auditUiAcceptancePageSnapshots([
      createSnapshot("home", {
        visibleSelectors: [
          "homeHeading",
          "homeSummary",
          "homeTagline",
          "homePrimaryCta",
          "homeHero",
          "homeFeatureRail",
          "homeFlowStrip",
        ],
        inViewportSelectors: ["homeHeading", "homePrimaryCta"],
        bodyText:
          "Story Video Forge 历史叙事短视频工作台 进入我的项目 新建项目 选题生成 文案生成 多轮确认 当前阶段聚焦 Topic 与 Script",
      }),
      createSnapshot("projects", {
        visibleSelectors: [
          "projectsHeading",
          "projectsContentColumn",
          "projectsHeaderActions",
          "projectsToolbar",
          "projectsTableShell",
          "projectsDraftButton",
        ],
        counts: {
          projectCards: 2,
        },
        bodyText: "我的项目 新建项目 草稿箱 搜索项目 阶段 标题 生成时间 打开 删除",
      }),
      createSnapshot("topic", {
        visibleSelectors: [
          "topicPipelineTabs",
          "topicEntryTabs",
          "topicToolbar",
          "topicResults",
          "currentTopicRound",
          "candidateDrawer",
          "generateTopic",
        ],
        counts: {
          candidateItems: 3,
        },
        bodyText: "选题 文案 分镜 素材 合成 系统自动推荐 事件库 自定义主题 历史时期 叙事张力 开始生成选题",
      }),
      createSnapshot("script", {
        visibleSelectors: [
          "scriptPageHeader",
          "scriptActionPanel",
          "scriptMainPanel",
          "regenOnce",
          "scriptTraceEntry",
          "scriptText",
        ],
        counts: {
          scriptTextLength: 128,
        },
        bodyText: "文案工作区 可执行动作 触发 regen_once 查看运行详情 当前文案",
      }),
    ]);

    expect(result.status).toBe("PASS");
    expect(result.structureChecks.every((check) => check.status === "PASS")).toBe(true);
    expect(result.deliveryChecks.every((check) => check.status === "PASS")).toBe(true);
    expect(result.deliveryChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "topic-recommendation-diagnostics",
          status: "PASS",
        }),
      ]),
    );
  });

  it("fails when the home page shell hooks are missing or the primary entry falls outside the first viewport", () => {
    const result = auditUiAcceptancePageSnapshots([
      createSnapshot("home", {
        visibleSelectors: ["homeHeading", "homeSummary", "homePrimaryCta"],
        inViewportSelectors: [],
        bodyText: "Story Video Forge 进入我的项目",
      }),
    ]);

    expect(result.status).toBe("FAIL");
    expect(result.deliveryChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "home-heading-in-viewport",
          status: "FAIL",
        }),
        expect.objectContaining({
          code: "home-primary-cta-in-viewport",
          status: "FAIL",
        }),
      ]),
    );
    expect(result.structureChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "home-hero-shell",
          status: "FAIL",
        }),
        expect.objectContaining({
          code: "home-tagline",
          status: "FAIL",
        }),
        expect.objectContaining({
          code: "home-feature-rail",
          status: "FAIL",
        }),
        expect.objectContaining({
          code: "home-flow-strip",
          status: "FAIL",
        }),
      ]),
    );
  });

  it("fails when generic filler copy leaks into the home page", () => {
    const result = auditUiAcceptancePageSnapshots([
      createSnapshot("home", {
        visibleSelectors: [
          "homeHeading",
          "homeSummary",
          "homePrimaryCta",
          "homeHero",
          "homeCapabilitySection",
          "homeFlowStrip",
        ],
        inViewportSelectors: ["homeHeading", "homePrimaryCta"],
        bodyText: "Story Video Forge WORKSPACE 正式工作区能力 进入我的项目",
      }),
    ]);

    expect(result.status).toBe("FAIL");
    expect(result.deliveryChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "home-generic-filler-copy",
          status: "FAIL",
        }),
      ]),
    );
  });

  it("fails when the projects page loses its bounded content column or project table", () => {
    const result = auditUiAcceptancePageSnapshots([
      createSnapshot("projects", {
        visibleSelectors: ["projectsHeading"],
        counts: {
          projectCards: 0,
        },
        bodyText: "我的项目",
      }),
    ]);

    expect(result.status).toBe("FAIL");
    expect(result.structureChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "projects-content-column",
          status: "FAIL",
        }),
        expect.objectContaining({
          code: "projects-header-actions",
          status: "FAIL",
        }),
        expect.objectContaining({
          code: "projects-toolbar-shell",
          status: "FAIL",
        }),
        expect.objectContaining({
          code: "projects-table-shell",
          status: "FAIL",
        }),
        expect.objectContaining({
          code: "projects-draft-entry",
          status: "FAIL",
        }),
      ]),
    );
    expect(result.deliveryChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "projects-project-card-count",
          status: "FAIL",
        }),
      ]),
    );
  });

  it("fails when topic candidates are missing or confirm entry is not reachable", () => {
    const result = auditUiAcceptancePageSnapshots([
      createSnapshot("topic", {
        visibleSelectors: ["topicPipelineTabs", "topicToolbar"],
        counts: {
          candidateItems: 0,
        },
        bodyText: "选题 历史时期",
      }),
    ]);

    expect(result.status).toBe("FAIL");
    expect(result.structureChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "topic-entry-tabs",
          status: "FAIL",
        }),
        expect.objectContaining({
          code: "topic-results-shell",
          status: "FAIL",
        }),
        expect.objectContaining({
          code: "topic-generate-action",
          status: "FAIL",
        }),
      ]),
    );
    expect(result.deliveryChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "topic-candidate-count",
          status: "FAIL",
        }),
      ]),
    );
  });

  it("fails when a topic recommendation round does not leave an inspectable downstream trace hook", () => {
    const result = auditUiAcceptancePageSnapshots([
      createSnapshot("topic", {
        visibleSelectors: [
          "topicPipelineTabs",
          "topicEntryTabs",
          "topicToolbar",
          "topicResults",
          "currentTopicRound",
          "candidateDrawer",
          "generateTopic",
        ],
        counts: {
          candidateItems: 3,
        },
        bodyText: "选题 当前轮主题 系统自动推荐 候选详情 开始生成选题",
      }),
      createSnapshot("script", {
        visibleSelectors: [
          "scriptPageHeader",
          "scriptActionPanel",
          "scriptMainPanel",
          "regenOnce",
          "scriptText",
        ],
        counts: {
          scriptTextLength: 88,
        },
        bodyText: "文案工作区 可执行动作 当前文案",
      }),
    ]);

    expect(result.status).toBe("FAIL");
    expect(result.deliveryChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "topic-recommendation-diagnostics",
          status: "FAIL",
        }),
      ]),
    );
  });

  it("fails when the script page is only loading or lacks real generated content", () => {
    const result = auditUiAcceptancePageSnapshots([
      createSnapshot("script", {
        visibleSelectors: ["scriptPageHeader", "scriptRunningState"],
        counts: {
          scriptTextLength: 0,
        },
        bodyText: "文案工作区 正在生成文案，请稍候。",
      }),
    ]);

    expect(result.status).toBe("FAIL");
    expect(result.deliveryChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "script-real-content",
          status: "FAIL",
        }),
      ]),
    );
  });

  it("fails when developer shell copy leaks into the page", () => {
    const result = auditUiAcceptancePageSnapshots([
      createSnapshot("script", {
        visibleSelectors: [
          "scriptPageHeader",
          "scriptActionPanel",
          "scriptMainPanel",
          "regenOnce",
          "scriptTraceEntry",
          "scriptText",
        ],
        counts: {
          scriptTextLength: 42,
        },
        bodyText: "文案工作区 TODO debug placeholder 当前文案",
      }),
    ]);

    expect(result.status).toBe("FAIL");
    expect(result.deliveryChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "script-dev-shell-copy",
          status: "FAIL",
        }),
      ]),
    );
  });
});

function createSnapshot(
  pageId: UiAcceptancePageSnapshot["pageId"],
  input: Partial<UiAcceptancePageSnapshot>,
): UiAcceptancePageSnapshot {
  return {
    pageId,
    bodyText: input.bodyText ?? "",
    visibleSelectors: input.visibleSelectors ?? [],
    inViewportSelectors: input.inViewportSelectors ?? [],
    counts: input.counts ?? {},
  };
}
