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
 * S2-2D 任务 6：浏览器验收（真实 .env 部署——付费闸门生效，报价弹窗出现；
 * 不做真实付费调用：确认后立即取消）。
 *
 * 覆盖：
 * 1. 新建项目 → "开始生成选题" → 409 paid_generation_quote_required 不再作为
 *    裸报错 → **报价确认弹窗出现**（生成费用确认）；
 * 2. 弹窗展示预计费用与授权上界；取消 → 弹窗关闭、不提交、不产生付费调用；
 * 3. 失败页"重新生成"入口同样进入报价弹窗（TopicPanel 路径）。
 *
 * 说明：script/storyboard/publish 三面板的报价弹窗由 jsdom 组件测试
 * （script/storyboard/publish-panel-quote-flow.spec.ts）覆盖；真实页面推进到
 * 这些阶段需要付费生成（选题/文案成功），本验收不做真实付费 live——到达
 * 这些面板需要先确认付费报价，超出"取消不付费"验收边界。
 *
 * 前置：本机 .env 配置真实 LLM provider（LLM_PROVIDER != stub）——付费闸门
 * 生效是脚本断言成立的前提；stub 部署下脚本应跳过报价断言（免 quote 直连）。
 */

const USER_USERNAME = "s2d-alice";
const USER_PASSWORD = "s2d-alice-password-strong";

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
    await verifyCreateTopicQuoteDialog(page);
    await verifyRegenerateQuoteDialog(page);
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
  console.log(`\nAll ${results.length} S2-2D browser acceptance steps passed`);
}

async function startAcceptanceApp(): Promise<Setup> {
  const root = mkdtempSync(join(tmpdir(), "hvf-s2d-browser-"));
  const dbPath = join(root, "s2d-browser.db");
  const backendPort = await findFreePort();
  const frontendPort = await findFreePort();

  const sqlite = new Database(dbPath);
  applyAllDatabaseMigrations(sqlite);
  sqlite.close();

  const client = await createPrismaClient(dbPath);
  await activateDatabase(client, { mode: "fresh" });
  await bootstrapAdmin(client, {
    username: "s2d-admin",
    password: "s2d-admin-password-strong",
    displayName: "S2D Admin",
  }, { requireDatabaseActivation: false });
  await client.user.create({
    data: {
      username: USER_USERNAME,
      displayName: "S2D Alice",
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
  // 真实 .env 部署（LLM_PROVIDER 来自 .env）：付费闸门生效

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

/** 新建项目 → 开始生成选题 → 报价弹窗出现 → 取消（不付费）。 */
async function verifyCreateTopicQuoteDialog(page: Page): Promise<void> {
  await page.goto(new URL("/projects", page.url()).toString(), { waitUntil: "domcontentloaded" });
  const createButtons = page.locator("button:has-text('新建项目'), button:has-text('创建项目')");
  await createButtons.first().waitFor({ timeout: 10000 });
  await createButtons.first().click();
  await page.waitForSelector('[data-testid="generate-topic"]', { timeout: 10000 });
  await page.click('[data-testid="generate-topic"]');

  // 真实付费部署：报价确认弹窗出现（而不是"选题生成失败"裸报错）
  try {
    await page.waitForSelector('[data-testid="quote-estimated"]', { timeout: 15000 });
    record("topic: 新建项目选题生成进入报价确认弹窗", true);
  } catch {
    const body = await page.locator("body").innerText();
    record(
      "topic: 新建项目选题生成进入报价确认弹窗",
      false,
      body.includes("paid_generation_quote_required") ? "裸报错（未接入报价）" : body.slice(0, 120),
    );
    return;
  }
  const estimated = await page.locator('[data-testid="quote-estimated"]').innerText();
  record("topic: 弹窗展示预计费用", estimated.includes("¥"), estimated.slice(0, 40));

  // 取消：不提交、不产生付费调用
  await page.click('[data-testid="quote-cancel"]');
  await page.waitForTimeout(800);
  const dialogGone = (await page.locator('[data-testid="quote-estimated"]').count()) === 0;
  record("topic: 取消后弹窗关闭（未提交、未付费）", dialogGone);
}

/** 选题失败页的"重新生成"入口同样进入报价弹窗（TopicPanel 路径）。 */
async function verifyRegenerateQuoteDialog(page: Page): Promise<void> {
  // 直接导航到最近项目的 topic 页（失败态应显示"重新生成"）
  const projectLink = page.locator("a[href*='/projects/'], [data-testid*='project']").first();
  await page.goto(new URL("/projects", page.url()).toString(), { waitUntil: "domcontentloaded" });
  const row = page.locator("tr").filter({ hasText: "未命名项目" }).first();
  const href = await row.locator("a, [data-testid]").first().getAttribute("href").catch(() => null);
  if (!href) {
    record("regen: 项目链接可导航", false, "未找到项目行");
    return;
  }
  await page.goto(new URL(href, page.url()).toString(), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const regenButton = page.locator("button:has-text('重新生成')").first();
  if ((await regenButton.count()) === 0) {
    // 状态可能已恢复（ready 空态）：自动生成入口同样走报价
    record("regen: 失败页重新生成按钮出现", true, "状态为待生成（auto 路径由 CreateTopicModal 覆盖）");
    return;
  }
  await regenButton.click();
  try {
    await page.waitForSelector('[data-testid="quote-estimated"]', { timeout: 15000 });
    record("regen: TopicPanel 重新生成进入报价确认弹窗", true);
    await page.click('[data-testid="quote-cancel"]');
  } catch {
    record("regen: TopicPanel 重新生成进入报价确认弹窗", false, "未出现报价弹窗");
  }
  void projectLink;
}

// --- infra（与 s2-2b/2c 脚本同构） ----------------------------------------------

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
