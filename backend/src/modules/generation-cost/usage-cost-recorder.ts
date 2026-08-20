import type {
  AssetProviderJobRecord,
  DbClient,
  GenerationRunEventRecord,
  RunConfigurationSnapshotRecord,
  UsageCostRecordRecord,
} from "../../db/client.js";
import { listProviderModelCatalog } from "./provider-model-catalog.repository.js";
import { disableProviderModelCatalogEntries } from "./provider-model-catalog.repository.js";
import {
  priceGenerationWorkload,
  type PricingWorkloadItem,
} from "./pricing.service.js";
import { OPERATION_TOKEN_ESTIMATES } from "./generation-cost.service.js";

/**
 * S2-2A 任务 9A：媒体 provider 调用的 usage 成本记账（详细设计 4.9 / 8.4 / 步骤 3）。
 *
 * 合同：
 * - 唯一记账键 (runConfigurationSnapshotId, providerRequestKey, attemptIndex)：
 *   重放同一 provider job attempt 只更新原记录状态，绝不新增第二条费用
 *   （数据库唯一约束为最终防线，本模块先按键幂等 upsert）。
 * - estimate 与 actual 分开存储：estimated 恒为按目录单价对计量单位的定价；
 *   actual 仅在可确认时填写——provider 回执（provider_usage）或执行后本地实测
 *   计量（estimate basis + actualCostState=estimated_after_execution）。
 *   绝不把本地估算标成 provider_usage/provider_invoice（验收 8）。
 * - overrun：本 snapshot 累计实际/估算费用超过 authorizationCostMicros 时追加
 *   append-only `pricing_overrun` run event，并把对应 catalog item 置 disabled
 *   （不适合自动新运行，待管理员复核价格）；已消费 quote 不被改写（验收 5）。
 * - 金额一律十进制微元字符串；失败/未完成请求保留 estimated，actual 为 null。
 */

export type UsageCostActualState = "estimated_after_execution" | "provider_confirmed";

export interface ProviderJobUsageMeasuredUnits {
  unitType: "image" | "video_second" | "tts_character";
  count: number;
  /** video_second 专用：目录按画质分价（缺省按 standard_720p）。 */
  quality?: string;
}

export interface ProviderJobUsageProviderReceipt {
  inputUnits: number;
  outputUnits: number;
  /** provider 回执确认的费用（微元十进制字符串）。 */
  costMicros: string;
}

export interface RecordProviderJobUsageInput {
  db: DbClient;
  /** 授权与计价上下文（quote 绑定 run 的快照）。 */
  snapshot: RunConfigurationSnapshotRecord;
  /** run event 归属（pricing_overrun 审计）。 */
  runId: string;
  providerJob: AssetProviderJobRecord;
  capability: "image.generate" | "video.image_to_video" | "tts.synthesize";
  providerKey: string;
  modelId: string;
  measuredUnits: ProviderJobUsageMeasuredUnits;
  /** provider 回执；null = 无精确账单（验收 8 的 estimated_after_execution 路径）。 */
  providerUsage: ProviderJobUsageProviderReceipt | null;
  durationMs?: number;
}

export interface RecordProviderJobUsageOutcome {
  record: UsageCostRecordRecord;
  actualCostState: UsageCostActualState;
  /** 本 snapshot 累计费用是否超出授权上界（副作用：run event + catalog 禁用）。 */
  overrun: boolean;
}

/** provider job 状态 → usage 记录生命周期状态（设计 4.9）。 */
function toUsageStatus(jobStatus: AssetProviderJobRecord["status"]): UsageCostRecordRecord["status"] {
  switch (jobStatus) {
    case "completed":
      return "succeeded";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
    case "submitted":
    case "running":
      return "submitted";
    default:
      return "planned";
  }
}

/** 计量单位 → 单条计价 workload（与报价 workload 同一取值域与计价真相源）。 */
function toWorkloadItem(
  capability: RecordProviderJobUsageInput["capability"],
  providerModelId: string,
  units: ProviderJobUsageMeasuredUnits,
): PricingWorkloadItem {
  switch (units.unitType) {
    case "image":
      return {
        capability,
        provider_model_id: providerModelId,
        operation: "assets.generate",
        unit_type: "image",
        image_count: units.count,
      };
    case "video_second":
      return {
        capability,
        provider_model_id: providerModelId,
        operation: "assets.generate",
        unit_type: "video_second",
        video_task_count: 1,
        estimated_seconds_total: units.count,
        parameters: { api_quality: units.quality ?? "standard_720p" },
      };
    case "tts_character":
      return {
        capability,
        provider_model_id: providerModelId,
        operation: "assets.generate",
        unit_type: "tts_character",
        character_count: units.count,
      };
  }
}

/**
 * 按 (snapshot, providerRequestKey, attemptIndex) 幂等记账。
 * 同键重放：保留原记录 id/createdAt，更新状态与金额（不新增费用行）。
 */
export async function recordProviderJobUsage(
  input: RecordProviderJobUsageInput,
): Promise<RecordProviderJobUsageOutcome> {
  const { db, snapshot, providerJob } = input;
  const status = toUsageStatus(providerJob.status);

  // 目录单价对实测计量定价（estimate 真相源与报价一致）。
  // 条目定位按 (capability, providerKey, modelId)；条目因 overrun 被禁用后
  // 仍按其价目内容记账（记账是历史事实，不受新运行禁用影响）。
  const catalog = listProviderModelCatalog(db);
  const entry = catalog.find(
    (item) =>
      item.capability === input.capability &&
      item.providerKey === input.providerKey &&
      item.modelId === input.modelId,
  );
  let estimatedCostMicros = "0";
  if (entry) {
    const pricingCatalog =
      entry.status === "active"
        ? catalog
        : catalog.map((item) => (item.id === entry.id ? { ...item, status: "active" as const } : item));
    const priced = priceGenerationWorkload({
      catalog: pricingCatalog,
      blockedProviderModelIds: [],
      workload: [toWorkloadItem(input.capability, entry.id, input.measuredUnits)],
    });
    if (priced.ok) {
      estimatedCostMicros = priced.value.items[0]?.estimated_cost_micros ?? "0";
    }
  }

  // actual：succeeded 且有 provider 回执 → provider_usage；
  // succeeded 无回执 → 本地实测计量的 estimate basis（estimated_after_execution）；
  // 未完成/失败 → 保留 estimated，actual null（费用未知不伪造）
  let actualCostMicros: string | null = null;
  let costBasis: UsageCostRecordRecord["costBasis"] = "estimate";
  let actualCostState: UsageCostActualState = "estimated_after_execution";
  let inputUnits: number | null = null;
  let outputUnits: number | null = null;
  if (status === "succeeded") {
    outputUnits = input.measuredUnits.count;
    if (input.providerUsage) {
      actualCostMicros = input.providerUsage.costMicros;
      costBasis = "provider_usage";
      actualCostState = "provider_confirmed";
      inputUnits = input.providerUsage.inputUnits;
      outputUnits = input.providerUsage.outputUnits;
    } else {
      actualCostMicros = estimatedCostMicros;
      costBasis = "estimate";
      actualCostState = "estimated_after_execution";
    }
  }

  const usageKey = {
    runConfigurationSnapshotId: snapshot.id,
    providerRequestKey: providerJob.providerRequestKey ?? `job:${providerJob.id}`,
    attemptIndex: providerJob.attemptIndex ?? 0,
  };

  // 幂等 upsert（Map 态按键查既有记录；Prisma 态 writer 按 DB 唯一约束 upsert）
  let existing: UsageCostRecordRecord | undefined;
  for (const record of db.usageCostRecords.values()) {
    if (
      record.runConfigurationSnapshotId === usageKey.runConfigurationSnapshotId &&
      record.providerRequestKey === usageKey.providerRequestKey &&
      record.attemptIndex === usageKey.attemptIndex
    ) {
      existing = record;
      break;
    }
  }
  const now = new Date();
  const record: UsageCostRecordRecord = {
    id: existing?.id ?? db.generateId(),
    runConfigurationSnapshotId: usageKey.runConfigurationSnapshotId,
    assetProviderJobRecordId: providerJob.id,
    interactionId: null,
    capability: input.capability,
    providerKey: input.providerKey,
    modelId: input.modelId,
    providerRequestKey: usageKey.providerRequestKey,
    attemptIndex: usageKey.attemptIndex,
    status,
    unitType: input.measuredUnits.unitType,
    inputUnits,
    outputUnits,
    estimatedCostMicros,
    actualCostMicros,
    costBasis,
    durationMs: input.durationMs ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  if (db.thirdAggregateWriter) {
    await db.thirdAggregateWriter.saveUsageCostRecord(record);
  }
  db.usageCostRecords.set(record.id, record);

  // overrun：snapshot 累计（actual ?? estimated）超过授权上界
  const overrun = await checkAndHandleOverrun(input, record);

  return { record, actualCostState, overrun };
}

/**
 * 累计费用超授权上界 → append-only pricing_overrun run event + catalog 禁用。
 * 只追加事件与禁用目录，绝不改写 quote/snapshot（授权是不可变历史）。
 */
export interface OverrunCheckInput {
  db: DbClient;
  snapshot: RunConfigurationSnapshotRecord;
  runId: string;
  capability: string;
  providerKey: string;
  modelId: string;
}

/** 累计费用超授权上界 → append-only pricing_overrun + catalog 禁用（媒体/LLM 共用）。 */
async function checkAndHandleOverrun(
  input: OverrunCheckInput,
  current: UsageCostRecordRecord,
): Promise<boolean> {
  const { snapshot } = input;
  if (snapshot.authorizationCostMicros === null) return false;
  const bound = BigInt(snapshot.authorizationCostMicros);

  let total = 0n;
  const seenKeys = new Set<string>();
  for (const record of input.db.usageCostRecords.values()) {
    if (record.runConfigurationSnapshotId !== snapshot.id) continue;
    // 镜像中可能同时存在同键新旧对象（Map set 替换后不会，防御性去重）
    const key = `${record.providerRequestKey}:${record.attemptIndex}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    total += BigInt(record.actualCostMicros ?? record.estimatedCostMicros);
  }
  if (total <= bound) return false;

  // 8.4 语义为一次性动作：同 (run, capability, providerKey, modelId) 已追加过
  // pricing_overrun 则不再重复追加（同一 attempt 的 running 轮询 + completed
  // 回执重放只应触发一次）；不同模型的超界仍各自追加事件并禁用对应目录项
  // （M-7 细化：去重键含 providerKey/modelId，完整符合 8.4"把对应 catalog 项
  // 标记为不适合自动新运行"）。catalog 禁用幂等（已禁用条目 no-op）。
  const existingEvents = input.db.generationRunEvents.get(input.runId) ?? [];
  const alreadyFlagged = existingEvents.some((event) => {
    if (event.eventType !== "pricing_overrun") return false;
    const payload = event.eventJson as Record<string, unknown>;
    return (
      payload["capability"] === input.capability &&
      payload["provider_key"] === input.providerKey &&
      payload["model_id"] === input.modelId
    );
  });
  if (alreadyFlagged) return true;
  // 注：去重基于本实例内存镜像事件——跨实例边界（另一进程已追加落库、本实例
  // 镜像未刷新）仍可能重复追加，属分布式最终一致性残余（M-b 标注，可接受）；

  const event: GenerationRunEventRecord = {
    id: input.db.generateId(),
    generationRunId: input.runId,
    segmentId: null,
    eventType: "pricing_overrun",
    eventJson: {
      capability: input.capability,
      provider_key: input.providerKey,
      model_id: input.modelId,
      usage_record_id: current.id,
      total_cost_micros: total.toString(),
      authorization_cost_micros: snapshot.authorizationCostMicros,
      reason: "actual_exceeds_authorization_bound",
    },
    createdAt: new Date(),
  };
  if (input.db.thirdAggregateWriter) {
    await input.db.thirdAggregateWriter.appendGenerationRunEvent(event);
  }
  const events = input.db.generationRunEvents.get(input.runId) ?? [];
  events.push(event);
  input.db.generationRunEvents.set(input.runId, events);

  // 对应 catalog item 不再适合自动新运行（待管理员复核价格）
  const catalogIds = [...input.db.providerModelCatalog.values()]
    .filter(
      (entry) =>
        entry.capability === input.capability &&
        entry.providerKey === input.providerKey &&
        entry.modelId === input.modelId,
    )
    .map((entry) => entry.id);
  await disableProviderModelCatalogEntries(input.db, catalogIds);
  return true;
}

// ─── LLM token 记账（S2-2A 任务 9B） ────────────────────────────────────────

export interface RecordLlmUsageInput {
  db: DbClient;
  snapshot: RunConfigurationSnapshotRecord;
  runId: string;
  /** 计价估算上下文（缺失 token 时回退该 operation 的 token 估算）。 */
  operationOf: import("../../../../shared/src/index.js").GenerationOperation;
  /** 反查 interaction log 的稳定锚点（runId + operationName + attemptIndex）。 */
  interactionId: string;
  operationName: string;
  capability: "llm.smart" | "llm.flash";
  providerKey: string;
  modelId: string;
  /** provider 返回的精确 token；缺失时保留 null actual 与估算 basis（不伪造）。 */
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs?: number;
  status: "succeeded" | "failed";
  /** 同 run 内同一 operation 的调用序号（从 0 起），参与唯一记账键。 */
  attemptIndex: number;
}

export interface RecordLlmUsageOutcome {
  record: UsageCostRecordRecord;
  actualCostState: UsageCostActualState;
}

/**
 * LLM interaction 的 usage 记账（实施计划 9B 步骤 1）：
 * - 唯一键 (runConfigurationSnapshotId, providerRequestKey=llm:<runId>:<operationName>,
 *   attemptIndex)——同 interaction/attempt 重放只更新原记录，不新增费用；
 * - 有 provider token → estimated 按实际 token 计价、actual=同值
 *   （costBasis=provider_usage，input/output units=实际 token）；
 * - 无 token → actual=null、costBasis=estimate（估算按 operation 级 token 估算），
 *   绝不伪造实际 token。
 * 注：LLM 路径不触发 pricing_overrun（token 计价即精确费用，且估算模式按
 * interaction 累计可达授权数倍属设计取舍）；目录项缺失时保留 null actual +
 * estimate basis（不标 provider_usage 零价，避免静默少计费误导）。
 */
export async function recordLlmUsage(
  input: RecordLlmUsageInput,
): Promise<RecordLlmUsageOutcome> {
  const { db, snapshot } = input;

  const catalog = listProviderModelCatalog(db);
  const entry = catalog.find(
    (item) =>
      item.capability === input.capability &&
      item.providerKey === input.providerKey &&
      item.modelId === input.modelId,
  );

  // 计价 token：实际 token 优先，缺失回退 operation 估算（与实际报价估算同源）
  const estimates = OPERATION_TOKEN_ESTIMATES[input.operationOf];
  const estimatedInput = input.inputTokens ?? estimates.estimated_input_tokens;
  const estimatedOutput = input.outputTokens ?? estimates.estimated_output_tokens;

  let estimatedCostMicros = "0";
  if (entry) {
    const pricingCatalog =
      entry.status === "active"
        ? catalog
        : catalog.map((item) => (item.id === entry.id ? { ...item, status: "active" as const } : item));
    const priced = priceGenerationWorkload({
      catalog: pricingCatalog,
      blockedProviderModelIds: [],
      workload: [
        {
          capability: input.capability,
          provider_model_id: entry.id,
          operation: input.operationOf,
          unit_type: "token",
          estimated_input_tokens: estimatedInput,
          estimated_output_tokens: estimatedOutput,
        },
      ],
    });
    if (priced.ok) {
      estimatedCostMicros = priced.value.items[0]?.estimated_cost_micros ?? "0";
    }
  }

  const hasExactTokens = input.inputTokens !== null && input.outputTokens !== null;
  let actualCostMicros: string | null = null;
  let costBasis: UsageCostRecordRecord["costBasis"] = "estimate";
  let actualCostState: UsageCostActualState = "estimated_after_execution";
  let inputUnits: number | null = null;
  let outputUnits: number | null = null;
  if (input.status === "succeeded" && hasExactTokens && entry) {
    // provider 确认 token → 精确计价（provider_usage）；估算与确认同源定价。
    // 目录项缺失（快照解析后漂移）时保留 null actual + estimate，不伪造零价
    actualCostMicros = estimatedCostMicros;
    costBasis = "provider_usage";
    actualCostState = "provider_confirmed";
    inputUnits = input.inputTokens!;
    outputUnits = input.outputTokens!;
  }

  const providerRequestKey = `llm:${input.runId}:${input.operationName}`;
  const usageKey = {
    runConfigurationSnapshotId: snapshot.id,
    providerRequestKey,
    attemptIndex: input.attemptIndex,
  };

  let existing: UsageCostRecordRecord | undefined;
  for (const record of db.usageCostRecords.values()) {
    if (
      record.runConfigurationSnapshotId === usageKey.runConfigurationSnapshotId &&
      record.providerRequestKey === usageKey.providerRequestKey &&
      record.attemptIndex === usageKey.attemptIndex
    ) {
      existing = record;
      break;
    }
  }
  const now = new Date();
  const record: UsageCostRecordRecord = {
    id: existing?.id ?? db.generateId(),
    runConfigurationSnapshotId: usageKey.runConfigurationSnapshotId,
    assetProviderJobRecordId: null,
    interactionId: input.interactionId,
    capability: input.capability,
    providerKey: input.providerKey,
    modelId: input.modelId,
    providerRequestKey: usageKey.providerRequestKey,
    attemptIndex: usageKey.attemptIndex,
    status: input.status,
    unitType: "token",
    inputUnits,
    outputUnits,
    estimatedCostMicros,
    actualCostMicros,
    costBasis,
    durationMs: input.durationMs ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  if (db.thirdAggregateWriter) {
    await db.thirdAggregateWriter.saveUsageCostRecord(record);
  }
  db.usageCostRecords.set(record.id, record);

  // S2-2A 任务 9B（final 审查 I-1）：LLM 记账同样纳入 overrun 语义——
  // snapshot 累计（actual ?? estimated）超授权上界时追加 pricing_overrun
  // 事件并禁用对应目录项（与媒体同款；估算模式累计超界同样触发，保护方向）
  await checkAndHandleOverrun(
    {
      db,
      snapshot,
      runId: input.runId,
      capability: input.capability,
      providerKey: input.providerKey,
      modelId: input.modelId,
    },
    record,
  );

  return { record, actualCostState };
}
