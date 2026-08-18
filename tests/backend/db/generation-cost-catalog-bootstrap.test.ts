import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import type { ProviderModelCatalogRecord } from "../../../backend/src/db/client.js";
import { createDbClient } from "../../../backend/src/db/client.js";
import { PrismaFirstAggregateWriter } from "../../../backend/src/db/repositories/prisma-first-aggregate-writer.js";
import { hydrateFirstAggregates } from "../../../backend/src/db/repositories/prisma-first-aggregate-hydrator.js";
import {
  bootstrapGenerationCostCatalog,
} from "../../../backend/src/modules/generation-cost/generation-cost-bootstrap.js";
import { listProviderModelCatalog } from "../../../backend/src/modules/generation-cost/provider-model-catalog.repository.js";
import { applyAllDatabaseMigrations } from "./migration-test-utils.js";

/**
 * S2-2A 任务 7 重开（codex 审计 P1-1/P3）：真实 Prisma 启动集成测试。
 *
 * 覆盖：
 * - 迁移占位目录行在 bootstrap 后被禁用（生产 DB 不再把占位数据公开为 enabled）；
 * - seed 行以 active+isDefault 落库；
 * - readiness 不可报价项物化为 disabled 并持久化；
 * - 批量 seed 应用为单事务，中段失败整体回滚（不留半应用状态）。
 */

const tempDirectories: string[] = [];
const openClients: Array<Awaited<ReturnType<typeof createPrismaClient>>> = [];

function createMigratedDatabase(): string {
  const directory = mkdtempSync(join(tmpdir(), "s2-2a-catalog-bootstrap-"));
  tempDirectories.push(directory);
  const databasePath = join(directory, "test.db");
  const database = new Database(databasePath);
  try {
    applyAllDatabaseMigrations(database);
  } finally {
    database.close();
  }
  return databasePath;
}

afterEach(async () => {
  for (const client of openClients.splice(0)) {
    try {
      await client.$disconnect();
    } catch {
      // Windows 下句柄可能已释放，忽略
    }
  }
  for (const directory of tempDirectories.splice(0)) {
    try {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // Prisma 句柄延迟释放时跳过清理，避免 EBUSY 掩盖真实断言
    }
  }
});

const RESOLVED_LLM_INPUT = {
  mode: "resolved" as const,
  smart: { providerKey: "deepseek", modelId: "deepseek-v4-pro" },
  flash: { providerKey: "zhipu", modelId: "glm-4" },
};

const CONFIGURED_MEDIA_INPUT = {
  registeredModels: [
    { capability: "image.generate" as const, providerKey: "dashscope", modelId: "wan2.6-t2i" },
    { capability: "video.image_to_video" as const, providerKey: "dashscope", modelId: "wan2.7-i2v-2026-04-25" },
    { capability: "tts.synthesize" as const, providerKey: "dashscope", modelId: "qwen3-tts-instruct-flash" },
  ],
  credentialConfigured: true,
  deploymentScope: "cn-beijing" as const,
};

const NORMAL_ENVIRONMENT = { demoMode: false, testEnv: false };

async function createBootstrappedContext() {
  const databasePath = createMigratedDatabase();
  const client = await createPrismaClient(databasePath);
  openClients.push(client);
  await client.user.create({ data: { id: "u1", username: "t", displayName: "T", passwordHash: "h", role: "USER" } });
  const writer = await PrismaFirstAggregateWriter.create(client, "u1");
  const db = createDbClient();
  db.firstAggregateWriter = writer;
  await hydrateFirstAggregates(db, new Map() as never, client, { storageRoot: process.cwd() });
  return { client, db, databasePath };
}

describe("generation cost catalog bootstrap (prisma)", () => {
  it("hydrates migration placeholder rows, then disables them and persists the real seed", async () => {
    const { client, db } = await createBootstrappedContext();

    // hydrate 后内存含任务 2 迁移的占位行（active+isDefault，pricingJson 为空）。
    const placeholdersBefore = listProviderModelCatalog(db);
    expect(placeholdersBefore.length).toBe(5);
    expect(placeholdersBefore.map((e) => e.id)).toContain("llm.smart.dashscope.qwen-max");
    expect(placeholdersBefore.map((e) => e.id)).toContain("video.image_to_video.dashscope.video-v1");

    const result = await bootstrapGenerationCostCatalog(db, {
      llm: RESOLVED_LLM_INPUT,
      media: CONFIGURED_MEDIA_INPUT,
      environment: NORMAL_ENVIRONMENT,
    });
    expect(result.readiness.ok).toBe(true);
    expect(result.disabledProviderModelIds).toEqual([]);

    // 数据库断言：占位行 disabled+非默认；seed 行 active+默认。
    const placeholderRow = await client.providerModelCatalog.findUnique({
      where: { id: "llm.smart.dashscope.qwen-max" },
    });
    expect(placeholderRow?.status).toBe("disabled");
    expect(placeholderRow?.isDefault).toBe(false);

    const seedRow = await client.providerModelCatalog.findUnique({
      where: { id: "llm.smart.deepseek.deepseek-v4-pro" },
    });
    expect(seedRow?.status).toBe("active");
    expect(seedRow?.isDefault).toBe(true);
    expect(seedRow?.pricingVersion).toBe("llm-deepseek-2026-08-17");

    const mediaRow = await client.providerModelCatalog.findUnique({
      where: { id: "video.image_to_video.dashscope.cn-beijing.wan2.7-i2v-2026-04-25" },
    });
    expect(mediaRow?.status).toBe("active");
    expect(mediaRow?.isDefault).toBe(true);

    const totalRows = await client.providerModelCatalog.count();
    expect(totalRows).toBe(10); // 5 占位（disabled）+ 5 seed（active）
  });

  it("persists readiness-materialized disables for demo environments", async () => {
    const { client, db } = await createBootstrappedContext();
    const result = await bootstrapGenerationCostCatalog(db, {
      llm: RESOLVED_LLM_INPUT,
      media: CONFIGURED_MEDIA_INPUT,
      environment: { demoMode: true, testEnv: false },
    });
    expect(result.readiness.ok).toBe(false);
    expect(result.disabledProviderModelIds).toEqual([
      "video.image_to_video.dashscope.cn-beijing.wan2.7-i2v-2026-04-25",
    ]);

    const videoRow = await client.providerModelCatalog.findUnique({
      where: { id: "video.image_to_video.dashscope.cn-beijing.wan2.7-i2v-2026-04-25" },
    });
    expect(videoRow?.status).toBe("disabled");
    expect(videoRow?.isDefault).toBe(false);
  });

  it("disables media rows and keeps llm rows when restarting under an unknown deployment scope", async () => {
    // 区域链路（diff_reviewer Minor-4）：北京 bootstrap 后媒体行 active；
    // 切换未知 endpoint 重启 → 媒体行被禁用（公开目录无媒体行），LLM 行保留，
    // readiness 输出 capability 级 media_deployment_scope_unknown。
    const { client, db } = await createBootstrappedContext();
    void client;
    const unknownInput = {
      llm: RESOLVED_LLM_INPUT,
      media: { registeredModels: [], credentialConfigured: true, deploymentScope: "unknown" as const },
      environment: NORMAL_ENVIRONMENT,
    };
    const result = await bootstrapGenerationCostCatalog(db, unknownInput);
    expect(result.readiness.ok).toBe(false);
    expect(
      result.readiness.issues.filter((i) => i.code === "media_deployment_scope_unknown").length,
    ).toBe(3);
    for (const capability of ["image.generate", "video.image_to_video", "tts.synthesize"]) {
      const row = listProviderModelCatalog(db).find((e) => e.capability === capability);
      expect(row?.status, capability).toBe("disabled");
    }
    // LLM 不受区域影响：seed 行保持 active（占位行被禁用后仍存在）。
    const llmRows = listProviderModelCatalog(db).filter((e) => e.capability === "llm.smart");
    expect(llmRows.some((e) => e.status === "active")).toBe(true);
    expect(llmRows.some((e) => e.status === "disabled")).toBe(true); // 迁移占位行
  });

  it("rolls back the whole batch when any catalog upsert fails mid-way", async () => {
    const { client, db } = await createBootstrappedContext();
    const before = await client.providerModelCatalog.count();

    const template = listProviderModelCatalog(db)[0]!;
    const probeA: ProviderModelCatalogRecord = { ...template, id: "rollback.probe.a" };
    const probeB: ProviderModelCatalogRecord = { ...template, id: "rollback.probe.b" };
    const invalid: ProviderModelCatalogRecord = {
      ...template,
      id: "rollback.probe.invalid",
      // 违反数据库 CHECK 约束的 capability 会让事务中段失败。
      capability: "not.acapability" as never,
    };
    // 直接经 writer 实例调用（保留 this 绑定，codex P3-A：抽出方法会因 this 解绑
    // 抛 TypeError 形成假阳性），并断言触发的是数据库 CHECK 约束而非 this 错误。
    const writer = db.firstAggregateWriter!;
    const failure = await writer
      .applyProviderModelCatalogSeedBatch!([probeA, invalid, probeB])
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(failure).toBeInstanceOf(Error);
    const message = failure instanceof Error ? failure.message : String(failure);
    expect(message).not.toContain("Cannot read properties of undefined");
    expect(message).toMatch(/constraint|check/i);

    const after = await client.providerModelCatalog.count();
    expect(after).toBe(before); // 成功前缀（probeA）也被回滚，不留半应用状态
    expect(await client.providerModelCatalog.findUnique({ where: { id: "rollback.probe.a" } })).toBeNull();
    expect(await client.providerModelCatalog.findUnique({ where: { id: "rollback.probe.b" } })).toBeNull();
  });
});
