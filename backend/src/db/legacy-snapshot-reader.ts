import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const LEGACY_SNAPSHOT_COLLECTIONS = [
  "projects",
  "events",
  "topicPackages",
  "candidateCache",
  "topicRunCounts",
  "scriptRecords",
  "storyboardRecords",
  "assetPlanRecords",
  "assetManifestRecords",
  "composeRecords",
  "renderJobRecords",
  "publishPackageRecords",
  "assetProviderJobRecords",
  "recommendationRounds",
] as const;

export type LegacySnapshotCollectionName = typeof LEGACY_SNAPSHOT_COLLECTIONS[number];
export type LegacySnapshotEntry = [string, unknown];

export interface LegacySnapshotDocument {
  version: "db_snapshot_v1" | "db_snapshot_v2";
  savedAt: string | null;
  collections: Record<LegacySnapshotCollectionName, LegacySnapshotEntry[]>;
  topicCandidateStore: Record<string, unknown>;
}

export class LegacySnapshotReadError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "LegacySnapshotReadError";
  }
}

export interface LegacySnapshotReadResult {
  sourcePath: string;
  sourceSha256: string;
  document: LegacySnapshotDocument;
}

export function readLegacySnapshot(sourcePath: string): LegacySnapshotReadResult {
  const absolutePath = resolve(sourcePath);
  const bytes = readFileSync(absolutePath);
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new LegacySnapshotReadError(
      "snapshot_invalid_json",
      error instanceof Error ? error.message : "snapshot_invalid_json",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new LegacySnapshotReadError("snapshot_invalid_root", "Snapshot root must be an object");
  }
  const root = parsed as Record<string, unknown>;
  if (root.version !== "db_snapshot_v1" && root.version !== "db_snapshot_v2") {
    throw new LegacySnapshotReadError("snapshot_unsupported_version", String(root.version ?? "missing"));
  }

  const collections = {} as Record<LegacySnapshotCollectionName, LegacySnapshotEntry[]>;
  for (const collectionName of LEGACY_SNAPSHOT_COLLECTIONS) {
    const value = root[collectionName];
    if (value === undefined) {
      collections[collectionName] = [];
      continue;
    }
    if (!Array.isArray(value) || value.some((entry) => !Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string")) {
      throw new LegacySnapshotReadError(
        "snapshot_invalid_collection",
        `Invalid collection: ${collectionName}`,
      );
    }
    collections[collectionName] = value as LegacySnapshotEntry[];
  }

  const topicCandidateStore = root.topicCandidateStore;
  if (topicCandidateStore !== undefined && (!topicCandidateStore || typeof topicCandidateStore !== "object" || Array.isArray(topicCandidateStore))) {
    throw new LegacySnapshotReadError("snapshot_invalid_topic_candidate_store", "Invalid topicCandidateStore");
  }

  return {
    sourcePath: absolutePath,
    sourceSha256,
    document: {
      version: root.version,
      savedAt: typeof root.savedAt === "string" ? root.savedAt : null,
      collections,
      topicCandidateStore: (topicCandidateStore ?? {}) as Record<string, unknown>,
    },
  };
}
