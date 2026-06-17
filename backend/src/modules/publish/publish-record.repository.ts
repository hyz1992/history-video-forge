import type { DbClient, PublishPackageRecord } from "../../db/client";

export type SavePublishPackageRecordInput = Omit<
  PublishPackageRecord,
  "id" | "createdAt" | "updatedAt"
> & {
  id?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export async function savePublishPackageRecord(
  db: DbClient,
  input: SavePublishPackageRecordInput,
): Promise<PublishPackageRecord> {
  const now = new Date();
  const record: PublishPackageRecord = {
    id: input.id ?? db.generateId(),
    projectId: input.projectId,
    renderJobRecordId: input.renderJobRecordId,
    topicPackageId: input.topicPackageId,
    scriptRecordId: input.scriptRecordId,
    storyboardRecordId: input.storyboardRecordId,
    assetManifestRecordId: input.assetManifestRecordId,
    packageJson: input.packageJson,
    validationResultJson: input.validationResultJson ?? null,
    executionStateJson: input.executionStateJson ?? null,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };

  db.publishPackageRecords.set(record.id, record);

  return record;
}

export async function getPublishPackageRecordById(
  db: DbClient,
  id: string,
): Promise<PublishPackageRecord | null> {
  return db.publishPackageRecords.get(id) ?? null;
}
