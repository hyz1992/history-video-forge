import type {
  AssetManifestRecord,
  AssetPlanRecord,
  DbClient,
  ProjectGenerationConfigurationRecord,
  ProjectRecord,
  ProviderModelCatalogRecord,
  RunConfigurationSnapshotRecord,
  StoryboardRecord,
  StoryboardSegmentOverrideRecord,
  UsageCostRecordRecord,
} from "../../db/client.js";
import type { AppPrismaClient } from "../../db/prisma-client.types.js";
import { syncProjectConfigRecord } from "../generation-config/generation-config.repository.js";

/**
 * S2-2A 任务 8：generation-cost repository（成本只读查询；2026-08-23 报价
 * 体系移除后保留 snapshot/usage/解析源）。
 *
 * 所有查询必须以已授权 `projectId` 为入口（owner scope 反查在 controller 完成）；
 * 禁止提供只凭 snapshot/cost id 返回数据的未授权方法。
 * 内存态读写 DbClient 的 Map；Prisma 激活态经 thirdAggregateWriter 双写，
 * 只读查询传入 prismaClient 时以数据库为权威（跨进程一致性，外部审查 N1）：
 * 查询结果同步回内存镜像，单实例内读写语义保持一致。
 */

// --- snapshot / usage 只读（project-scoped） ---------------------------------

export async function findSnapshotById(
  db: DbClient,
  projectId: string,
  snapshotId: string,
  prismaClient?: AppPrismaClient,
): Promise<RunConfigurationSnapshotRecord | null> {
  if (prismaClient) {
    const row = await prismaClient.runConfigurationSnapshot.findUnique({ where: { id: snapshotId } });
    if (!row || row.projectId !== projectId) return null;
    const record = toSnapshotRecord(row);
    db.runConfigurationSnapshots.set(record.id, record);
    return record;
  }
  const record = db.runConfigurationSnapshots.get(snapshotId);
  if (!record || record.projectId !== projectId) return null;
  return record;
}

export async function listSnapshotsByProject(
  db: DbClient,
  projectId: string,
  prismaClient?: AppPrismaClient,
): Promise<RunConfigurationSnapshotRecord[]> {
  if (prismaClient) {
    const rows = await prismaClient.runConfigurationSnapshot.findMany({ where: { projectId } });
    const records = rows.map(toSnapshotRecord);
    for (const record of records) db.runConfigurationSnapshots.set(record.id, record);
    return records.sort(compareByCreatedAt);
  }
  return sortByCreatedAt(
    [...db.runConfigurationSnapshots.values()].filter((record) => record.projectId === projectId),
  );
}

export async function listUsageRecordsByProject(
  db: DbClient,
  projectId: string,
  prismaClient?: AppPrismaClient,
): Promise<UsageCostRecordRecord[]> {
  if (prismaClient) {
    const snapshotIds = (
      await prismaClient.runConfigurationSnapshot.findMany({ where: { projectId }, select: { id: true } })
    ).map((row) => row.id);
    const [snapshotRows, runRows, usageRows] = await Promise.all([
      snapshotIds.length === 0
        ? Promise.resolve([])
        : prismaClient.runConfigurationSnapshot.findMany({ where: { id: { in: snapshotIds } } }),
      snapshotIds.length === 0
        ? Promise.resolve([])
        : prismaClient.generationRun.findMany({
            where: { runConfigurationSnapshotId: { in: snapshotIds } },
          }),
      snapshotIds.length === 0
        ? Promise.resolve([])
        : prismaClient.usageCostRecord.findMany({
            where: { runConfigurationSnapshotId: { in: snapshotIds } },
          }),
    ]);
    // 关联记录一并同步镜像：costs/records 的 run_id/run_status/operation
    // 在冷镜像进程下也必须从 DB 恢复（外部审查 N1 同根因）
    for (const row of snapshotRows) {
      const record = toSnapshotRecord(row);
      db.runConfigurationSnapshots.set(record.id, record);
    }
    for (const row of runRows) {
      const record = toRunRecord(row);
      db.generationRuns.set(record.id, record);
    }
    const records = usageRows.map(toUsageRecord);
    for (const record of records) db.usageCostRecords.set(record.id, record);
    return records.sort(compareByCreatedAt);
  }
  const records: UsageCostRecordRecord[] = [];
  for (const record of db.usageCostRecords.values()) {
    const snapshot = db.runConfigurationSnapshots.get(record.runConfigurationSnapshotId);
    if (snapshot && snapshot.projectId === projectId) records.push(record);
  }
  return records.sort(compareByCreatedAt);
}

// --- Prisma row → record 转换 -------------------------------------------------

function toRunRecord(row: {
  id: string;
  projectId: string;
  userId: string | null;
  operation: string;
  idempotencyKey: string;
  payloadFingerprint: string;
  quoteId: string | null;
  runConfigurationSnapshotId: string;
  dispatchPayloadJson: unknown;
  status: string;
  dispatchLeaseOwner: string | null;
  dispatchLeaseExpiresAt: Date | null;
  dispatchClaimCount: number;
  createdAt: Date;
  updatedAt: Date;
}): import("../../db/client.js").GenerationRunRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    operation: row.operation,
    idempotencyKey: row.idempotencyKey,
    payloadFingerprint: row.payloadFingerprint,
    quoteId: row.quoteId,
    runConfigurationSnapshotId: row.runConfigurationSnapshotId,
    dispatchPayloadJson: row.dispatchPayloadJson as Record<string, unknown>,
    status: row.status as import("../../db/client.js").GenerationRunRecord["status"],
    dispatchLeaseOwner: row.dispatchLeaseOwner,
    dispatchLeaseExpiresAt: row.dispatchLeaseExpiresAt,
    dispatchClaimCount: row.dispatchClaimCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// --- 提交重校验输入（DB 权威读取，任务 8 终审 I-1'） -------------------------

/**
 * 报价/提交重解析的全部输入。Prisma 态以数据库为权威并同步内存镜像：
 * 实例 B 的旧镜像不得放过实例 A 修改配置/价格/plan 之前的旧 quote。
 */
export interface QuoteResolutionSource {
  /** 调用方传入的 project（Prisma 态活动指针不回写该对象，见 loader 注释）。 */
  project: ProjectRecord;
  projectConfig: ProjectGenerationConfigurationRecord | null;
  catalog: ProviderModelCatalogRecord[];
  storyboard: StoryboardRecord | null;
  segmentOverrides: StoryboardSegmentOverrideRecord[];
  assetPlan: AssetPlanRecord | null;
  manifest: AssetManifestRecord | null;
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const nullableObject = (value: unknown): Record<string, unknown> | null =>
  value == null ? null : object(value);

function toProjectConfigRecord(row: {
  id: string;
  projectId: string;
  schemaVersion: string;
  revision: number;
  sourceUserPreferenceRevision: number | null;
  configurationJson: unknown;
  createdAt: Date;
  updatedAt: Date;
}): ProjectGenerationConfigurationRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    schemaVersion: row.schemaVersion,
    revision: row.revision,
    sourceUserPreferenceRevision: row.sourceUserPreferenceRevision,
    configurationJson: object(row.configurationJson) as ProjectGenerationConfigurationRecord["configurationJson"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCatalogRecord(row: {
  id: string;
  capability: string;
  providerKey: string;
  modelId: string;
  modelVersion: string | null;
  displayName: string;
  qualityTier: string | null;
  speedTier: string | null;
  parameterCapabilitiesJson: unknown;
  pricingVersion: string;
  pricingJson: unknown;
  status: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}): ProviderModelCatalogRecord {
  return {
    id: row.id,
    capability: row.capability as ProviderModelCatalogRecord["capability"],
    providerKey: row.providerKey,
    modelId: row.modelId,
    modelVersion: row.modelVersion,
    displayName: row.displayName,
    qualityTier: row.qualityTier,
    speedTier: row.speedTier,
    parameterCapabilitiesJson: object(row.parameterCapabilitiesJson),
    pricingVersion: row.pricingVersion,
    pricingJson: object(row.pricingJson),
    status: row.status as ProviderModelCatalogRecord["status"],
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toStoryboardRecord(row: {
  id: string;
  projectId: string;
  topicPackageId: string;
  scriptRecordId: string;
  planJson: unknown;
  validationResultJson: unknown;
  executionStateJson: unknown;
  graphTraceSummaryJson: unknown;
  runtimeDiagnosticsJson: unknown;
  createdAt: Date;
}): StoryboardRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    topicPackageId: row.topicPackageId,
    scriptRecordId: row.scriptRecordId,
    planJson: object(row.planJson),
    validationResultJson: object(row.validationResultJson),
    executionStateJson: nullableObject(row.executionStateJson),
    graphTraceSummaryJson: nullableObject(row.graphTraceSummaryJson),
    runtimeDiagnosticsJson: nullableObject(row.runtimeDiagnosticsJson),
    createdAt: row.createdAt,
  };
}

function toAssetPlanRecord(row: {
  id: string;
  projectId: string;
  topicPackageId: string;
  scriptRecordId: string;
  storyboardRecordId: string;
  planJson: unknown;
  validationResultJson: unknown;
  executionStateJson: unknown;
  graphTraceSummaryJson: unknown;
  runtimeDiagnosticsJson: unknown;
  createdAt: Date;
}): AssetPlanRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    topicPackageId: row.topicPackageId,
    scriptRecordId: row.scriptRecordId,
    storyboardRecordId: row.storyboardRecordId,
    planJson: object(row.planJson) as never,
    validationResultJson: object(row.validationResultJson) as never,
    executionStateJson: object(row.executionStateJson),
    graphTraceSummaryJson: nullableObject(row.graphTraceSummaryJson),
    runtimeDiagnosticsJson: nullableObject(row.runtimeDiagnosticsJson),
    createdAt: row.createdAt,
  };
}

function toManifestRecord(row: {
  id: string;
  projectId: string;
  topicPackageId: string;
  scriptRecordId: string;
  storyboardRecordId: string;
  assetPlanRecordId: string;
  revision: number;
  manifestJson: unknown;
  validationResultJson: unknown;
  executionStateJson: unknown;
  graphTraceSummaryJson: unknown;
  runtimeDiagnosticsJson: unknown;
  createdAt: Date;
}): AssetManifestRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    topicPackageId: row.topicPackageId,
    scriptRecordId: row.scriptRecordId,
    storyboardRecordId: row.storyboardRecordId,
    assetPlanRecordId: row.assetPlanRecordId,
    revision: row.revision,
    manifestJson: object(row.manifestJson),
    validationResultJson: object(row.validationResultJson),
    executionStateJson: nullableObject(row.executionStateJson),
    graphTraceSummaryJson: nullableObject(row.graphTraceSummaryJson),
    runtimeDiagnosticsJson: nullableObject(row.runtimeDiagnosticsJson),
    createdAt: row.createdAt,
  };
}

function toSegmentOverrideRecord(row: {
  id: string;
  projectId: string;
  storyboardRecordId: string;
  segmentId: string;
  strategyOverride: string | null;
  revision: number;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): StoryboardSegmentOverrideRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    storyboardRecordId: row.storyboardRecordId,
    segmentId: row.segmentId,
    strategyOverride: row.strategyOverride as StoryboardSegmentOverrideRecord["strategyOverride"],
    revision: row.revision,
    updatedByUserId: row.updatedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * 加载报价/提交重解析的全部输入。
 *
 * - Prisma 态：project 行、项目配置、目录、storyboard、override、asset plan、
 *   manifest 全部直查数据库（project 不存在返回 null）；活动指针只作为本地
 *   变量驱动取数，**不回写共享 project 对象**——写路径是"内存先行、DB 异步
 *   落库"，读路径回写 DB 中的旧指针会在单实例内 revert 写路径进行中的变更。
 * - Map 态：内存即存储。
 */
export async function loadQuoteResolutionSource(
  db: DbClient,
  project: ProjectRecord,
  prismaClient?: AppPrismaClient,
): Promise<QuoteResolutionSource | null> {
  if (!prismaClient) {
    let projectConfig: ProjectGenerationConfigurationRecord | null = null;
    for (const record of db.projectGenerationConfigurations.values()) {
      if (record.projectId === project.id) {
        projectConfig = record;
        break;
      }
    }
    const storyboard = project.activeStoryboardRecordId
      ? db.storyboardRecords.get(project.activeStoryboardRecordId) ?? null
      : null;
    const segmentOverrides = [...db.storyboardSegmentOverrides.values()].filter(
      (override) =>
        override.projectId === project.id &&
        override.storyboardRecordId === storyboard?.id &&
        override.strategyOverride !== null,
    );
    const assetPlan = project.activeAssetPlanRecordId
      ? db.assetPlanRecords.get(project.activeAssetPlanRecordId) ?? null
      : null;
    const manifest = project.activeAssetManifestRecordId
      ? db.assetManifestRecords.get(project.activeAssetManifestRecordId) ?? null
      : null;
    return {
      project,
      projectConfig,
      catalog: [...db.providerModelCatalog.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      storyboard,
      segmentOverrides,
      assetPlan,
      manifest,
    };
  }

  const projectRow = await prismaClient.project.findUnique({ where: { id: project.id } });
  if (!projectRow) return null;
  // 活动指针以 DB 行为准（仅本地变量，不回写共享 project 对象——写路径是
  // "内存先行、DB 异步落库"，读路径回写旧指针会在单实例内 revert 进行中的
  // 变更，diff 审查 I-A1）
  const activeStoryboardRecordId = projectRow.activeStoryboardRecordId;
  const activeAssetPlanRecordId = projectRow.activeAssetPlanRecordId;
  const activeAssetManifestRecordId = projectRow.activeAssetManifestRecordId;

  const [configRow, catalogRows, storyboardRow, assetPlanRow, manifestRow] = await Promise.all([
    prismaClient.projectGenerationConfiguration.findUnique({ where: { projectId: project.id } }),
    prismaClient.providerModelCatalog.findMany(),
    activeStoryboardRecordId
      ? prismaClient.storyboardRecord.findUnique({ where: { id: activeStoryboardRecordId } })
      : Promise.resolve(null),
    activeAssetPlanRecordId
      ? prismaClient.assetPlanRecord.findUnique({ where: { id: activeAssetPlanRecordId } })
      : Promise.resolve(null),
    activeAssetManifestRecordId
      ? prismaClient.assetManifestRecord.findUnique({ where: { id: activeAssetManifestRecordId } })
      : Promise.resolve(null),
  ]);
  const overrideRows = storyboardRow
    ? await prismaClient.storyboardSegmentOverride.findMany({
        where: { projectId: project.id, storyboardRecordId: storyboardRow.id },
      })
    : [];

  const projectConfig = configRow ? toProjectConfigRecord(configRow) : null;
  if (projectConfig) syncProjectConfigRecord(db, projectConfig);
  const catalog = catalogRows.map(toCatalogRecord).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const record of catalog) db.providerModelCatalog.set(record.id, record);
  // 跨项目行不可见（owner scope；正常情况下活动指针不会跨项目，防御性过滤）
  const storyboard =
    storyboardRow && storyboardRow.projectId === project.id ? toStoryboardRecord(storyboardRow) : null;
  if (storyboard) db.storyboardRecords.set(storyboard.id, storyboard);
  const assetPlan = assetPlanRow && assetPlanRow.projectId === project.id ? toAssetPlanRecord(assetPlanRow) : null;
  if (assetPlan) db.assetPlanRecords.set(assetPlan.id, assetPlan);
  const manifest = manifestRow && manifestRow.projectId === project.id ? toManifestRecord(manifestRow) : null;
  if (manifest) db.assetManifestRecords.set(manifest.id, manifest);
  const segmentOverrides = overrideRows
    .filter((row) => row.strategyOverride !== null)
    .map(toSegmentOverrideRecord);
  for (const record of segmentOverrides) db.storyboardSegmentOverrides.set(record.id, record);

  return { project, projectConfig, catalog, storyboard, segmentOverrides, assetPlan, manifest };
}

// --- 排序辅助 ---------------------------------------------------------------

function compareByCreatedAt(a: { createdAt: Date }, b: { createdAt: Date }): number {
  if (a.createdAt.getTime() < b.createdAt.getTime()) return -1;
  if (a.createdAt.getTime() > b.createdAt.getTime()) return 1;
  return 0;
}

function sortByCreatedAt<T extends { createdAt: Date }>(records: T[]): T[] {
  return records.sort(compareByCreatedAt);
}

// --- Prisma row → record 转换 -------------------------------------------------


function toSnapshotRecord(row: {
  id: string;
  projectId: string;
  userId: string | null;
  stage: string;
  operation: string;
  runId: string | null;
  projectConfigurationRevision: number;
  schemaVersion: string;
  configurationHash: string;
  resolvedConfigurationJson: unknown;
  resolutionTraceJson: unknown;
  quoteId: string | null;
  quoteFingerprint: string | null;
  estimatedCostMicros: string | null;
  authorizationCostMicros: string | null;
  containsUnboundedItem: boolean;
  budgetLimitMicros: string | null;
  budgetOverrideAuthorized: boolean;
  pricingHash: string | null;
  pricingVersionSetJson: unknown;
  createdAt: Date;
  updatedAt: Date;
}): RunConfigurationSnapshotRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    stage: row.stage,
    operation: row.operation,
    runId: row.runId,
    projectConfigurationRevision: row.projectConfigurationRevision,
    schemaVersion: row.schemaVersion,
    configurationHash: row.configurationHash,
    resolvedConfigurationJson: row.resolvedConfigurationJson as Record<string, unknown>,
    resolutionTraceJson: row.resolutionTraceJson as unknown[],
    quoteId: row.quoteId,
    quoteFingerprint: row.quoteFingerprint,
    estimatedCostMicros: row.estimatedCostMicros,
    authorizationCostMicros: row.authorizationCostMicros,
    containsUnboundedItem: row.containsUnboundedItem,
    budgetLimitMicros: row.budgetLimitMicros,
    budgetOverrideAuthorized: row.budgetOverrideAuthorized,
    pricingHash: row.pricingHash,
    pricingVersionSetJson: row.pricingVersionSetJson as string[],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toUsageRecord(row: {
  id: string;
  runConfigurationSnapshotId: string;
  assetProviderJobRecordId: string | null;
  interactionId: string | null;
  capability: string;
  providerKey: string;
  modelId: string;
  providerRequestKey: string;
  attemptIndex: number;
  status: string;
  unitType: string;
  inputUnits: number | null;
  outputUnits: number | null;
  estimatedCostMicros: string;
  actualCostMicros: string | null;
  costBasis: string;
  durationMs: number | null;
  createdAt: Date;
  updatedAt: Date;
}): UsageCostRecordRecord {
  return {
    id: row.id,
    runConfigurationSnapshotId: row.runConfigurationSnapshotId,
    assetProviderJobRecordId: row.assetProviderJobRecordId,
    interactionId: row.interactionId,
    capability: row.capability,
    providerKey: row.providerKey,
    modelId: row.modelId,
    providerRequestKey: row.providerRequestKey,
    attemptIndex: row.attemptIndex,
    status: row.status as UsageCostRecordRecord["status"],
    unitType: row.unitType as UsageCostRecordRecord["unitType"],
    inputUnits: row.inputUnits,
    outputUnits: row.outputUnits,
    estimatedCostMicros: row.estimatedCostMicros,
    actualCostMicros: row.actualCostMicros,
    costBasis: row.costBasis as UsageCostRecordRecord["costBasis"],
    durationMs: row.durationMs,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
