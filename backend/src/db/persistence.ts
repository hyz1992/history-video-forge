import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { createDbClient, type DbClient, type ProjectRecord } from "./client.js";
import type { ProjectTopicCandidateState } from "../app.js";

const workspaceRoot = process.cwd();
const SNAPSHOT_PATH = resolve(workspaceRoot, "storage/db-snapshot.json");

type SnapshotMapEntries<T = unknown> = Array<[string, T]>;

interface DbSnapshot {
  version: "db_snapshot_v1" | "db_snapshot_v2";
  savedAt: string;
  projects: SnapshotMapEntries;
  events: SnapshotMapEntries;
  topicPackages: SnapshotMapEntries;
  candidateCache: SnapshotMapEntries;
  topicRunCounts: Array<[string, number]>;
  scriptRecords: SnapshotMapEntries;
  storyboardRecords: SnapshotMapEntries;
  assetPlanRecords: SnapshotMapEntries;
  assetManifestRecords: SnapshotMapEntries;
  composeRecords: SnapshotMapEntries;
  renderJobRecords: SnapshotMapEntries;
  publishPackageRecords: SnapshotMapEntries;
  assetProviderJobRecords: SnapshotMapEntries;
  recommendationRounds: SnapshotMapEntries;
  topicCandidateStore: Record<string, {
    candidatesById: Record<string, unknown>;
    rounds: Array<Record<string, unknown>>;
  }>;
}

export interface SnapshotPersistenceOptions {
  snapshotPath?: string;
  projectsRoot?: string;
}

export interface SnapshotLoadResult {
  ok: boolean;
  source: "primary" | "backup" | "none";
  migratedFrom: "db_snapshot_v1" | null;
  error: string | null;
}

export interface SnapshotSaveResult {
  ok: boolean;
  error: string | null;
}

function mapToArray<T>(map: Map<string, T>): Array<[string, T]> {
  return [...map.entries()];
}

const DATE_FIELD_NAMES = new Set([
  "createdAt", "updatedAt", "savedAt",
  "started_at", "ended_at",
  "submittedAt", "lastPolledAt", "completedAt",
  "firstGeneratedAt", "lastSelectedAt", "persistedAt",
]);

function reviveDates(_key: string, value: unknown): unknown {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
    return new Date(value);
  }
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).__date
  ) {
    return new Date((value as Record<string, unknown>).__date as string);
  }
  return value;
}

function serializeDateFields(obj: unknown): unknown {
  return JSON.parse(JSON.stringify(obj, (_key, value) => {
    if (value instanceof Date || (value && typeof value === "object" && "toISOString" in value && typeof (value as Date).toISOString === "function")) {
      return { __date: (value as Date).toISOString() };
    }
    return value;
  }), reviveDates);
}

function deserializeDateFields(obj: unknown): unknown {
  return JSON.parse(JSON.stringify(obj), reviveDates);
}

export function saveDbSnapshot(
  db: DbClient,
  topicCandidateStore: Map<string, ProjectTopicCandidateState>,
  options: SnapshotPersistenceOptions = {},
): SnapshotSaveResult {
  const snapshotPath = options.snapshotPath ?? SNAPSHOT_PATH;
  try {
    mkdirSync(dirname(snapshotPath), { recursive: true });

    const snapshot: DbSnapshot = {
      version: "db_snapshot_v2",
      savedAt: new Date().toISOString(),
      projects: mapToArray(db.projects),
      events: mapToArray(db.events),
      topicPackages: mapToArray(db.topicPackages),
      candidateCache: mapToArray(db.candidateCache),
      topicRunCounts: [...db.topicRunCounts.entries()],
      scriptRecords: mapToArray(db.scriptRecords),
      storyboardRecords: mapToArray(db.storyboardRecords),
      assetPlanRecords: mapToArray(db.assetPlanRecords),
      assetManifestRecords: mapToArray(db.assetManifestRecords),
      composeRecords: mapToArray(db.composeRecords),
      renderJobRecords: mapToArray(db.renderJobRecords),
      publishPackageRecords: mapToArray(db.publishPackageRecords),
      assetProviderJobRecords: mapToArray(db.assetProviderJobRecords),
      recommendationRounds: mapToArray(db.recommendationRounds),
      topicCandidateStore: {},
    };

    for (const [projectId, state] of topicCandidateStore.entries()) {
      snapshot.topicCandidateStore[projectId] = {
        candidatesById: Object.fromEntries(state.candidatesById) as unknown as Record<string, unknown>,
        rounds: state.rounds as unknown as Array<Record<string, unknown>>,
      };
    }

    const serialized = serializeDateFields(snapshot);
    writeSnapshotAtomically(snapshotPath, JSON.stringify(serialized, null, 2));

    // Also persist each project's individual metadata file
    for (const [, project] of db.projects) {
      saveProjectMetadata(project as ProjectRecord);
    }
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "snapshot_save_failed" };
  }
}

function writeSnapshotAtomically(snapshotPath: string, body: string): void {
  const tempPath = `${snapshotPath}.tmp`;
  const backupPath = `${snapshotPath}.bak`;
  mkdirSync(dirname(snapshotPath), { recursive: true });
  if (existsSync(snapshotPath)) copyFileSync(snapshotPath, backupPath);
  const fd = openSync(tempPath, "w");
  try {
    writeFileSync(fd, body, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tempPath, snapshotPath);
  } catch (error) {
    // Windows may reject replacing an existing file via rename; keep the
    // durable .bak and complete the replacement without hiding the failure.
    rmSync(snapshotPath, { force: true });
    renameSync(tempPath, snapshotPath);
  }
}

function normalizeSnapshotDocument(value: unknown): { snapshot: DbSnapshot; migratedFrom: "db_snapshot_v1" | null } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("db_snapshot_invalid_root");
  const source = value as Record<string, unknown>;
  if (source.version !== "db_snapshot_v1" && source.version !== "db_snapshot_v2") {
    throw new Error("db_snapshot_unsupported_version");
  }
  const entries = (key: string): SnapshotMapEntries => {
    const value = source[key];
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((entry) => !Array.isArray(entry) || entry.length !== 2)) {
      throw new Error(`db_snapshot_invalid_${key}`);
    }
    return value as SnapshotMapEntries;
  };
  const topicCandidateStore = source.topicCandidateStore;
  if (topicCandidateStore !== undefined && (!topicCandidateStore || typeof topicCandidateStore !== "object" || Array.isArray(topicCandidateStore))) {
    throw new Error("db_snapshot_invalid_topicCandidateStore");
  }
  return {
    migratedFrom: source.version === "db_snapshot_v1" ? "db_snapshot_v1" : null,
    snapshot: {
      version: "db_snapshot_v2",
      savedAt: typeof source.savedAt === "string" ? source.savedAt : new Date(0).toISOString(),
      projects: entries("projects"),
      events: entries("events"),
      topicPackages: entries("topicPackages"),
      candidateCache: entries("candidateCache"),
      topicRunCounts: Array.isArray(source.topicRunCounts) ? source.topicRunCounts as Array<[string, number]> : [],
      scriptRecords: entries("scriptRecords"),
      storyboardRecords: entries("storyboardRecords"),
      assetPlanRecords: entries("assetPlanRecords"),
      assetManifestRecords: entries("assetManifestRecords"),
      composeRecords: entries("composeRecords"),
      renderJobRecords: entries("renderJobRecords"),
      publishPackageRecords: entries("publishPackageRecords"),
      assetProviderJobRecords: entries("assetProviderJobRecords"),
      recommendationRounds: entries("recommendationRounds"),
      topicCandidateStore: (topicCandidateStore ?? {}) as DbSnapshot["topicCandidateStore"],
    },
  };
}

function applySnapshot(db: DbClient, topicCandidateStore: Map<string, ProjectTopicCandidateState>, snapshot: DbSnapshot): void {
  const target = createDbClient();
  const apply = (map: Map<string, unknown>, entries: SnapshotMapEntries) => {
    for (const [key, value] of entries) map.set(key, deserializeDateFields(value));
  };
  apply(target.projects as Map<string, unknown>, snapshot.projects);
  apply(target.events as Map<string, unknown>, snapshot.events);
  apply(target.topicPackages as Map<string, unknown>, snapshot.topicPackages);
  apply(target.candidateCache as Map<string, unknown>, snapshot.candidateCache);
  for (const [key, value] of snapshot.topicRunCounts) target.topicRunCounts.set(key, value);
  apply(target.scriptRecords as Map<string, unknown>, snapshot.scriptRecords);
  apply(target.storyboardRecords as Map<string, unknown>, snapshot.storyboardRecords);
  apply(target.assetPlanRecords as Map<string, unknown>, snapshot.assetPlanRecords);
  apply(target.assetManifestRecords as Map<string, unknown>, snapshot.assetManifestRecords);
  apply(target.composeRecords as Map<string, unknown>, snapshot.composeRecords);
  apply(target.renderJobRecords as Map<string, unknown>, snapshot.renderJobRecords);
  apply(target.publishPackageRecords as Map<string, unknown>, snapshot.publishPackageRecords);
  apply(target.assetProviderJobRecords as Map<string, unknown>, snapshot.assetProviderJobRecords);
  apply(target.recommendationRounds as Map<string, unknown>, snapshot.recommendationRounds);

  const nextTopicStore = new Map<string, ProjectTopicCandidateState>();
  for (const [projectId, state] of Object.entries(snapshot.topicCandidateStore)) {
    if (!state || typeof state !== "object") throw new Error("db_snapshot_invalid_topic_candidate_state");
    nextTopicStore.set(projectId, {
      candidatesById: new Map(Object.entries(state.candidatesById ?? {})) as never,
      rounds: (state.rounds ?? []) as never,
    });
  }

  for (const key of Object.keys(target) as Array<keyof DbClient>) {
    const value = target[key];
    if (value instanceof Map && db[key] instanceof Map) {
      (db[key] as Map<string, unknown>).clear();
      for (const [entryKey, entryValue] of value.entries()) (db[key] as Map<string, unknown>).set(entryKey, entryValue);
    }
  }
  topicCandidateStore.clear();
  for (const [key, value] of nextTopicStore) topicCandidateStore.set(key, value);
}

export function loadDbSnapshot(
  db: DbClient,
  topicCandidateStore: Map<string, ProjectTopicCandidateState>,
  options: SnapshotPersistenceOptions = {},
): SnapshotLoadResult {
  const snapshotPath = options.snapshotPath ?? SNAPSHOT_PATH;
  const candidates = [
    { path: snapshotPath, source: "primary" as const },
    { path: `${snapshotPath}.bak`, source: "backup" as const },
  ];
  let lastError: string | null = null;
  for (const candidate of candidates) {
    if (!existsSync(candidate.path)) continue;
    try {
      const { snapshot, migratedFrom } = normalizeSnapshotDocument(deserializeDateFields(JSON.parse(readFileSync(candidate.path, "utf8"))));
      applySnapshot(db, topicCandidateStore, snapshot);
      return { ok: true, source: candidate.source, migratedFrom, error: null };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "db_snapshot_load_failed";
    }
  }
  return { ok: false, source: "none", migratedFrom: null, error: lastError ?? "db_snapshot_missing" };
}

// ---------------------------------------------------------------------------
// Per-project metadata files (survives even if db-snapshot.json is lost)
// ---------------------------------------------------------------------------

const PROJECTS_ROOT = resolve(workspaceRoot, "storage/projects");

/** Write project.json inside the project's storage dir. */
export function saveProjectMetadata(project: ProjectRecord): void {
  try {
    const dir = resolve(workspaceRoot, project.storageRootDir);
    mkdirSync(dir, { recursive: true });
    const meta = serializeDateFields(project);
    writeFileSync(join(dir, "project.json"), JSON.stringify(meta, null, 2), "utf8");
  } catch {
    // best-effort
  }
}

/** Remove the project's storage directory so deleted projects are not recovered
 *  from disk on the next server start. */
export function deleteProjectStorage(project: ProjectRecord): void {
  try {
    if (!project.storageRootDir) return;
    const dir = resolve(workspaceRoot, project.storageRootDir);
    const relativeDir = relative(PROJECTS_ROOT, dir);
    if (!relativeDir || relativeDir.startsWith("..") || isAbsolute(relativeDir)) return;
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

function projectJsonPath(projectDir: string): string {
  return join(PROJECTS_ROOT, projectDir, "project.json");
}

/** Scan storage/projects/ for project.json files and restore any projects
 *  not already in the db. */
export function recoverProjectsFromDisk(db: DbClient): void {
  try {
    if (!existsSync(PROJECTS_ROOT)) return;

    const dateDirs = readdirSync(PROJECTS_ROOT);
    for (const dateDir of dateDirs) {
      const datePath = join(PROJECTS_ROOT, dateDir);
      if (!statSync(datePath).isDirectory()) continue;

      const projectDirs = readdirSync(datePath);
      for (const projectDir of projectDirs) {
        const metaPath = projectJsonPath(join(dateDir, projectDir));
        if (!existsSync(metaPath)) continue;

        try {
          const raw = readFileSync(metaPath, "utf8");
          const meta = deserializeDateFields(JSON.parse(raw)) as ProjectRecord;
          if (meta.id && !db.projects.has(meta.id)) {
            db.projects.set(meta.id, meta);
          }
        } catch {
          // skip unreadable files
        }
      }
    }
  } catch {
    // best-effort
  }
}
