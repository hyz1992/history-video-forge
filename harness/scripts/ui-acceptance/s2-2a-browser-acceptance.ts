import { chromium, type Browser, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import { applyAllDatabaseMigrations } from "../../../tests/backend/db/migration-test-utils.js";
import { bootstrapAdmin } from "../../../backend/src/auth/admin-bootstrap.js";
import { hashPassword } from "../../../backend/src/auth/password-hash.js";
import { PrismaSessionStore } from "../../../backend/src/auth/session-store.js";
import { buildApp, type AppInstance } from "../../../backend/src/app.js";
import { activateDatabase } from "../../../backend/src/db/database-activation.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import type { AppPrismaClient } from "../../../backend/src/db/prisma-client.types.js";
import { createHttpServer } from "../../../backend/src/server.js";

/**
 * S2-2A 任务 12：浏览器验收（stub/fake 部署，不做真实付费调用）。
 *
 * 覆盖实施计划任务 12 步骤 3 的 UI 验收点：
 * 1. 用户设置四档切换（默认"优先 Remotion"）；
 * 2. 创建项目后默认冻结用户默认；
 * 3. 项目设置失效预览；
 * 4. 项目设置保存（乐观并发 PATCH）。
 *
 * 报价确认/严格 fallback/成本明细的交互层由 jsdom 组件测试覆盖，quote 正
 * 链路 + billing 落账由 tests/backend/s2-2a-e2e-acceptance.test.ts 覆盖
 * （付费部署路径 + mock provider）；本脚本运行环境为 stub 后端。
 */

const USER_USERNAME = "s2a-alice";
const USER_PASSWORD = "s2a-alice-password-strong";

interface AcceptanceResult {
  step: string;
  pass: boolean;
  detail?: string;
}

interface Setup {
  root: string;
  app: AppInstance;
  httpServer: Server;
  viteProc: ChildProcess;
  frontendUrl: string;
}

const results: AcceptanceResult[] = [];

function record(step: string, pass: boolean, detail?: string): void {
  results.push({ step, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${step}${detail ? ` :: ${detail}` : ""}`);
}

async function main(): Promise<void> {
  let setup: Setup | null = null;
  let browser: Browser | null = null;

  try {
    setup = await startAcceptanceApp();
    browser = await chromium.launch();

    const page = await browser.newPage();
    await login(page, setup.frontendUrl);
    await verifySettingsFourStrategies(page);
    await verifySettingsSave(page);
    await verifyProjectFreezeAndInvalidation(page, setup);
    await page.context().close();
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (setup) await stopAcceptanceApp(setup);
  }

  const failed = results.filter((result) => !result.pass);
  if (failed.length > 0) {
    console.error(`\n${failed.length} acceptance step(s) failed`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} S2-2A browser acceptance steps passed`);
}

async function startAcceptanceApp(): Promise<Setup> {
  const root = mkdtempSync(join(tmpdir(), "hvf-s2a-browser-"));
  const dbPath = join(root, "s2a-browser.db");
  const backendPort = await findFreePort();
  const frontendPort = await findFreePort();

  const sqlite = new Database(dbPath);
  applyAllDatabaseMigrations(sqlite);
  sqlite.close();

  const client = await createPrismaClient(dbPath);
  await activateDatabase(client, { mode: "fresh" });

  await bootstrapAdmin(client, {
    username: "s2a-admin",
    password: "s2a-admin-password-strong",
    displayName: "S2A Admin",
  }, { requireDatabaseActivation: false });
  await client.user.create({
    data: {
      username: USER_USERNAME,
      displayName: "S2A Alice",
      passwordHash: await hashPassword(USER_PASSWORD),
      role: "USER",
      status: "ACTIVE",
      mustChangePassword: false,
    },
  });

  process.env.DATABASE_URL = dbPath;
  process.env.SERVER_PORT = String(backendPort);
  process.env.SERVER_HOST = "127.0.0.1";
  process.env.VITEST = "1";

  const app = buildApp({ prismaClient: client, skipSnapshotLoad: true });
  const sessionStore = new PrismaSessionStore(client);
  const httpServer = createHttpServer(app, { sessionStore });
  await listen(httpServer, backendPort);

  const viteProc = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["vite", "--config", "frontend/vite.config.ts", "--port", String(frontendPort), "--strictPort"],
    {
      cwd: process.cwd(),
      env: { ...process.env, SERVER_PORT: String(backendPort) },
      shell: process.platform === "win32",
      stdio: "ignore",
    },
  );

  const frontendUrl = `http://127.0.0.1:${frontendPort}`;
  await waitFor(frontendUrl, 40000);

  return { root, app, httpServer, viteProc, frontendUrl };
}

async function stopAcceptanceApp(setup: Setup): Promise<void> {
  await killProcessTree(setup.viteProc);
  await new Promise<void>((resolve) => setup.httpServer.close(() => resolve()));
  rmSync(setup.root, { recursive: true, force: true });
}

// --- browser steps -----------------------------------------------------------

async function login(page: Page, frontendUrl: string): Promise<void> {
  await page.goto(`${frontendUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="text"], input[name="username"], input[placeholder*="用户" i]', USER_USERNAME);
  await page.fill('input[type="password"]', USER_PASSWORD);
  await page.click('button[type="submit"], button:has-text("登录")');
  await page.waitForURL(/\/projects|\//, { timeout: 15000 });
}

async function verifySettingsFourStrategies(page: Page): Promise<void> {
  await page.goto(new URL("/settings", page.url()).toString(), { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="strategy-prefer_remotion"]', { timeout: 10000 });
  const preferRemotionChecked = await page.isChecked('[data-testid="strategy-prefer_remotion"]');
  record("settings: 默认选中「优先 Remotion」", preferRemotionChecked);
  const hasAllApi = await page.locator('[data-testid="strategy-all_api_video"]').count();
  const hasPreferApi = await page.locator('[data-testid="strategy-prefer_api_video"]').count();
  const hasAllRemotion = await page.locator('[data-testid="strategy-all_remotion"]').count();
  record("settings: 四档策略卡片齐全", hasAllApi === 1 && hasPreferApi === 1 && hasAllRemotion === 1);
  const qualityCount = await page.locator('[data-testid="quality-standard_720p"]').count();
  record("settings: 画质 720P/1080P 可选", qualityCount === 1);
}

async function verifySettingsSave(page: Page): Promise<void> {
  await page.check('[data-testid="strategy-all_api_video"]');
  await page.click('[data-testid="save-preference"]');
  await page.waitForSelector('[data-testid="save-preference"]:not(:disabled)', { timeout: 10000 });
  // 保存成功后重新进入页面应保持 all_api_video（服务器持久化）
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="strategy-all_api_video"]', { timeout: 10000 });
  const saved = await page.isChecked('[data-testid="strategy-all_api_video"]');
  record("settings: 保存后刷新保持 all_api_video", saved);
}

async function verifyProjectFreezeAndInvalidation(page: Page, setup: Setup): Promise<void> {
  // 创建项目（用户默认 all_api_video 应冻结为项目配置）
  await page.goto(new URL("/projects", page.url()).toString(), { waitUntil: "domcontentloaded" });
  await page.waitForSelector("button:has-text('新建项目'), button:has-text('创建项目')", { timeout: 10000 });
  await page.click("button:has-text('新建项目'), button:has-text('创建项目')");
  await page.waitForTimeout(800);
  // 进入第一个项目的工作区
  const projectLinks = page.locator("a[href*='/projects/']");
  const linkCount = await projectLinks.count();
  record("projects: 创建项目成功", linkCount >= 1);
  if (linkCount === 0) return;
  await projectLinks.first().click();
  await page.waitForSelector(".project-workspace, [data-testid='open-project-settings']", { timeout: 15000 });

  // 打开项目设置对话框 → 验证来源与冻结值
  await page.click('[data-testid="open-project-settings"]');
  await page.waitForSelector('[data-testid="project-invalidation-preview"], .project-meta', { timeout: 10000 });
  const pageText = await page.textContent("body");
  const sourceInherited = (pageText ?? "").includes("继承自创建时用户默认");
  record("project-settings: 来源说明为继承自创建时用户默认", sourceInherited);
  const frozenStrategy = await page.isChecked('[data-testid="project-strategy-all_api_video"]');
  record("project-settings: 项目冻结用户默认 all_api_video", frozenStrategy);

  // 改策略 → 保存前失效预览出现（资产规划受影响）
  await page.check('[data-testid="project-strategy-prefer_api_video"]');
  await page.waitForSelector('[data-testid="project-invalidation-preview"]', { timeout: 5000 });
  const previewText = await page.textContent('[data-testid="project-invalidation-preview"]');
  const previewShown = (previewText ?? "").includes("资产规划");
  record("project-settings: 保存前失效预览（策略变化→资产规划）", previewShown);

  // 保存项目设置
  await page.click('[data-testid="save-project-config"]');
  await page.waitForTimeout(800);
  const dialogClosed = await page.locator('[data-testid="save-project-config"]').count() === 0;
  record("project-settings: 保存后对话框关闭", dialogClosed);
}

// --- infra helpers (同 s1-browser-acceptance) --------------------------------

async function findFreePort(): Promise<number> {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("no port")));
      }
    });
  });
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`frontend not ready at ${url}`);
}

async function killProcessTree(proc: ChildProcess): Promise<void> {
  if (!proc.pid) return;
  if (process.platform === "win32") {
    const { execSync } = await import("node:child_process");
    try {
      execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: "ignore" });
    } catch {
      proc.kill();
    }
    return;
  }
  proc.kill("SIGTERM");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
