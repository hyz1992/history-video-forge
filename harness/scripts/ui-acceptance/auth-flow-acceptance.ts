import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";

import { applyAllDatabaseMigrations } from "../../../tests/backend/db/migration-test-utils.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { activateDatabase } from "../../../backend/src/db/database-activation.js";
import { bootstrapAdmin } from "../../../backend/src/auth/admin-bootstrap.js";
import { hashPassword } from "../../../backend/src/auth/password-hash.js";
import { PrismaSessionStore } from "../../../backend/src/auth/session-store.js";
import { buildApp } from "../../../backend/src/app.js";
import { createLocalRemotionRenderAdapter } from "../../../backend/src/modules/render/local-remotion-render-adapter.js";
import { createHttpServer } from "../../../backend/src/server.js";

const BACKEND_PORT = 5123;
const FRONTEND_PORT = 5174;
const ADMIN_USERNAME = "acceptance-admin";
const ADMIN_PASSWORD = "a-strong-acceptance-admin-pw";
const USER_USERNAME = "acceptance-user";
const USER_PASSWORD = "a-strong-acceptance-user-pw";

interface AcceptanceResult {
  step: string;
  pass: boolean;
  detail?: string;
}

const results: AcceptanceResult[] = [];

function record(step: string, pass: boolean, detail?: string) {
  results.push({ step, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${step}${detail ? ` :: ${detail}` : ""}`);
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "svf2-auth-acceptance-"));
  const dbPath = join(root, "auth-acceptance.db");

  try {
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);
    await activateDatabase(client, { mode: "fresh" });
    await bootstrapAdmin(client, { username: ADMIN_USERNAME, password: ADMIN_PASSWORD }, { requireDatabaseActivation: false });
    await client.user.create({
      data: {
        username: USER_USERNAME,
        displayName: "验收用户",
        passwordHash: await hashPassword(USER_PASSWORD),
        role: "USER",
        status: "ACTIVE",
        mustChangePassword: false,
      },
    });
    await client.$disconnect();

    process.env.DATABASE_URL = dbPath;
    process.env.SERVER_PORT = String(BACKEND_PORT);
    process.env.SERVER_HOST = "127.0.0.1";

    const renderAdapter = createLocalRemotionRenderAdapter();
    const liveClient = await createPrismaClient(dbPath);
    const sessionStore = new PrismaSessionStore(liveClient);
    const app = buildApp({ renderAdapter, skipSnapshotLoad: true, prismaClient: liveClient });
    const httpServer = createHttpServer(app, { sessionStore });

    await new Promise<void>((resolveListen, rejectListen) => {
      httpServer.listen(BACKEND_PORT, "127.0.0.1", () => resolveListen()).on("error", rejectListen);
    });

    const frontendDir = resolve(process.cwd(), "frontend");
    const viteEnv = {
      ...process.env,
      SERVER_PORT: String(BACKEND_PORT),
    };
    const viteProc = spawn(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["vite", "--config", "frontend/vite.config.ts", "--port", String(FRONTEND_PORT), "--strictPort"],
      { cwd: process.cwd(), env: viteEnv, shell: process.platform === "win32" },
    );

    await waitFor(`http://127.0.0.1:${FRONTEND_PORT}/`, 40000);

    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      // 1. 未登录访问受保护路由 → 跳转 /login?redirect=...
      await page.goto(`http://127.0.0.1:${FRONTEND_PORT}/projects`);
      await page.waitForURL(/\/login/, { timeout: 8000 });
      const loginUrl = page.url();
      record(
        "未登录访问 /projects 跳转 /login 带 redirect",
        loginUrl.includes("/login") && loginUrl.includes("redirect="),
        loginUrl,
      );

      // 2. 错误密码 → 留在登录页，泛化错误
      await page.fill("[data-testid='login-username']", ADMIN_USERNAME);
      await page.fill("[data-testid='login-password']", "wrong-password-xxx");
      await page.click("[data-testid='login-submit']");
      await page.waitForSelector("[data-testid='login-error']", { timeout: 8000 });
      const errorText = await page.textContent("[data-testid='login-error']");
      record("错误密码显示泛化错误且不泄漏细节", /用户名或密码错误/.test(errorText ?? ""), errorText ?? "");

      // 3. 正确账号登录 → 进入 redirect 目标 (/projects)
      await page.fill("[data-testid='login-password']", ADMIN_PASSWORD);
      await page.click("[data-testid='login-submit']");
      await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 8000 });
      record("正确凭据登录后进入 redirect 目标", page.url().endsWith("/projects"), page.url());

      // 4. 刷新页面 → /api/auth/me 恢复登录状态
      await page.reload();
      await page.waitForSelector("[data-testid='logout-btn']", { timeout: 8000 });
      const hasLogoutBtn = await page.locator("[data-testid='logout-btn']").isVisible().catch(() => false);
      record("刷新后通过 /api/auth/me 恢复登录态", hasLogoutBtn);

      // 5. 退出 → 回到 /login
      await page.locator("[data-testid='logout-btn']").click();
      await page.waitForURL(/\/login/, { timeout: 8000 });
      record("点击退出回到 /login", page.url().includes("/login"), page.url());

      // 6. 退出后访问受保护页仍需登录
      await page.goto(`http://127.0.0.1:${FRONTEND_PORT}/projects`);
      await page.waitForURL(/\/login/, { timeout: 8000 });
      record("退出后访问受保护页仍需登录", page.url().includes("/login"), page.url());

      // 7. 直接 GET /api/auth/me 无 cookie → 401
      const meRespAnon = await page.evaluate(async () => {
        const r = await fetch("/api/auth/me");
        return r.status;
      });
      record("无 cookie 调 /api/auth/me 返回 401", meRespAnon === 401, `status=${meRespAnon}`);

      // 8. USER 登录 → 进入 /projects（USER 角色验收）
      await page.goto(`http://127.0.0.1:${FRONTEND_PORT}/login?redirect=/projects`);
      await page.fill("[data-testid='login-username']", USER_USERNAME);
      await page.fill("[data-testid='login-password']", USER_PASSWORD);
      await page.click("[data-testid='login-submit']");
      await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 8000 });
      record("USER 角色登录后进入 /projects", page.url().endsWith("/projects"), page.url());

      // 9. USER 退出后回到登录页
      await page.locator("[data-testid='logout-btn']").click();
      await page.waitForURL(/\/login/, { timeout: 8000 });
      record("USER 角色退出后回到 /login", page.url().includes("/login"), page.url());
    } finally {
      await browser.close();
    }

    viteProc.kill();
    httpServer.close();
    await liveClient.$disconnect().catch(() => undefined);
  } finally {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Windows may lock the db file briefly; best-effort cleanup
    }
  }

  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.error(`\n${failed.length} 个验收步骤失败`);
    process.exit(1);
  }
  console.log(`\n全部 ${results.length} 个验收步骤通过`);
}

function waitFor(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  const check = async (resolve: () => void, reject: (e: Error) => void) => {
    try {
      const res = await fetch(url);
      if (res.ok) { resolve(); return; }
    } catch {
      // not ready
    }
    if (Date.now() - start > timeoutMs) {
      reject(new Error(`等待 ${url} 超时`));
      return;
    }
    setTimeout(() => check(resolve, reject), 500);
  };
  return new Promise((resolve, reject) => check(resolve, reject));
}

main().catch((error) => {
  console.error("验收脚本异常:", error);
  process.exit(1);
});
