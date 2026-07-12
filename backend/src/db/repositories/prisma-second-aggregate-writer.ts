import type { AssetPlanRecord, ProjectRecord, ScriptRecord, StoryboardRecord } from "../client.js";
import type { AppPrismaClient } from "../prisma-client.types.js";

const scriptData = (record: ScriptRecord) => ({
  projectId: record.projectId, topicPackageId: record.topicPackageId, scriptText: record.scriptText,
  openingSpan: record.openingSpan, endingSpan: record.endingSpan, estimatedDurationSec: record.estimatedDurationSec,
  beatTraceJson: record.beatTraceJson as never, quoteTraceJson: record.quoteTraceJson as never,
  reviewStatus: record.reviewStatus, validationResultJson: record.validationResultJson as never,
  semanticReviewResultJson: record.semanticReviewResultJson as never, executionStateJson: record.executionStateJson as never,
  graphTraceSummaryJson: record.graphTraceSummaryJson as never, runtimeDiagnosticsJson: record.runtimeDiagnosticsJson as never,
});
const storyboardData = (record: StoryboardRecord) => ({
  projectId: record.projectId, topicPackageId: record.topicPackageId, scriptRecordId: record.scriptRecordId,
  planJson: record.planJson as never, validationResultJson: record.validationResultJson as never,
  executionStateJson: record.executionStateJson as never, graphTraceSummaryJson: record.graphTraceSummaryJson as never,
  runtimeDiagnosticsJson: record.runtimeDiagnosticsJson as never,
});
const assetPlanData = (record: AssetPlanRecord) => ({
  projectId: record.projectId, topicPackageId: record.topicPackageId, scriptRecordId: record.scriptRecordId,
  storyboardRecordId: record.storyboardRecordId, planJson: record.planJson as never,
  validationResultJson: record.validationResultJson as never, executionStateJson: record.executionStateJson as never,
  graphTraceSummaryJson: record.graphTraceSummaryJson as never, runtimeDiagnosticsJson: record.runtimeDiagnosticsJson as never,
});

export class PrismaSecondAggregateWriter {
  constructor(private readonly client: AppPrismaClient, private readonly ownerId: string) {}

  async saveScript(record: ScriptRecord): Promise<void> {
    const data = scriptData(record);
    await this.client.scriptRecord.upsert({ where: { id: record.id }, create: { id: record.id, ...data, createdAt: record.createdAt }, update: data });
  }
  async saveStoryboard(record: StoryboardRecord): Promise<void> {
    const data = storyboardData(record);
    await this.client.storyboardRecord.upsert({ where: { id: record.id }, create: { id: record.id, ...data, createdAt: record.createdAt }, update: data });
  }
  async saveAssetPlan(record: AssetPlanRecord): Promise<void> {
    const data = assetPlanData(record);
    await this.client.assetPlanRecord.upsert({ where: { id: record.id }, create: { id: record.id, ...data, createdAt: record.createdAt }, update: data });
  }

  async activateScript(project: ProjectRecord, record: ScriptRecord): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const [scoped, topic, stored] = await Promise.all([
        tx.project.findFirst({ where: { id: project.id, ownerId: this.ownerId }, select: { id: true } }),
        tx.topicPackage.findUnique({ where: { id: record.topicPackageId }, select: { projectId: true } }),
        tx.scriptRecord.findUnique({ where: { id: record.id }, select: { projectId: true } }),
      ]);
      if (!scoped) throw new Error("project_scope_denied");
      if (topic?.projectId !== project.id || stored?.projectId !== project.id) throw new Error("script_activation_project_mismatch");
      await tx.project.update({ where: { id: project.id }, data: {
        status: project.status, activeScriptRecordId: record.id, activeStoryboardRecordId: null, activeAssetPlanRecordId: null,
        activeAssetManifestRecordId: null, activeComposeRecordId: null, activeRenderJobRecordId: null,
        latestScriptRunTraceJson: project.latestScriptRunTraceJson as never, latestStoryboardRunTraceJson: project.latestStoryboardRunTraceJson as never,
        latestAssetPlanRunTraceJson: project.latestAssetPlanRunTraceJson as never, latestAssetsRunTraceJson: project.latestAssetsRunTraceJson as never,
        latestComposeRunTraceJson: project.latestComposeRunTraceJson as never, latestRenderRunTraceJson: project.latestRenderRunTraceJson as never,
      } });
    });
  }

  async activateStoryboard(project: ProjectRecord, record: StoryboardRecord): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const [scoped, topic, script, stored] = await Promise.all([
        tx.project.findFirst({ where: { id: project.id, ownerId: this.ownerId }, select: { id: true } }),
        tx.topicPackage.findUnique({ where: { id: record.topicPackageId }, select: { projectId: true } }),
        tx.scriptRecord.findUnique({ where: { id: record.scriptRecordId }, select: { projectId: true } }),
        tx.storyboardRecord.findUnique({ where: { id: record.id }, select: { projectId: true } }),
      ]);
      if (!scoped) throw new Error("project_scope_denied");
      if ([topic, script, stored].some((item) => item?.projectId !== project.id)) throw new Error("storyboard_activation_project_mismatch");
      await tx.project.update({ where: { id: project.id }, data: {
        status: project.status, activeStoryboardRecordId: record.id, activeAssetPlanRecordId: null,
        activeAssetManifestRecordId: null, activeComposeRecordId: null, activeRenderJobRecordId: null,
        latestStoryboardRunTraceJson: project.latestStoryboardRunTraceJson as never, latestAssetPlanRunTraceJson: project.latestAssetPlanRunTraceJson as never,
        latestAssetsRunTraceJson: project.latestAssetsRunTraceJson as never, latestComposeRunTraceJson: project.latestComposeRunTraceJson as never,
        latestRenderRunTraceJson: project.latestRenderRunTraceJson as never,
      } });
    });
  }

  async activateAssetPlan(project: ProjectRecord, record: AssetPlanRecord): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const [scoped, topic, script, storyboard, stored] = await Promise.all([
        tx.project.findFirst({ where: { id: project.id, ownerId: this.ownerId }, select: { id: true } }),
        tx.topicPackage.findUnique({ where: { id: record.topicPackageId }, select: { projectId: true } }),
        tx.scriptRecord.findUnique({ where: { id: record.scriptRecordId }, select: { projectId: true } }),
        tx.storyboardRecord.findUnique({ where: { id: record.storyboardRecordId }, select: { projectId: true } }),
        tx.assetPlanRecord.findUnique({ where: { id: record.id }, select: { projectId: true } }),
      ]);
      if (!scoped) throw new Error("project_scope_denied");
      if ([topic, script, storyboard, stored].some((item) => item?.projectId !== project.id)) throw new Error("asset_plan_activation_project_mismatch");
      await tx.project.update({ where: { id: project.id }, data: {
        status: project.status, activeAssetPlanRecordId: record.id, activeAssetManifestRecordId: null,
        activeComposeRecordId: null, activeRenderJobRecordId: null,
        latestAssetPlanRunTraceJson: project.latestAssetPlanRunTraceJson as never, latestAssetsRunTraceJson: project.latestAssetsRunTraceJson as never,
        latestComposeRunTraceJson: project.latestComposeRunTraceJson as never, latestRenderRunTraceJson: project.latestRenderRunTraceJson as never,
      } });
    });
  }
}
