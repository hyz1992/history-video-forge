import type {
  AssetManifestRecord,
  AssetProviderJobRecord,
  ComposeRecord,
  DbClient,
  PublishPackageRecord,
  RenderJobRecord,
} from "../client.js";
import type { AppPrismaClient } from "../prisma-client.types.js";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const nullableObject = (value: unknown): Record<string, unknown> | null => value == null ? null : object(value);

export async function hydrateThirdAggregates(db: DbClient, client: AppPrismaClient): Promise<void> {
  const projectIds = [...db.projects.keys()];
  const [manifests, composeRecords, renderJobs, publishPackages] = await Promise.all([
    client.assetManifestRecord.findMany({ where: { projectId: { in: projectIds } } }),
    client.composeRecord.findMany({ where: { projectId: { in: projectIds } } }),
    client.renderJobRecord.findMany({ where: { projectId: { in: projectIds } } }),
    client.publishPackageRecord.findMany({ where: { projectId: { in: projectIds } } }),
  ]);
  const manifestIds = manifests.map((row) => row.id);
  const providerJobs = manifestIds.length === 0
    ? []
    : await client.assetProviderJobRecord.findMany({ where: { assetManifestRecordId: { in: manifestIds } } });

  db.assetManifestRecords.clear();
  db.composeRecords.clear();
  db.renderJobRecords.clear();
  db.publishPackageRecords.clear();
  db.assetProviderJobRecords.clear();

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
}
