import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { chromium, type ConsoleMessage, type Page, type Response } from "@playwright/test";

import { uiAcceptanceDynamicSelectors, uiAcceptanceSelectors } from "./dom-selectors";
import type { UiAcceptanceSmokePlan } from "./ui-acceptance-smoke";

export interface RunUiAcceptanceBrowserInput {
  plan: UiAcceptanceSmokePlan;
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

async function runSmokeMainline(page: Page, screenshotsDir: string) {
  const screenshotPaths: Record<string, string> = {};

  await page.goto("/");
  await page.waitForSelector(uiAcceptanceSelectors.homePrimaryCta);
  screenshotPaths.home = await captureScreenshot(page, screenshotsDir, "home");

  await page.click(uiAcceptanceSelectors.homePrimaryCta);
  await page.waitForURL("**/projects");
  await page.waitForSelector(uiAcceptanceSelectors.createProject);
  screenshotPaths.projects = await captureScreenshot(page, screenshotsDir, "projects");

  await page.click(uiAcceptanceSelectors.createProject);
  await page.waitForURL(/\/projects\/[^/]+\/topic$/);
  await page.waitForSelector(uiAcceptanceSelectors.generateTopic);
  screenshotPaths["topic-workspace"] = await captureScreenshot(
    page,
    screenshotsDir,
    "topic-workspace",
  );

  await page.click(uiAcceptanceSelectors.generateTopic);
  await page.waitForSelector(uiAcceptanceDynamicSelectors.firstCandidateItem, {
    timeout: 60000,
  });
  await page.click(uiAcceptanceDynamicSelectors.firstCandidateItem);
  await page.waitForSelector(uiAcceptanceSelectors.candidateDrawer);
  await page.click(uiAcceptanceSelectors.confirmCandidate);

  await page.waitForURL(/\/projects\/[^/]+\/script$/, {
    timeout: 60000,
  });
  await page.waitForSelector(uiAcceptanceSelectors.scriptText, {
    timeout: 60000,
  });
  await page.waitForSelector(uiAcceptanceSelectors.scriptTraceEntry);
  screenshotPaths["script-workspace"] = await captureScreenshot(
    page,
    screenshotsDir,
    "script-workspace",
  );

  return {
    screenshotPaths,
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
    const smokeResult = await runSmokeMainline(page, input.screenshotsDir);
    await context.tracing.stop({
      path: input.tracePath,
    });

    writeFileSync(input.consoleSummaryPath, JSON.stringify(consoleMessages, null, 2), "utf8");
    writeFileSync(input.networkSummaryPath, JSON.stringify(networkErrors, null, 2), "utf8");

    const projectId = new URL(smokeResult.finalUrl).pathname.split("/")[2] ?? null;

    return {
      finalUrl: new URL(smokeResult.finalUrl).pathname,
      projectId,
      screenshotPaths: smokeResult.screenshotPaths,
      consoleMessages,
      networkErrors,
    };
  } finally {
    await context.close();
    await browser.close();
  }
}
