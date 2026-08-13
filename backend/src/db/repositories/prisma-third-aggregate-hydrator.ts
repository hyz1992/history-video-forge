import type {
  AssetManifestRecord,
  AssetProviderJobRecord,
  ComposeRecord,
  DbClient,
  GenerationCostQuoteRecord,
  GenerationRunEventRecord,
  GenerationRunRecord,
  PublishPackageRecord,
  RenderJobRecord,
  RunConfigurationSnapshotRecord,
  UsageCostRecordRecord,
} from "../client.js";
import type { AppPrismaClient } from "../prisma-client.types.js";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const nullableObject = (value: unknown): Record<string, unknown> | null => value == null ? null : object(value);

export async function hydrateThirdAggregates(db: DbClient, client: AppPrismaClient): Promise<void> {
  const projectIds = [...db.projects.keys()];
  const [manifests, composeRecords, renderJobs, publishPackages, quotes, snapshots, runs] = await Promise.all([
    client.assetManifestRecord.findMany({ where: { projectId: { in: projectIds } } }),
    client.composeRecord.findMany({ where: { projectId: { in: projectIds } } }),
    client.renderJobRecord.findMany({ where: { projectId: { in: projectIds } } }),
    client.publishPackageRecord.findMany({ where: { projectId: { in: projectIds } } }),
    client.generationCostQuote.findMany({ where: { projectId: { in: projectIds } } }),
    client.runConfigurationSnapshot.findMany({ where: { projectId: { in: projectIds } } }),
    client.generationRun.findMany({ where: { projectId: { in: projectIds } } }),
  ]);
  const manifestIds = manifests.map((row) => row.id);
  const snapshotIds = snapshots.map((row) => row.id);
  const runIds = runs.map((row) => row.id);
  const [providerJobs, usageRecords, runEvents] = await Promise.all([
    manifestIds.length === 0
      ? []
      : client.assetProviderJobRecord.findMany({ where: { assetManifestRecordId: { in: manifestIds } } }),
    snapshotIds.length === 0
      ? []
      : client.usageCostRecord.findMany({ where: { runConfigurationSnapshotId: { in: snapshotIds } } }),
    runIds.length === 0
      ? []
      : client.generationRunEvent.findMany({ where: { generationRunId: { in: runIds } }, orderBy: { createdAt: "asc" } }),
  ]);

  db.assetManifestRecords.clear();
  db.composeRecords.clear();
  db.renderJobRecords.clear();
  db.publishPackageRecords.clear();
  db.assetProviderJobRecords.clear();
  db.generationCostQuotes.clear();
  db.runConfigurationSnapshots.clear();
  db.generationRuns.clear();
  db.generationRunEvents.clear();
  db.usageCostRecords.clear();

  for (const row of manifests) {
    const record: AssetManifestRecord = { ...row, manifestJson: object(row.manifestJson), validationResultJson: object(row.validationResultJson), executionStateJson: nullableObject(row.executionStateJson), graphTraceSummaryJson: nullableObject(row.graphTraceSummaryJson), runtimeDiagnosticsJson: nullableObject(row.runtimeDiagnosticsJson) };
    db.assetManifestRecords.set(record.id, record);
  }
  for (const row of composeRecords) {
    const record: ComposeRecord = { ...row, timelineJson: object(row.timelineJson), validationResultJson: object(row.validationResultJson), executionStateJson: nullableObject(row.executionStateJson), graphTraceSummaryJson: nullableObject(row.graphTraceSummaryJson), runtimeDiagnosticsJson: nullableObject(row.runtimeDiagnosticsJson) };
    db.composeRecords.set(record.id, record);
  }
  for (const row of renderJobs) {
    const record: RenderJobRecord = { ...row, status: row.status as RenderJobRecord["status"], profileJson: object(row.profileJson), outputArtifactJson: row.outputArtifactJson as RenderJobRecord["outputArtifactJson"], validationResultJson: row.validationResultJson as RenderJobRecord["validationResultJson"], executionStateJson: nullableObject(row.executionStateJson), graphTraceSummaryJson: nullableObject(row.graphTraceSummaryJson), runtimeDiagnosticsJson: nullableObject(row.runtimeDiagnosticsJson) };
    db.renderJobRecords.set(record.id, record);
  }
  for (const row of publishPackages) {
    const record: PublishPackageRecord = { ...row, packageJson: object(row.packageJson), validationResultJson: nullableObject(row.validationResultJson), executionStateJson: nullableObject(row.executionStateJson) };
    db.publishPackageRecords.set(record.id, record);
  }
  for (const row of providerJobs) {
    const record: AssetProviderJobRecord = { ...row, status: row.status as AssetProviderJobRecord["status"], rawRequestJson: nullableObject(row.rawRequestJson), rawResponseJson: nullableObject(row.rawResponseJson) };
    db.assetProviderJobRecords.set(record.id, record);
  }
  // S2-2A：报价、运行快照、运行、运行事件与用量成本。
  for (const row of quotes) {
    const record: GenerationCostQuoteRecord = {
      id: row.id, projectId: row.projectId, userId: row.userId, operation: row.operation,
      configurationHash: row.configurationHash, quoteFingerprint: row.quoteFingerprint, pricingHash: row.pricingHash,
      pricingVersionSetJson: row.pricingVersionSetJson as unknown as string[],
      itemsJson: row.itemsJson as unknown as unknown[],
      estimatedCostMicros: row.estimatedCostMicros, authorizationCostMicros: row.authorizationCostMicros,
      containsUnboundedItem: row.containsUnboundedItem, budgetLimitMicros: row.budgetLimitMicros, overBudget: row.overBudget,
      expiresAt: row.expiresAt, consumedAt: row.consumedAt,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
    db.generationCostQuotes.set(record.id, record);
  }
  for (const row of snapshots) {
    const record: RunConfigurationSnapshotRecord = {
      id: row.id, projectId: row.projectId, userId: row.userId,
      stage: row.stage, operation: row.operation, runId: row.runId,
      projectConfigurationRevision: row.projectConfigurationRevision, schemaVersion: row.schemaVersion,
      configurationHash: row.configurationHash,
      resolvedConfigurationJson: object(row.resolvedConfigurationJson),
      resolutionTraceJson: row.resolutionTraceJson as unknown as unknown[],
      quoteId: row.quoteId, quoteFingerprint: row.quoteFingerprint,
      estimatedCostMicros: row.estimatedCostMicros, authorizationCostMicros: row.authorizationCostMicros,
      budgetLimitMicros: row.budgetLimitMicros, budgetOverrideAuthorized: row.budgetOverrideAuthorized,
      pricingHash: row.pricingHash,
      pricingVersionSetJson: row.pricingVersionSetJson as unknown as string[],
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
    db.runConfigurationSnapshots.set(record.id, record);
  }
  for (const row of runs) {
    const record: GenerationRunRecord = {
      id: row.id, projectId: row.projectId, userId: row.userId, operation: row.operation,
      idempotencyKey: row.idempotencyKey, payloadFingerprint: row.payloadFingerprint,
      quoteId: row.quoteId, runConfigurationSnapshotId: row.runConfigurationSnapshotId,
      dispatchPayloadJson: object(row.dispatchPayloadJson),
      status: row.status as GenerationRunRecord["status"],
      dispatchLeaseOwner: row.dispatchLeaseOwner, dispatchLeaseExpiresAt: row.dispatchLeaseExpiresAt,
      dispatchClaimCount: row.dispatchClaimCount,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
    db.generationRuns.set(record.id, record);
  }
  for (const row of runEvents) {
    const record: GenerationRunEventRecord = {
      id: row.id, generationRunId: row.generationRunId, eventType: row.eventType,
      segmentId: row.segmentId, eventJson: object(row.eventJson), createdAt: row.createdAt,
    };
    const events = db.generationRunEvents.get(record.generationRunId) ?? [];
    events.push(record);
    db.generationRunEvents.set(record.generationRunId, events);
  }
  for (const row of usageRecords) {
    const record: UsageCostRecordRecord = {
      id: row.id, runConfigurationSnapshotId: row.runConfigurationSnapshotId,
      assetProviderJobRecordId: row.assetProviderJobRecordId, interactionId: row.interactionId,
      capability: row.capability, providerKey: row.providerKey, modelId: row.modelId,
      providerRequestKey: row.providerRequestKey, attemptIndex: row.attemptIndex,
      status: row.status as UsageCostRecordRecord["status"],
      unitType: row.unitType as UsageCostRecordRecord["unitType"],
      inputUnits: row.inputUnits, outputUnits: row.outputUnits,
      estimatedCostMicros: row.estimatedCostMicros, actualCostMicros: row.actualCostMicros,
      costBasis: row.costBasis as UsageCostRecordRecord["costBasis"], durationMs: row.durationMs,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
    db.usageCostRecords.set(record.id, record);
  }
}
