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
 * S2-2B 任务 10：浏览器验收（stub/fake 部署，不做真实付费调用）。
 *
 * 覆盖详细设计 §13.5 验收清单第 3 项（真实页面）：
 * 1. 设置页创作三区（音色/画风/字幕）渲染、选择与保存、刷新保持；
 * 2. 项目设置创作三区 + 保存前失效预览（画风 → 资产规划）；
 * 3. 字幕安全覆盖表单 + 实时预览框。
 *
 * 覆盖范围声明：
 * - 试听按钮在 stub 部署下走 fake 本地合成（零费用）；付费路径的报价弹窗
 *   交互由 jsdom 组件测试（creative-settings-ui.spec.ts）与后端 quote 协议
 *   测试（voice-preview-quote.test.ts）覆盖；真实付费试听未运行（未验证）。
 * - 音色/画风/字幕进入运行快照与执行消费由
 *   tests/backend/s2-2b-e2e-acceptance.test.ts 覆盖。
 */

const USER_USERNAME = "s2b-alice";
const USER_PASSWORD = "s2b-alice-password-strong";

interface AcceptanceResult {
  step: string;
  pass: boolean;
  detail?: string;
}

interface Setup {
  root: string;
  client: AppPrismaClient;
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
    await verifyCreativeSettings(page);
    await verifyProjectCreativeCover(page);
    await verifySubtitlePreview(page);
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
  console.log(`\nAll ${results.length} S2-2B browser acceptance steps passed`);
}

async function startAcceptanceApp(): Promise<Setup> {
  const root = mkdtempSync(join(tmpdir(), "hvf-s2b-browser-"));
  const dbPath = join(root, "s2b-browser.db");
  const backendPort = await findFreePort();
  const frontendPort = await findFreePort();

  const sqlite = new Database(dbPath);
  applyAllDatabaseMigrations(sqlite);
  sqlite.close();

  const client = await createPrismaClient(dbPath);
  await activateDatabase(client, { mode: "fresh" });

  await bootstrapAdmin(client, {
    username: "s2b-admin",
    password: "s2b-admin-password-strong",
    displayName: "S2B Admin",
  }, { requireDatabaseActivation: false });
  await client.user.create({
    data: {
      username: USER_USERNAME,
      displayName: "S2B Alice",
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

  return { root, client, app, httpServer, viteProc, frontendUrl };
}

async function stopAcceptanceApp(setup: Setup): Promise<void> {
  await killProcessTree(setup.viteProc);
  await new Promise<void>((resolve) => setup.httpServer.close(() => resolve()));
  await setup.client.$disconnect().catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 500));
  rmSync(setup.root, { recursive: true, force: true });
}

// --- browser steps -----------------------------------------------------------

async function login(page: Page, frontendUrl: string): Promise<void> {
  await page.goto(`${frontendUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="text"], input[name="username"], input[placeholder*="用户" i]', USER_USERNAME);
  await page.fill('input[type="password"]', USER_PASSWORD);
  await page.click('button[type="submit"], button:has-text("登录")');
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });
}

/** 设置页：创作三区渲染、选择与保存、刷新保持。 */
async function verifyCreativeSettings(page: Page): Promise<void> {
  await page.goto(new URL("/settings", page.url()).toString(), { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="user-creative-settings"]', { timeout: 15000 });

  const voiceCards = await page.locator('[data-testid^="voice-voice_"]').count();
  record("settings: 音色卡片列表渲染（seed 音色 ≥ 4）", voiceCards >= 4, `count=${voiceCards}`);
  const artCards = await page.locator('[data-testid^="art-art_style_"]').count();
  record("settings: 画风 preset 卡片渲染（≥ 3）", artCards >= 3, `count=${artCards}`);
  const subtitleCards = await page.locator('[data-testid^="subtitle-subtitle_style_"]').count();
  record("settings: 字幕 preset 卡片渲染（≥ 3）", subtitleCards >= 3, `count=${subtitleCards}`);

  // 选择画风并保存，刷新后保持
  await page.click('[data-testid="art-art_style_classical_ink"]');
  await page.click('[data-testid="save-preference"]');
  await page.waitForSelector('[data-testid="save-preference"]:not(:disabled)', { timeout: 10000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="user-creative-settings"]', { timeout: 15000 });
  const artActive = await page.locator('[data-testid="art-art_style_classical_ink"]').evaluate(
    (el) => el.classList.contains("active"),
  );
  record("settings: 画风选择保存后刷新保持", artActive);
}

/** 项目设置：创作三区 + 画风变更失效预览（资产规划）。 */
async function verifyProjectCreativeCover(page: Page): Promise<void> {
  await page.goto(new URL("/projects", page.url()).toString(), { waitUntil: "domcontentloaded" });
  const createButtons = page.locator("button:has-text('新建项目'), button:has-text('创建项目')");
  await createButtons.first().waitFor({ timeout: 10000 });
  await createButtons.first().click();
  await page.waitForSelector('[data-testid="generate-topic"]', { timeout: 10000 });
  await page.click('[data-testid="generate-topic"]');
  await page.waitForURL(/\/projects\/[^/]+(\/topic)?$/, { timeout: 30000 });

  // 打开项目设置对话框
  const settingsButton = page.locator(
    'button:has-text("项目设置"), [data-testid="open-project-settings"]',
  ).first();
  await settingsButton.waitFor({ timeout: 10000 });
  await settingsButton.click();
  await page.waitForSelector('[data-testid="project-creative-settings"]', { timeout: 10000 });
  record("project: 项目设置创作三区渲染", true);

  // 画风变更 → 失效预览包含资产规划
  await page.click('[data-testid="art-art_style_cinematic"]');
  await page.waitForSelector('[data-testid="project-invalidation-preview"]', { timeout: 10000 });
  const previewText = await page
    .locator('[data-testid="project-invalidation-preview"]')
    .innerText();
  record("project: 画风变更失效预览包含资产规划", previewText.includes("资产规划"), previewText.slice(0, 60));
}

/** 字幕：安全覆盖表单 + 预览框随覆盖更新。 */
async function verifySubtitlePreview(page: Page): Promise<void> {
  await page.goto(new URL("/settings", page.url()).toString(), { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="creative-subtitle-settings"]', { timeout: 15000 });
  await page.click('[data-testid="subtitle-subtitle_style_bold_stroke"]');
  await page.waitForSelector('[data-testid="subtitle-overrides"]', { timeout: 10000 });

  await page.fill('[data-testid="override-font_size_px"]', "60");
  await page.locator('[data-testid="override-font_size_px"]').dispatchEvent("change");
  const previewStyle = await page
    .locator('[data-testid="subtitle-preview-text"]')
    .getAttribute("style");
  record("subtitle: 覆盖字号后预览框更新", previewStyle?.includes("font-size: 60px") ?? false, previewStyle?.slice(0, 80) ?? "");
}

// --- infra（与 s2-2a 脚本同构） ----------------------------------------------

async function findFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function listen(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for ${url}`);
}

async function killProcessTree(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
    await new Promise((resolve) => setTimeout(resolve, 800));
    return;
  }
  proc.kill("SIGTERM");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
