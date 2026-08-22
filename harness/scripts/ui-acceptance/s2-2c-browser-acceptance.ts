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
import { buildPricingCatalogSeed } from "../../../backend/src/modules/generation-cost/pricing-catalog.seed.js";
import { applyProviderModelCatalogSeed } from "../../../backend/src/modules/generation-cost/provider-model-catalog.repository.js";
import { LLM_MODEL_CANDIDATES_V1 } from "../../../backend/src/modules/generation-cost/llm-model-catalog.js";

/**
 * S2-2C 任务 10：浏览器验收（stub/fake 部署，不做真实付费调用）。
 *
 * 覆盖详细设计 §9 验收点（真实页面）：
 * 1. 设置页高级设置区五槽渲染（目录多候选注入：LLM 双候选 + 媒体单候选）；
 * 2. 选"自动"→ auto；选候选 → fixed；保存后刷新保持；
 * 3. 单候选槽位"当前仅配置 X"、无候选槽位"当前部署无可用模型"文案；
 * 4. 项目设置高级区 + 固定 smart → 失效预览含 LLM 生成阶段。
 *
 * 覆盖范围声明：
 * - 目录多候选由脚本在 buildApp 后注入（stub 部署 + 自定义 seed）——目录
 *   API 只返回 active 条目，页面候选列表与后端目录同源。
 * - 付费链路（quote/提交/执行消费快照模型）由
 *   tests/backend/s2-2c-e2e-acceptance.test.ts 覆盖；真实付费 live 未运行。
 */

const USER_USERNAME = "s2c-alice";
const USER_PASSWORD = "s2c-alice-password-strong";

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
    await verifyCapabilitySlotsOnSettings(page);
    await verifySingleAndEmptySlotCopy(page);
    await verifyProjectSettingsCapabilityArea(page);
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
  console.log(`\nAll ${results.length} S2-2C browser acceptance steps passed`);
}

async function startAcceptanceApp(): Promise<Setup> {
  const root = mkdtempSync(join(tmpdir(), "hvf-s2c-browser-"));
  const dbPath = join(root, "s2c-browser.db");
  const backendPort = await findFreePort();
  const frontendPort = await findFreePort();

  const sqlite = new Database(dbPath);
  applyAllDatabaseMigrations(sqlite);
  sqlite.close();

  const client = await createPrismaClient(dbPath);
  await activateDatabase(client, { mode: "fresh" });

  await bootstrapAdmin(client, {
    username: "s2c-admin",
    password: "s2c-admin-password-strong",
    displayName: "S2C Admin",
  }, { requireDatabaseActivation: false });
  await client.user.create({
    data: {
      username: USER_USERNAME,
      displayName: "S2C Alice",
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

  // 注入多候选目录（stub 部署 + 自定义 seed）：LLM 双候选 + 媒体单候选
  const seed = buildPricingCatalogSeed({
    llm: {
      mode: "resolved",
      smart: { providerKey: "deepseek", modelId: "deepseek-v4-pro" },
      flash: { providerKey: "zhipu", modelId: "glm-4" },
      candidates: LLM_MODEL_CANDIDATES_V1,
    },
    media: { deploymentScope: "cn-beijing" },
  });
  await applyProviderModelCatalogSeed(app.db, seed);
  // 移除 video 槽目录行：验收"无候选槽位"文案（tts 保持单候选）
  for (const [id, entry] of [...app.db.providerModelCatalog.entries()]) {
    if (entry.capability === "video.image_to_video") app.db.providerModelCatalog.delete(id);
  }

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

/** 设置页高级设置区：五槽渲染、选候选固定、保存、刷新恢复。 */
async function verifyCapabilitySlotsOnSettings(page: Page): Promise<void> {
  await page.goto(new URL("/settings", page.url()).toString(), { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="cap-slot-llm.smart"]', { timeout: 15000 });

  // 五槽渲染
  const slots = ["llm.smart", "llm.flash", "image.generate", "video.image_to_video", "tts.synthesize"];
  let allRendered = true;
  for (const slot of slots) {
    const exists = await page.locator(`[data-testid="cap-slot-${slot}"]`).count();
    if (exists === 0) allRendered = false;
  }
  record("settings: 高级设置区五槽渲染", allRendered);

  // LLM smart 槽双候选（目录注入）可见
  const smartCandidates = await page.locator('[data-testid^="cap-candidate-llm.smart-"]').count();
  record("settings: llm.smart 双候选渲染", smartCandidates === 2, `count=${smartCandidates}`);
  const pageText = await page.locator("body").innerText();
  record("settings: 候选元数据来自目录（DeepSeek V4 Pro / 智谱 GLM-4）", pageText.includes("DeepSeek V4 Pro") && pageText.includes("智谱 GLM-4"));

  // 初始 auto 选中 → 选候选（智谱 GLM-4）→ 保存 → 刷新恢复
  const autoChecked = await page.locator('[data-testid="cap-auto-llm.smart"]').isChecked();
  record("settings: 默认 auto 选中", autoChecked);

  await page.click('[data-testid="cap-candidate-llm.smart-llm.smart.zhipu.glm-4"]');
  await page.click('[data-testid="save-preference"]');
  await page.waitForSelector('[data-testid="save-preference"]:not(:disabled)', { timeout: 10000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="cap-slot-llm.smart"]', { timeout: 15000 });
  const fixedChecked = await page
    .locator('[data-testid="cap-candidate-llm.smart-llm.smart.zhipu.glm-4"]')
    .isChecked();
  record("settings: 候选固定保存后刷新保持", fixedChecked);
}

/** 单候选槽位"当前仅配置 X"、无候选槽位"当前部署无可用模型"文案。 */
async function verifySingleAndEmptySlotCopy(page: Page): Promise<void> {
  const singleNote = await page.locator('[data-testid="cap-single-note-tts.synthesize"]').count();
  const singleText = singleNote > 0
    ? await page.locator('[data-testid="cap-single-note-tts.synthesize"]').innerText()
    : "";
  record("settings: 媒体单候选槽位显示'当前仅配置'", singleNote > 0 && singleText.includes("当前仅配置"), singleText.slice(0, 60));

  const emptyNote = await page.locator('[data-testid="cap-empty-video.image_to_video"]').count();
  const emptyText = emptyNote > 0
    ? await page.locator('[data-testid="cap-empty-video.image_to_video"]').innerText()
    : "";
  record("settings: 无候选槽位显示'当前部署无可用模型'", emptyNote > 0 && emptyText.includes("当前部署无可用模型"), emptyText.slice(0, 60));
}

/** 项目设置高级区 + 固定 smart → 失效预览含 LLM 生成阶段。 */
async function verifyProjectSettingsCapabilityArea(page: Page): Promise<void> {
  await page.goto(new URL("/projects", page.url()).toString(), { waitUntil: "domcontentloaded" });
  const createButtons = page.locator("button:has-text('新建项目'), button:has-text('创建项目')");
  await createButtons.first().waitFor({ timeout: 10000 });
  await createButtons.first().click();
  await page.waitForSelector('[data-testid="generate-topic"]', { timeout: 10000 });
  await page.click('[data-testid="generate-topic"]');
  await page.waitForURL(/\/projects\/[^/]+(\/topic)?$/, { timeout: 30000 });

  const settingsButton = page.locator(
    'button:has-text("项目设置"), [data-testid="open-project-settings"]',
  ).first();
  await settingsButton.waitFor({ timeout: 10000 });
  await settingsButton.click();
  await page.waitForSelector('[data-testid="project-capability-settings"]', { timeout: 10000 });
  record("project: 项目设置高级区渲染", true);

  const projectSlots = await page.locator('[data-testid^="project-cap-slot-"]').count();
  record("project: 高级区五槽渲染", projectSlots === 5, `count=${projectSlots}`);

  // 新项目继承用户默认的 fixed 选择（设置页已固定智谱 GLM-4）→ 先断言继承值
  const inheritedChecked = await page.locator(
    '[data-testid="project-cap-candidate-llm.smart-llm.smart.zhipu.glm-4"]',
  ).isChecked();
  record("project: 继承用户默认 fixed（智谱 GLM-4）", inheritedChecked);

  // 改选另一候选（DeepSeek V4 Pro）→ 产生配置变化 → 失效预览出现 LLM 生成阶段
  await page.click('[data-testid="project-cap-candidate-llm.smart-llm.smart.deepseek.deepseek-v4-pro"]');
  await page.waitForSelector('[data-testid="project-invalidation-preview"]', { timeout: 10000 });
  const previewText = await page
    .locator('[data-testid="project-invalidation-preview"]')
    .innerText();
  record("project: 改选候选后失效预览含 LLM 生成", previewText.includes("LLM 生成"), previewText.slice(0, 80));
}

// --- infra（与 s2-2b 脚本同构） ----------------------------------------------

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
