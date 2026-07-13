import type { DbClient, RenderJobRecord } from "../../db/client";

export type SaveRenderJobRecordInput = Omit<
  RenderJobRecord,
  "id" | "createdAt" | "updatedAt"
> & {
  id?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export async function saveRenderJobRecord(
  db: DbClient,
  input: SaveRenderJobRecordInput,
): Promise<RenderJobRecord> {
  const now = new Date();
  const record: RenderJobRecord = {
    id: input.id ?? db.generateId(),
    projectId: input.projectId,
    composeRecordId: input.composeRecordId,
    assetManifestRecordId: input.assetManifestRecordId,
    status: input.status,
    profileJson: input.profileJson,
    outputArtifactJson: input.outputArtifactJson ?? null,
    validationResultJson: input.validationResultJson,
    executionStateJson: input.executionStateJson ?? null,
    graphTraceSummaryJson: input.graphTraceSummaryJson ?? null,
    runtimeDiagnosticsJson: input.runtimeDiagnosticsJson ?? null,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };

  const projectOwnerId = db.projects.get(record.projectId)?.ownerId ?? "system";
  await db.thirdAggregateWriter?.saveRender(record, projectOwnerId);
  db.renderJobRecords.set(record.id, record);

  return record;
}

export async function getRenderJobRecordById(
  db: DbClient,
  id: string,
): Promise<RenderJobRecord | null> {
  return db.renderJobRecords.get(id) ?? null;
}
