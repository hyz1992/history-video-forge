import type { AssetManifestRecord, DbClient } from "../../db/client";
import { normalizeAssetManifestDates } from "./manifest-date-normalizer.js";

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
    manifestJson: normalizeAssetManifestDates(
      input.manifestJson as Record<string, unknown>,
    ) as unknown as Record<string, unknown>,
    validationResultJson: input.validationResultJson,
    executionStateJson: input.executionStateJson ?? null,
    graphTraceSummaryJson: input.graphTraceSummaryJson ?? null,
    runtimeDiagnosticsJson: input.runtimeDiagnosticsJson ?? null,
    createdAt: input.createdAt ?? new Date(),
  };

  const projectOwnerId = db.projects.get(record.projectId)?.ownerId ?? "system";
  await db.thirdAggregateWriter?.saveAssetManifest(record, projectOwnerId);
  db.assetManifestRecords.set(record.id, record);

  return record;
}

export async function getAssetManifestRecordById(
  db: DbClient,
  id: string,
): Promise<AssetManifestRecord | null> {
  const record = db.assetManifestRecords.get(id) ?? null;
  if (record) {
    record.manifestJson = normalizeAssetManifestDates(
      record.manifestJson as Record<string, unknown>,
    ) as unknown as Record<string, unknown>;
  }
  return record;
}
