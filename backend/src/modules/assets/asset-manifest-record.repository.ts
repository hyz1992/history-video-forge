import type { AssetManifestRecord, DbClient } from "../../db/client";

export type SaveAssetManifestRecordInput = Omit<
  AssetManifestRecord,
  "id" | "createdAt"
> & {
  id?: string;
  createdAt?: Date;
};

export async function saveAssetManifestRecord(
  db: DbClient,
  input: SaveAssetManifestRecordInput,
): Promise<AssetManifestRecord> {
  const record: AssetManifestRecord = {
    id: input.id ?? db.generateId(),
    projectId: input.projectId,
    topicPackageId: input.topicPackageId,
    scriptRecordId: input.scriptRecordId,
    storyboardRecordId: input.storyboardRecordId,
    assetPlanRecordId: input.assetPlanRecordId,
    manifestJson: input.manifestJson,
    validationResultJson: input.validationResultJson,
    executionStateJson: input.executionStateJson ?? null,
    graphTraceSummaryJson: input.graphTraceSummaryJson ?? null,
    runtimeDiagnosticsJson: input.runtimeDiagnosticsJson ?? null,
    createdAt: input.createdAt ?? new Date(),
  };

  db.assetManifestRecords.set(record.id, record);

  return record;
}

export async function getAssetManifestRecordById(
  db: DbClient,
  id: string,
): Promise<AssetManifestRecord | null> {
  return db.assetManifestRecords.get(id) ?? null;
}
