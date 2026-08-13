import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import type { RunConfigurationSnapshotRecord, GenerationRunRecord, GenerationCostQuoteRecord } from "../../../backend/src/db/client.js";
import { PrismaThirdAggregateWriter } from "../../../backend/src/db/repositories/prisma-third-aggregate-writer.js";
import { applyAllDatabaseMigrations } from "./migration-test-utils.js";

/**
 * S2-2A 任务 2 审查整改（P1-3）：run/quote/snapshot 同项目一致性 writer 强校验。
 * SQLite/Prisma 无法用声明式跨表复合 FK 表达，写入时由事务级强校验兜底。
 */

const tempDirectories: string[] = [];

function createMigratedDatabase(): string {
  const directory = mkdtempSync(join(tmpdir(), "s2-2a-writer-"));
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

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function seedTwoProjects(client: { project: { create: (a: unknown) => Promise<unknown> } }, userId: string) {
  await client.project.create({
    data: { id: "p1", name: "P1", ownerId: userId, createdById: userId, status: "active", storageKey: "p1", storageDisplayName: "P1", storageRenameLocked: false },
  });
  await client.project.create({
    data: { id: "p2", name: "P2", ownerId: userId, createdById: userId, status: "active", storageKey: "p2", storageDisplayName: "P2", storageRenameLocked: false },
  });
}

function snapshotRecord(projectId: string, id: string): RunConfigurationSnapshotRecord {
  return {
    id, projectId, userId: null, stage: "assets", operation: "assets.generate", runId: null,
    projectConfigurationRevision: 1, schemaVersion: "resolved_generation_configuration_v1",
    configurationHash: "fnv1a64:111111111111abc1",
    resolvedConfigurationJson: {}, resolutionTraceJson: [],
    quoteId: null, quoteFingerprint: null,
    estimatedCostMicros: "0", authorizationCostMicros: "0",
    budgetLimitMicros: null, budgetOverrideAuthorized: false,
    pricingHash: null, pricingVersionSetJson: [],
    createdAt: new Date(), updatedAt: new Date(),
  };
}

function runRecord(projectId: string, id: string, snapshotId: string, quoteId: string | null = null): GenerationRunRecord {
  return {
    id, projectId, userId: null, operation: "assets.generate", idempotencyKey: `key-${id}`,
    payloadFingerprint: "fp", quoteId, runConfigurationSnapshotId: snapshotId,
    dispatchPayloadJson: {}, status: "pending_dispatch",
    dispatchLeaseOwner: null, dispatchLeaseExpiresAt: null, dispatchClaimCount: 0,
    createdAt: new Date(), updatedAt: new Date(),
  };
}

describe("S2-2A third aggregate writer project consistency", () => {
  it("rejects a run whose snapshot belongs to a different project", async () => {
    const databasePath = createMigratedDatabase();
    const client = await createPrismaClient(databasePath);
    try {
      await client.user.create({ data: { id: "u1", username: "t", displayName: "T", passwordHash: "h", role: "USER" } });
      await seedTwoProjects(client as never, "u1");
      const writer = new PrismaThirdAggregateWriter(client);
      // p2 的 snapshot
      await writer.appendRunConfigurationSnapshot(snapshotRecord("p2", "snap2"));
      // p1 的 run 关联 p2 的 snapshot → 拒绝
      await expect(
        writer.saveGenerationRun(runRecord("p1", "run1", "snap2")),
      ).rejects.toThrow("generation_run_project_mismatch");
    } finally {
      await client.$disconnect();
    }
  });

  it("rejects a run whose quote belongs to a different project", async () => {
    const databasePath = createMigratedDatabase();
    const client = await createPrismaClient(databasePath);
    try {
      await client.user.create({ data: { id: "u1", username: "t", displayName: "T", passwordHash: "h", role: "USER" } });
      await seedTwoProjects(client as never, "u1");
      const writer = new PrismaThirdAggregateWriter(client);
      await writer.appendRunConfigurationSnapshot(snapshotRecord("p1", "snap1"));
      // p2 的 quote
      const quote: GenerationCostQuoteRecord = {
        id: "q2", projectId: "p2", userId: null, operation: "assets.generate",
        configurationHash: "fnv1a64:111111111111abc1", quoteFingerprint: "sha256:" + "a".repeat(64),
        pricingHash: "sha256:" + "b".repeat(64), pricingVersionSetJson: ["v1"], itemsJson: [],
        estimatedCostMicros: "100", authorizationCostMicros: "100",
        containsUnboundedItem: false, budgetLimitMicros: null, overBudget: false,
        expiresAt: new Date(Date.now() + 600000), consumedAt: null,
        createdAt: new Date(), updatedAt: new Date(),
      };
      await writer.saveGenerationCostQuote(quote);
      // p1 的 run 关联 p2 的 quote → 拒绝
      await expect(
        writer.saveGenerationRun(runRecord("p1", "run1", "snap1", "q2")),
      ).rejects.toThrow("generation_run_project_mismatch");
    } finally {
      await client.$disconnect();
    }
  });

  it("accepts a run whose snapshot and quote belong to the same project", async () => {
    const databasePath = createMigratedDatabase();
    const client = await createPrismaClient(databasePath);
    try {
      await client.user.create({ data: { id: "u1", username: "t", displayName: "T", passwordHash: "h", role: "USER" } });
      await seedTwoProjects(client as never, "u1");
      const writer = new PrismaThirdAggregateWriter(client);
      await writer.appendRunConfigurationSnapshot(snapshotRecord("p1", "snap1"));
      const quote: GenerationCostQuoteRecord = {
        id: "q1", projectId: "p1", userId: null, operation: "assets.generate",
        configurationHash: "fnv1a64:111111111111abc1", quoteFingerprint: "sha256:" + "a".repeat(64),
        pricingHash: "sha256:" + "b".repeat(64), pricingVersionSetJson: ["v1"], itemsJson: [],
        estimatedCostMicros: "100", authorizationCostMicros: "100",
        containsUnboundedItem: false, budgetLimitMicros: null, overBudget: false,
        expiresAt: new Date(Date.now() + 600000), consumedAt: null,
        createdAt: new Date(), updatedAt: new Date(),
      };
      await writer.saveGenerationCostQuote(quote);
      await expect(
        writer.saveGenerationRun(runRecord("p1", "run1", "snap1", "q1")),
      ).resolves.toBeUndefined();
    } finally {
      await client.$disconnect();
    }
  });

  it("rejects invalid money strings at the writer boundary", async () => {
    const databasePath = createMigratedDatabase();
    const client = await createPrismaClient(databasePath);
    try {
      await client.user.create({ data: { id: "u1", username: "t", displayName: "T", passwordHash: "h", role: "USER" } });
      await seedTwoProjects(client as never, "u1");
      const writer = new PrismaThirdAggregateWriter(client);
      const quote: GenerationCostQuoteRecord = {
        id: "q1", projectId: "p1", userId: null, operation: "assets.generate",
        configurationHash: "fnv1a64:111111111111abc1", quoteFingerprint: "sha256:" + "a".repeat(64),
        pricingHash: "sha256:" + "b".repeat(64), pricingVersionSetJson: ["v1"], itemsJson: [],
        estimatedCostMicros: "not-money", authorizationCostMicros: "100",
        containsUnboundedItem: false, budgetLimitMicros: null, overBudget: false,
        expiresAt: new Date(Date.now() + 600000), consumedAt: null,
        createdAt: new Date(), updatedAt: new Date(),
      };
      await expect(writer.saveGenerationCostQuote(quote)).rejects.toThrow("estimated_cost_micros_invalid_micros");
    } finally {
      await client.$disconnect();
    }
  });
});
