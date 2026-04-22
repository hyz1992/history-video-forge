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
          "homePrimaryCta",
          "homeHero",
          "homeCapabilitySection",
          "homeFlowStrip",
        ],
        inViewportSelectors: ["homeHeading", "homePrimaryCta"],
        bodyText:
          "Story Video Forge 进入我的项目 把选题和文案工作区收拢到项目内 新建项目 生成选题 确认主题 生成文案",
      }),
      createSnapshot("projects", {
        visibleSelectors: ["projectsHeading", "formalProjects", "draftProjects"],
        bodyText: "我的项目 正式项目 草稿项目 / 未完成项目",
      }),
      createSnapshot("topic", {
        visibleSelectors: [
          "topicPageHeader",
          "currentTopicRound",
          "topicHistory",
          "confirmCandidate",
        ],
        counts: {
          candidateItems: 3,
        },
        bodyText: "选题工作区 当前轮 候选历史 确认这个题",
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
          code: "home-capability-section",
          status: "FAIL",
        }),
        expect.objectContaining({
          code: "home-flow-strip",
          status: "FAIL",
        }),
      ]),
    );
  });

  it("fails when topic candidates are missing or confirm entry is not reachable", () => {
    const result = auditUiAcceptancePageSnapshots([
      createSnapshot("topic", {
        visibleSelectors: ["topicPageHeader", "currentTopicRound"],
        counts: {
          candidateItems: 0,
        },
        bodyText: "选题工作区 当前轮",
      }),
    ]);

    expect(result.status).toBe("FAIL");
    expect(result.structureChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "topic-history-section",
          status: "FAIL",
        }),
        expect.objectContaining({
          code: "topic-confirm-entry",
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
