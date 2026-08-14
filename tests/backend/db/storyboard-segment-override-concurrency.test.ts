import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { PrismaSecondAggregateWriter } from "../../../backend/src/db/repositories/prisma-second-aggregate-writer.js";
import type { StoryboardSegmentOverrideRecord } from "../../../backend/src/db/client.js";
import { applyAllDatabaseMigrations } from "./migration-test-utils.js";

/**
 * S2-2A 任务 4 整改（P1）：真实双 Prisma client 并发 CAS 测试。
 * 断言：一个成功、一个 conflict（409 语义），数据库 revision 只递增一次。
 */

const tempDirectories: string[] = [];

function createMigratedDatabase(): string {
  const directory = mkdtempSync(join(tmpdir(), "sb-override-concurrency-"));
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

/** 建完整上游链（User→Project→TopicPackage→ScriptRecord→StoryboardRecord），
 * 满足 StoryboardSegmentOverride.storyboardRecordId 外键。 */
async function seedStoryboardRecord(client: Awaited<ReturnType<typeof createPrismaClient>>): Promise<string> {
  const now = new Date();
  await client.user.create({ data: { id: "u1", username: "t", displayName: "T", passwordHash: "h", role: "USER" } });
  await client.project.create({ data: { id: "p1", name: "P", ownerId: "u1", createdById: "u1", storageKey: "p1", storageDisplayName: "P", storageRenameLocked: false } });
  await client.topicPackage.create({
    data: {
      id: "tp1", projectId: "p1", title: "T", selectedAngle: "A",
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
      id: "sr1", projectId: "p1", topicPackageId: "tp1", scriptText: "T", openingSpan: "O", endingSpan: "E",
      estimatedDurationSec: 10, beatTraceJson: [], quoteTraceJson: [], reviewStatus: "pass",
      createdAt: now,
    },
  });
  await client.storyboardRecord.create({
    data: {
      id: "sb_rec_1", projectId: "p1", topicPackageId: "tp1", scriptRecordId: "sr1",
      planJson: {}, validationResultJson: {}, createdAt: now,
    },
  });
  return "sb_rec_1";
}

function makeRecord(projectId: string, storyboardRecordId: string, segmentId: string, strategyOverride: "api_video" | "remotion_motion", revision: number): StoryboardSegmentOverrideRecord {
  const now = new Date();
  return {
    id: `${storyboardRecordId}-${segmentId}-${revision}`,
    projectId,
    storyboardRecordId,
    segmentId,
    strategyOverride,
    revision,
    updatedByUserId: "u1",
    createdAt: now,
    updatedAt: now,
  };
}

describe("storyboard segment override real Prisma concurrency", () => {
  it("concurrent first-create: one succeeds, one conflicts, single row revision=1", async () => {
    const databasePath = createMigratedDatabase();
    const clientA = await createPrismaClient(databasePath);
    const clientB = await createPrismaClient(databasePath);
    const writerA = new PrismaSecondAggregateWriter(clientA);
    const writerB = new PrismaSecondAggregateWriter(clientB);

    try {
      await seedStoryboardRecord(clientA);
      // 两个 client 并发首建同一 (storyboardRecordId, segmentId)
      const record = makeRecord("p1", "sb_rec_1", "seg_1", "api_video", 1);
      const results = await Promise.allSettled([
        writerA.casUpsertStoryboardSegmentOverride(record, 0),
        writerB.casUpsertStoryboardSegmentOverride({ ...record, id: record.id + "-b" }, 0),
      ]);

      const successes = results.filter((r) => r.status === "fulfilled" && r.value.success === true);
      const conflicts = results.filter(
        (r) => r.status === "fulfilled" && !r.value.success && r.value.conflict === true,
      );
      expect(successes.length).toBe(1);
      expect(conflicts.length).toBe(1);

      // 数据库只有一行，revision=1
      const rows = await clientA.storyboardSegmentOverride.findMany({ where: { storyboardRecordId: "sb_rec_1", segmentId: "seg_1" } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.revision).toBe(1);
    } finally {
      await clientA.$disconnect();
      await clientB.$disconnect();
    }
  }, 30000);

  it("concurrent update from revision 1: one succeeds to revision 2, other conflicts with actual revision", async () => {
    const databasePath = createMigratedDatabase();
    const clientA = await createPrismaClient(databasePath);
    const clientB = await createPrismaClient(databasePath);
    const writerA = new PrismaSecondAggregateWriter(clientA);
    const writerB = new PrismaSecondAggregateWriter(clientB);

    try {
      await seedStoryboardRecord(clientA);
      // 先建 revision 1
      const created = await writerA.casUpsertStoryboardSegmentOverride(makeRecord("p1", "sb_rec_1", "seg_1", "api_video", 1), 0);
      expect(created.success).toBe(true);

      // 两个 client 并发从 revision 1 → 2
      const results = await Promise.allSettled([
        writerA.casUpsertStoryboardSegmentOverride(makeRecord("p1", "sb_rec_1", "seg_1", "remotion_motion", 2), 1),
        writerB.casUpsertStoryboardSegmentOverride(makeRecord("p1", "sb_rec_1", "seg_1", "remotion_motion", 2), 1),
      ]);

      const successes = results.filter((r) => r.status === "fulfilled" && r.value.success === true);
      const conflicts = results.filter(
        (r) => r.status === "fulfilled" && !r.value.success && r.value.conflict === true,
      );
      expect(successes.length).toBe(1);
      expect(conflicts.length).toBe(1);
      if (conflicts[0]!.status === "fulfilled" && !conflicts[0]!.value.success) {
        // 失败方返回数据库实际 revision（2）
        expect(conflicts[0]!.value.existingRecord.revision).toBe(2);
      }

      // 数据库 revision=2，只有一行
      const rows = await clientA.storyboardSegmentOverride.findMany({ where: { storyboardRecordId: "sb_rec_1", segmentId: "seg_1" } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.revision).toBe(2);
    } finally {
      await clientA.$disconnect();
      await clientB.$disconnect();
    }
  }, 30000);
});
