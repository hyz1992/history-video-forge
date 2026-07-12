import type { DbClient } from "./client.js";
import type { ProjectTopicCandidateState } from "../app.js";
import {
  loadDbSnapshot,
  recoverProjectsFromDisk,
  saveDbSnapshot,
  type SnapshotLoadResult,
  type SnapshotSaveResult,
} from "./persistence.js";

export function loadLegacyFixtureState(
  db: DbClient,
  topicCandidateStore: Map<string, ProjectTopicCandidateState>,
  snapshotPath?: string,
): SnapshotLoadResult {
  const result = loadDbSnapshot(db, topicCandidateStore, { snapshotPath });
  recoverProjectsFromDisk(db);
  return result;
}

export function saveLegacyFixtureState(
  db: DbClient,
  topicCandidateStore: Map<string, ProjectTopicCandidateState>,
  snapshotPath?: string,
): SnapshotSaveResult {
  return saveDbSnapshot(db, topicCandidateStore, { snapshotPath });
}
