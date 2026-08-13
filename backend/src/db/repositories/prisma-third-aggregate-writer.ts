import type {
  AssetManifestRecord,
  AssetProviderJobRecord,
  ComposeRecord,
  GenerationCostQuoteRecord,
  GenerationRunEventRecord,
  GenerationRunRecord,
  ProjectRecord,
  PublishPackageRecord,
  RenderJobRecord,
  RunConfigurationSnapshotRecord,
  UsageCostRecordRecord,
} from "../client.js";
import type { AppPrismaClient } from "../prisma-client.types.js";

/**
 * 非负十进制微元字符串校验（与 shared decimalMicrosString 合同一致）。
 * 数据库列已有 CHECK 约束，writer 边界提前校验让错误可读（P1-2 整改）。
 */
function assertValidMicros(value: string, field: string): void {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${field}_invalid_micros: expected non-negative decimal integer string, got "${value}"`);
  }
}
function assertValidNullableMicros(value: string | null, field: string): void {
  if (value !== null) assertValidMicros(value, field);
}

const manifestData = (record: AssetManifestRecord) => ({ projectId: record.projectId, topicPackageId: record.topicPackageId, scriptRecordId: record.scriptRecordId, storyboardRecordId: record.storyboardRecordId, assetPlanRecordId: record.assetPlanRecordId, manifestJson: record.manifestJson as never, validationResultJson: record.validationResultJson as never, executionStateJson: record.executionStateJson as never, graphTraceSummaryJson: record.graphTraceSummaryJson as never, runtimeDiagnosticsJson: record.runtimeDiagnosticsJson as never });
const composeData = (record: ComposeRecord) => ({ projectId: record.projectId, assetManifestRecordId: record.assetManifestRecordId, timelineJson: record.timelineJson as never, validationResultJson: record.validationResultJson as never, executionStateJson: record.executionStateJson as never, graphTraceSummaryJson: record.graphTraceSummaryJson as never, runtimeDiagnosticsJson: record.runtimeDiagnosticsJson as never });
const renderData = (record: RenderJobRecord) => ({ projectId: record.projectId, composeRecordId: record.composeRecordId, assetManifestRecordId: record.assetManifestRecordId, status: record.status, profileJson: record.profileJson as never, outputArtifactJson: record.outputArtifactJson as never, validationResultJson: record.validationResultJson as never, executionStateJson: record.executionStateJson as never, graphTraceSummaryJson: record.graphTraceSummaryJson as never, runtimeDiagnosticsJson: record.runtimeDiagnosticsJson as never });
const publishData = (record: PublishPackageRecord) => ({ projectId: record.projectId, renderJobRecordId: record.renderJobRecordId, topicPackageId: record.topicPackageId, scriptRecordId: record.scriptRecordId, storyboardRecordId: record.storyboardRecordId, assetManifestRecordId: record.assetManifestRecordId, packageJson: record.packageJson as never, validationResultJson: record.validationResultJson as never, executionStateJson: record.executionStateJson as never });
const providerJobData = (record: AssetProviderJobRecord) => ({ assetManifestRecordId: record.assetManifestRecordId, assetRunId: record.assetRunId, executionId: record.executionId, taskId: record.taskId, providerType: record.providerType, providerName: record.providerName, providerJobId: record.providerJobId, status: record.status, attemptCount: record.attemptCount, generationRunId: record.generationRunId, providerRequestKey: record.providerRequestKey, rawRequestJson: record.rawRequestJson as never, rawResponseJson: record.rawResponseJson as never, errorCode: record.errorCode, errorMessage: record.errorMessage, submittedAt: record.submittedAt, lastPolledAt: record.lastPolledAt, completedAt: record.completedAt });

export class PrismaThirdAggregateWriter {
  constructor(private readonly client: AppPrismaClient) {}

  private async assertProjectScope(projectId: string, ownerId: string): Promise<void> {
    const scoped = await this.client.project.findFirst({ where: { id: projectId, ownerId }, select: { id: true } });
    if (!scoped) throw new Error("project_scope_denied");
  }

  async saveAssetManifest(record: AssetManifestRecord, projectOwnerId: string): Promise<void> {
    await this.assertProjectScope(record.projectId, projectOwnerId);
    const data = manifestData(record);
    await this.client.assetManifestRecord.upsert({ where: { id: record.id }, create: { id: record.id, ...data, createdAt: record.createdAt }, update: data });
  }
  async saveCompose(record: ComposeRecord, projectOwnerId: string): Promise<void> {
    await this.assertProjectScope(record.projectId, projectOwnerId);
    const data = composeData(record);
    await this.client.composeRecord.upsert({ where: { id: record.id }, create: { id: record.id, ...data, createdAt: record.createdAt }, update: data });
  }
  async saveRender(record: RenderJobRecord, projectOwnerId: string): Promise<void> {
    await this.assertProjectScope(record.projectId, projectOwnerId);
    const data = renderData(record);
    await this.client.renderJobRecord.upsert({ where: { id: record.id }, create: { id: record.id, ...data, createdAt: record.createdAt, updatedAt: record.updatedAt }, update: data });
  }
  async savePublish(record: PublishPackageRecord, projectOwnerId: string): Promise<void> {
    await this.assertProjectScope(record.projectId, projectOwnerId);
    const data = publishData(record);
    await this.client.publishPackageRecord.upsert({ where: { id: record.id }, create: { id: record.id, ...data, createdAt: record.createdAt, updatedAt: record.updatedAt }, update: data });
  }
  async saveProviderJob(record: AssetProviderJobRecord, projectOwnerId: string): Promise<AssetProviderJobRecord> {
    const scopedManifest = await this.client.assetManifestRecord.findFirst({ where: { id: record.assetManifestRecordId, project: { ownerId: projectOwnerId } }, select: { id: true } });
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
        tx.project.findFirst({ where: { id: project.id, ownerId: project.ownerId }, select: { activeAssetPlanRecordId: true } }),
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
        tx.project.findFirst({ where: { id: project.id, ownerId: project.ownerId }, select: { activeAssetManifestRecordId: true } }),
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
        tx.project.findFirst({ where: { id: project.id, ownerId: project.ownerId }, select: { activeComposeRecordId: true } }),
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
        tx.project.findFirst({ where: { id: project.id, ownerId: project.ownerId }, select: { activeRenderJobRecordId: true } }),
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

  // --- S2-2A 报价、运行快照、运行、事件、用量成本 ---

  async saveGenerationCostQuote(record: GenerationCostQuoteRecord): Promise<void> {
    // P1-2：金额必须在 writer 边界即为合法非负十进制微元字符串。
    assertValidMicros(record.estimatedCostMicros, "estimated_cost_micros");
    assertValidMicros(record.authorizationCostMicros, "authorization_cost_micros");
    assertValidNullableMicros(record.budgetLimitMicros, "budget_limit_micros");
    const data = {
      projectId: record.projectId,
      userId: record.userId,
      operation: record.operation,
      configurationHash: record.configurationHash,
      quoteFingerprint: record.quoteFingerprint,
      pricingHash: record.pricingHash,
      pricingVersionSetJson: record.pricingVersionSetJson as never,
      itemsJson: record.itemsJson as never,
      estimatedCostMicros: record.estimatedCostMicros,
      authorizationCostMicros: record.authorizationCostMicros,
      containsUnboundedItem: record.containsUnboundedItem,
      budgetLimitMicros: record.budgetLimitMicros,
      overBudget: record.overBudget,
      expiresAt: record.expiresAt,
      consumedAt: record.consumedAt,
      updatedAt: record.updatedAt,
    };
    await this.client.generationCostQuote.upsert({
      where: { id: record.id },
      create: { id: record.id, ...data, createdAt: record.createdAt },
      update: data,
    });
  }

  /**
   * 追加不可变运行快照。不提供 update 方法（详细设计 4.6 节）。
   */
  async appendRunConfigurationSnapshot(record: RunConfigurationSnapshotRecord): Promise<void> {
    // P1-2：金额字段若存在必须是合法非负十进制微元字符串。
    assertValidNullableMicros(record.estimatedCostMicros, "estimated_cost_micros");
    assertValidNullableMicros(record.authorizationCostMicros, "authorization_cost_micros");
    assertValidNullableMicros(record.budgetLimitMicros, "budget_limit_micros");
    // P1-2：snapshot 引用的 quote 必须属于相同项目（数据库触发器为最后防线，
    // 这里在 writer 层提前给出可读错误）。
    if (record.quoteId !== null) {
      const quote = await this.client.generationCostQuote.findUnique({
        where: { id: record.quoteId },
        select: { projectId: true },
      });
      if (!quote) throw new Error("snapshot_quote_not_found");
      if (quote.projectId !== record.projectId) {
        throw new Error("snapshot_quote_project_mismatch: snapshot and quote must belong to the same project");
      }
    }
    await this.client.runConfigurationSnapshot.create({ data: {
      id: record.id, projectId: record.projectId, userId: record.userId,
      stage: record.stage, operation: record.operation, runId: record.runId,
      projectConfigurationRevision: record.projectConfigurationRevision, schemaVersion: record.schemaVersion,
      configurationHash: record.configurationHash,
      resolvedConfigurationJson: record.resolvedConfigurationJson as never,
      resolutionTraceJson: record.resolutionTraceJson as never,
      quoteId: record.quoteId, quoteFingerprint: record.quoteFingerprint,
      estimatedCostMicros: record.estimatedCostMicros, authorizationCostMicros: record.authorizationCostMicros,
      budgetLimitMicros: record.budgetLimitMicros, budgetOverrideAuthorized: record.budgetOverrideAuthorized,
      pricingHash: record.pricingHash, pricingVersionSetJson: record.pricingVersionSetJson as never,
      createdAt: record.createdAt, updatedAt: record.updatedAt,
    } });
  }

  async saveGenerationRun(record: GenerationRunRecord): Promise<void> {
    // P1-3：run 关联的 snapshot 与 quote 必须属于同一个项目（SQLite/Prisma
    // 无法用声明式跨表复合 FK 表达，写入时事务级强校验）。
    await this.client.$transaction(async (transaction) => {
      const snapshot = await transaction.runConfigurationSnapshot.findUnique({
        where: { id: record.runConfigurationSnapshotId },
        select: { projectId: true },
      });
      if (!snapshot) throw new Error("generation_run_snapshot_not_found");
      if (snapshot.projectId !== record.projectId) {
        throw new Error("generation_run_project_mismatch: run and snapshot must belong to the same project");
      }
      if (record.quoteId !== null) {
        const quote = await transaction.generationCostQuote.findUnique({
          where: { id: record.quoteId },
          select: { projectId: true },
        });
        if (!quote) throw new Error("generation_run_quote_not_found");
        if (quote.projectId !== record.projectId) {
          throw new Error("generation_run_project_mismatch: run and quote must belong to the same project");
        }
      }
      const data = {
        projectId: record.projectId, userId: record.userId, operation: record.operation,
        idempotencyKey: record.idempotencyKey, payloadFingerprint: record.payloadFingerprint,
        quoteId: record.quoteId, runConfigurationSnapshotId: record.runConfigurationSnapshotId,
        dispatchPayloadJson: record.dispatchPayloadJson as never,
        status: record.status,
        dispatchLeaseOwner: record.dispatchLeaseOwner, dispatchLeaseExpiresAt: record.dispatchLeaseExpiresAt,
        dispatchClaimCount: record.dispatchClaimCount, updatedAt: record.updatedAt,
      };
      await transaction.generationRun.upsert({
        where: { id: record.id },
        create: { id: record.id, ...data, createdAt: record.createdAt },
        update: data,
      });
    });
  }

  /**
   * 追加运行事件（append-only）。不提供 update。
   */
  async appendGenerationRunEvent(record: GenerationRunEventRecord): Promise<void> {
    await this.client.generationRunEvent.create({ data: {
      id: record.id, generationRunId: record.generationRunId, eventType: record.eventType,
      segmentId: record.segmentId, eventJson: record.eventJson as never, createdAt: record.createdAt,
    } });
  }

  async saveUsageCostRecord(record: UsageCostRecordRecord): Promise<void> {
    // P1-2：金额必须在 writer 边界即为合法非负十进制微元字符串。
    assertValidMicros(record.estimatedCostMicros, "estimated_cost_micros");
    assertValidNullableMicros(record.actualCostMicros, "actual_cost_micros");
    const data = {
      runConfigurationSnapshotId: record.runConfigurationSnapshotId,
      assetProviderJobRecordId: record.assetProviderJobRecordId, interactionId: record.interactionId,
      capability: record.capability, providerKey: record.providerKey, modelId: record.modelId,
      providerRequestKey: record.providerRequestKey, attemptIndex: record.attemptIndex,
      status: record.status, unitType: record.unitType,
      inputUnits: record.inputUnits, outputUnits: record.outputUnits,
      estimatedCostMicros: record.estimatedCostMicros, actualCostMicros: record.actualCostMicros,
      costBasis: record.costBasis, durationMs: record.durationMs, updatedAt: record.updatedAt,
    };
    await this.client.usageCostRecord.upsert({
      where: {
        runConfigurationSnapshotId_providerRequestKey_attemptIndex: {
          runConfigurationSnapshotId: record.runConfigurationSnapshotId,
          providerRequestKey: record.providerRequestKey,
          attemptIndex: record.attemptIndex,
        },
      },
      create: { id: record.id, ...data, createdAt: record.createdAt },
      update: data,
    });
  }
}
