import type {
  AssetManifestRecord,
  AssetProviderJobRecord,
  ComposeRecord,
  PublishPackageRecord,
  RenderJobRecord,
} from "../client.js";
import type { AppPrismaClient } from "../prisma-client.types.js";

const manifestData = (record: AssetManifestRecord) => ({ projectId: record.projectId, topicPackageId: record.topicPackageId, scriptRecordId: record.scriptRecordId, storyboardRecordId: record.storyboardRecordId, assetPlanRecordId: record.assetPlanRecordId, manifestJson: record.manifestJson as never, validationResultJson: record.validationResultJson as never, executionStateJson: record.executionStateJson as never, graphTraceSummaryJson: record.graphTraceSummaryJson as never, runtimeDiagnosticsJson: record.runtimeDiagnosticsJson as never });
const composeData = (record: ComposeRecord) => ({ projectId: record.projectId, assetManifestRecordId: record.assetManifestRecordId, timelineJson: record.timelineJson as never, validationResultJson: record.validationResultJson as never, executionStateJson: record.executionStateJson as never, graphTraceSummaryJson: record.graphTraceSummaryJson as never, runtimeDiagnosticsJson: record.runtimeDiagnosticsJson as never });
const renderData = (record: RenderJobRecord) => ({ projectId: record.projectId, composeRecordId: record.composeRecordId, assetManifestRecordId: record.assetManifestRecordId, status: record.status, profileJson: record.profileJson as never, outputArtifactJson: record.outputArtifactJson as never, validationResultJson: record.validationResultJson as never, executionStateJson: record.executionStateJson as never, graphTraceSummaryJson: record.graphTraceSummaryJson as never, runtimeDiagnosticsJson: record.runtimeDiagnosticsJson as never });
const publishData = (record: PublishPackageRecord) => ({ projectId: record.projectId, renderJobRecordId: record.renderJobRecordId, topicPackageId: record.topicPackageId, scriptRecordId: record.scriptRecordId, storyboardRecordId: record.storyboardRecordId, assetManifestRecordId: record.assetManifestRecordId, packageJson: record.packageJson as never, validationResultJson: record.validationResultJson as never, executionStateJson: record.executionStateJson as never });
const providerJobData = (record: AssetProviderJobRecord) => ({ assetManifestRecordId: record.assetManifestRecordId, assetRunId: record.assetRunId, executionId: record.executionId, taskId: record.taskId, providerType: record.providerType, providerName: record.providerName, providerJobId: record.providerJobId, status: record.status, attemptCount: record.attemptCount, rawRequestJson: record.rawRequestJson as never, rawResponseJson: record.rawResponseJson as never, errorCode: record.errorCode, errorMessage: record.errorMessage, submittedAt: record.submittedAt, lastPolledAt: record.lastPolledAt, completedAt: record.completedAt });

export class PrismaThirdAggregateWriter {
  constructor(private readonly client: AppPrismaClient, private readonly ownerId: string) {}

  private async assertProjectScope(projectId: string): Promise<void> {
    const scoped = await this.client.project.findFirst({ where: { id: projectId, ownerId: this.ownerId }, select: { id: true } });
    if (!scoped) throw new Error("project_scope_denied");
  }

  async saveAssetManifest(record: AssetManifestRecord): Promise<void> {
    await this.assertProjectScope(record.projectId);
    const data = manifestData(record);
    await this.client.assetManifestRecord.upsert({ where: { id: record.id }, create: { id: record.id, ...data, createdAt: record.createdAt }, update: data });
  }
  async saveCompose(record: ComposeRecord): Promise<void> {
    await this.assertProjectScope(record.projectId);
    const data = composeData(record);
    await this.client.composeRecord.upsert({ where: { id: record.id }, create: { id: record.id, ...data, createdAt: record.createdAt }, update: data });
  }
  async saveRender(record: RenderJobRecord): Promise<void> {
    await this.assertProjectScope(record.projectId);
    const data = renderData(record);
    await this.client.renderJobRecord.upsert({ where: { id: record.id }, create: { id: record.id, ...data, createdAt: record.createdAt, updatedAt: record.updatedAt }, update: data });
  }
  async savePublish(record: PublishPackageRecord): Promise<void> {
    await this.assertProjectScope(record.projectId);
    const data = publishData(record);
    await this.client.publishPackageRecord.upsert({ where: { id: record.id }, create: { id: record.id, ...data, createdAt: record.createdAt, updatedAt: record.updatedAt }, update: data });
  }
  async saveProviderJob(record: AssetProviderJobRecord): Promise<AssetProviderJobRecord> {
    const scopedManifest = await this.client.assetManifestRecord.findFirst({ where: { id: record.assetManifestRecordId, project: { ownerId: this.ownerId } }, select: { id: true } });
    if (!scopedManifest) throw new Error("asset_manifest_scope_denied");
    const data = providerJobData(record);
    const row = await this.client.assetProviderJobRecord.upsert({
      where: { assetRunId_executionId_taskId_attemptCount: { assetRunId: record.assetRunId, executionId: record.executionId, taskId: record.taskId, attemptCount: record.attemptCount } },
      create: { id: record.id, ...data, createdAt: record.createdAt, updatedAt: record.updatedAt },
      update: data,
    });
    return { ...row, status: row.status as AssetProviderJobRecord["status"], rawRequestJson: row.rawRequestJson as Record<string, unknown> | null, rawResponseJson: row.rawResponseJson as Record<string, unknown> | null };
  }
}
