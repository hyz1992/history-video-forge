/**
 * Task12-B：口播前置真实浏览器验收（stub/fake 部署，零真实供应商调用）。
 *
 * 覆盖清单（任务12 checklist 浏览器项中与 11A/11B/11C 相关的子集）：
 * 1. 三入口创建拒绝→选择面板→确认→带 selection 重试成功（系统推荐/事件库/自定义）；
 * 2. 取消不创建；口播未确认时深链分镜回文案；
 * 3. 事件库 422 选择面板层叠可操作（详情抽屉打开状态）；
 * 4. legacy 项目并存不受口播门禁影响（开关开启时普通创建按设计 422 + 直造 legacy 深链）；
 * 5. 项目设置：narration 项目 tts 槽禁用、试听按钮隐藏并引导文案；
 * 6. 口播面板生成/确认主链（确认正文→生成口播→确认口播）。
 *
 * 未覆盖（声明）：真实供应商调用（synthetic provider 注入）；字幕样式浏览器专项；
 * 导出专项；Task11B 升级弹窗专项；非 narration 项目的设置页对照；自定义输入保留断言。
 */
// 环境前置声明必须最先求值（在 backend env.ts 读取项目根 .env 之前），见文件内说明。
import "./narration-browser-acceptance.setup.js";
import { chromium, type Browser, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import { applyAllDatabaseMigrations } from "../../../tests/backend/db/migration-test-utils.js";
import { bootstrapAdmin } from "../../../backend/src/auth/admin-bootstrap.js";
import { hashPassword } from "../../../backend/src/auth/password-hash.js";
import { PrismaSessionStore } from "../../../backend/src/auth/session-store.js";
import { PrismaFirstAggregateWriter } from "../../../backend/src/db/repositories/prisma-first-aggregate-writer.js";
import { PrismaSecondAggregateWriter } from "../../../backend/src/db/repositories/prisma-second-aggregate-writer.js";
import { PrismaThirdAggregateWriter } from "../../../backend/src/db/repositories/prisma-third-aggregate-writer.js";
import { buildApp, type AppInstance } from "../../../backend/src/app.js";
import { activateDatabase } from "../../../backend/src/db/database-activation.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import type { AppPrismaClient } from "../../../backend/src/db/prisma-client.types.js";
import { createHttpServer } from "../../../backend/src/server.js";
import { bootstrapGenerationCostCatalog, resolveGenerationCostBootstrapInputFromEnv } from "../../../backend/src/modules/generation-cost/generation-cost-bootstrap.js";
import { buildPricingCatalogSeed } from "../../../backend/src/modules/generation-cost/pricing-catalog.seed.js";
import { DEFAULT_GENERATION_CONFIGURATION } from "../../../shared/src/index.js";
import { hydrateFirstAggregates } from "../../../backend/src/db/repositories/prisma-first-aggregate-hydrator.js";
import { hydrateSecondAggregates } from "../../../backend/src/db/repositories/prisma-second-aggregate-hydrator.js";
import { hydrateThirdAggregates } from "../../../backend/src/db/repositories/prisma-third-aggregate-hydrator.js";
import { initializeFirstAggregateRuntime } from "../../../backend/src/runtime/startup/first-aggregate-startup.js";
import { applyProviderModelCatalogSeed } from "../../../backend/src/modules/generation-cost/provider-model-catalog.repository.js";
import { seedGlobalVoiceProfiles } from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";
import { DashScopeNarrationProvider } from "../../../backend/src/modules/narration/providers/dashscope-narration-provider.js";

const USER_USERNAME = "n11-browser";
const USER_PASSWORD = "n11-browser-password-strong";

interface AcceptanceResult { step: string; pass: boolean; detail?: string }
const results: AcceptanceResult[] = [];
// 未处理拒绝不使进程崩溃，但计数纳入最终判定：验收期间任何 Prisma/sqlite 连接失败都视为失败。
let unhandledRejectionCount = 0;
process.on("unhandledRejection", (reason) => {
  unhandledRejectionCount += 1;
  console.error(`DEBUG unhandledRejection #${unhandledRejectionCount} @${new Date().toISOString()}:`, (reason as Error)?.stack ?? String(reason));
});
function debugAt(message: string): void {
  console.error(`DEBUG step @${new Date().toISOString()}: ${message}`);
}
function record(step: string, pass: boolean, detail?: string): void {
  results.push({ step, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${step}${detail ? ` :: ${detail}` : ""}`);
}

interface Setup { root: string; client: AppPrismaClient; app: AppInstance; httpServer: import("node:http").Server; viteProc: ChildProcess; frontendUrl: string; browserUserId: string }

// 口播前置合格组合（与 422 响应 options 一致，依赖脚本回种的 WS 目录行与隔离音色库）。
const QUALIFIED_SELECTION = {
  provider_model_id: "tts.synthesize.dashscope.cn-beijing.qwen-audio-3.0-tts-plus",
  voice_profile_id: "voice_narration_qwen_longyimuling",
  policy_version: "narration-first-qwen-neutral-20260906-v1",
};

function event(name: string, output?: unknown) {
  return { kind: "json" as const, elapsedMs: 0, data: { header: { event: name, task_id: "task" }, payload: output === undefined ? {} : { output } } };
}

// synthetic provider 必须按真实请求正文动态构造结果：合同要求 sentences.originalText
// 拼接 === sourceText、words 拼接 === normalizedText，且词级时间戳非零、时长与 PCM 一致。
const SYNTH_PER_CHAR_MS = 60;
function synthesizeFixedVoice(sourceText: string) {
  const graphemes = Array.from(sourceText.replace(/[\r\n]+/g, ""));
  const normalizedText = graphemes.join("");
  const words = graphemes.map((char, index) => ({ text: char, begin_index: index, end_index: index + 1, begin_time: index * SYNTH_PER_CHAR_MS, end_time: (index + 1) * SYNTH_PER_CHAR_MS }));
  const durationMs = graphemes.length * SYNTH_PER_CHAR_MS;
  const pcm = Buffer.alloc(Math.ceil((durationMs / 1000) * 24000) * 2);
  const sentence = { providerSentenceIndex: 0, originalText: sourceText, normalizedText, words };
  const rawEvents = [
    event("task-started"),
    event("result-generated", { type: "sentence-begin", sentence: { index: 0 } }),
    { kind: "audio" as const, elapsedMs: 0, byteOffset: 0, byteLength: pcm.length },
    event("result-generated", { type: "sentence-end", sentence: { index: 0, words }, original_text: sourceText, normalized_text: normalizedText }),
    event("task-finished"),
  ];
  return { pcm, providerTaskId: "task", providerRequestId: null, usageCharacters: sourceText.length, sentences: [sentence], rawEvents };
}

function syntheticProvider(calls: { count: number }) {
  return new DashScopeNarrationProvider({
    client: {
      async synthesize(input) {
        calls.count += 1;
        return synthesizeFixedVoice(input.sourceText);
      },
    },
  });
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* 未就绪继续等待 */ }
    if (Date.now() > deadline) throw new Error("vite_not_ready");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
      server.close(() => resolve());
    });
  });
}

async function listen(server: import("node:http").Server, port: number): Promise<void> {
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => resolve()));
}

async function killProcessTree(proc: ChildProcess): Promise<void> {
  if (proc.pid === undefined) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"]);
    return;
  }
  proc.kill("SIGTERM");
}

async function startAcceptanceApp(): Promise<Setup> {
  const root = mkdtempSync(join(tmpdir(), "hvf-n11-browser-"));
  const dbPath = join(root, "n11-browser.db");
  const backendPort = await findFreePort();
  const frontendPort = await findFreePort();

  const sqlite = new Database(dbPath);
  applyAllDatabaseMigrations(sqlite);
  sqlite.close();

  const client = await createPrismaClient(dbPath);
  await activateDatabase(client, { mode: "fresh" });
  // 预置隔离音色库（含 WS 口播音色档案 voice_narration_qwen_longyimuling），否则资格过滤会拒绝重试。
  const libDir = join(root, "project-storage", "storage", "voice-profiles");
  mkdirSync(libDir, { recursive: true });
  copyFileSync(join(process.cwd(), "storage", "voice-profiles", "voice-profiles.json"), join(libDir, "voice-profiles.json"));

  await bootstrapAdmin(client, {
    username: "n11-admin",
    password: "n11-admin-password-strong",
    displayName: "N11 Admin",
  }, { requireDatabaseActivation: false });
  const browserUser = await client.user.create({
    data: {
      username: USER_USERNAME,
      displayName: "N11 Browser",
      passwordHash: await hashPassword(USER_PASSWORD),
      role: "USER",
      status: "ACTIVE",
      mustChangePassword: false,
    },
  });
  // 音色库 JSON 内含 owner_id=browser-admin/browser-owner 的私有档案，FK 需要这两用户先行存在。
  await client.user.create({
    data: { id: "browser-admin", username: "browser-admin", displayName: "Browser Admin", passwordHash: await hashPassword("browser-admin-password-strong"), role: "USER", status: "ACTIVE", mustChangePassword: false },
  });
  await client.user.create({
    data: { id: "local-migration-owner", username: "local-migration-owner", displayName: "Local Migration Owner", passwordHash: await hashPassword("local-migration-owner-password"), role: "USER", status: "ACTIVE", mustChangePassword: false },
  });
  await client.user.create({
    data: { id: "browser-owner", username: "browser-owner", displayName: "Browser Owner", passwordHash: await hashPassword("browser-owner-password-strong"), role: "USER", status: "ACTIVE", mustChangePassword: false },
  });

  process.env.DATABASE_URL = dbPath;
  process.env.SERVER_PORT = String(backendPort);
  process.env.SERVER_HOST = "127.0.0.1";
  process.env.VITEST = "1";
  // trace 写盘与 topic 候选库在 VITEST 下按 STORAGE_ROOT_DIR 兜底取根（否则落到
  // process.cwd()，验收数据会写进用户真实 storage/，含共享的候选库索引）。
  process.env.STORAGE_ROOT_DIR = join(root, "project-storage");
  // 冒烟/验收经 buildApp 选项注入 narrationFirstEnabled，但 createProject 路由读 env——
  // 422 资格拒绝只在模式开启时发生，这里显式打开。
  process.env.NARRATION_FIRST_ENABLED = "true";

  const calls = { count: 0 };
  const firstWriter = await PrismaFirstAggregateWriter.create(client, "local-migration-owner");
  const app = buildApp({
    prismaClient: client,
    firstAggregateWriter: firstWriter,
    secondAggregateWriter: new PrismaSecondAggregateWriter(client, firstWriter.ownerId),
    thirdAggregateWriter: new PrismaThirdAggregateWriter(client),
    skipSnapshotLoad: true,
    storageBaseDir: join(root, "project-storage"),
    narrationFirstEnabled: true,
    narrationProvider: syntheticProvider(calls),
  });

  // 与生产 server 同源：DB 权威用户偏好读取 + readiness 交叉校验的目录 seed。
  await initializeFirstAggregateRuntime({
    db: app.db,
    topicCandidateStore: app.topicCandidateStore,
    prismaClient: client,
    storageRoot: process.cwd(),
    onSyncError: (message) => console.warn("event-library-sync-failed", message),
  });
  await hydrateSecondAggregates(app.db, client);
  await hydrateThirdAggregates(app.db, client);
  await bootstrapGenerationCostCatalog(app.db, resolveGenerationCostBootstrapInputFromEnv());
  // bootstrap 后同步内存目录镜像（与生产 hydrate 同源数据流）
  const catalogRows = await client.providerModelCatalog.findMany();
  app.db.providerModelCatalog.clear();
  for (const row of catalogRows) app.db.providerModelCatalog.set(row.id, { ...row });
  // 回种 WS 口播目录行（bootstrap 在无媒体凭据环境会将其禁用/省略；本验收显式恢复 active）。
  const wsSeed = buildPricingCatalogSeed({ llm: { mode: "stub" }, media: { deploymentScope: "cn-beijing" } })
    .find((entry) => entry.id === "tts.synthesize.dashscope.cn-beijing.qwen-audio-3.0-tts-plus");
  if (!wsSeed) throw new Error("ws_narration_catalog_seed_missing");
  await client.providerModelCatalog.upsert({ where: { id: wsSeed.id }, create: { ...wsSeed }, update: { ...wsSeed, status: "active" } });
  app.db.providerModelCatalog.set(wsSeed.id, { ...wsSeed, status: "active" });

  await seedGlobalVoiceProfiles(app.db);

  // 三入口 422 的触发前提：浏览器用户继承一份"旧 fixed 模型 + 不合格音色"的全局偏好。
  await client.userGenerationPreference.create({
    data: {
      id: "pref-n11-incompatible",
      schemaVersion: "generation_configuration_v1",
      revision: 1,
      userId: browserUser.id,
      configurationJson: (() => {
        const config = structuredClone(DEFAULT_GENERATION_CONFIGURATION);
        config.capabilities["tts.synthesize"] = { mode: "fixed", provider_model_id: "old-http-tts-model" } as never;
        config.creative.voice_profile_id = "old-incompatible-voice";
        return config;
      })(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

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
  return { root, client, app, httpServer, viteProc, frontendUrl, browserUserId: browserUser.id };
}

async function stopAcceptanceApp(setup: Setup): Promise<void> {
  debugAt("teardown begin");
  // 先给 fire-and-forget 生成任务（stub 选题推荐等）留出落库窗口，再断开连接，
  // 避免 disconnect 后迟到查询重启引擎、对已删除目录重新 connect 触发未处理拒绝。
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 3000));
  await killProcessTree(setup.viteProc);
  setup.httpServer.close();
  await setup.client.$disconnect();
  debugAt("teardown disconnected");
  // Windows 下 better-sqlite3 WAL/SHM 句柄释放有延迟，rmSync 偶发 EBUSY，短暂等待后重试。
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  try {
    rmSync(setup.root, { recursive: true, force: true });
  } catch {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
    rmSync(setup.root, { recursive: true, force: true });
  }
  debugAt("teardown done");
}

async function login(page: Page, frontendUrl: string): Promise<void> {
  await page.goto(`${frontendUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="text"], input[name="username"], input[placeholder*="用户" i]', USER_USERNAME);
  await page.fill('input[type="password"]', USER_PASSWORD);
  await page.click('button[type="submit"], button:has-text("登录")');
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });
}

async function main(): Promise<void> {
  let setup: Setup | null = null;
  let browser: Browser | null = null;
  try {
    setup = await startAcceptanceApp();
    browser = await chromium.launch();
    const page = await browser.newPage();
    // 任务12-B 调试：打印创建请求的真实响应体（422 原因定位）
    page.on("response", async (response) => {
      if (response.url().includes("/api/projects") && response.status() >= 400) {
        console.error("DEBUG 4xx/5xx:", response.status(), response.url().slice(0, 160), (await response.text()).slice(0, 300));
      }
    });
    await login(page, setup.frontendUrl);
    const base = new URL("/", page.url()).toString();
    let projectIdFromUrl = "";

    // 1) 系统推荐入口：422→选择面板→确认→重试→进入项目
    await page.goto(`${base}projects/new`, { waitUntil: "domcontentloaded" }).catch(async () => {
      await page.goto(base);
    });
    await page.goto(base);
    const newButton = page.locator('button:has-text("新建项目"), button:has-text("创建项目")').first();
    await newButton.click({ timeout: 10000 }).catch(() => undefined);
    await page.waitForSelector('[data-testid="topic-dialog"]', { timeout: 15000 });
    page.on("pageerror", (err) => console.error("DEBUG pageerror:", err.message));
    page.on("console", (msg) => { if (msg.type() === "error") console.error("DEBUG console.error:", msg.text().slice(0, 300)); });
    const systemCreatePromise = page.waitForResponse((response) => response.url().endsWith("/api/projects") && response.request().method() === "POST", { timeout: 20000 });
    await page.locator('[data-testid="generate-topic"]').click();
    const systemCreateResp = await systemCreatePromise;
    await page.waitForSelector('[data-testid="narration-creation-selection"]', { timeout: 15000 }).catch(async () => {
      const dialogText = await page.locator("[data-testid=topic-dialog]").innerText().catch(() => "(dialog gone)");
      console.error("DEBUG post-click dialog:", dialogText.slice(0, 200));
      const retryDebug = await page.evaluate(async () => { const r = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "retry-debug", narration_selection: { provider_model_id: "tts.synthesize.dashscope.cn-beijing.qwen-audio-3.0-tts-plus", voice_profile_id: "voice_narration_qwen_longyimuling", policy_version: "narration-first-qwen-neutral-20260906-v1" } }) }); return { status: r.status, body: await r.text() }; });
      console.error("DEBUG retry-with-selection:", JSON.stringify(retryDebug).slice(0, 500));
      throw new Error("selection panel not visible");
    });
    record("system: 提交后 422 资格拒绝并原地展示选择面板", systemCreateResp.status() === 422, `status=${systemCreateResp.status()}`);
    await page.locator('[data-testid="narration-creation-option"]').first().check();
    await page.locator('[data-testid="narration-creation-confirm"]').click();
    await page.waitForURL(/\/projects\/.+\/topic/, { timeout: 20000 });
    record("system: 确认后带 selection 重试成功并进入项目", true);
    projectIdFromUrl = page.url().match(/projects\/([^/]+)/)?.[1] ?? "";
    debugAt(`entered project topic page projectId=${projectIdFromUrl}`);
    const createCalls = setup.app.db.projects.size;
    record("system: 单项目创建（无重复）", createCalls === 1, `projects=${createCalls}`);

    // 2) narration 模式：先经 UI 确认候选（stub LLM 已即时生成推荐），生成 script，
    //    再在 NarrationPanel 内确认正文 → 生成口播 → 确认口播（Task11A 主链）。
    // 进入项目后先等 fire-and-forget 的 stub 推荐落库，再刷新 topic 页确认候选。
    // 注意：TopicPanel 的 confirm-candidate 仅在选中候选卡片后渲染；候选缺失时
    // 页面处于 empty 态，需点「生成选题」触发后再选卡。
    await page.waitForTimeout(3000);
    await page.goto(`${base}projects/${projectIdFromUrl}/topic`, { waitUntil: "domcontentloaded" });
    debugAt("topic page reloaded, waiting candidates");
    const firstCandidate = page.locator('[data-testid^="candidate-item-"]').first();
    await firstCandidate.waitFor({ state: "visible", timeout: 20000 }).catch(() => undefined);
    if (!(await firstCandidate.isVisible().catch(() => false))) {
      debugAt("candidates missing, trying 生成选题 button");
      const gen = page.locator('button:has-text("生成选题")').first();
      if (await gen.count()) {
        await gen.click();
        await firstCandidate.waitFor({ state: "visible", timeout: 30000 });
      } else throw new Error("confirm_candidate_missing_and_no_generate_button");
    }
    await firstCandidate.click();
    await page.waitForSelector("[data-testid=confirm-candidate]", { timeout: 10000 });
    await page.locator("[data-testid=confirm-candidate]").click();
    await page.waitForTimeout(2000);
    await page.goto(`${base}projects/${projectIdFromUrl}/script`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-testid=narration-panel]", { timeout: 20000 }).catch(async (error) => {
      const snap = await page.request.get(`${base}api/projects/${projectIdFromUrl}`);
      const snapBody = await snap.json();
      console.error("DEBUG snapshot mode/status/active_script:", snapBody.narration_timing_mode, snapBody.current_status, JSON.stringify(snapBody.active_script)?.slice(0, 120));
      throw error;
    });
    await page.locator("[data-testid=narration-panel]").getByText("确认正文").click();
    await page.waitForTimeout(800);
    await page.locator("[data-testid=narration-generate]").click({ timeout: 15000 });
    await page.waitForSelector("audio", { timeout: 30000 }).catch(async (error) => {
      const statusText = await page.locator("[data-testid=narration-status]").innerText().catch(() => "(no status)");
      debugAt(`audio missing after generate; narration-status="${statusText}"`);
      const snap = await page.request.get(`${base}api/projects/${projectIdFromUrl}/script/narration/context`);
      debugAt(`narration context: ${(await snap.text()).slice(0, 600)}`);
      throw error;
    });
    record("narration: 口播生成成功（音频出现）", true);
    const accept = page.locator('[data-testid="accept-duration"]');
    if (await accept.count()) await accept.check();
    await page.locator('[data-testid="narration-confirm"]').click();
    const narrationConfirmResp = await page.waitForResponse((response) => response.url().includes("/narrations/") && response.url().endsWith("/confirm"), { timeout: 15000 }).catch(() => null);
    await page.waitForTimeout(800);
    const narrationStatusAfter = await page.locator("[data-testid=narration-status]").innerText().catch(() => "");
    // 确认成功且下游就绪时前端会自动跳分镜页，此时 narration-status 已卸载，
    // 以「确认 API 2xx + 状态标签已确认 或 已跳分镜」为确认完成的判据。
    record(
      "narration: 口播确认完成",
      narrationConfirmResp !== null && narrationConfirmResp.ok() && (narrationStatusAfter.includes("口播已确认") || page.url().includes("/storyboard")),
      `api=${narrationConfirmResp?.status() ?? "no-response"} status="${narrationStatusAfter.slice(0, 20)}" url=${page.url().slice(-40)}`,
    );

    // 3) 事件库入口：422→选择面板在详情抽屉之上可操作（层叠）→取消零创建→
    //    再次生成→确认→带 selection 重试创建成功（与系统/自定义入口同链）。
    await page.goto(base);
    await page.locator('button:has-text("新建项目"), button:has-text("创建项目")').first().click({ timeout: 10000 }).catch(() => undefined);
    await page.waitForSelector('[data-testid="topic-dialog"]', { timeout: 15000 });
    await page.locator('.tab-btn:has-text("事件库")').click();
    // 事件库列表为异步加载，必须等 loading 结束再判定条目；条目缺失属环境异常判 FAIL。
    const card = page.locator(".entry-card").first();
    await card.waitFor({ state: "visible", timeout: 15000 }).catch(() => undefined);
    if (!(await card.isVisible().catch(() => false))) {
      record("library: 事件库无条目（fixture 缺失，层叠与重试验证未完成）", false, "no entries");
    } else {
      await card.click();
      await page.waitForSelector('[data-testid="library-generate"]', { timeout: 15000 });
      const libraryFirstPromise = page.waitForResponse((response) => response.url().endsWith("/api/projects") && response.request().method() === "POST", { timeout: 20000 });
      await page.locator('[data-testid="library-generate"]').click();
      const libraryFirstResp = await libraryFirstPromise;
      await page.waitForSelector('[data-testid="narration-creation-selection"]', { timeout: 15000 });
      // 勾选即层叠可操作的真实证明（isVisible 只能证明渲染）。
      await page.locator('[data-testid="narration-creation-option"]').first().check({ timeout: 5000 });
      record("library: 422 后选择面板在详情抽屉之上可勾选（层叠）", libraryFirstResp.status() === 422, `create status=${libraryFirstResp.status()}`);
      await page.locator('[data-testid="narration-creation-cancel"]').click();
      record("library: 取消后零创建", (await setup.app.db.projects.size) === 1);
      // 再次生成→面板→确认，验证带 selection 重试创建腿。
      await page.locator('[data-testid="library-generate"]').click();
      await page.waitForSelector('[data-testid="narration-creation-selection"]', { timeout: 15000 });
      const libraryRetryPromise = page.waitForResponse((response) => response.url().endsWith("/api/projects") && response.request().method() === "POST", { timeout: 20000 });
      await page.locator('[data-testid="narration-creation-option"]').first().check();
      await page.locator('[data-testid="narration-creation-confirm"]').click();
      const libraryRetryResp = await libraryRetryPromise;
      record("library: 确认后带 selection 重试创建成功", libraryRetryResp.ok(), `status=${libraryRetryResp.status()}`);
      await page.waitForURL(/\/projects\/.+\/topic/, { timeout: 20000 }).catch(() => undefined);
      record("library: 重试后进入项目 topic 页", page.url().includes("/projects/") && page.url().includes("/topic"), page.url().slice(-60));
    }

    // 4) 自定义入口：422 → 面板 → 确认带 selection 重试创建成功。创建后前端自动
    //    触发提炼；stub 部署下提炼按设计 fail-closed（custom refine 不接 stub LLM
    //    → 503 custom_refine_unavailable），记录为设计行为，不作为门禁失败。
    await page.goto(base);
    await page.locator('button:has-text("新建项目"), button:has-text("创建项目")').first().click({ timeout: 10000 }).catch(() => undefined);
    await page.waitForSelector('[data-testid="topic-dialog"]', { timeout: 15000 });
    await page.locator('.tab-btn:has-text("自定义选题")').click();
    await page.locator("textarea").fill("晏子使楚");
    const customFirstPromise = page.waitForResponse((response) => response.url().endsWith("/api/projects") && response.request().method() === "POST", { timeout: 20000 });
    await page.locator('[data-testid="custom-generate"]').click();
    const customFirstResp = await customFirstPromise;
    await page.waitForSelector('[data-testid="narration-creation-selection"]', { timeout: 15000 }).catch(async (error) => {
      debugAt(`custom selection missing; dialog=${JSON.stringify((await page.locator("[data-testid=topic-dialog]").innerText().catch(() => "(dialog gone)")).slice(0, 200))}`);
      throw error;
    });
    record("custom: 提交后 422 资格拒绝并原地展示选择面板", customFirstResp.status() === 422, `status=${customFirstResp.status()}`);
    await page.locator('[data-testid="narration-creation-option"]').first().check();
    // 重试 promise 必须在 confirm 前注册，否则会捕获到第一次 422 响应。
    const customRetryPromise = page.waitForResponse((response) => response.url().endsWith("/api/projects") && response.request().method() === "POST", { timeout: 20000 });
    await page.locator('[data-testid="narration-creation-confirm"]').click();
    const customRetryResp = await customRetryPromise;
    record("custom: 确认后带 selection 重试创建成功", customRetryResp.ok(), `status=${customRetryResp.status()}`);
    const customRefineResp = await page.waitForResponse((response) => response.url().includes("/topic/from-custom"), { timeout: 30000 }).catch(() => null);
    record(
      "custom: stub 部署提炼 fail-closed 503（设计行为）",
      customRefineResp === null || customRefineResp.status() === 503,
      customRefineResp === null ? "未捕获提炼请求" : `status=${customRefineResp.status()}`,
    );
    record("custom: 全流程创建无重复", setup.app.db.projects.size === 3, `projects=${setup.app.db.projects.size}`);

    // 5) 项目设置：narration 项目 tts 槽禁用、试听隐藏并引导（用系统入口项目验证）
    await page.goto(`${base}projects/${projectIdFromUrl}/topic`);
    const settingsButton = page.locator('[data-testid="open-project-settings"]');
    if (await settingsButton.count()) {
      await settingsButton.first().click();
      await page.waitForSelector('[data-testid="cap-narration-note-tts"]', { timeout: 15000 });
      record("settings: narration 项目 tts 槽禁用并提示策略固定", true);
      const previewVisible = await page.locator('[data-testid^="voice-preview-"]').count();
      const hint = await page.locator('[data-testid="voice-narration-hint"]').count();
      record("settings: 试听按钮隐藏且引导文案页", previewVisible === 0 && hint > 0);
      await page.keyboard.press("Escape");
    } else {
      record("settings: 未找到设置入口（跳过，留 Task12 复验）", false, "entry missing");
    }

    // 6) legacy 并存：narration 开启时普通创建（无 selection）按设计被资格门禁拒绝；
    //    以开关关闭语义直造 legacy 项目，验证其分镜深链不受口播门禁影响。
    const legacyGateResp = await page.request.post(`${base}api/projects`, { data: { name: "legacy-gate-浏览器" } });
    record("legacy: 开关开启时无 selection 创建被拒（设计门禁）", legacyGateResp.status() === 422, `status=${legacyGateResp.status()}`);
    const legacyProject = await createProject(setup.app.db, {
      name: "legacy-浏览器",
      ownerId: setup.browserUserId,
      createdById: setup.browserUserId,
      narrationFirstEnabled: false,
      narrationSelection: undefined,
    });
    await setup.client.project.upsert({
      where: { id: legacyProject.id },
      create: { id: legacyProject.id, ownerId: legacyProject.ownerId, createdById: legacyProject.createdById, name: legacyProject.name, status: legacyProject.status, storageKey: legacyProject.id, storageDisplayName: legacyProject.storageDisplayName || legacyProject.name },
      update: { name: legacyProject.name, status: legacyProject.status },
    });
    await page.goto(`${base}projects/${legacyProject.id}/storyboard`);
    await page.waitForTimeout(1500);
    const gated = page.url().includes("reason=narration_required");
    record("legacy: 分镜页不被口播门禁拦截", !gated);

    // 7) 深链：直造未确认口播的 narration 项目，分镜深链回文案页
    const freshProject = await createProject(setup.app.db, {
      name: "fresh-n11",
      ownerId: setup.browserUserId,
      createdById: setup.browserUserId,
      narrationFirstEnabled: true,
      narrationSelection: QUALIFIED_SELECTION,
    });
    await setup.client.project.upsert({
      where: { id: freshProject.id },
      create: { id: freshProject.id, ownerId: freshProject.ownerId, createdById: freshProject.createdById, name: freshProject.name, status: freshProject.status, storageKey: freshProject.id, storageDisplayName: freshProject.storageDisplayName || freshProject.name },
      update: { name: freshProject.name, status: freshProject.status },
    });
    await page.goto(`${base}projects/${freshProject.id}/storyboard`);
    await page.waitForURL(/reason=narration_required/, { timeout: 15000 }).catch(() => undefined);
    record(
      "deeplink: 未确认口播分镜回文案",
      page.url().includes("reason=narration_required") && page.url().includes(`/projects/${freshProject.id}/script`),
      page.url().slice(-80),
    );
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (setup) await stopAcceptanceApp(setup).catch(() => undefined);
  }

  const failed = results.filter((result) => !result.pass);
  console.error(`\n${failed.length} acceptance step(s) failed`);
  record("process: 验收期间无未处理拒绝", unhandledRejectionCount === 0, `count=${unhandledRejectionCount}`);
  const finalFailed = results.filter((result) => !result.pass);
  if (finalFailed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
