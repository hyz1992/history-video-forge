import type { ComposeRecord, DbClient } from "../../db/client";

export type SaveComposeRecordInput = Omit<
  ComposeRecord,
  "id" | "createdAt"
> & {
  id?: string;
  createdAt?: Date;
};

export async function saveComposeRecord(
  db: DbClient,
  input: SaveComposeRecordInput,
): Promise<ComposeRecord> {
  const record: ComposeRecord = {
    id: input.id ?? db.generateId(),
    projectId: input.projectId,
    assetManifestRecordId: input.assetManifestRecordId,
    timelineJson: input.timelineJson,
    validationResultJson: input.validationResultJson,
    executionStateJson: input.executionStateJson ?? null,
    graphTraceSummaryJson: input.graphTraceSummaryJson ?? null,
    runtimeDiagnosticsJson: input.runtimeDiagnosticsJson ?? null,
    createdAt: input.createdAt ?? new Date(),
  };

  db.composeRecords.set(record.id, record);

  return record;
}

export async function getComposeRecordById(
  db: DbClient,
  id: string,
): Promise<ComposeRecord | null> {
  return db.composeRecords.get(id) ?? null;
}
