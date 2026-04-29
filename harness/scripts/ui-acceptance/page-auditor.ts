import type { Page } from "@playwright/test";

import { uiAcceptanceDynamicSelectors, uiAcceptanceSelectors } from "./dom-selectors";
import {
  auditUiAcceptancePageSnapshots,
  type UiAcceptancePageRuleResult,
  type UiAcceptancePageSnapshot,
} from "./page-rules";

export type UiAcceptanceAuditPageId = UiAcceptancePageSnapshot["pageId"];

interface UiAcceptanceAuditPageDefinition {
  pageId: UiAcceptanceAuditPageId;
  selectors: Record<string, string>;
  viewportSelectors?: string[];
  countSelectors?: Record<string, string>;
  textLengthSelectors?: Record<string, string>;
}

const uiAcceptanceAuditDefinitions: Record<
  UiAcceptanceAuditPageId,
  UiAcceptanceAuditPageDefinition
> = {
  home: {
    pageId: "home",
    selectors: {
      homeHeading: "[data-testid='home-heading']",
      homeSummary: ".home-summary",
      homeTagline: "[data-testid='home-tagline']",
      homePrimaryCta: uiAcceptanceSelectors.homePrimaryCta,
      homeHero: "[data-testid='home-hero']",
      homeFeatureRail: "[data-testid='home-feature-rail']",
      homeFlowStrip: "[data-testid='home-flow-strip']",
    },
    viewportSelectors: ["homeHeading", "homePrimaryCta"],
  },
  projects: {
    pageId: "projects",
    selectors: {
      projectsHeading: "[data-testid='projects-heading']",
      projectsContentColumn: "[data-testid='projects-content-column']",
      projectsHeaderActions: "[data-testid='projects-header-actions']",
      projectsToolbar: "[data-testid='projects-table-toolbar']",
      projectsTableShell: "[data-testid='projects-table-shell']",
      projectsDraftButton: "[data-testid='projects-draft-button']",
      projectsEmptyState: "[data-testid='projects-empty-state']",
    },
    countSelectors: {
      projectCards: "[data-testid^='project-row-']",
    },
  },
  topic: {
    pageId: "topic",
    selectors: {
      topicPipelineTabs: "[data-testid='topic-pipeline-tabs']",
      topicEntryTabs: "[data-testid='topic-entry-tabs']",
      topicToolbar: "[data-testid='topic-toolbar']",
      topicResults: "[data-testid='topic-results-shell']",
      currentTopicRound: "[data-testid='current-topic-round']",
      candidateDrawer: uiAcceptanceSelectors.candidateDrawer,
      generateTopic: "[data-testid='system-generate']",
    },
    countSelectors: {
      candidateItems: uiAcceptanceDynamicSelectors.firstCandidateItem,
    },
  },
  script: {
    pageId: "script",
    selectors: {
      scriptPageHeader: "[data-testid='script-page-header']",
      scriptActionPanel: "[data-testid='script-action-panel']",
      scriptMainPanel: "[data-testid='script-main-panel']",
      regenOnce: "[data-testid='regen-once']",
      scriptTraceEntry: uiAcceptanceSelectors.scriptTraceEntry,
      scriptText: uiAcceptanceSelectors.scriptText,
      scriptRunningState: "[data-testid='script-running-state']",
    },
    textLengthSelectors: {
      scriptTextLength: uiAcceptanceSelectors.scriptText,
    },
  },
};

async function isSelectorVisible(page: Page, selector: string) {
  const locator = page.locator(selector).first();
  if ((await locator.count()) === 0) {
    return false;
  }

  return locator.isVisible();
}

async function isSelectorInViewport(page: Page, selector: string) {
  const locator = page.locator(selector).first();
  if ((await locator.count()) === 0 || !(await locator.isVisible())) {
    return false;
  }

  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) {
    return false;
  }

  return (
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= viewport.width &&
    box.y + box.height <= viewport.height
  );
}

async function readSelectorTextLength(page: Page, selector: string) {
  const locator = page.locator(selector).first();
  if ((await locator.count()) === 0 || !(await locator.isVisible())) {
    return 0;
  }

  const text = await locator.innerText();
  return text.trim().length;
}

export async function captureUiAcceptancePageSnapshot(
  page: Page,
  pageId: UiAcceptanceAuditPageId,
): Promise<UiAcceptancePageSnapshot> {
  const definition = uiAcceptanceAuditDefinitions[pageId];
  const visibleSelectors: string[] = [];
  const inViewportSelectors: string[] = [];
  const counts: Record<string, number> = {};

  for (const [key, selector] of Object.entries(definition.selectors)) {
    if (await isSelectorVisible(page, selector)) {
      visibleSelectors.push(key);
    }
  }

  for (const key of definition.viewportSelectors ?? []) {
    const selector = definition.selectors[key];
    if (selector && (await isSelectorInViewport(page, selector))) {
      inViewportSelectors.push(key);
    }
  }

  for (const [key, selector] of Object.entries(definition.countSelectors ?? {})) {
    counts[key] = await page.locator(selector).count();
  }

  for (const [key, selector] of Object.entries(definition.textLengthSelectors ?? {})) {
    counts[key] = await readSelectorTextLength(page, selector);
  }

  const bodyText = await page.locator("body").innerText();
  return {
    pageId,
    bodyText,
    visibleSelectors,
    inViewportSelectors,
    counts,
  };
}

export function auditUiAcceptancePages(
  snapshots: UiAcceptancePageSnapshot[],
): UiAcceptancePageRuleResult {
  return auditUiAcceptancePageSnapshots(snapshots);
}
