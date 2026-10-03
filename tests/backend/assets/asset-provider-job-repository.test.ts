import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { PrismaThirdAggregateWriter } from "../../../backend/src/db/repositories/prisma-third-aggregate-writer.js";
import { hydrateThirdAggregates } from "../../../backend/src/db/repositories/prisma-third-aggregate-hydrator.js";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";
import {
  createAssetProviderJobRecord,
  listAssetProviderJobRecordsByManifest,
  updateAssetProviderJobRecord,
} from "../../../backend/src/modules/assets/asset-provider-job.repository.js";

describe("asset provider job repository", () => {
  it("恢复更新接收真实提交观测时间，后续 patch 不覆盖或清空首次时间", async () => {
    const db = createDbClient();
    const created = await createAssetProviderJobRecord(db, {
      assetManifestRecordId: "manifest_001", assetRunId: "run_001", executionId: "exec_001", taskId: "task_001",
      providerType: "image", providerName: "fake_image", providerJobId: null, status: "prepared", attemptCount: 1,
      rawRequestJson: {}, rawResponseJson: null, errorCode: null, errorMessage: null,
    });
    const observedSubmittedAt = new Date("2026-10-03T01:00:01Z");
    const recovered = await updateAssetProviderJobRecord(db, created.id, { status: "failed", submittedAt: observedSubmittedAt });
    expect(recovered?.submittedAt).toEqual(observedSubmittedAt);
    const later = await updateAssetProviderJobRecord(db, created.id, { submittedAt: new Date("2026-10-03T01:00:03Z") });
    expect(later?.submittedAt).toEqual(observedSubmittedAt);
    const cleared = await updateAssetProviderJobRecord(db, created.id, { submittedAt: null });
    expect(cleared?.submittedAt).toEqual(observedSubmittedAt);
  });

  it("更新补首次 submittedAt，重复 submitted 和终态更新保留首次时间与身份", async () => {
    vi.useFakeTimers();
    try {
      const db = createDbClient();
      vi.setSystemTime(new Date("2026-10-03T01:00:00Z"));
      const created = await createAssetProviderJobRecord(db, {
        assetManifestRecordId: "manifest_001", assetRunId: "run_001", executionId: "exec_001", taskId: "task_001",
        providerType: "image", providerName: "fake_image", providerJobId: null, status: "prepared", attemptCount: 1,
        generationRunId: "run_001", providerRequestKey: "assets:run_001:task_001", attemptIndex: 0,
        rawRequestJson: { prompt: "古代宫殿" }, rawResponseJson: null, errorCode: null, errorMessage: null,
      });
      vi.setSystemTime(new Date("2026-10-03T01:00:01Z"));
      const submitted = await updateAssetProviderJobRecord(db, created.id, { status: "submitted", providerJobId: "remote_001" });
      expect(submitted?.submittedAt).toEqual(new Date("2026-10-03T01:00:01Z"));
      vi.setSystemTime(new Date("2026-10-03T01:00:02Z"));
      const repeated = await updateAssetProviderJobRecord(db, created.id, { status: "submitted", rawResponseJson: { accepted: true } });
      expect(repeated?.submittedAt).toEqual(submitted?.submittedAt);
      vi.setSystemTime(new Date("2026-10-03T01:00:03Z"));
      const completed = await updateAssetProviderJobRecord(db, created.id, { status: "completed" });
      expect(completed?.completedAt).toEqual(new Date("2026-10-03T01:00:03Z"));
      vi.setSystemTime(new Date("2026-10-03T01:00:04Z"));
      const terminalUpdate = await updateAssetProviderJobRecord(db, created.id, { status: "completed", rawResponseJson: { output: "ok" } });
      expect(terminalUpdate).toMatchObject({
        id: created.id, submittedAt: submitted?.submittedAt, completedAt: completed?.completedAt, createdAt: created.createdAt,
        updatedAt: new Date("2026-10-03T01:00:04Z"), rawRequestJson: created.rawRequestJson,
        generationRunId: "run_001", providerRequestKey: "assets:run_001:task_001", attemptIndex: 0,
        assetManifestRecordId: "manifest_001", assetRunId: "run_001", executionId: "exec_001", taskId: "task_001",
      });
    } finally { vi.useRealTimers(); }
  });

  it.each(["completed", "failed", "canceled"] as const)("%s 首次终态时间不会被后续更新覆盖", async status => {
    vi.useFakeTimers();
    try {
      const db = createDbClient();
      const created = await createAssetProviderJobRecord(db, {
        assetManifestRecordId: "manifest_001", assetRunId: "run_001", executionId: "exec_001", taskId: "task_001",
        providerType: "image", providerName: "fake_image", providerJobId: null, status: "prepared", attemptCount: 1,
        rawRequestJson: {}, rawResponseJson: null, errorCode: null, errorMessage: null,
      });
      vi.setSystemTime(new Date("2026-10-03T01:00:01Z"));
      const terminal = await updateAssetProviderJobRecord(db, created.id, { status });
      expect(terminal?.completedAt).toEqual(new Date("2026-10-03T01:00:01Z"));
      vi.setSystemTime(new Date("2026-10-03T01:00:02Z"));
      const repeated = await updateAssetProviderJobRecord(db, created.id, { status, errorMessage: "已对账" });
      expect(repeated?.completedAt).toEqual(terminal?.completedAt);
      expect(repeated?.submittedAt).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("creates, updates, and lists provider jobs by manifest record id", async () => {
    const db = createDbClient();

    const created = await createAssetProviderJobRecord(db, {
      assetManifestRecordId: "manifest_001",
      assetRunId: "assets_run_001",
      executionId: "exec_img_001",
      taskId: "img_001",
      providerType: "image",
      providerName: "fake_image",
      providerJobId: "job_001",
      status: "submitted",
      attemptCount: 1,
      rawRequestJson: { prompt: "test" },
      rawResponseJson: null,
      errorCode: null,
      errorMessage: null,
    });

    expect(created.id).toBeTruthy();
    expect(created.status).toBe("submitted");

    const updated = await updateAssetProviderJobRecord(db, created.id, {
      status: "completed",
      rawResponseJson: { output: "ok" },
    });

    expect(updated?.status).toBe("completed");
    expect(updated?.rawResponseJson).toMatchObject({ output: "ok" });

    const jobs = await listAssetProviderJobRecordsByManifest(
      db,
      "manifest_001",
    );

    expect(jobs).toHaveLength(1);
    expect(jobs[0].taskId).toBe("img_001");
  });
});

// ─── S2-2A 任务 9A：call-intent 身份三元组（数据库唯一防线） ──────────────────

describe("asset provider job call-intent uniqueness (任务 9A 步骤 1)", () => {
  const tempDirectories: string[] = [];
  const openClients: Array<{ $disconnect(): Promise<unknown> }> = [];

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
        // 忽略句柄延迟释放
      }
    }
  });

  async function createRelationalFixture() {
    const directory = mkdtempSync(join(tmpdir(), "s2-2a-job-intent-"));
    tempDirectories.push(directory);
    const databasePath = join(directory, "test.db");
    const database = new Database(databasePath);
    try {
      applyAllDatabaseMigrations(database);
    } finally {
      database.close();
    }
    const client = await createPrismaClient(databasePath);
    openClients.push(client);
    await client.user.create({ data: { id: "u1", username: "t", displayName: "T", passwordHash: "h", role: "USER" } });
    await client.project.create({
      data: { id: "p1", name: "P", ownerId: "u1", createdById: "u1", storageKey: "p1", storageDisplayName: "P" },
    });
    await client.topicPackage.create({
      data: {
        id: "tp1", projectId: "p1", title: "T", selectedAngle: "A", familyLabel: "F", scopeLabel: "S",
        coreConflict: "C", strongScene: "SC", stakes: "ST", packagingSeed: "PS",
        canonicalQuotesJson: [], canonicalQuoteIntentsJson: [], durationBandJson: {},
        narrativeTensionMapJson: {}, mustIncludeBeatsJson: [], forbiddenExpansionsJson: [],
        riskHintsJson: [], sourceAnchorRefsJson: [], ambiguityNotesJson: [],
      },
    });
    await client.scriptRecord.create({
      data: {
        id: "sr1", projectId: "p1", topicPackageId: "tp1", scriptText: "T", openingSpan: "O", endingSpan: "E",
        estimatedDurationSec: 10, beatTraceJson: [], quoteTraceJson: [], reviewStatus: "pass",
      },
    });
    await client.storyboardRecord.create({
      data: { id: "sb1", projectId: "p1", topicPackageId: "tp1", scriptRecordId: "sr1", planJson: {}, validationResultJson: {} },
    });
    await client.assetPlanRecord.create({
      data: {
        id: "ap1", projectId: "p1", topicPackageId: "tp1", scriptRecordId: "sr1", storyboardRecordId: "sb1",
        planJson: { tasks: [] }, validationResultJson: {}, executionStateJson: {},
      },
    });
    await client.assetManifestRecord.create({
      data: {
        id: "manifest_intent_1", projectId: "p1", topicPackageId: "tp1", scriptRecordId: "sr1",
        storyboardRecordId: "sb1", assetPlanRecordId: "ap1", revision: 1,
        manifestJson: {}, validationResultJson: {},
      },
    });
    await client.runConfigurationSnapshot.create({
      data: {
        id: "snap_intent_1", projectId: "p1", stage: "assets", operation: "assets.generate",
        runId: null, projectConfigurationRevision: 1, schemaVersion: "v1", configurationHash: "h",
        resolvedConfigurationJson: {}, resolutionTraceJson: [], quoteId: null, quoteFingerprint: null,
        estimatedCostMicros: "1000", authorizationCostMicros: "2000", budgetLimitMicros: null,
        budgetOverrideAuthorized: false, pricingHash: null, pricingVersionSetJson: [],
      },
    });
    await client.generationRun.create({
      data: {
        id: "run_intent_1", projectId: "p1", operation: "assets.generate", idempotencyKey: "k1",
        payloadFingerprint: "f", runConfigurationSnapshotId: "snap_intent_1", dispatchPayloadJson: {},
        status: "succeeded",
      },
    });
    const db = createDbClient();
    db.projects.set("p1", { id: "p1", ownerId: "u1" } as never);
    await hydrateThirdAggregates(db, client);
    db.thirdAggregateWriter = new PrismaThirdAggregateWriter(client);
    return { databasePath, client, db };
  }

  it.each(["running", "completed", "failed"] as const)("真实 SQLite 重连重载保留 %s 状态、ID、响应和时间", async status => {
    const { databasePath, client, db } = await createRelationalFixture();
    const created = await createAssetProviderJobRecord(db, {
      assetManifestRecordId: "manifest_intent_1", assetRunId: "run_intent_1", executionId: "exec_img_001", taskId: "img_001",
      providerType: "image", providerName: "fake_image", providerJobId: null, status: "prepared", attemptCount: 1,
      generationRunId: "run_intent_1", providerRequestKey: "assets:run_intent_1:img_001", attemptIndex: 0,
      rawRequestJson: { prompt: "古代宫殿" }, rawResponseJson: null, errorCode: null, errorMessage: null,
    });
    const submitted = await updateAssetProviderJobRecord(db, created.id, {
      status: "submitted", providerJobId: "remote_001", rawResponseJson: { request_id: "submit_001" },
    });
    expect(submitted?.submittedAt).toBeInstanceOf(Date);
    const updated = await updateAssetProviderJobRecord(db, created.id, {
      status, rawResponseJson: { request_id: "poll_001", state: status }, lastPolledAt: new Date("2026-10-03T01:00:02Z"),
      errorCode: status === "failed" ? "remote_rejected" : null, errorMessage: status === "failed" ? "供应商拒绝" : null,
    });
    expect(updated?.completedAt).toEqual(status === "running" ? null : expect.any(Date));
    await client.$disconnect();
    const reopened = await createPrismaClient(databasePath);
    openClients.push(reopened);
    const reloaded = createDbClient();
    reloaded.projects.set("p1", { id: "p1", ownerId: "u1" } as never);
    await hydrateThirdAggregates(reloaded, reopened);
    expect(reloaded.assetProviderJobRecords.get(created.id)).toEqual(updated);
    expect(reloaded.assetProviderJobRecords.size).toBe(1);
    expect(reloaded.assetProviderJobRecords.get(created.id)).toMatchObject({
      status, providerJobId: "remote_001", rawRequestJson: { prompt: "古代宫殿" },
      rawResponseJson: { request_id: "poll_001", state: status }, submittedAt: submitted?.submittedAt,
      generationRunId: "run_intent_1", providerRequestKey: "assets:run_intent_1:img_001", attemptIndex: 0,
    });
  });

  it("真实 SQLite 恢复 failed 后重载仍保留本次提交观测时间", async () => {
    const { databasePath, client, db } = await createRelationalFixture();
    const created = await createAssetProviderJobRecord(db, {
      assetManifestRecordId: "manifest_intent_1", assetRunId: "run_intent_1", executionId: "exec_img_001", taskId: "img_001",
      providerType: "image", providerName: "fake_image", providerJobId: null, status: "prepared", attemptCount: 1,
      generationRunId: "run_intent_1", providerRequestKey: "assets:run_intent_1:img_001", attemptIndex: 0,
      rawRequestJson: { prompt: "古代宫殿" }, rawResponseJson: null, errorCode: null, errorMessage: null,
    });
    const submittedAt = new Date("2026-10-03T01:00:01Z");
    await updateAssetProviderJobRecord(db, created.id, {
      status: "failed", submittedAt, providerJobId: "remote_001", rawResponseJson: { request_id: "submit_001" },
      errorCode: "adapter_pipeline_error", errorMessage: "job_write_failed",
    });
    await client.$disconnect();
    const reopened = await createPrismaClient(databasePath);
    openClients.push(reopened);
    const reloaded = createDbClient();
    reloaded.projects.set("p1", { id: "p1", ownerId: "u1" } as never);
    await hydrateThirdAggregates(reloaded, reopened);
    expect(reloaded.assetProviderJobRecords.get(created.id)).toMatchObject({
      status: "failed", submittedAt, providerJobId: "remote_001", rawResponseJson: { request_id: "submit_001" },
      generationRunId: "run_intent_1", providerRequestKey: "assets:run_intent_1:img_001", attemptIndex: 0,
    });
  });

  it("rejects a second job with the same (generationRunId, providerRequestKey, attemptIndex)", async () => {
    const { client } = await createRelationalFixture();
    const jobRow = {
      assetManifestRecordId: "manifest_intent_1",
      assetRunId: "run_intent_1",
      executionId: "exec_tts_001",
      taskId: "tts_001",
      providerType: "tts",
      providerName: "dashscope_tts",
      status: "succeeded",
      attemptCount: 1,
      generationRunId: "run_intent_1",
      providerRequestKey: "assets:run_intent_1:tts_001",
      attemptIndex: 0,
    };
    // 第二条同身份插入被唯一索引拒绝（防重复计费提交的数据库最终防线）
    await client.assetProviderJobRecord.create({ data: { id: "job_intent_1", ...jobRow } });
    await expect(
      client.assetProviderJobRecord.create({ data: { id: "job_intent_2", ...jobRow } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
