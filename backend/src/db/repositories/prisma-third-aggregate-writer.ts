import type {
  AssetManifestRecord,
  AssetProviderJobRecord,
  ComposeRecord,
  ProjectRecord,
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

  async activateAssetManifest(project: ProjectRecord, record: AssetManifestRecord): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const [scoped, topic, script, storyboard, plan, stored] = await Promise.all([
        tx.project.findFirst({ where: { id: project.id, ownerId: this.ownerId }, select: { activeAssetPlanRecordId: true } }),
        tx.topicPackage.findUnique({ where: { id: record.topicPackageId }, select: { projectId: true } }),
        tx.scriptRecord.findUnique({ where: { id: record.scriptRecordId }, select: { projectId: true } }),
        tx.storyboardRecord.findUnique({ where: { id: record.storyboardRecordId }, select: { projectId: true } }),
        tx.assetPlanRecord.findUnique({ where: { id: record.assetPlanRecordId }, select: { projectId: true } }),
        tx.assetManifestRecord.findUnique({ where: { id: record.id }, select: { projectId: true } }),
      ]);
      if (!scoped) throw new Error("project_scope_denied");
      if (scoped.activeAssetPlanRecordId !== record.assetPlanRecordId) throw new Error("asset_manifest_activation_stale_source");
      if ([topic, script, storyboard, plan, stored].some((item) => item?.projectId !== project.id)) throw new Error("asset_manifest_activation_project_mismatch");
      await tx.project.update({ where: { id: project.id }, data: { status: project.status, activeAssetManifestRecordId: record.id, activeComposeRecordId: null, activeRenderJobRecordId: null, activePublishPackageRecordId: null, latestAssetsRunTraceJson: project.latestAssetsRunTraceJson as never, latestComposeRunTraceJson: null as never, latestRenderRunTraceJson: null as never } });
    });
  }

  async activateCompose(project: ProjectRecord, record: ComposeRecord): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const [scoped, manifest, stored] = await Promise.all([
        tx.project.findFirst({ where: { id: project.id, ownerId: this.ownerId }, select: { activeAssetManifestRecordId: true } }),
        tx.assetManifestRecord.findUnique({ where: { id: record.assetManifestRecordId }, select: { projectId: true } }),
        tx.composeRecord.findUnique({ where: { id: record.id }, select: { projectId: true } }),
      ]);
      if (!scoped) throw new Error("project_scope_denied");
      if (scoped.activeAssetManifestRecordId !== record.assetManifestRecordId) throw new Error("compose_activation_stale_source");
      if ([manifest, stored].some((item) => item?.projectId !== project.id)) throw new Error("compose_activation_project_mismatch");
      await tx.project.update({ where: { id: project.id }, data: { status: project.status, activeComposeRecordId: record.id, activeRenderJobRecordId: null, activePublishPackageRecordId: null, latestComposeRunTraceJson: project.latestComposeRunTraceJson as never, latestRenderRunTraceJson: null as never } });
    });
  }

  async activateRender(project: ProjectRecord, record: RenderJobRecord): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const [scoped, compose, manifest, stored] = await Promise.all([
        tx.project.findFirst({ where: { id: project.id, ownerId: this.ownerId }, select: { activeComposeRecordId: true } }),
        tx.composeRecord.findUnique({ where: { id: record.composeRecordId }, select: { projectId: true, assetManifestRecordId: true } }),
        tx.assetManifestRecord.findUnique({ where: { id: record.assetManifestRecordId }, select: { projectId: true } }),
        tx.renderJobRecord.findUnique({ where: { id: record.id }, select: { projectId: true } }),
      ]);
      if (!scoped) throw new Error("project_scope_denied");
      if (scoped.activeComposeRecordId !== record.composeRecordId) throw new Error("render_activation_stale_source");
      if (compose?.assetManifestRecordId !== record.assetManifestRecordId || [compose, manifest, stored].some((item) => item?.projectId !== project.id)) throw new Error("render_activation_project_mismatch");
      await tx.project.update({ where: { id: project.id }, data: { status: project.status, activeRenderJobRecordId: record.id, activePublishPackageRecordId: null, latestRenderRunTraceJson: project.latestRenderRunTraceJson as never } });
    });
  }

  async activatePublish(project: ProjectRecord, record: PublishPackageRecord): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const [scoped, render, topic, script, storyboard, manifest, stored] = await Promise.all([
        tx.project.findFirst({ where: { id: project.id, ownerId: this.ownerId }, select: { activeRenderJobRecordId: true } }),
        tx.renderJobRecord.findUnique({ where: { id: record.renderJobRecordId }, select: { projectId: true, assetManifestRecordId: true } }),
        tx.topicPackage.findUnique({ where: { id: record.topicPackageId }, select: { projectId: true } }),
        tx.scriptRecord.findUnique({ where: { id: record.scriptRecordId }, select: { projectId: true } }),
        tx.storyboardRecord.findUnique({ where: { id: record.storyboardRecordId }, select: { projectId: true } }),
        tx.assetManifestRecord.findUnique({ where: { id: record.assetManifestRecordId }, select: { projectId: true } }),
        tx.publishPackageRecord.findUnique({ where: { id: record.id }, select: { projectId: true } }),
      ]);
      if (!scoped) throw new Error("project_scope_denied");
      if (scoped.activeRenderJobRecordId !== record.renderJobRecordId) throw new Error("publish_activation_stale_source");
      if (render?.assetManifestRecordId !== record.assetManifestRecordId || [render, topic, script, storyboard, manifest, stored].some((item) => item?.projectId !== project.id)) throw new Error("publish_activation_project_mismatch");
      await tx.project.update({ where: { id: project.id }, data: { status: project.status, activePublishPackageRecordId: record.id } });
    });
  }
}
