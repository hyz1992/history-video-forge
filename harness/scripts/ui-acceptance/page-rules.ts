import {
  summarizeUiAcceptanceChecks,
  type UiAcceptanceCheck,
  type UiAcceptanceCheckTotals,
  type UiAcceptanceStatus,
} from "./report-model";

export interface UiAcceptancePageSnapshot {
  pageId: "home" | "projects" | "topic" | "script";
  bodyText: string;
  visibleSelectors: string[];
  inViewportSelectors: string[];
  counts: Record<string, number>;
}

export interface UiAcceptancePageRuleResult {
  structureChecks: UiAcceptanceCheck[];
  deliveryChecks: UiAcceptanceCheck[];
  status: UiAcceptanceStatus;
  totals: UiAcceptanceCheckTotals;
}

const DEV_SHELL_COPY_PATTERN = /\b(todo|debug|placeholder)\b/i;
const SCRIPT_LOADING_PATTERN = /正在生成文案|暂无 active script snapshot|加载失败/i;
const HOME_GENERIC_FILLER_PATTERN = /\bworkspace\b/i;

function hasVisibleSelector(snapshot: UiAcceptancePageSnapshot, selectorKey: string) {
  return snapshot.visibleSelectors.includes(selectorKey);
}

function hasInViewportSelector(snapshot: UiAcceptancePageSnapshot, selectorKey: string) {
  return snapshot.inViewportSelectors.includes(selectorKey);
}

function createCheck(
  code: string,
  status: UiAcceptanceStatus,
  message: string,
): UiAcceptanceCheck {
  return {
    code,
    status,
    message,
  };
}

function createPresenceCheck(
  snapshot: UiAcceptancePageSnapshot,
  selectorKey: string,
  code: string,
  message: string,
) {
  return createCheck(
    code,
    hasVisibleSelector(snapshot, selectorKey) ? "PASS" : "FAIL",
    message,
  );
}

function createViewportCheck(
  snapshot: UiAcceptancePageSnapshot,
  selectorKey: string,
  code: string,
  message: string,
) {
  return createCheck(
    code,
    hasInViewportSelector(snapshot, selectorKey) ? "PASS" : "FAIL",
    message,
  );
}

function auditHomePage(snapshot: UiAcceptancePageSnapshot) {
  return {
    structureChecks: [
      createPresenceCheck(snapshot, "homeHeading", "home-main-heading", "首页主标题必须可见"),
      createPresenceCheck(snapshot, "homeSummary", "home-main-summary", "首页主说明必须可见"),
      createPresenceCheck(snapshot, "homeTagline", "home-tagline", "首页副标题必须可见"),
      createPresenceCheck(snapshot, "homePrimaryCta", "home-primary-cta", "首页主 CTA 必须可见"),
      createPresenceCheck(snapshot, "homeHero", "home-hero-shell", "首页必须存在 hero 主舞台"),
      createPresenceCheck(
        snapshot,
        "homeFeatureRail",
        "home-feature-rail",
        "首页必须存在旧项目风格的 feature rail",
      ),
      createPresenceCheck(
        snapshot,
        "homeFlowStrip",
        "home-flow-strip",
        "首页必须存在产品主链路流程带",
      ),
    ],
    deliveryChecks: [
      createViewportCheck(
        snapshot,
        "homeHeading",
        "home-heading-in-viewport",
        "首页主标题必须在首屏可见",
      ),
      createViewportCheck(
        snapshot,
        "homePrimaryCta",
        "home-primary-cta-in-viewport",
        "首页主 CTA 必须在可视区域内",
      ),
      createCheck(
        "home-generic-filler-copy",
        HOME_GENERIC_FILLER_PATTERN.test(snapshot.bodyText) ? "FAIL" : "PASS",
        "首页不能出现 WORKSPACE 这类无意义泛化标签",
      ),
    ],
  };
}

function auditProjectsPage(snapshot: UiAcceptancePageSnapshot) {
  return {
    structureChecks: [
      createPresenceCheck(
        snapshot,
        "projectsHeading",
        "projects-main-heading",
        "项目页主标题必须可见",
      ),
      createPresenceCheck(
        snapshot,
        "formalProjects",
        "projects-formal-section",
        "项目页必须展示正式项目区",
      ),
      createPresenceCheck(
        snapshot,
        "draftProjects",
        "projects-draft-section",
        "项目页必须展示草稿项目区",
      ),
    ],
    deliveryChecks: [],
  };
}

function auditTopicPage(snapshot: UiAcceptancePageSnapshot) {
  return {
    structureChecks: [
      createPresenceCheck(
        snapshot,
        "topicPageHeader",
        "topic-workspace-heading",
        "topic 工作区标题必须可见",
      ),
      createPresenceCheck(
        snapshot,
        "currentTopicRound",
        "topic-current-round-section",
        "topic 工作区必须展示当前轮候选区",
      ),
      createPresenceCheck(
        snapshot,
        "topicHistory",
        "topic-history-section",
        "topic 工作区必须展示候选历史区",
      ),
      createPresenceCheck(
        snapshot,
        "confirmCandidate",
        "topic-confirm-entry",
        "topic 工作区必须存在确认主题入口",
      ),
    ],
    deliveryChecks: [
      createCheck(
        "topic-candidate-count",
        (snapshot.counts.candidateItems ?? 0) > 0 ? "PASS" : "FAIL",
        "topic 候选卡片数量必须大于 0",
      ),
    ],
  };
}

function auditScriptPage(snapshot: UiAcceptancePageSnapshot) {
  const scriptTextLength = snapshot.counts.scriptTextLength ?? 0;
  const hasRealContent =
    scriptTextLength > 0 &&
    !SCRIPT_LOADING_PATTERN.test(snapshot.bodyText) &&
    hasVisibleSelector(snapshot, "scriptText");

  return {
    structureChecks: [
      createPresenceCheck(
        snapshot,
        "scriptPageHeader",
        "script-workspace-heading",
        "script 工作区标题必须可见",
      ),
      createPresenceCheck(
        snapshot,
        "scriptActionPanel",
        "script-action-panel",
        "script 工作区必须展示动作区",
      ),
      createPresenceCheck(
        snapshot,
        "scriptMainPanel",
        "script-main-panel",
        "script 工作区必须展示当前文案区",
      ),
      createPresenceCheck(
        snapshot,
        "regenOnce",
        "script-regen-once-entry",
        "script 工作区必须存在 regen_once 入口",
      ),
      createPresenceCheck(
        snapshot,
        "scriptTraceEntry",
        "script-trace-entry",
        "script 工作区必须存在 trace / 运行摘要入口",
      ),
    ],
    deliveryChecks: [
      createCheck(
        "script-real-content",
        hasRealContent ? "PASS" : "FAIL",
        "script 页面必须展示真实生成内容，而不是只有 loading 或空白区",
      ),
    ],
  };
}

function auditGlobalDelivery(snapshot: UiAcceptancePageSnapshot) {
  return [
    createCheck(
      `${snapshot.pageId}-non-empty-body`,
      snapshot.bodyText.trim().length > 0 ? "PASS" : "FAIL",
      "页面关键内容区不能是空白",
    ),
    createCheck(
      `${snapshot.pageId}-dev-shell-copy`,
      DEV_SHELL_COPY_PATTERN.test(snapshot.bodyText) ? "FAIL" : "PASS",
      "页面不能暴露 TODO / debug / placeholder 等开发壳文案",
    ),
  ];
}

export function auditUiAcceptancePageSnapshots(
  snapshots: UiAcceptancePageSnapshot[],
): UiAcceptancePageRuleResult {
  const structureChecks: UiAcceptanceCheck[] = [];
  const deliveryChecks: UiAcceptanceCheck[] = [];

  for (const snapshot of snapshots) {
    if (snapshot.pageId === "home") {
      const result = auditHomePage(snapshot);
      structureChecks.push(...result.structureChecks);
      deliveryChecks.push(...result.deliveryChecks);
    } else if (snapshot.pageId === "projects") {
      const result = auditProjectsPage(snapshot);
      structureChecks.push(...result.structureChecks);
      deliveryChecks.push(...result.deliveryChecks);
    } else if (snapshot.pageId === "topic") {
      const result = auditTopicPage(snapshot);
      structureChecks.push(...result.structureChecks);
      deliveryChecks.push(...result.deliveryChecks);
    } else if (snapshot.pageId === "script") {
      const result = auditScriptPage(snapshot);
      structureChecks.push(...result.structureChecks);
      deliveryChecks.push(...result.deliveryChecks);
    }

    deliveryChecks.push(...auditGlobalDelivery(snapshot));
  }

  const summary = summarizeUiAcceptanceChecks([...structureChecks, ...deliveryChecks]);
  return {
    structureChecks,
    deliveryChecks,
    status: summary.status,
    totals: summary.totals,
  };
}
