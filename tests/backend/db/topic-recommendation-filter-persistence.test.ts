import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { hydrateFirstAggregates } from "../../../backend/src/db/repositories/prisma-first-aggregate-hydrator.js";
import { PrismaFirstAggregateWriter } from "../../../backend/src/db/repositories/prisma-first-aggregate-writer.js";
import { PrismaRecommendationStore } from "../../../backend/src/db/repositories/prisma-recommendation-store.js";
import {
  recordProjectRecommendationRound,
  saveCachedCandidate,
} from "../../../backend/src/modules/cache/candidate-cache.repository.js";
import { applyAllDatabaseMigrations } from "./migration-test-utils.js";

const tempDirectories: string[] = [];

async function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "history-video-forge-filter-persistence-"));
  tempDirectories.push(root);
  const databasePath = join(root, "test.db");
  const sqlite = new Database(databasePath);
  applyAllDatabaseMigrations(sqlite);
  sqlite.close();

  const client = await createPrismaClient(databasePath);
  const owner = await client.user.create({
    data: {
      id: "owner",
      username: "owner",
      displayName: "Owner",
      passwordHash: "hash",
      role: "ADMIN",
    },
  });
  const project = await client.project.create({
    data: {
      id: "project",
      ownerId: owner.id,
      createdById: owner.id,
      name: "Project",
      status: "topic_candidates_ready",
      storageKey: "project",
      storageDisplayName: "Project",
    },
  });
  const writer = await PrismaFirstAggregateWriter.create(client, owner.id);
  const db = createDbClient();
  db.firstAggregateWriter = writer;

  return { root, client, project, db };
}

function candidateInput(projectId: string | null, fingerprint: string) {
  return {
    projectId,
    fingerprint,
    eventIdentity: `event-${fingerprint}`,
    oneLineAngle: "angle",
    familyLabel: "family",
    scopeLabel: "single-event",
    viralRubricJson: {},
    estimatedDurationBandJson: "medium",
    strongScene: "scene",
    coreConflict: "conflict",
    mustCoverPreviewJson: [],
    sourceHint: "source",
    recentUsageHint: "unused",
    whyThisNow: "timely",
    riskHintsJson: [],
  };
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("topic recommendation filter persistence", () => {
  it("persists one normalized filter across cache, round, and exposure", async () => {
    const { client, project, db } = await createFixture();
    const filterFingerprint = "0123456789abcdef";
    const filterJson = {
      event_domain: "military_warfare",
      storytelling_lens: "turning_point",
    };

    try {
      await saveCachedCandidate(db, {
        ...candidateInput(project.id, "candidate-fingerprint"),
        filterFingerprint,
      });
      const legacyShapedCandidate = {
        eventRegistryEntryId: "",
        eventIdentity: "event-candidate-fingerprint",
        title: "Filtered event",
        fingerprint: "candidate-fingerprint",
        filterFingerprint: "ffffffffffffffff",
      };
      const inMemoryRound = await recordProjectRecommendationRound(db, {
        projectId: project.id,
        filterFingerprint,
        filterJson,
        candidates: [legacyShapedCandidate],
      });

      const cache = await client.recommendationCandidateCache.findFirstOrThrow();
      const round = await client.recommendationRound.findFirstOrThrow({
        include: { exposures: true },
      });
      expect(cache.filterFingerprint).toBe(filterFingerprint);
      expect(round).toMatchObject({ filterFingerprint, filterJson });
      expect(inMemoryRound.candidates).toEqual([
        expect.objectContaining({ filterFingerprint }),
      ]);
      expect(round.exposures).toEqual([
        expect.objectContaining({ filterFingerprint }),
      ]);
    } finally {
      await client.$disconnect();
    }
  });

  it("hydrates legacy null filter fields without inventing a fingerprint", async () => {
    const { root, client, project } = await createFixture();

    try {
      await client.recommendationCandidateCache.create({
        data: {
          id: "legacy-candidate",
          ...candidateInput(project.id, "legacy-candidate"),
        },
      });
      await client.recommendationRound.create({
        data: {
          projectId: project.id,
          roundIndex: 1,
          exposures: {
            create: [{
              eventIdentity: "event-legacy-candidate",
              title: "Legacy event",
              fingerprint: "legacy-candidate",
            }],
          },
        },
      });

      const db = createDbClient();
      await hydrateFirstAggregates(db, new Map(), client, { storageRoot: root });

      expect(db.candidateCache.get("legacy-candidate")?.filterFingerprint).toBeNull();
      const hydratedRound = db.recommendationRounds.get(project.id)?.[0];
      expect(hydratedRound?.filterFingerprint).toBeNull();
      expect(hydratedRound?.filterJson).toBeNull();
      expect(hydratedRound?.candidates[0]?.filterFingerprint).toBeNull();
    } finally {
      await client.$disconnect();
    }
  });

  it("rejects malformed filter JSON returned by the Prisma recommendation store", async () => {
    const { client, project } = await createFixture();

    try {
      const store = new PrismaRecommendationStore(client);
      await expect(store.recordRound({
        projectId: project.id,
        ownerId: project.ownerId,
        filterFingerprint: "0123456789abcdef",
        filterJson: { invalid: true } as never,
        candidates: [],
      })).rejects.toThrow("recommendation_round_filter_invalid");
    } finally {
      await client.$disconnect();
    }
  });

  it("rejects malformed persisted filter JSON during hydration", async () => {
    const { root, client, project } = await createFixture();

    try {
      await client.recommendationRound.create({
        data: {
          projectId: project.id,
          roundIndex: 1,
          filterFingerprint: "0123456789abcdef",
          filterJson: { invalid: true },
        },
      });

      await expect(hydrateFirstAggregates(
        createDbClient(),
        new Map(),
        client,
        { storageRoot: root },
      )).rejects.toThrow("recommendation_round_filter_invalid");
    } finally {
      await client.$disconnect();
    }
  });

  it("clears stale filter context when an existing candidate is cached unfiltered", async () => {
    const { client, project, db } = await createFixture();

    try {
      const filteredRecord = await saveCachedCandidate(db, {
        ...candidateInput(project.id, "reused-candidate"),
        filterFingerprint: "0123456789abcdef",
      });
      const unfilteredRecord = await saveCachedCandidate(
        db,
        candidateInput(project.id, "reused-candidate"),
      );

      const inMemoryRecords = [...db.candidateCache.values()].filter(
        (record) => record.projectId === project.id &&
          record.fingerprint === "reused-candidate",
      );
      expect(inMemoryRecords).toHaveLength(1);
      expect(inMemoryRecords[0]?.filterFingerprint).toBeUndefined();
      expect(unfilteredRecord).toMatchObject({
        id: filteredRecord.id,
        createdAt: filteredRecord.createdAt,
        filterFingerprint: undefined,
      });

      const cache = await client.recommendationCandidateCache.findFirstOrThrow({
        where: { projectId: project.id, fingerprint: "reused-candidate" },
      });
      expect(cache.filterFingerprint).toBeNull();
    } finally {
      await client.$disconnect();
    }
  });

  it("keeps different projects isolated and global cache writes append-only", async () => {
    const db = createDbClient();

    const projectOne = await saveCachedCandidate(
      db,
      candidateInput("project-one", "shared-fingerprint"),
    );
    const projectTwo = await saveCachedCandidate(
      db,
      candidateInput("project-two", "shared-fingerprint"),
    );
    const firstGlobal = await saveCachedCandidate(
      db,
      candidateInput(null, "shared-fingerprint"),
    );
    const secondGlobal = await saveCachedCandidate(
      db,
      candidateInput(null, "shared-fingerprint"),
    );

    expect(new Set([
      projectOne.id,
      projectTwo.id,
      firstGlobal.id,
      secondGlobal.id,
    ])).toHaveLength(4);
    expect([...db.candidateCache.values()]).toHaveLength(4);
  });
});
