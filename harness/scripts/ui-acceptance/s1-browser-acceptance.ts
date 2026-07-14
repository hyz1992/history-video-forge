import { chromium, type Browser, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
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
import type { ProjectRecord } from "../../../backend/src/db/client.js";
import { activateDatabase } from "../../../backend/src/db/database-activation.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import type { AppPrismaClient } from "../../../backend/src/db/prisma-client.types.js";
import { createHttpServer } from "../../../backend/src/server.js";

const ADMIN_USERNAME = "s1-admin";
const ADMIN_PASSWORD = "s1-admin-password-strong";
const USER_USERNAME = "s1-alice";
const USER_PASSWORD = "s1-alice-password-strong";
const OTHER_USERNAME = "s1-bob";
const OTHER_PASSWORD = "s1-bob-password-strong";
const MIGRATION_OWNER_USERNAME = "migration-owner";
const PROJECT_NAME = "S1 Browser Legacy Project";

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
  aliceId: string;
  migrationOwnerId: string;
  migrationProjectId: string;
}

const results: AcceptanceResult[] = [];

function record(step: string, pass: boolean, detail?: string): void {
  results.push({ step, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${step}${detail ? ` :: ${detail}` : ""}`);
}

function assertStep(condition: boolean, step: string, detail?: string): void {
  record(step, condition, detail);
  if (!condition) {
    throw new Error(`${step}${detail ? ` :: ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  let setup: Setup | null = null;
  let browser: Browser | null = null;

  try {
    setup = await startAcceptanceApp();
    browser = await chromium.launch();

    const adminPage = await newPage(browser);
    await verifyAnonymousAdminRedirect(adminPage, setup.frontendUrl);
    await verifyMigrationOwnerCannotLogin(adminPage);
    await login(adminPage, ADMIN_USERNAME, ADMIN_PASSWORD);
    await adminPage.waitForSelector(".admin-projects-page", { timeout: 10000 });
    assertStep(adminPage.url().includes("/admin/projects"), "admin reaches projects page", adminPage.url());
    await verifyAdminProjectList(adminPage, setup);
    await verifyAdminUserList(adminPage, setup);
    await transferProjectOwnerInBrowser(adminPage, setup);
    await verifyAdminDeputizeBanner(adminPage, setup);
    await verifyAdminAuditLog(adminPage);
    await adminPage.context().close();

    const alicePage = await newPage(browser);
    await loginAt(alicePage, setup.frontendUrl, USER_USERNAME, USER_PASSWORD, "/projects");
    await verifyAliceOwnsTransferredProject(alicePage, setup);
    await alicePage.context().close();

    const bobPage = await newPage(browser);
    await loginAt(bobPage, setup.frontendUrl, OTHER_USERNAME, OTHER_PASSWORD, "/projects");
    await verifyBobIsolationAndAdminGuard(bobPage, setup);
    await bobPage.context().close();
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (setup) await stopAcceptanceApp(setup);
  }

  const failed = results.filter((result) => !result.pass);
  if (failed.length > 0) {
    console.error(`\n${failed.length} acceptance step(s) failed`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} S1 browser acceptance steps passed`);
}

async function startAcceptanceApp(): Promise<Setup> {
  const root = mkdtempSync(join(tmpdir(), "hvf-s1-browser-"));
  const dbPath = join(root, "s1-browser.db");
  const backendPort = await findFreePort();
  const frontendPort = await findFreePort();

  const sqlite = new Database(dbPath);
  applyAllDatabaseMigrations(sqlite);
  sqlite.close();

  const client = await createPrismaClient(dbPath);
  await activateDatabase(client, { mode: "fresh" });

  await bootstrapAdmin(client, {
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
    displayName: "S1 Admin",
  }, { requireDatabaseActivation: false });
  const alice = await client.user.create({
    data: {
      username: USER_USERNAME,
      displayName: "S1 Alice",
      passwordHash: await hashPassword(USER_PASSWORD),
      role: "USER",
      status: "ACTIVE",
      mustChangePassword: false,
    },
  });
  await client.user.create({
    data: {
      username: OTHER_USERNAME,
      displayName: "S1 Bob",
      passwordHash: await hashPassword(OTHER_PASSWORD),
      role: "USER",
      status: "ACTIVE",
      mustChangePassword: false,
    },
  });
  const migrationOwner = await client.user.create({
    data: {
      username: MIGRATION_OWNER_USERNAME,
      displayName: "migration-owner",
      passwordHash: "!migration-owner-no-login",
      role: "ADMIN",
      status: "ACTIVE",
      mustChangePassword: true,
    },
  });

  const migrationProjectId = `s1-browser-project-${randomUUID().slice(0, 8)}`;
  await client.project.create({
    data: {
      id: migrationProjectId,
      ownerId: migrationOwner.id,
      createdById: migrationOwner.id,
      name: PROJECT_NAME,
      status: "script_ready",
      storageKey: `storage-${migrationProjectId}`,
      storageDisplayName: PROJECT_NAME,
    },
  });

  process.env.DATABASE_URL = dbPath;
  process.env.SERVER_PORT = String(backendPort);
  process.env.SERVER_HOST = "127.0.0.1";
  process.env.VITEST = "1";

  const app = buildApp({ prismaClient: client, skipSnapshotLoad: true });
  mirrorProjectToMemory(app, migrationProjectId, migrationOwner.id);

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

  return {
    root,
    client,
    app,
    httpServer,
    viteProc,
    frontendUrl,
    aliceId: alice.id,
    migrationOwnerId: migrationOwner.id,
    migrationProjectId,
  };
}

function mirrorProjectToMemory(app: AppInstance, projectId: string, ownerId: string): void {
  const now = new Date();
  const project: ProjectRecord = {
    id: projectId,
    name: PROJECT_NAME,
    ownerId,
    createdById: ownerId,
    status: "script_ready",
    activeTopicPackageId: null,
    activeScriptRecordId: null,
    activeStoryboardRecordId: null,
    activeAssetPlanRecordId: null,
    activeAssetManifestRecordId: null,
    activeComposeRecordId: null,
    activeRenderJobRecordId: null,
    activePublishPackageRecordId: null,
    latestTopicRunTraceJson: null,
    latestScriptRunTraceJson: null,
    latestStoryboardRunTraceJson: null,
    latestAssetPlanRunTraceJson: null,
    latestAssetsRunTraceJson: null,
    latestComposeRunTraceJson: null,
    latestRenderRunTraceJson: null,
    storageDisplayName: PROJECT_NAME,
    storageShortId: "",
    storageRootDir: "",
    storageRenameLocked: false,
    createdAt: now,
    updatedAt: now,
  };
  app.db.projects.set(projectId, project);
}

async function stopAcceptanceApp(setup: Setup): Promise<void> {
  await killProcessTree(setup.viteProc);
  await close(setup.httpServer).catch(() => undefined);
  await setup.client.$disconnect().catch(() => undefined);
  rmSync(setup.root, { recursive: true, force: true });
}

async function killProcessTree(processToKill: ChildProcess): Promise<void> {
  if (!processToKill.pid) {
    processToKill.kill();
    return;
  }
  if (process.platform === "win32") {
    await new Promise<void>((resolveKill) => {
      const killer = spawn("taskkill", ["/pid", String(processToKill.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.on("exit", () => resolveKill());
      killer.on("error", () => resolveKill());
    });
    return;
  }
  processToKill.kill("SIGTERM");
}

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

async function verifyAnonymousAdminRedirect(page: Page, frontendUrl: string): Promise<void> {
  await page.goto(`${frontendUrl}/admin/projects`);
  await page.waitForURL(/\/login/, { timeout: 10000 });
  assertStep(page.url().includes("redirect="), "anonymous admin route redirects to login", page.url());
}

async function verifyMigrationOwnerCannotLogin(page: Page): Promise<void> {
  await page.fill("[data-testid='login-username']", MIGRATION_OWNER_USERNAME);
  await page.fill("[data-testid='login-password']", "migration-owner-password");
  await page.click("[data-testid='login-submit']");
  await page.waitForSelector("[data-testid='login-error']", { timeout: 10000 });
  assertStep(page.url().includes("/login"), "migration owner cannot log in", page.url());
}

async function login(page: Page, username: string, password: string): Promise<void> {
  await page.fill("[data-testid='login-username']", username);
  await page.fill("[data-testid='login-password']", password);
  await page.click("[data-testid='login-submit']");
}

async function loginAt(page: Page, frontendUrl: string, username: string, password: string, redirect: string): Promise<void> {
  await page.goto(`${frontendUrl}/login?redirect=${encodeURIComponent(redirect)}`);
  await login(page, username, password);
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 10000 });
}

async function verifyAdminProjectList(page: Page, setup: Setup): Promise<void> {
  const body = await page.locator("body").textContent();
  assertStep(body?.includes(PROJECT_NAME) === true, "admin project list shows migration project");
  assertStep(body?.includes(setup.migrationOwnerId) === true, "admin project list shows migration owner id");
}

async function verifyAdminUserList(page: Page, setup: Setup): Promise<void> {
  await page.goto(`${setup.frontendUrl}/admin/users`);
  await page.waitForSelector(".admin-users-page", { timeout: 10000 });
  const body = await page.locator("body").textContent();
  assertStep(body?.includes(MIGRATION_OWNER_USERNAME) === true, "admin user list shows migration owner");
  assertStep(body?.includes(USER_USERNAME) === true, "admin user list shows regular user");
}

async function transferProjectOwnerInBrowser(page: Page, setup: Setup): Promise<void> {
  await page.goto(`${setup.frontendUrl}/admin/projects`);
  await page.waitForSelector(".admin-projects-page", { timeout: 10000 });
  await page.locator(".action-buttons .el-button").nth(1).click();
  await page.locator(".el-dialog input").first().fill(setup.aliceId);
  await page.locator(".el-dialog textarea").first().fill("browser acceptance transfer");
  await page.locator(".el-dialog .el-button--primary").click();
  await page.waitForFunction(
    ({ ownerId }) => document.body.textContent?.includes(ownerId),
    { ownerId: setup.aliceId },
    { timeout: 10000 },
  );

  const project = await setup.client.project.findUnique({ where: { id: setup.migrationProjectId } });
  assertStep(project?.ownerId === setup.aliceId, "browser transfer changes prisma project owner", project?.ownerId);
  assertStep(setup.app.db.projects.get(setup.migrationProjectId)?.ownerId === setup.aliceId, "browser transfer mirrors owner to memory");
}

async function verifyAdminDeputizeBanner(page: Page, setup: Setup): Promise<void> {
  await page.locator(".action-buttons .el-button").first().click();
  await page.waitForURL(new RegExp(`/projects/${setup.migrationProjectId}/script`), { timeout: 10000 });
  const status = await page.evaluate(async (projectId) => {
    const [me, project] = await Promise.all([
      fetch("/api/auth/me", { credentials: "include" }).then((response) => response.json()),
      fetch(`/api/projects/${projectId}`, { credentials: "include" }).then((response) => response.json()),
    ]);
    return {
      adminId: me?.user?.id,
      ownerId: project?.owner_id,
    };
  }, setup.migrationProjectId);
  record("admin project snapshot resolves owner in browser", status.adminId !== status.ownerId, JSON.stringify(status));
  try {
    await page.waitForSelector("[data-testid='deputize-banner']", { state: "visible", timeout: 10000 });
  } catch (error) {
    const bodyText = await page.locator("body").textContent().catch(() => "");
    throw new Error(`deputize_banner_missing status=${JSON.stringify(status)} body=${bodyText?.slice(0, 240)}`, { cause: error });
  }
  assertStep(status.adminId !== status.ownerId, "admin is viewing another user's project", JSON.stringify(status));
  assertStep(true, "admin sees deputize banner on transferred user project", page.url());
}

async function verifyAdminAuditLog(page: Page): Promise<void> {
  await page.goto(`${page.url().split("/projects/")[0]}/admin/audit-logs`);
  await page.waitForSelector(".admin-audit-page", { timeout: 10000 });
  const auditStatus = await page.evaluate(async () => {
    const response = await fetch("/api/admin/audit-logs/query", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "owner_transfer", limit: 5 }),
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, total: body?.total ?? 0 };
  });
  assertStep(auditStatus.status === 200 && auditStatus.total >= 1, "admin audit query sees owner_transfer", JSON.stringify(auditStatus));
}

async function verifyAliceOwnsTransferredProject(page: Page, setup: Setup): Promise<void> {
  await page.waitForSelector("[data-testid='projects-heading']", { timeout: 10000 });
  const body = await page.locator("body").textContent();
  assertStep(body?.includes(PROJECT_NAME) === true, "alice project list shows transferred project");
  const status = await page.evaluate(async (projectId) => {
    const response = await fetch(`/api/projects/${projectId}`, { credentials: "include" });
    return response.status;
  }, setup.migrationProjectId);
  assertStep(status === 200, "alice can load transferred project snapshot", `status=${status}`);
}

async function verifyBobIsolationAndAdminGuard(page: Page, setup: Setup): Promise<void> {
  await page.waitForSelector("[data-testid='projects-heading']", { timeout: 10000 });
  const body = await page.locator("body").textContent();
  assertStep(body?.includes(PROJECT_NAME) !== true, "bob project list hides alice project");
  const projectStatus = await page.evaluate(async (projectId) => {
    const response = await fetch(`/api/projects/${projectId}`, { credentials: "include" });
    return response.status;
  }, setup.migrationProjectId);
  assertStep(projectStatus === 404, "bob cannot load alice project snapshot", `status=${projectStatus}`);

  await page.goto(`${setup.frontendUrl}/admin/users`);
  await page.waitForURL((url) => !url.pathname.startsWith("/admin"), { timeout: 10000 });
  assertStep(!page.url().includes("/admin"), "user role is redirected away from admin routes", page.url());
}

async function listen(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => resolve()).on("error", reject);
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function findFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve()).on("error", reject);
  });
  const address = server.address();
  await close(server);
  if (!address || typeof address === "string") {
    throw new Error("free_port_unavailable");
  }
  return address.port;
}

function waitFor(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  const check = async (resolve: () => void, reject: (error: Error) => void) => {
    try {
      const response = await fetch(url);
      if (response.ok) {
        resolve();
        return;
      }
    } catch {
      // keep polling
    }
    if (Date.now() - start > timeoutMs) {
      reject(new Error(`Timed out waiting for ${url}`));
      return;
    }
    setTimeout(() => check(resolve, reject), 500);
  };
  return new Promise((resolve, reject) => check(resolve, reject));
}

main().catch((error) => {
  console.error("S1 browser acceptance failed:", error);
  process.exit(1);
});
