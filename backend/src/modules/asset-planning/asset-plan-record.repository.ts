import type { AssetPlanRecord, DbClient } from "../../db/client";

export type SaveAssetPlanRecordInput = Omit<
  AssetPlanRecord,
  "id" | "createdAt"
> & {
  id?: string;
  createdAt?: Date;
};

export async function saveAssetPlanRecord(
  db: DbClient,
  input: SaveAssetPlanRecordInput,
): Promise<AssetPlanRecord> {
  const record: AssetPlanRecord = {
    id: input.id ?? db.generateId(),
    projectId: input.projectId,
    topicPackageId: input.topicPackageId,
    scriptRecordId: input.scriptRecordId,
    storyboardRecordId: input.storyboardRecordId,
    planJson: input.planJson,
    validationResultJson: input.validationResultJson,
    executionStateJson: input.executionStateJson,
    graphTraceSummaryJson: input.graphTraceSummaryJson ?? null,
    runtimeDiagnosticsJson: input.runtimeDiagnosticsJson ?? null,
    createdAt: input.createdAt ?? new Date(),
  };

  await db.secondAggregateWriter?.saveAssetPlan(record);
  db.assetPlanRecords.set(record.id, record);

  return record;
}

export async function getAssetPlanRecordById(
  db: DbClient,
  id: string,
): Promise<AssetPlanRecord | null> {
  return db.assetPlanRecords.get(id) ?? null;
}
