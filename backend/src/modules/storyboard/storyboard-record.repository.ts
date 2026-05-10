import type { DbClient, StoryboardRecord } from "../../db/client";

export interface SaveStoryboardRecordInput {
  projectId: string;
  topicPackageId: string;
  scriptRecordId: string;
  planJson: Record<string, unknown>;
  validationResultJson: Record<string, unknown>;
  executionStateJson?: Record<string, unknown> | null;
  graphTraceSummaryJson?: Record<string, unknown> | null;
  runtimeDiagnosticsJson?: Record<string, unknown> | null;
}

export async function saveStoryboardRecord(
  db: DbClient,
  input: SaveStoryboardRecordInput,
): Promise<StoryboardRecord> {
  const record: StoryboardRecord = {
    id: db.generateId(),
    projectId: input.projectId,
    topicPackageId: input.topicPackageId,
    scriptRecordId: input.scriptRecordId,
    planJson: input.planJson,
    validationResultJson: input.validationResultJson,
    executionStateJson: input.executionStateJson ?? null,
    graphTraceSummaryJson: input.graphTraceSummaryJson ?? null,
    runtimeDiagnosticsJson: input.runtimeDiagnosticsJson ?? null,
    createdAt: new Date(),
  };

  db.storyboardRecords.set(record.id, record);

  return record;
}

export async function getStoryboardRecordById(
  db: DbClient,
  storyboardRecordId: string,
): Promise<StoryboardRecord | null> {
  return db.storyboardRecords.get(storyboardRecordId) ?? null;
}
