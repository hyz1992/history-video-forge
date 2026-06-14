import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { DbClient, ProjectRecord } from "./client.js";
import type { ProjectTopicCandidateState } from "../app.js";

const workspaceRoot = resolve(
  fileURLToPath(new URL("../../../", import.meta.url)),
);
const SNAPSHOT_PATH = resolve(workspaceRoot, "storage/db-snapshot.json");

interface DbSnapshot {
  version: "db_snapshot_v1";
  savedAt: string;
  projects: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  topicPackages: Array<Record<string, unknown>>;
  candidateCache: Array<Record<string, unknown>>;
  topicRunCounts: Array<[string, number]>;
  scriptRecords: Array<Record<string, unknown>>;
  storyboardRecords: Array<Record<string, unknown>>;
  assetPlanRecords: Array<Record<string, unknown>>;
  assetManifestRecords: Array<Record<string, unknown>>;
  composeRecords: Array<Record<string, unknown>>;
  renderJobRecords: Array<Record<string, unknown>>;
  topicCandidateStore: Record<string, {
    candidatesById: Record<string, unknown>;
    rounds: Array<Record<string, unknown>>;
  }>;
}

function mapToArray<T>(map: Map<string, T>): Array<[string, T]> {
  return [...map.entries()];
}

function arrayToMap<T>(entries: Array<[string, T]>): Map<string, T> {
  return new Map(entries);
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
): void {
  try {
    mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });

    const snapshot: DbSnapshot = {
      version: "db_snapshot_v1",
      savedAt: new Date().toISOString(),
      projects: mapToArray(db.projects).map(([k, v]) => [k, v]),
      events: mapToArray(db.events).map(([k, v]) => [k, v]),
      topicPackages: mapToArray(db.topicPackages).map(([k, v]) => [k, v]),
      candidateCache: mapToArray(db.candidateCache).map(([k, v]) => [k, v]),
      topicRunCounts: [...db.topicRunCounts.entries()],
      scriptRecords: mapToArray(db.scriptRecords).map(([k, v]) => [k, v]),
      storyboardRecords: mapToArray(db.storyboardRecords).map(([k, v]) => [k, v]),
      assetPlanRecords: mapToArray(db.assetPlanRecords).map(([k, v]) => [k, v]),
      assetManifestRecords: mapToArray(db.assetManifestRecords).map(([k, v]) => [k, v]),
      composeRecords: mapToArray(db.composeRecords).map(([k, v]) => [k, v]),
      renderJobRecords: mapToArray(db.renderJobRecords).map(([k, v]) => [k, v]),
      topicCandidateStore: {},
    };

    for (const [projectId, state] of topicCandidateStore.entries()) {
      snapshot.topicCandidateStore[projectId] = {
        candidatesById: Object.fromEntries(state.candidatesById),
        rounds: state.rounds,
      };
    }

    const serialized = serializeDateFields(snapshot);
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(serialized, null, 2), "utf8");

    // Also persist each project's individual metadata file
    for (const [, project] of db.projects) {
      saveProjectMetadata(project as ProjectRecord);
    }
  } catch {
    // Silently fail — persistence is best-effort
  }
}

export function loadDbSnapshot(
  db: DbClient,
  topicCandidateStore: Map<string, ProjectTopicCandidateState>,
): boolean {
  try {
    if (!existsSync(SNAPSHOT_PATH)) return false;

    const raw = readFileSync(SNAPSHOT_PATH, "utf8");
    const snapshot = deserializeDateFields(JSON.parse(raw)) as DbSnapshot;

    if (snapshot.version !== "db_snapshot_v1") return false;

    for (const [k, v] of snapshot.projects) db.projects.set(k, v as never);
    for (const [k, v] of snapshot.events) db.events.set(k, v as never);
    for (const [k, v] of snapshot.topicPackages) db.topicPackages.set(k, v as never);
    for (const [k, v] of snapshot.candidateCache) db.candidateCache.set(k, v as never);
    for (const [k, v] of snapshot.topicRunCounts) db.topicRunCounts.set(k, v);
    for (const [k, v] of snapshot.scriptRecords) db.scriptRecords.set(k, v as never);
    for (const [k, v] of snapshot.storyboardRecords) db.storyboardRecords.set(k, v as never);
    for (const [k, v] of snapshot.assetPlanRecords) db.assetPlanRecords.set(k, v as never);
    for (const [k, v] of snapshot.assetManifestRecords) db.assetManifestRecords.set(k, v as never);
    for (const [k, v] of snapshot.composeRecords) db.composeRecords.set(k, v as never);
    for (const [k, v] of snapshot.renderJobRecords) db.renderJobRecords.set(k, v as never);

    for (const [projectId, state] of Object.entries(snapshot.topicCandidateStore)) {
      topicCandidateStore.set(projectId, {
        candidatesById: new Map(Object.entries(state.candidatesById)),
        rounds: state.rounds as never,
      });
    }

    return true;
  } catch {
    return false;
  }
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
