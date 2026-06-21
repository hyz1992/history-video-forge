import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { cwd } from "node:process";

import { chromium, type Page } from "@playwright/test";

import {
  listReferenceMigrationContracts,
  type ReferenceMigrationContract,
} from "./reference-migration-contracts";
import {
  createReferenceMigrationSummaryMarkdown,
  summarizeReferenceMigrationChecks,
  type ReferenceMigrationCheck,
  type ReferenceMigrationCheckStatus,
  type ReferenceMigrationContractResult,
  type ReferenceMigrationScreenshot,
} from "./reference-migration-model";

const DEFAULT_BASE_URL = "http://127.0.0.1:5173";
const OUTPUT_ROOT = resolve(cwd(), "harness/scripts/runtime/output/ui-reference-migration");

function generateRunId(): string {
  const now = new Date();
  const iso = now.toISOString().replace(/[:.]/g, "-");
  return `run-${iso}`;
}

interface RunnerContext {
  repoRoot: string;
  baseUrl: string;
  runId: string;
  outputDir: string;
  screenshotsDir: string;
}

async function checkPageReachable(page: Page, url: string): Promise<boolean> {
  try {
    await page.goto(url, { timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

async function takeScreenshot(
  page: Page,
  path: string,
  viewport: { width: number; height: number },
): Promise<string> {
  await page.setViewportSize(viewport);
  await page.screenshot({ path, fullPage: true });
  return path;
}

async function checkSelectorVisible(page: Page, selector: string): Promise<boolean> {
  const locator = page.locator(selector).first();
  if ((await locator.count()) === 0) {
    return false;
  }
  return locator.isVisible();
}

async function checkSelectorInViewport(page: Page, selector: string): Promise<boolean> {
  const visible = await checkSelectorVisible(page, selector);
  if (!visible) return false;
  return page.locator(selector).first().evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight;
  });
}

async function checkRoute(page: Page, expectedRoute: string): Promise<boolean> {
  const url = new URL(page.url());
  return url.pathname === expectedRoute;
}

function scanGlobalSelectors(
  contract: ReferenceMigrationContract,
  repoRoot: string,
): ReferenceMigrationCheck[] {
  const checks: ReferenceMigrationCheck[] = [];
  const { forbiddenGlobalSelectors, reviewedGlobalSelectors } = contract.styleIsolation;
  const srcDir = join(repoRoot, "frontend", "src");

  function scanDir(dir: string) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.name.endsWith(".css") || entry.name.endsWith(".vue")) {
        const content = readFileSync(fullPath, "utf8");
        for (const selector of forbiddenGlobalSelectors) {
          if (content.includes(selector)) {
            const reviewed = reviewedGlobalSelectors?.includes(selector);
            checks.push({
              code: `global-selector-${selector.replace(/[^a-zA-Z0-9]/g, "-")}`,
              status: reviewed ? "WARN" : "FAIL",
              message: reviewed
                ? `选中 ${selector} 在 ${relative(repoRoot, fullPath)} 中出现（已审查通过，列入人工审查项）`
                : `禁止的全局选择器 ${selector} 在 ${relative(repoRoot, fullPath)} 中出现`,
            });
          }
        }
      }
    }
  }

  if (existsSync(srcDir)) {
    scanDir(srcDir);
  }

  return checks;
}

async function runSentinelChecks(
  page: Page,
  contract: ReferenceMigrationContract,
  baseUrl: string,
): Promise<ReferenceMigrationCheck[]> {
  const checks: ReferenceMigrationCheck[] = [];
  const { sentinelRoutes, forbiddenBodyClasses, forbiddenVisibleSelectors } =
    contract.styleIsolation;

  for (const route of sentinelRoutes) {
    const sentinelUrl = `${baseUrl}${route}`;
    try {
      await page.goto(sentinelUrl, { timeout: 10000 });

      if (forbiddenBodyClasses) {
        for (const cls of forbiddenBodyClasses) {
          const hasClass = await page.locator("body").evaluate((el, className) => {
            return el.classList.contains(className);
          }, cls);
          if (hasClass) {
            checks.push({
              code: `body-class-${cls}`,
              status: "FAIL",
              message: `哨兵 route ${route} 上存在禁止的 body class: ${cls}`,
            });
          } else {
            checks.push({
              code: `body-class-${cls}`,
              status: "PASS",
              message: `哨兵 route ${route} 上未检测到 ${cls}`,
            });
          }
        }
      }

      if (forbiddenVisibleSelectors) {
        for (const selector of forbiddenVisibleSelectors) {
          const visible = await checkSelectorVisible(page, selector);
          if (visible) {
            checks.push({
              code: `visible-selector-${selector.replace(/[^a-zA-Z0-9-]/g, "-")}`,
              status: "FAIL",
              message: `哨兵 route ${route} 上可见禁止 selector: ${selector}`,
            });
          } else {
            checks.push({
              code: `visible-selector-${selector.replace(/[^a-zA-Z0-9-]/g, "-")}`,
              status: "PASS",
              message: `哨兵 route ${route} 上未检测到 selector: ${selector}`,
            });
          }
        }
      }
    } catch {
      checks.push({
        code: "sentinel-unreachable",
        status: "SKIPPED",
        message: `无法访问哨兵 route: ${route}`,
      });
    }
  }

  return checks;
}

function checkReferenceAndTarget(
  contract: ReferenceMigrationContract,
  referenceAbsPath: string,
): ReferenceMigrationContractResult | null {
  const checks: ReferenceMigrationCheck[] = [];

  if (!existsSync(referenceAbsPath)) {
    checks.push({
      code: "reference-file-exists",
      status: "FAIL",
      message: `参考 HTML 缺失: ${contract.referencePath}`,
    });
    return {
      contract_id: contract.id,
      title: contract.title,
      status: "FAIL",
      checks,
      screenshots: [],
      manual_review_items: contract.manualReviewItems,
    };
  }

  return null;
}

async function ensureTargetReachable(
  page: Page,
  contract: ReferenceMigrationContract,
  targetUrl: string,
): Promise<ReferenceMigrationCheck | null> {
  const reachable = await checkPageReachable(page, targetUrl);
  if (!reachable) {
    return {
      code: "target-reachable",
      status: "FAIL",
      message: `目标 route 无法访问: ${contract.targetRoute}`,
    };
  }
  return null;
}

async function captureContractScreenshots(
  page: Page,
  contract: ReferenceMigrationContract,
  ctx: RunnerContext,
  targetUrl: string,
  referenceAbsPath: string,
  checks: ReferenceMigrationCheck[],
  screenshots: ReferenceMigrationScreenshot[],
) {
  const contractScreenshotDir = join(ctx.screenshotsDir, contract.outputName);
  mkdirSync(contractScreenshotDir, { recursive: true });

  for (const viewport of contract.viewports) {
    const refScreenshotRel = `screenshots/${contract.outputName}/reference-${viewport.name}.png`;
    const targetScreenshotRel = `screenshots/${contract.outputName}/target-${viewport.name}.png`;
    const refPath = join(ctx.screenshotsDir, contract.outputName, `reference-${viewport.name}.png`);
    const targetPath = join(ctx.screenshotsDir, contract.outputName, `target-${viewport.name}.png`);

    try {
      await page.goto(`file://${referenceAbsPath}`, { timeout: 10000 });
      await takeScreenshot(page, refPath, viewport);
    } catch {
      checks.push({
        code: "reference-screenshot",
        status: "FAIL",
        message: `无法截取参考页截图 (${viewport.name})`,
      });
    }

    try {
      await page.goto(targetUrl, { timeout: 10000 });
      await takeScreenshot(page, targetPath, viewport);
    } catch {
      checks.push({
        code: "target-screenshot",
        status: "FAIL",
        message: `无法截取目标页截图 (${viewport.name})`,
      });
    }

    screenshots.push({
      viewport: viewport.name,
      reference: refScreenshotRel,
      target: targetScreenshotRel,
    });
  }
}

async function runSelectorChecks(
  page: Page,
  contract: ReferenceMigrationContract,
  targetUrl: string,
  checks: ReferenceMigrationCheck[],
) {
  await page.goto(targetUrl, { timeout: 10000 });

  for (const item of contract.requiredSelectors) {
    const visible = await checkSelectorVisible(page, item.selector);
    if (!visible) {
      checks.push({
        code: `selector-${item.key}`,
        status: "FAIL",
        message: `必须 selector 不可见: ${item.selector}`,
      });
    } else if (item.mustBeInViewport) {
      const inViewport = await checkSelectorInViewport(page, item.selector);
      checks.push({
        code: `selector-${item.key}`,
        status: inViewport ? "PASS" : "FAIL",
        message: inViewport
          ? `${item.selector} 在首屏可见`
          : `${item.selector} 不在首屏 viewport`,
      });
    } else {
      checks.push({
        code: `selector-${item.key}`,
        status: "PASS",
        message: `${item.selector} 可见`,
      });
    }
  }
}

async function runInteractionChecks(
  page: Page,
  contract: ReferenceMigrationContract,
  targetUrl: string,
  checks: ReferenceMigrationCheck[],
) {
  for (const interaction of contract.interactionChecks) {
    try {
      await page.goto(targetUrl, { timeout: 10000 });
      await page.click(interaction.selector);
      await page.waitForTimeout(1000);

      if (interaction.expectRoute) {
        const routeOk = await checkRoute(page, interaction.expectRoute);
        checks.push({
          code: `interaction-${interaction.key}`,
          status: routeOk ? "PASS" : "FAIL",
          message: routeOk
            ? `点击 ${interaction.selector} 到达 ${page.url()}`
            : `点击 ${interaction.selector} 后期望 route ${interaction.expectRoute}，实际在 ${page.url()}`,
        });
      }
    } catch {
      checks.push({
        code: `interaction-${interaction.key}`,
        status: "FAIL",
        message: `交互检查失败: ${interaction.key}`,
      });
    }
  }
}

async function runContractCheck(
  page: Page,
  contract: ReferenceMigrationContract,
  ctx: RunnerContext,
): Promise<ReferenceMigrationContractResult> {
  const checks: ReferenceMigrationCheck[] = [];
  const screenshots: ReferenceMigrationScreenshot[] = [];

  const referenceAbsPath = resolve(ctx.repoRoot, contract.referencePath);
  const targetUrl = `${ctx.baseUrl}${contract.targetRoute}`;

  // Check reference HTML exists and target is reachable
  const earlyResult = checkReferenceAndTarget(contract, referenceAbsPath);
  if (earlyResult) return earlyResult;

  const targetUnreachable = await ensureTargetReachable(page, contract, targetUrl);
  if (targetUnreachable) {
    checks.push(targetUnreachable);
    return {
      contract_id: contract.id,
      title: contract.title,
      status: "FAIL",
      checks,
      screenshots,
      manual_review_items: contract.manualReviewItems,
    };
  }

  // Screenshots
  await captureContractScreenshots(page, contract, ctx, targetUrl, referenceAbsPath, checks, screenshots);

  // Selector checks
  await runSelectorChecks(page, contract, targetUrl, checks);

  // Interaction checks
  await runInteractionChecks(page, contract, targetUrl, checks);

  // Style isolation: static text scan + sentinel route browser checks
  checks.push(...scanGlobalSelectors(contract, ctx.repoRoot));
  checks.push(...(await runSentinelChecks(page, contract, ctx.baseUrl)));

  const resultStatus = summarizeReferenceMigrationChecks(checks);

  return {
    contract_id: contract.id,
    title: contract.title,
    status: resultStatus.status,
    checks,
    screenshots,
    manual_review_items: contract.manualReviewItems,
  };
}

async function main() {
  const baseUrl = process.env.UI_REFERENCE_BASE_URL ?? DEFAULT_BASE_URL;
  const repoRoot = cwd();
  const runId = generateRunId();
  const outputDir = join(OUTPUT_ROOT, runId);
  const screenshotsDir = join(outputDir, "screenshots");
  const contractsDir = join(outputDir, "contracts");

  mkdirSync(outputDir, { recursive: true });
  mkdirSync(screenshotsDir, { recursive: true });
  mkdirSync(contractsDir, { recursive: true });

  const ctx: RunnerContext = {
    repoRoot,
    baseUrl,
    runId,
    outputDir,
    screenshotsDir,
  };

  const contracts = listReferenceMigrationContracts();
  const contractResults: ReferenceMigrationContractResult[] = [];

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    for (const contract of contracts) {
      const result = await runContractCheck(page, contract, ctx);
      contractResults.push(result);

      // Write contract snapshot
      writeFileSync(
        join(contractsDir, `${contract.id}.json`),
        JSON.stringify(result, null, 2),
        "utf8",
      );
    }
  } finally {
    await context.close();
    await browser.close();
  }

  // Aggregate results
  const allChecks: ReferenceMigrationCheck[] = [];
  for (const r of contractResults) {
    allChecks.push(...r.checks);
  }
  const aggregate = summarizeReferenceMigrationChecks(allChecks);

  const summary: {
    run_id: string;
    status: ReferenceMigrationCheckStatus;
    generated_at: string;
    contracts: ReferenceMigrationContractResult[];
    totals: { pass: number; warn: number; fail: number; skipped: number };
  } = {
    run_id: runId,
    status: aggregate.status,
    generated_at: new Date().toISOString(),
    contracts: contractResults,
    totals: aggregate.totals,
  };

  writeFileSync(join(outputDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  writeFileSync(
    join(outputDir, "summary.md"),
    createReferenceMigrationSummaryMarkdown(summary),
    "utf8",
  );

  console.log(`Reference migration run complete: ${runId}`);
  console.log(`Status: ${aggregate.status}`);
  console.log(`Output: ${outputDir}`);

  if (aggregate.status === "FAIL") {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Reference migration runner error:", err);
  process.exit(1);
});
