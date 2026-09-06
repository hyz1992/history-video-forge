import { createHash } from "node:crypto";

import { env } from "../../config/env.js";
import type {
  DbClient,
  GenerationRunRecord,
  ProjectRecord,
  RunConfigurationSnapshotRecord,
} from "../../db/client.js";
import type { AppPrismaClient } from "../../db/prisma-client.types.js";
import {
  resolveGenerationConfiguration,
  DEFAULT_GENERATION_CONFIGURATION,
  CREATIVE_PRESET_REGISTRY_SNAPSHOT_V1,
  ProjectCostRecordSchema,
  ProjectCostSummarySchema,
  GenerationRunConfigurationResponseSchema,
  type GenerationOperation,
  type GenerationQuoteSelection,
  type ProjectCostRecord,
  type ProjectCostSummary,
  type GenerationRunConfigurationResponse,
  type ResolvedGenerationConfigurationV1,
  type SegmentInput,
  type SegmentVisualStrategyOverride,
} from "../../../../shared/src/index.js";
import { getVoiceProfileById, listVoiceProfiles } from "../assets/voice/voice-profile.repository.js";
import { resolveSystemGenerationConstraints } from "../generation-config/system-constraints.js";

import type { GenerationCapabilityReadinessInput } from "./generation-capability-readiness.js";
import {
  listSnapshotsByProject,
  listUsageRecordsByProject,
  loadQuoteResolutionSource,
  type QuoteResolutionSource,
} from "./generation-cost.repository.js";
import { listRunsByProject } from "../generation-run/generation-run.repository.js";
import { isProviderTypeEnabled } from "../assets/provider-type-map.js";

/**
 * S2-2A 任务 8：报价、提交重校验与成本只读查询。
 *
 * 设计依据：详细设计 4.5（quote + QuoteFingerprintPayloadV1）、4.6（snapshot）、
 * 8.1（报价 API）、8.2（提交事务）、8.4（预算语义）、9.4（成本 API）。
 *
 * 金额约定：内部一律整数微元（BigInt），HTTP JSON 输出 CNY 十进制字符串（6 位小数）。
 *
 * 指纹与哈希边界（任务 1 整改）：
 * - configuration_hash（FNV-1a64）：提交时重新解析比对，漂移检测，非防伪。
 * - pricing_hash（SHA-256，PricingService）：价格变化检测。
 * - quoteFingerprint（SHA-256，本文件）：quote 创建时计算持久化，提交时按相同
 *   canonical 输入重算比对，绑定"配置 + 价格 + 费用明细"。
 *
 * unbounded 金额编码：DB 金额列 NOT NULL（数据库合同），unbounded 时金额归一为
 * "0" 持久化；预算门禁与提交校验以 `containsUnboundedItem` 标志为键，绝不把
 * 归一金额当作可信上界参与比较（pricing 服务的 null → "0" 仅发生在持久化边界）。
 */

// --- 金额格式化 -------------------------------------------------------------

/** 微元十进制字符串 → CNY 十进制字符串（微元/1e6，固定 6 位小数）。 */
export function microsToCnyDecimal(micros: string): string {
  const value = BigInt(micros);
  const yuan = value / 1_000_000n;
  const cents = value % 1_000_000n;
  return `${yuan.toString()}.${cents.toString().padStart(6, "0")}`;
}

/**
 * 报价/提交的 readiness 输入（缺 catalog：由本服务在求值时注入当前目录快照）。
 */
export type QuoteReadinessInput = Omit<GenerationCapabilityReadinessInput, "catalog">;

// --- token 估算与默认计量 ----------------------------------------------------

/** 各 operation 的 token 估算（记账缺失精确 token 时的回退估算）。 */
export const OPERATION_TOKEN_ESTIMATES: Record<
  GenerationOperation,
  { estimated_input_tokens: number; estimated_output_tokens: number }
> = {
  "topic.generate": { estimated_input_tokens: 40000, estimated_output_tokens: 20000 },
  "script.generate": { estimated_input_tokens: 30000, estimated_output_tokens: 15000 },
  "script.narration.generate": { estimated_input_tokens: 0, estimated_output_tokens: 0 },
  "storyboard.generate": { estimated_input_tokens: 40000, estimated_output_tokens: 25000 },
  "asset_plan.generate": { estimated_input_tokens: 50000, estimated_output_tokens: 30000 },
  "assets.generate": { estimated_input_tokens: 8000, estimated_output_tokens: 4000 },
  "publish.generate": { estimated_input_tokens: 10000, estimated_output_tokens: 6000 },
  // voice.preview 是纯媒体操作（无 LLM token 项；占位保持 Record 完整性）
  "voice.preview": { estimated_input_tokens: 0, estimated_output_tokens: 0 },
};

/** 视频任务默认估算秒数（任务参数未声明 duration_sec 时；与执行端默认 7s 对齐）。 */
export const DEFAULT_VIDEO_ESTIMATE_SECONDS = 7;

// --- 解析 -------------------------------------------------------------------

export interface QuoteResolutionValue {
  resolved: ResolvedGenerationConfigurationV1;
  source: QuoteResolutionSource;
  /**
   * S2-2B：voice.preview 的目标档案（可见性已过滤，用于计价 workload）。
   * 其他 operation 为 null。
   */
  voiceProfile: { provider_status: string; preview_text: string } | null;
}

/**
 * 报价/提交共用的确定性解析：项目冻结配置 + 当前目录 + run override + selection。
 * 报价与提交必须走同一实现，保证 configuration_hash 与 fingerprint 可比。
 * I-1'（任务 8 终审）：重解析输入统一经 loadQuoteResolutionSource 读取——
 * Prisma 态以数据库为权威（项目配置/目录/storyboard/override/plan/manifest），
 * 实例 B 的旧内存镜像不得影响重算结果。
 * 2026-08-23（报价体系移除）：run service 提交路径复用本函数完成快照解析
 * 与 plan/storyboard 绑定身份提取。
 */
export async function resolveQuoteConfiguration(
  db: DbClient,
  project: ProjectRecord,
  input: {
    operation: GenerationOperation;
    runOverrides?: unknown;
    selection?: GenerationQuoteSelection;
  },
  prismaClient?: AppPrismaClient,
): Promise<
  | { ok: true; value: QuoteResolutionValue }
  | { ok: false; error: { code: "generation_quote_resolution_failed"; message: string } }
> {
  const source = await loadQuoteResolutionSource(db, project, prismaClient);
  if (!source) {
    return {
      ok: false,
      error: { code: "generation_quote_resolution_failed", message: "project not found in the database" },
    };
  }
  // 配置记录缺失（旧项目未迁移）时按 backfill 同一默认值参与解析：
  // 与 getProjectGenerationConfiguration 的 backfill 产出一致（revision 1 默认），
  // 不在此路径产生持久化副作用。
  const config = source.projectConfig
    ? {
        configuration: source.projectConfig.configurationJson,
        revision: source.projectConfig.revision,
        sourceUserPreferenceRevision: source.projectConfig.sourceUserPreferenceRevision,
      }
    : {
        // 拷贝而非引用共享常量（防御性：resolver/后续变更不得污染模块级默认）
        configuration: { ...DEFAULT_GENERATION_CONFIGURATION },
        revision: 1,
        sourceUserPreferenceRevision: null as number | null,
      };

  let segmentInputs: SegmentInput[] | undefined;
  let segmentOverrides: Record<string, SegmentVisualStrategyOverride> | undefined;
  if (input.operation === "assets.generate" && source.storyboard) {
    const storyboard = source.storyboard;
    const plan = storyboard.planJson as {
      segments?: Array<{ segment_id?: string; api_video_suitability?: SegmentInput["api_video_suitability"] }>;
    };
    // 旧式 plan（无 api_video_suitability 的段）不参与报价路线解析——
    // 无适配度即无 video 计价语义（S2-2A 兼容读取原则：新产物才带适配度）。
    const segments = (plan.segments ?? []).filter(
      (segment) => segment.segment_id && segment.api_video_suitability,
    );
    segmentInputs = segments.map((segment) => ({
      segment_id: segment.segment_id!,
      api_video_suitability: segment.api_video_suitability!,
    }));
    const overrides: Record<string, SegmentVisualStrategyOverride> = {};
    for (const override of source.segmentOverrides) {
      if (override.strategyOverride !== null) {
        overrides[override.segmentId] = override.strategyOverride;
      }
    }
    if (Object.keys(overrides).length > 0) segmentOverrides = overrides;
  }

  const result = resolveGenerationConfiguration({
    projectConfiguration: config.configuration,
    projectConfigurationRevision: config.revision,
    sourceUserPreferenceRevision: config.sourceUserPreferenceRevision,
    runOverrides: input.runOverrides ?? undefined,
    segmentOverrides,
    systemConstraints: resolveSystemGenerationConstraints(env.demoMode),
    providerModelCatalog: source.catalog.map((entry) => ({
      provider_model_id: entry.id,
      capability: entry.capability,
      provider_key: entry.providerKey,
      model_id: entry.modelId,
      model_version: entry.modelVersion ?? null,
      status: entry.status,
      is_default: entry.isDefault,
    })),
    // S2-2B：音色库按项目 owner 可见性过滤（公共 + 本人私有）；Prisma 态
    // repository 直查数据库（跨实例权威，与快照 P1-2 整改同一模式）。
    voiceProfiles: await listVoiceProfiles(db, { ownerId: project.ownerId }),
    // S2-2B：preset 注册表只在解析阶段读取（外部审查 P1-3）。
    creativePresets: CREATIVE_PRESET_REGISTRY_SNAPSHOT_V1,
    operation: input.operation,
    segmentInputs,
  });
  if (!result.ok) {
    return {
      ok: false,
      error: { code: "generation_quote_resolution_failed", message: result.error.message },
    };
  }
  const resolved = result.value;

  // S2-2B：voice.preview 必须显式指定试听档案（run_overrides.creative.
  // voice_profile_id）——auto 模式下没有可计价/可执行的试听目标，不静默猜测试听对象。
  if (input.operation === "voice.preview" && resolved.resolved_creative.voice.mode !== "fixed") {
    return {
      ok: false,
      error: {
        code: "generation_quote_resolution_failed",
        message: "voice.preview requires an explicit voice profile via run_overrides.creative.voice_profile_id",
      },
    };
  }
  let voiceProfile: QuoteResolutionValue["voiceProfile"] = null;
  if (input.operation === "voice.preview") {
    const profile = await getVoiceProfileById(
      db,
      resolved.resolved_creative.voice.voice_profile_id!,
      { ownerId: project.ownerId },
    );
    voiceProfile = profile
      ? { provider_status: profile.provider_status, preview_text: profile.preview_text }
      : null;
  }

  return { ok: true, value: { resolved, source, voiceProfile } };
}

// --- 成本只读查询 -----------------------------------------------------------

export async function getProjectCostSummary(
  db: DbClient,
  projectId: string,
  prismaClient?: AppPrismaClient,
): Promise<ProjectCostSummary> {
  // prismaClient 传入时以数据库为权威（外部审查 N1：跨进程成本只读不能只读内存镜像）
  const [snapshots, usageRecords, runs] = await Promise.all([
    listSnapshotsByProject(db, projectId, prismaClient),
    listUsageRecordsByProject(db, projectId, prismaClient),
    listRunsByProject(db, projectId, prismaClient),
  ]);

  // 预计费用以请求级 usage 记录为准（快照金额为 free 形态零值，不再聚合）
  let totalEstimated = 0n;
  for (const record of usageRecords) {
    totalEstimated += BigInt(record.estimatedCostMicros);
  }

  let totalActual = 0n;
  const capabilityTotals = new Map<string, { estimated: bigint; actual: bigint; count: number }>();
  for (const record of usageRecords) {
    if (record.actualCostMicros !== null) totalActual += BigInt(record.actualCostMicros);
    const entry = capabilityTotals.get(record.capability) ?? { estimated: 0n, actual: 0n, count: 0 };
    entry.estimated += BigInt(record.estimatedCostMicros);
    if (record.actualCostMicros !== null) entry.actual += BigInt(record.actualCostMicros);
    entry.count += 1;
    capabilityTotals.set(record.capability, entry);
  }

  const runStatusCounts = {
    pending_dispatch: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    needs_reconciliation: 0,
  };
  for (const run of runs) {
    runStatusCounts[run.status] += 1;
  }

  const capabilityBreakdown = [...capabilityTotals.entries()]
    .map(([capability, totals]) => ({
      capability,
      estimated_cost_cny: microsToCnyDecimal(totals.estimated.toString()),
      actual_cost_cny: microsToCnyDecimal(totals.actual.toString()),
      record_count: totals.count,
    }))
    .sort((a, b) => {
      if (a.capability < b.capability) return -1;
      if (a.capability > b.capability) return 1;
      return 0;
    });

  return ProjectCostSummarySchema.parse({
    currency: "CNY",
    total_estimated_cost_cny: microsToCnyDecimal(totalEstimated.toString()),
    total_actual_cost_cny: microsToCnyDecimal(totalActual.toString()),
    run_count: runs.length,
    run_status_counts: runStatusCounts,
    capability_breakdown: capabilityBreakdown,
  });
}

export async function listProjectCostRecords(
  db: DbClient,
  projectId: string,
  prismaClient?: AppPrismaClient,
): Promise<ProjectCostRecord[]> {
  const usageRecords = await listUsageRecordsByProject(db, projectId, prismaClient);
  const records = usageRecords.map((record) => {
    const snapshot = db.runConfigurationSnapshots.get(record.runConfigurationSnapshotId);
    const run = snapshot?.runId ? db.generationRuns.get(snapshot.runId) : undefined;
    return ProjectCostRecordSchema.parse({
      id: record.id,
      run_id: run?.id ?? null,
      run_status: run?.status ?? null,
      snapshot_id: record.runConfigurationSnapshotId,
      operation: snapshot?.operation ?? "unknown",
      capability: record.capability,
      provider_key: record.providerKey,
      model_id: record.modelId,
      status: record.status,
      unit_type: record.unitType,
      input_units: record.inputUnits,
      output_units: record.outputUnits,
      estimated_cost_cny: microsToCnyDecimal(record.estimatedCostMicros),
      actual_cost_cny: record.actualCostMicros === null ? null : microsToCnyDecimal(record.actualCostMicros),
      cost_basis: record.costBasis,
      unit_detail: record.unitDetailJson,
      duration_ms: record.durationMs,
      created_at: record.createdAt.toISOString(),
      operation_name: extractLlmOperationName(record.providerRequestKey),
    });
  });
  return records;
}

/**
 * LLM usage 记录的 providerRequestKey 形如 `llm:<runId>:<operationName>`；
 * 提取调用角色（prompt id）。媒体记录（`assets:...`/`job:...`）返回 null。
 */
function extractLlmOperationName(providerRequestKey: string): string | null {
  if (!providerRequestKey.startsWith("llm:")) return null;
  const parts = providerRequestKey.split(":");
  return parts.length === 3 && parts[2] ? parts[2] : null;
}

export async function getRunConfiguration(
  db: DbClient,
  projectId: string,
  runId: string,
  prismaClient?: AppPrismaClient,
): Promise<GenerationRunConfigurationResponse | null> {
  // prismaClient 传入时直查数据库（外部审查 N1：跨进程读另一实例创建的 run 不 404）
  let run: GenerationRunRecord | undefined;
  let snapshot: RunConfigurationSnapshotRecord | undefined;
  if (prismaClient) {
    const runRow = await prismaClient.generationRun.findUnique({ where: { id: runId } });
    if (!runRow || runRow.projectId !== projectId) return null;
    run = toRunRecordForCost(runRow);
    db.generationRuns.set(run.id, run);
    const snapshotRow = await prismaClient.runConfigurationSnapshot.findUnique({
      where: { id: run.runConfigurationSnapshotId },
    });
    if (!snapshotRow) return null;
    snapshot = toSnapshotRecordForCost(snapshotRow);
    db.runConfigurationSnapshots.set(snapshot.id, snapshot);
  } else {
    run = db.generationRuns.get(runId);
    if (!run || run.projectId !== projectId) return null;
    snapshot = db.runConfigurationSnapshots.get(run.runConfigurationSnapshotId);
    if (!snapshot) return null;
  }
  return GenerationRunConfigurationResponseSchema.parse({
    run_id: run.id,
    run_status: run.status,
    operation: run.operation,
    configuration_hash: snapshot.configurationHash,
    snapshot: snapshot.resolvedConfigurationJson,
    created_at: run.createdAt.toISOString(),
  });
}

// --- Prisma row → record 转换（成本只读路径专用） ---------------------------

function toRunRecordForCost(row: {
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
}): GenerationRunRecord {
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
    status: row.status as GenerationRunRecord["status"],
    dispatchLeaseOwner: row.dispatchLeaseOwner,
    dispatchLeaseExpiresAt: row.dispatchLeaseExpiresAt,
    dispatchClaimCount: row.dispatchClaimCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSnapshotRecordForCost(row: {
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
