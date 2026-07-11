import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import {
  LEGACY_SNAPSHOT_COLLECTIONS,
  LegacySnapshotReadError,
  readLegacySnapshot,
  type LegacySnapshotEntry,
} from "../legacy-snapshot-reader.js";
import { createInspectionReport, type LegacyMigrationInspection, type MigrationIssue } from "./migration-report.js";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function addCollectionIssues(collection: string, entries: LegacySnapshotEntry[], issues: MigrationIssue[]): void {
  const seen = new Set<string>();
  for (const [key, value] of entries) {
    if (seen.has(key)) {
      issues.push({ code: "duplicate_collection_id", severity: "error", collection, recordId: key });
    }
    seen.add(key);
    const record = asRecord(value);
    if (record && typeof record.id === "string" && record.id !== key) {
      issues.push({
        code: "collection_key_id_mismatch",
        severity: "error",
        collection,
        recordId: key,
        detail: `record.id=${record.id}`,
      });
    }
  }
}

function inspectProjectReferences(
  collections: ReturnType<typeof readLegacySnapshot>["document"]["collections"],
  issues: MigrationIssue[],
): void {
  const projectIds = new Set(collections.projects.map(([id]) => id));
  const projectScopedCollections = [
    "topicPackages",
    "candidateCache",
    "scriptRecords",
    "storyboardRecords",
    "assetPlanRecords",
    "assetManifestRecords",
    "composeRecords",
    "renderJobRecords",
    "publishPackageRecords",
  ] as const;
  for (const collectionName of projectScopedCollections) {
    for (const [id, value] of collections[collectionName]) {
      const projectId = asRecord(value)?.projectId;
      if (typeof projectId === "string" && !projectIds.has(projectId)) {
        issues.push({
          code: "orphan_project_reference",
          severity: "error",
          collection: collectionName,
          recordId: id,
          detail: `projectId=${projectId}`,
        });
      }
    }
  }
  for (const [projectId] of collections.recommendationRounds) {
    if (!projectIds.has(projectId)) {
      issues.push({
        code: "orphan_project_reference",
        severity: "error",
        collection: "recommendationRounds",
        recordId: projectId,
      });
    }
  }
}

function inspectProjects(
  collections: ReturnType<typeof readLegacySnapshot>["document"]["collections"],
  issues: MigrationIssue[],
): void {
  const activeTargets = {
    activeTopicPackageId: collections.topicPackages,
    activeScriptRecordId: collections.scriptRecords,
    activeStoryboardRecordId: collections.storyboardRecords,
    activeAssetPlanRecordId: collections.assetPlanRecords,
    activeAssetManifestRecordId: collections.assetManifestRecords,
    activeComposeRecordId: collections.composeRecords,
    activeRenderJobRecordId: collections.renderJobRecords,
    activePublishPackageRecordId: collections.publishPackageRecords,
  };
  for (const [projectId, value] of collections.projects) {
    const project = asRecord(value);
    if (!project) {
      issues.push({ code: "project_invalid_record", severity: "error", collection: "projects", recordId: projectId });
      continue;
    }
    if (typeof project.storageRootDir === "string" && project.storageRootDir.trim()) {
      const storagePath = isAbsolute(project.storageRootDir)
        ? project.storageRootDir
        : resolve(process.cwd(), project.storageRootDir);
      if (!existsSync(storagePath)) {
        issues.push({
          code: "project_storage_missing",
          severity: "error",
          collection: "projects",
          recordId: projectId,
          detail: storagePath,
        });
      }
    } else {
      issues.push({ code: "project_storage_missing", severity: "error", collection: "projects", recordId: projectId });
    }
    for (const [field, targetEntries] of Object.entries(activeTargets)) {
      const activeId = project[field];
      if (typeof activeId !== "string") continue;
      const target = targetEntries.find(([id]) => id === activeId);
      if (!target) {
        issues.push({
          code: "active_record_missing",
          severity: "error",
          collection: "projects",
          recordId: projectId,
          detail: `${field}=${activeId}`,
        });
        continue;
      }
      const targetProjectId = asRecord(target[1])?.projectId;
      if (typeof targetProjectId === "string" && targetProjectId !== projectId) {
        issues.push({
          code: "active_record_project_mismatch",
          severity: "error",
          collection: "projects",
          recordId: projectId,
          detail: `${field}=${activeId}, targetProjectId=${targetProjectId}`,
        });
      }
    }
  }
}

function inspectForeignReferences(
  collections: ReturnType<typeof readLegacySnapshot>["document"]["collections"],
  issues: MigrationIssue[],
): void {
  const ids = Object.fromEntries(LEGACY_SNAPSHOT_COLLECTIONS.map((name) => [
    name,
    new Set(collections[name].map(([id]) => id)),
  ])) as Record<string, Set<string>>;
  const references: Array<{
    collection: keyof typeof collections;
    field: string;
    target: string;
    nullable?: boolean;
  }> = [
    { collection: "topicPackages", field: "eventRegistryEntryId", target: "events", nullable: true },
    { collection: "candidateCache", field: "eventRegistryEntryId", target: "events", nullable: true },
    { collection: "scriptRecords", field: "topicPackageId", target: "topicPackages" },
    { collection: "storyboardRecords", field: "topicPackageId", target: "topicPackages" },
    { collection: "storyboardRecords", field: "scriptRecordId", target: "scriptRecords" },
    { collection: "assetPlanRecords", field: "topicPackageId", target: "topicPackages" },
    { collection: "assetPlanRecords", field: "scriptRecordId", target: "scriptRecords" },
    { collection: "assetPlanRecords", field: "storyboardRecordId", target: "storyboardRecords" },
    { collection: "assetManifestRecords", field: "topicPackageId", target: "topicPackages" },
    { collection: "assetManifestRecords", field: "scriptRecordId", target: "scriptRecords" },
    { collection: "assetManifestRecords", field: "storyboardRecordId", target: "storyboardRecords" },
    { collection: "assetManifestRecords", field: "assetPlanRecordId", target: "assetPlanRecords" },
    { collection: "composeRecords", field: "assetManifestRecordId", target: "assetManifestRecords" },
    { collection: "renderJobRecords", field: "composeRecordId", target: "composeRecords" },
    { collection: "renderJobRecords", field: "assetManifestRecordId", target: "assetManifestRecords" },
    { collection: "publishPackageRecords", field: "renderJobRecordId", target: "renderJobRecords" },
    { collection: "publishPackageRecords", field: "topicPackageId", target: "topicPackages" },
    { collection: "publishPackageRecords", field: "scriptRecordId", target: "scriptRecords" },
    { collection: "publishPackageRecords", field: "storyboardRecordId", target: "storyboardRecords" },
    { collection: "publishPackageRecords", field: "assetManifestRecordId", target: "assetManifestRecords" },
    { collection: "assetProviderJobRecords", field: "assetManifestRecordId", target: "assetManifestRecords" },
  ];
  for (const reference of references) {
    for (const [recordId, value] of collections[reference.collection]) {
      const targetId = asRecord(value)?.[reference.field];
      if ((targetId === null || targetId === undefined) && reference.nullable) continue;
      if (typeof targetId === "string" && !ids[reference.target]?.has(targetId)) {
        issues.push({
          code: "orphan_foreign_reference",
          severity: "error",
          collection: reference.collection,
          recordId,
          detail: `${reference.field}=${targetId}`,
        });
      }
    }
  }
}

function inspectCandidateCacheUniqueness(
  entries: LegacySnapshotEntry[],
  issues: MigrationIssue[],
): void {
  const seen = new Map<string, string>();
  for (const [recordId, value] of entries) {
    const row = asRecord(value);
    if (!row || typeof row.projectId !== "string" || typeof row.fingerprint !== "string") continue;
    const key = `${row.projectId}\u0000${row.fingerprint}`;
    const firstRecordId = seen.get(key);
    if (firstRecordId) {
      issues.push({
        code: "duplicate_candidate_fingerprint",
        severity: "error",
        collection: "candidateCache",
        recordId,
        detail: `firstRecordId=${firstRecordId}, projectId=${row.projectId}, fingerprint=${row.fingerprint}`,
      });
    } else {
      seen.set(key, recordId);
    }
  }
}

export function inspectLegacySnapshot(sourcePath: string): LegacyMigrationInspection {
  let sourceSha256 = "";
  try {
    const readResult = readLegacySnapshot(sourcePath);
    sourceSha256 = readResult.sourceSha256;
    const { collections } = readResult.document;
    const issues: MigrationIssue[] = [];
    for (const collectionName of LEGACY_SNAPSHOT_COLLECTIONS) {
      addCollectionIssues(collectionName, collections[collectionName], issues);
    }
    inspectProjectReferences(collections, issues);
    inspectForeignReferences(collections, issues);
    inspectCandidateCacheUniqueness(collections.candidateCache, issues);
    inspectProjects(collections, issues);
    return createInspectionReport({
      sourcePath: readResult.sourcePath,
      sourceSha256,
      sourceVersion: readResult.document.version,
      counts: Object.fromEntries(LEGACY_SNAPSHOT_COLLECTIONS.map((name) => [name, collections[name].length])),
      issues,
    });
  } catch (error) {
    if (!sourceSha256) {
      try {
        sourceSha256 = readLegacySnapshotHashOnly(sourcePath);
      } catch {
        sourceSha256 = "";
      }
    }
    const code = error instanceof LegacySnapshotReadError ? error.code : "snapshot_read_failed";
    return createInspectionReport({
      sourcePath: resolve(sourcePath),
      sourceSha256,
      sourceVersion: null,
      counts: {},
      issues: [{ code, severity: "error", detail: error instanceof Error ? error.message : String(error) }],
    });
  }
}

function readLegacySnapshotHashOnly(sourcePath: string): string {
  return createHash("sha256").update(readFileSync(resolve(sourcePath))).digest("hex");
}
