import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { chromium, type ConsoleMessage, type Page, type Response } from "@playwright/test";

import { uiAcceptanceDynamicSelectors, uiAcceptanceSelectors } from "./dom-selectors";
import {
  captureUiAcceptancePageSnapshot,
  type UiAcceptanceAuditPageId,
} from "./page-auditor";
import type { UiAcceptancePageSnapshot } from "./page-rules";
import type { UiAcceptanceFullPlan } from "./ui-acceptance-full";
import type { UiAcceptanceSmokePlan } from "./ui-acceptance-smoke";

export type UiAcceptanceBrowserPlan = UiAcceptanceSmokePlan | UiAcceptanceFullPlan;

export interface RunUiAcceptanceBrowserInput {
  plan: UiAcceptanceBrowserPlan;
  outputDir: string;
  tracePath: string;
  consoleSummaryPath: string;
  networkSummaryPath: string;
  screenshotsDir: string;
}

export interface RunUiAcceptanceBrowserResult {
  finalUrl: string;
  projectId: string | null;
  screenshotPaths: Record<string, string>;
  pageSnapshots: UiAcceptancePageSnapshot[];
  consoleMessages: Array<{
    type: string;
    text: string;
  }>;
  networkErrors: Array<{
    url: string;
    status: number;
  }>;
}

function pushConsoleMessage(
  messages: RunUiAcceptanceBrowserResult["consoleMessages"],
  message: ConsoleMessage,
) {
  messages.push({
    type: message.type(),
    text: message.text(),
  });
}

function pushNetworkError(
  errors: RunUiAcceptanceBrowserResult["networkErrors"],
  response: Response,
) {
  if (response.status() < 400) {
    return;
  }

  errors.push({
    url: response.url(),
    status: response.status(),
  });
}

async function captureScreenshot(page: Page, screenshotsDir: string, name: string) {
  const outputPath = join(screenshotsDir, `${name}.png`);
  await page.screenshot({
    path: outputPath,
    fullPage: true,
  });
  return outputPath;
}

async function captureAuditSnapshot(
  page: Page,
  pageSnapshots: UiAcceptancePageSnapshot[],
  pageId: UiAcceptanceAuditPageId,
) {
  pageSnapshots.push(await captureUiAcceptancePageSnapshot(page, pageId));
}

async function isSelectorVisible(page: Page, selector: string) {
  const locator = page.locator(selector).first();
  if ((await locator.count()) === 0) {
    return false;
  }

  return locator.isVisible();
}

async function waitForScriptOutcome(page: Page, plan: UiAcceptanceSmokePlan) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < plan.scriptOutcomeTimeoutMs) {
    if (await isSelectorVisible(page, plan.scriptOutcomeSelectors.success)) {
      return;
    }

    if (await isSelectorVisible(page, plan.scriptOutcomeSelectors.failed)) {
      throw new Error("script_page_failed");
    }

    if (await isSelectorVisible(page, plan.scriptOutcomeSelectors.empty)) {
      throw new Error("script_page_empty");
    }

    await page.waitForTimeout(500);
  }

  throw new Error("script_page_timeout");
}

async function waitForHistoryEntryCount(page: Page, minimumCount: number, timeoutMs: number) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const count = await page.locator("[data-testid^='history-entry-']").count();
    if (count >= minimumCount) {
      return;
    }

    await page.waitForTimeout(500);
  }

  throw new Error("script_history_not_ready");
}

async function runSmokeMainline(
  page: Page,
  screenshotsDir: string,
  plan: UiAcceptanceBrowserPlan,
) {
  const screenshotPaths: Record<string, string> = {};
  const pageSnapshots: UiAcceptancePageSnapshot[] = [];

  await page.goto("/");
  await page.waitForSelector(uiAcceptanceSelectors.homePrimaryCta);
  await captureAuditSnapshot(page, pageSnapshots, "home");
  screenshotPaths.home = await captureScreenshot(page, screenshotsDir, "home");

  await page.click(uiAcceptanceSelectors.homePrimaryCta);
  await page.waitForURL("**/projects");
  await page.waitForSelector(uiAcceptanceSelectors.createProject);
  await captureAuditSnapshot(page, pageSnapshots, "projects");
  screenshotPaths.projects = await captureScreenshot(page, screenshotsDir, "projects");

  await page.click(uiAcceptanceSelectors.createProject);
  await page.waitForURL(/\/projects\/[^/]+\/topic$/);
  await page.waitForSelector(uiAcceptanceSelectors.generateTopic);

  await page.click(uiAcceptanceSelectors.generateTopic);
  await page.waitForSelector(uiAcceptanceDynamicSelectors.firstCandidateItem, {
    timeout: 60000,
  });
  await page.click(uiAcceptanceDynamicSelectors.firstCandidateItem);
  await page.waitForSelector(uiAcceptanceSelectors.candidateDrawer);
  await captureAuditSnapshot(page, pageSnapshots, "topic");
  screenshotPaths["topic-workspace"] = await captureScreenshot(
    page,
    screenshotsDir,
    "topic-workspace",
  );
  await page.click(uiAcceptanceSelectors.confirmCandidate);

  await page.waitForURL(/\/projects\/[^/]+\/script$/, {
    timeout: 60000,
  });
  await waitForScriptOutcome(page, plan);
  await page.waitForSelector(uiAcceptanceSelectors.scriptTraceEntry);
  await captureAuditSnapshot(page, pageSnapshots, "script");
  screenshotPaths["script-workspace"] = await captureScreenshot(
    page,
    screenshotsDir,
    "script-workspace",
  );

  return {
    screenshotPaths,
    pageSnapshots,
    finalUrl: page.url(),
  };
}

async function runFullMainline(
  page: Page,
  screenshotsDir: string,
  plan: UiAcceptanceBrowserPlan,
) {
  const screenshotPaths: Record<string, string> = {};
  const pageSnapshots: UiAcceptancePageSnapshot[] = [];

  await page.goto("/");
  await page.waitForSelector(uiAcceptanceSelectors.homePrimaryCta);
  await captureAuditSnapshot(page, pageSnapshots, "home");
  screenshotPaths.home = await captureScreenshot(page, screenshotsDir, "home");

  await page.click(uiAcceptanceSelectors.homePrimaryCta);
  await page.waitForURL("**/projects");
  await page.waitForSelector(uiAcceptanceSelectors.createProject);
  await captureAuditSnapshot(page, pageSnapshots, "projects");
  screenshotPaths.projects = await captureScreenshot(page, screenshotsDir, "projects");

  await page.click(uiAcceptanceSelectors.createProject);
  await page.waitForURL(/\/projects\/[^/]+\/topic$/);
  await page.waitForSelector(uiAcceptanceSelectors.generateTopic);

  await page.click(uiAcceptanceSelectors.generateTopic);
  await page.waitForSelector(uiAcceptanceDynamicSelectors.firstCandidateItem, {
    timeout: 60000,
  });
  await page.click(uiAcceptanceDynamicSelectors.firstCandidateItem);
  await page.waitForSelector(uiAcceptanceSelectors.candidateDrawer);
  await captureAuditSnapshot(page, pageSnapshots, "topic");
  screenshotPaths["topic-workspace-first"] = await captureScreenshot(
    page,
    screenshotsDir,
    "topic-workspace-first",
  );
  await page.click(uiAcceptanceSelectors.confirmCandidate);

  await page.waitForURL(/\/projects\/[^/]+\/script$/, {
    timeout: 60000,
  });
  await waitForScriptOutcome(page, plan);
  await page.waitForSelector(uiAcceptanceSelectors.scriptTraceEntry);
  await captureAuditSnapshot(page, pageSnapshots, "script");
  screenshotPaths["script-workspace-first"] = await captureScreenshot(
    page,
    screenshotsDir,
    "script-workspace-first",
  );

  const initialHistoryCount = await page.locator("[data-testid^='history-entry-']").count();
  await page.click("[data-testid='regen-once']");
  await waitForHistoryEntryCount(page, initialHistoryCount + 1, plan.scriptOutcomeTimeoutMs);
  await waitForScriptOutcome(page, plan);

  await page.click("[data-testid='return-topic']");
  await page.waitForSelector("[data-testid='confirm-return-topic']");
  await page.click("[data-testid='confirm-return-topic']");

  await page.waitForURL(/\/projects\/[^/]+\/topic$/, {
    timeout: 60000,
  });
  await page.waitForSelector(uiAcceptanceDynamicSelectors.firstCandidateItem, {
    timeout: 60000,
  });
  await page.click(uiAcceptanceDynamicSelectors.firstCandidateItem);
  await page.waitForSelector(uiAcceptanceSelectors.candidateDrawer);
  await captureAuditSnapshot(page, pageSnapshots, "topic");
  screenshotPaths["topic-workspace-second"] = await captureScreenshot(
    page,
    screenshotsDir,
    "topic-workspace-second",
  );
  await page.click(uiAcceptanceSelectors.confirmCandidate);

  await page.waitForURL(/\/projects\/[^/]+\/script$/, {
    timeout: 60000,
  });
  await waitForScriptOutcome(page, plan);
  await page.waitForSelector(uiAcceptanceSelectors.scriptTraceEntry);
  await captureAuditSnapshot(page, pageSnapshots, "script");
  screenshotPaths["script-workspace-second"] = await captureScreenshot(
    page,
    screenshotsDir,
    "script-workspace-second",
  );

  return {
    screenshotPaths,
    pageSnapshots,
    finalUrl: page.url(),
  };
}

export async function runUiAcceptanceBrowser(
  input: RunUiAcceptanceBrowserInput,
): Promise<RunUiAcceptanceBrowserResult> {
  mkdirSync(input.outputDir, { recursive: true });
  mkdirSync(input.screenshotsDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:5173",
    viewport: input.plan.viewport,
  });
  const page = await context.newPage();
  const consoleMessages: RunUiAcceptanceBrowserResult["consoleMessages"] = [];
  const networkErrors: RunUiAcceptanceBrowserResult["networkErrors"] = [];

  page.on("console", (message) => {
    pushConsoleMessage(consoleMessages, message);
  });
  page.on("response", (response) => {
    pushNetworkError(networkErrors, response);
  });

  await context.tracing.start({
    screenshots: true,
    snapshots: true,
  });

  try {
    const runResult =
      input.plan.mode === "full"
        ? await runFullMainline(page, input.screenshotsDir, input.plan)
        : await runSmokeMainline(page, input.screenshotsDir, input.plan);
    await context.tracing.stop({
      path: input.tracePath,
    });

    writeFileSync(input.consoleSummaryPath, JSON.stringify(consoleMessages, null, 2), "utf8");
    writeFileSync(input.networkSummaryPath, JSON.stringify(networkErrors, null, 2), "utf8");

    const projectId = new URL(runResult.finalUrl).pathname.split("/")[2] ?? null;

    return {
      finalUrl: new URL(runResult.finalUrl).pathname,
      projectId,
      screenshotPaths: runResult.screenshotPaths,
      pageSnapshots: runResult.pageSnapshots,
      consoleMessages,
      networkErrors,
    };
  } finally {
    await context.close();
    await browser.close();
  }
}
