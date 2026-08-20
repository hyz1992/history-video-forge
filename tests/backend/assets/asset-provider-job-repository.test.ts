import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";
import {
  createAssetProviderJobRecord,
  listAssetProviderJobRecordsByManifest,
  updateAssetProviderJobRecord,
} from "../../../backend/src/modules/assets/asset-provider-job.repository.js";

describe("asset provider job repository", () => {
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

  it("rejects a second job with the same (generationRunId, providerRequestKey, attemptIndex)", async () => {
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
