import type {
  AssetProviderJobRecord,
  AssetProviderJobStatus,
  DbClient,
} from "../../db/client.js";

export type CreateAssetProviderJobInput = Omit<
  AssetProviderJobRecord,
  | "id"
  | "generationRunId"
  | "providerRequestKey"
  | "attemptIndex"
  | "submittedAt"
  | "lastPolledAt"
  | "completedAt"
  | "createdAt"
  | "updatedAt"
> & {
  /**
   * S2-2A call-intent 防重字段。dispatcher（任务 8）落地前可空；
   * 外部提交前必须写入，配合数据库部分唯一索引防止重复计费。
   * 身份三元组（generationRunId, providerRequestKey, attemptIndex）创建后不可变。
   */
  generationRunId?: string | null;
  providerRequestKey?: string | null;
  attemptIndex?: number | null;
};

export type UpdateAssetProviderJobPatch = Partial<
  Pick<
    AssetProviderJobRecord,
    | "providerJobId"
    | "status"
    | "attemptCount"
    | "rawRequestJson"
    | "rawResponseJson"
    | "errorCode"
    | "errorMessage"
    | "submittedAt"
    | "lastPolledAt"
  >
>;

export async function createAssetProviderJobRecord(
  db: DbClient,
  input: CreateAssetProviderJobInput,
): Promise<AssetProviderJobRecord> {
  const now = new Date();
  const record: AssetProviderJobRecord = {
    id: db.generateId(),
    assetManifestRecordId: input.assetManifestRecordId,
    assetRunId: input.assetRunId,
    executionId: input.executionId,
    taskId: input.taskId,
    providerType: input.providerType,
    providerName: input.providerName,
    providerJobId: input.providerJobId,
    status: input.status,
    attemptCount: input.attemptCount,
    generationRunId: input.generationRunId ?? null,
    providerRequestKey: input.providerRequestKey ?? null,
    attemptIndex: input.attemptIndex ?? null,
    rawRequestJson: input.rawRequestJson,
    rawResponseJson: input.rawResponseJson,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    submittedAt: input.status === "submitted" ? now : null,
    lastPolledAt: null,
    completedAt: input.status === "completed" ? now : null,
    createdAt: now,
    updatedAt: now,
  };

  const manifestProjectId = db.assetManifestRecords.get(record.assetManifestRecordId)?.projectId;
  const projectOwnerId = manifestProjectId ? db.projects.get(manifestProjectId)?.ownerId ?? "system" : "system";
  const persisted = await db.thirdAggregateWriter?.saveProviderJob(record, projectOwnerId) ?? record;
  db.assetProviderJobRecords.set(persisted.id, persisted);

  return persisted;
}

export async function updateAssetProviderJobRecord(
  db: DbClient,
  id: string,
  patch: UpdateAssetProviderJobPatch,
): Promise<AssetProviderJobRecord | null> {
  const existing = db.assetProviderJobRecords.get(id);
  if (!existing) return null;

  const now = new Date();
  const updated: AssetProviderJobRecord = {
    ...existing,
    ...patch,
    // 本次真实提交的观测时间可随恢复写入携带，已保存的首次时间永久优先。
    submittedAt: existing.submittedAt ?? patch.submittedAt ?? (patch.status === "submitted" ? now : null),
    completedAt:
      patch.status === ("completed" as AssetProviderJobStatus) ||
      patch.status === ("failed" as AssetProviderJobStatus) ||
      patch.status === ("canceled" as AssetProviderJobStatus)
        ? existing.completedAt ?? now
        : existing.completedAt,
    updatedAt: now,
  };

  const manifestProjectId = db.assetManifestRecords.get(updated.assetManifestRecordId)?.projectId;
  const projectOwnerId = manifestProjectId ? db.projects.get(manifestProjectId)?.ownerId ?? "system" : "system";
  const persisted = await db.thirdAggregateWriter?.saveProviderJob(updated, projectOwnerId) ?? updated;
  db.assetProviderJobRecords.set(persisted.id, persisted);

  return persisted;
}

export async function listAssetProviderJobRecordsByManifest(
  db: DbClient,
  manifestRecordId: string,
): Promise<AssetProviderJobRecord[]> {
  const results: AssetProviderJobRecord[] = [];
  for (const record of db.assetProviderJobRecords.values()) {
    if (record.assetManifestRecordId === manifestRecordId) {
      results.push(record);
    }
  }
  return results;
}
