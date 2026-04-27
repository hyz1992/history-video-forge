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
  const projectCards = snapshot.counts.projectCards ?? 0;
  const hasEmptyState = hasVisibleSelector(snapshot, "projectsEmptyState");

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
        "projectsContentColumn",
        "projects-content-column",
        "项目页必须使用居中的有界内容列",
      ),
      createPresenceCheck(
        snapshot,
        "projectsHeaderActions",
        "projects-header-actions",
        "项目页必须在标题区展示主次按钮组",
      ),
      createPresenceCheck(
        snapshot,
        "projectsToolbar",
        "projects-toolbar-shell",
        "项目页必须展示搜索与阶段筛选工具栏",
      ),
      createPresenceCheck(
        snapshot,
        "projectsTableShell",
        "projects-table-shell",
        "项目页必须展示项目表格主舞台",
      ),
      createPresenceCheck(
        snapshot,
        "projectsDraftButton",
        "projects-draft-entry",
        "项目页必须把草稿箱作为顶部次按钮入口展示",
      ),
    ],
    deliveryChecks: [
      createCheck(
        "projects-project-card-count",
        projectCards > 0 || hasEmptyState ? "PASS" : "FAIL",
        "项目页必须展示项目卡片，或在空列表场景下展示明确空态",
      ),
    ],
  };
}

function auditTopicPage(snapshot: UiAcceptancePageSnapshot) {
  return {
    structureChecks: [
      createPresenceCheck(
        snapshot,
        "topicPipelineTabs",
        "topic-pipeline-tabs",
        "topic 页面必须展示流水线阶段 tabs",
      ),
      createPresenceCheck(
        snapshot,
        "topicEntryTabs",
        "topic-entry-tabs",
        "topic 页面必须展示二级入口 tabs",
      ),
      createPresenceCheck(
        snapshot,
        "topicToolbar",
        "topic-toolbar",
        "topic 页面必须展示选题筛选工具栏",
      ),
      createPresenceCheck(
        snapshot,
        "topicResults",
        "topic-results-shell",
        "topic 页面必须展示候选结果区",
      ),
      createPresenceCheck(
        snapshot,
        "generateTopic",
        "topic-generate-action",
        "topic 页面必须存在开始生成选题入口",
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
