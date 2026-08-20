import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { PrismaFirstAggregateWriter } from "../../../backend/src/db/repositories/prisma-first-aggregate-writer.js";
import { PrismaSecondAggregateWriter } from "../../../backend/src/db/repositories/prisma-second-aggregate-writer.js";
import { PrismaThirdAggregateWriter } from "../../../backend/src/db/repositories/prisma-third-aggregate-writer.js";
import { hydrateFirstAggregates } from "../../../backend/src/db/repositories/prisma-first-aggregate-hydrator.js";
import { hydrateSecondAggregates } from "../../../backend/src/db/repositories/prisma-second-aggregate-hydrator.js";
import { hydrateThirdAggregates } from "../../../backend/src/db/repositories/prisma-third-aggregate-hydrator.js";
import { createGenerationRunRepository } from "../../../backend/src/modules/generation-run/generation-run.repository.js";
import { createOrRestoreGenerationRun } from "../../../backend/src/modules/generation-run/generation-run.service.js";
import { createGenerationCostQuote } from "../../../backend/src/modules/generation-cost/generation-cost.service.js";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";
import { buildQuotableReadinessInput, prepareQuoteProject, seedQuotableCatalog } from "./quote-test-context.js";
import type { AppPrismaClient } from "../../../backend/src/db/prisma-client.types.js";
import type { DbClient, ProjectRecord } from "../../../backend/src/db/client.js";

/**
 * 任务 8 终审遗留 I-1'（9A 步骤 0 收口）：提交重校验输入 DB 权威化。
 *
 * 不变量：提交重校验的重解析输入（项目配置/模型目录/asset plan/storyboard/
 * override/manifest）以数据库为权威。实例 B 的内存镜像落后于实例 A 的
 * 变更时，旧 quote 必须被拒绝，而不是按旧镜像重算后放过。
 *
 * 同时覆盖 F5：quote 感知 enabled_provider_types 执行过滤——
 * 授权上界不得包含执行时会被过滤掉的任务。
 */

const tempDirectories: string[] = [];
const openClients: Array<Awaited<ReturnType<typeof createPrismaClient>>> = [];

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

function createMigratedDatabase(): string {
  const directory = mkdtempSync(join(tmpdir(), "s2-2a-revalidation-db-"));
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

async function createPrismaContext() {
  const databasePath = createMigratedDatabase();
  const client = await createPrismaClient(databasePath);
  openClients.push(client);
  await client.user.create({ data: { id: "u1", username: "t", displayName: "T", passwordHash: "h", role: "USER" } });
  const firstWriter = await PrismaFirstAggregateWriter.create(client, "u1");
  const app = buildApp({
    firstAggregateWriter: firstWriter,
    secondAggregateWriter: new PrismaSecondAggregateWriter(client, "u1"),
    thirdAggregateWriter: new PrismaThirdAggregateWriter(client),
    prismaClient: client,
  });
  await hydrateFirstAggregates(app.db, new Map() as never, client, { storageRoot: process.cwd() });
  await hydrateSecondAggregates(app.db, client);
  await hydrateThirdAggregates(app.db, client);
  await seedQuotableCatalog(app);
  const project = await createProject(app.db, { name: "T", ownerId: "u1" });
  return { client, db: app.db, project };
}

async function createQuote(
  db: DbClient,
  project: ProjectRecord,
  enabledProviderTypes?: string[],
  prismaClient?: AppPrismaClient,
) {
  const result = await createGenerationCostQuote(
    db, project, project.ownerId,
    { operation: "assets.generate", enabled_provider_types: enabledProviderTypes },
    { readinessInput: buildQuotableReadinessInput(), prismaClient },
  );
  if (!result.ok) throw new Error(`quote creation failed: ${JSON.stringify(result.error)}`);
  return result.value.quote;
}

async function submit(
  db: DbClient,
  project: ProjectRecord,
  quoteId: string,
  options: { key: string; enabledProviderTypes?: string[] },
  prismaClient?: AppPrismaClient,
) {
  const repository = createGenerationRunRepository(db, prismaClient);
  return createOrRestoreGenerationRun(
    db, project, project.ownerId,
    {
      operation: "assets.generate",
      costQuoteId: quoteId,
      authorizeBudgetOverride: false,
      idempotencyKey: options.key,
      selection: { task_ids: [] },
      runOverrides: undefined,
      enabledProviderTypes: options.enabledProviderTypes,
      dispatchPayload: { execution_mode: "auto_available" },
    },
    { readinessInput: buildQuotableReadinessInput(), repository, prismaClient },
  );
}

describe("revalidation inputs are database-authoritative (I-1')", () => {
  it("project configuration drift written by another instance rejects the old quote", async () => {
    const { client, db, project } = await createPrismaContext();
    const quote = await createQuote(db, project, undefined, client);

    // 实例 A：直接改数据库里的项目配置（内存镜像保持旧值——模拟实例 B 旧镜像）
    const configRow = await client.projectGenerationConfiguration.findUnique({ where: { projectId: project.id } });
    expect(configRow).not.toBeNull();
    const driftedConfig = {
      ...(configRow!.configurationJson as Record<string, unknown>),
      video: {
        ...((configRow!.configurationJson as Record<string, unknown>).video as Record<string, unknown>),
        api_quality: "high_1080p",
      },
    };
    await client.projectGenerationConfiguration.update({
      where: { projectId: project.id },
      data: { configurationJson: driftedConfig, revision: { increment: 1 } },
    });

    const result = await submit(db, project, quote.id, { key: "i1p-config-drift-1" }, client);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("generation_quote_configuration_changed");
  });

  it("catalog pricing drift written by another instance rejects the old quote", async () => {
    const { client, db, project } = await createPrismaContext();
    const quote = await createQuote(db, project, undefined, client);

    // 实例 A：目录价格变更（内存镜像仍旧价格）——必须选 quote 实际计价使用的条目
    const quoteEntryIds = [...new Set(
      (quote.itemsJson as Array<{ provider_model_id: string }>).map((item) => item.provider_model_id),
    )];
    expect(quoteEntryIds.length).toBeGreaterThan(0);
    const target = await client.providerModelCatalog.findUnique({ where: { id: quoteEntryIds[0]! } });
    expect(target).not.toBeNull();
    await client.providerModelCatalog.update({
      where: { id: target!.id },
      data: {
        pricingJson: {
          ...((target!.pricingJson as Record<string, unknown>)),
          __drift_probe: "pricing-changed-by-instance-a",
        },
        pricingVersion: `${target!.pricingVersion}-drifted`,
      },
    });

    const result = await submit(db, project, quote.id, { key: "i1p-pricing-drift-1" }, client);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("generation_quote_price_changed");
  });

  it("active asset plan pointer moved by another instance rejects the old quote", async () => {
    const { client, db, project } = await createPrismaContext();
    // 建一个带 plan 的项目链路：quote 先按内存/DB 一致的 plan 生成
    const now = new Date();
    await client.topicPackage.create({
      data: {
        id: "tp1", projectId: project.id, title: "T", selectedAngle: "A",
        familyLabel: "F", scopeLabel: "S", coreConflict: "C", strongScene: "SC",
        stakes: "ST", packagingSeed: "PS",
        canonicalQuotesJson: [], canonicalQuoteIntentsJson: [], durationBandJson: {},
        narrativeTensionMapJson: {}, mustIncludeBeatsJson: [], forbiddenExpansionsJson: [],
        riskHintsJson: [], sourceAnchorRefsJson: [], ambiguityNotesJson: [],
        createdAt: now,
      },
    });
    await client.scriptRecord.create({
      data: {
        id: "sr1", projectId: project.id, topicPackageId: "tp1", scriptText: "T", openingSpan: "O", endingSpan: "E",
        estimatedDurationSec: 10, beatTraceJson: [], quoteTraceJson: [], reviewStatus: "pass",
        createdAt: now,
      },
    });
    await client.storyboardRecord.create({
      data: {
        id: "sb_rec_1", projectId: project.id, topicPackageId: "tp1", scriptRecordId: "sr1",
        planJson: {
          segments: [
            { segment_id: "sb_001", api_video_suitability: "api_video_strongly_recommended" },
          ],
        },
        validationResultJson: {}, createdAt: now,
      },
    });
    await client.assetPlanRecord.create({
      data: {
        id: "ap_rec_1", projectId: project.id, topicPackageId: "tp1", scriptRecordId: "sr1",
        storyboardRecordId: "sb_rec_1",
        planJson: {
          tasks: [
            { task_id: "task_img_001", task_type: "image_still", source_segment_id: "sb_001", source_excerpt: "hello" },
          ],
        },
        validationResultJson: {}, executionStateJson: {}, createdAt: now,
      },
    });
    await client.project.update({
      where: { id: project.id },
      data: { activeStoryboardRecordId: "sb_rec_1", activeAssetPlanRecordId: "ap_rec_1" },
    });
    // 同步内存镜像，保证 quote 创建时内存/DB 一致（漂移只发生在提交前）
    const mirrorProject = db.projects.get(project.id)!;
    mirrorProject.activeStoryboardRecordId = "sb_rec_1";
    mirrorProject.activeAssetPlanRecordId = "ap_rec_1";
    db.storyboardRecords.set("sb_rec_1", {
      id: "sb_rec_1", projectId: project.id, topicPackageId: "tp1", scriptRecordId: "sr1",
      planJson: { segments: [{ segment_id: "sb_001", api_video_suitability: "api_video_strongly_recommended" }] },
      validationResultJson: {}, executionStateJson: null, graphTraceSummaryJson: null, runtimeDiagnosticsJson: null,
      createdAt: now,
    });
    db.assetPlanRecords.set("ap_rec_1", {
      id: "ap_rec_1", projectId: project.id, topicPackageId: "tp1", scriptRecordId: "sr1",
      storyboardRecordId: "sb_rec_1",
      planJson: {
        tasks: [
          { task_id: "task_img_001", task_type: "image_still", source_segment_id: "sb_001", source_excerpt: "hello" },
        ],
      } as never,
      validationResultJson: {} as never, executionStateJson: {}, graphTraceSummaryJson: null, runtimeDiagnosticsJson: null,
      createdAt: now,
    });
    const quote = await createQuote(db, project, undefined, client);

    // 实例 A：激活指针移除（实例 B 内存镜像仍旧指向旧 plan）
    await client.project.update({
      where: { id: project.id },
      data: { activeAssetPlanRecordId: null },
    });

    const result = await submit(db, project, quote.id, { key: "i1p-plan-drift-1" }, client);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("generation_quote_fingerprint_mismatch");
  });

  it("positive control: no drift → submit succeeds with database-authoritative inputs", async () => {
    const { client, db, project } = await createPrismaContext();
    const quote = await createQuote(db, project, undefined, client);

    const result = await submit(db, project, quote.id, { key: "i1p-positive-1" }, client);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.created).toBe(true);
      expect(result.value.run.status).toBe("pending_dispatch");
    }
  });
});

describe("quote workload honors enabled_provider_types (F5)", () => {
  it("quote with enabled_provider_types=[tts] prices only tts media items", async () => {
    const { client, db, project } = await createPrismaContext();
    // 带 image/video/tts 三类任务的 plan（直接写库 + 同步镜像）
    const now = new Date();
    await client.topicPackage.create({
      data: {
        id: "tp1", projectId: project.id, title: "T", selectedAngle: "A",
        familyLabel: "F", scopeLabel: "S", coreConflict: "C", strongScene: "SC",
        stakes: "ST", packagingSeed: "PS",
        canonicalQuotesJson: [], canonicalQuoteIntentsJson: [], durationBandJson: {},
        narrativeTensionMapJson: {}, mustIncludeBeatsJson: [], forbiddenExpansionsJson: [],
        riskHintsJson: [], sourceAnchorRefsJson: [], ambiguityNotesJson: [],
        createdAt: now,
      },
    });
    await client.scriptRecord.create({
      data: {
        id: "sr1", projectId: project.id, topicPackageId: "tp1", scriptText: "T", openingSpan: "O", endingSpan: "E",
        estimatedDurationSec: 10, beatTraceJson: [], quoteTraceJson: [], reviewStatus: "pass",
        createdAt: now,
      },
    });
    await client.storyboardRecord.create({
      data: {
        id: "sb_rec_1", projectId: project.id, topicPackageId: "tp1", scriptRecordId: "sr1",
        planJson: {
          segments: [
            { segment_id: "sb_001", api_video_suitability: "api_video_strongly_recommended" },
          ],
        },
        validationResultJson: {}, createdAt: now,
      },
    });
    await client.assetPlanRecord.create({
      data: {
        id: "ap_rec_1", projectId: project.id, topicPackageId: "tp1", scriptRecordId: "sr1",
        storyboardRecordId: "sb_rec_1",
        planJson: {
          tasks: [
            { task_id: "task_img_001", task_type: "image_still", source_segment_id: "sb_001", source_excerpt: "hello" },
            { task_id: "task_video_001", task_type: "video_clip", source_segment_id: "sb_001", source_excerpt: "hello", parameters: { duration_sec: 7 } },
            { task_id: "task_tts_001", task_type: "tts_audio", source_segment_id: null, source_excerpt: "hello" },
          ],
        },
        validationResultJson: {}, executionStateJson: {}, createdAt: now,
      },
    });
    await client.project.update({
      where: { id: project.id },
      data: { activeStoryboardRecordId: "sb_rec_1", activeAssetPlanRecordId: "ap_rec_1" },
    });
    const mirrorProject = db.projects.get(project.id)!;
    mirrorProject.activeStoryboardRecordId = "sb_rec_1";
    mirrorProject.activeAssetPlanRecordId = "ap_rec_1";
    db.storyboardRecords.set("sb_rec_1", {
      id: "sb_rec_1", projectId: project.id, topicPackageId: "tp1", scriptRecordId: "sr1",
      planJson: { segments: [{ segment_id: "sb_001", api_video_suitability: "api_video_strongly_recommended" }] },
      validationResultJson: {}, executionStateJson: null, graphTraceSummaryJson: null, runtimeDiagnosticsJson: null,
      createdAt: now,
    });
    db.assetPlanRecords.set("ap_rec_1", {
      id: "ap_rec_1", projectId: project.id, topicPackageId: "tp1", scriptRecordId: "sr1",
      storyboardRecordId: "sb_rec_1",
      planJson: {
        tasks: [
          { task_id: "task_img_001", task_type: "image_still", source_segment_id: "sb_001", source_excerpt: "hello" },
          { task_id: "task_video_001", task_type: "video_clip", source_segment_id: "sb_001", source_excerpt: "hello", parameters: { duration_sec: 7 } },
          { task_id: "task_tts_001", task_type: "tts_audio", source_segment_id: null, source_excerpt: "hello" },
        ],
      } as never,
      validationResultJson: {} as never, executionStateJson: {}, graphTraceSummaryJson: null, runtimeDiagnosticsJson: null,
      createdAt: now,
    });

    const filtered = await createQuote(db, project, ["tts"], client);
    const unfiltered = await createQuote(db, project, undefined, client);

    const filteredItems = (filtered.itemsJson as Array<{ capability: string }>).map((item) => item.capability);
    expect(filteredItems).toContain("tts.synthesize");
    expect(filteredItems).not.toContain("image.generate");
    expect(filteredItems).not.toContain("video.image_to_video");
    // 未过滤 quote 必须包含 image 与 tts（video 取决于 resolved 路线，不在此断言）
    const unfilteredItems = (unfiltered.itemsJson as Array<{ capability: string }>).map((item) => item.capability);
    expect(unfilteredItems).toContain("tts.synthesize");
    expect(unfilteredItems).toContain("image.generate");
    // 过滤后授权上界不高于未过滤（F5 的保守方向收口）
    expect(BigInt(filtered.authorizationCostMicros) <= BigInt(unfiltered.authorizationCostMicros)).toBe(true);

    // 提交重放不同过滤 → quote 内容指纹漂移被拒
    const mismatch = await submit(
      db, project, filtered.id,
      { key: "f5-mismatch-1", enabledProviderTypes: ["tts", "image", "video"] },
      client,
    );
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.error.code).toBe("generation_quote_fingerprint_mismatch");

    // 同过滤提交 → 成功
    const matched = await submit(
      db, project, filtered.id,
      { key: "f5-matched-1", enabledProviderTypes: ["tts"] },
      client,
    );
    expect(matched.ok).toBe(true);
  });

  it("rejects enabled_provider_types on non-assets operations", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    const project = await prepareQuoteProject(app.db);
    const result = await createGenerationCostQuote(
      app.db, project, project.ownerId,
      { operation: "topic.generate", enabled_provider_types: ["tts"] },
      { readinessInput: buildQuotableReadinessInput() },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("generation_quote_invalid_input");
  });
});
