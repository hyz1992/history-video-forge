import { createHash } from "node:crypto";

import { env } from "../../config/env.js";
import type {
  DbClient,
  GenerationCostQuoteRecord,
  ProjectRecord,
  RunConfigurationSnapshotRecord,
} from "../../db/client.js";
import {
  canonicalStringify,
  resolveGenerationConfiguration,
  GenerationQuoteRequestSchema,
  GenerationQuoteResponseSchema,
  ProjectCostRecordSchema,
  ProjectCostSummarySchema,
  GenerationRunConfigurationResponseSchema,
  type GenerationOperation,
  type GenerationQuoteRequest,
  type GenerationQuoteResponse,
  type GenerationQuoteRunOverrides,
  type GenerationQuoteSelection,
  type ProjectCostRecord,
  type ProjectCostSummary,
  type GenerationRunConfigurationResponse,
  type ResolvedGenerationConfigurationV1,
  type SegmentInput,
  type SegmentVisualStrategyOverride,
} from "../../../../shared/src/index.js";
import { getProjectGenerationConfiguration } from "../generation-config/generation-config.repository.js";
import { resolveSystemGenerationConstraints } from "../generation-config/system-constraints.js";
import {
  computePricingHash,
  priceGenerationWorkload,
  type PricedWorkloadItem,
  type PricingResultValue,
  type PricingWorkloadItem,
} from "./pricing.service.js";
import { listProviderModelCatalog } from "./provider-model-catalog.repository.js";
import {
  evaluateGenerationCapabilityReadiness,
  type GenerationCapabilityReadinessInput,
} from "./generation-capability-readiness.js";
import {
  findQuoteById,
  listQuotesByProject,
  listSnapshotsByProject,
  listUsageRecordsByProject,
  saveGenerationCostQuote,
} from "./generation-cost.repository.js";
import { listRunsByProject } from "../generation-run/generation-run.repository.js";

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

export const QUOTE_TTL_MS = 10 * 60 * 1000;

/** quote 提交重校验的结构化错误码（HTTP 映射见 controller）。 */
export type RevalidateQuoteErrorCode =
  | "generation_quote_not_owner"
  | "generation_quote_operation_mismatch"
  | "generation_quote_consumed"
  | "generation_quote_expired"
  | "generation_quote_configuration_changed"
  | "generation_quote_price_changed"
  | "generation_quote_fingerprint_mismatch";

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

// --- 报价 workload 构建 ------------------------------------------------------

/**
 * 每个公开 operation 涉及的 LLM capability slot（quote 阶段的静态估计；
 * 实际调用链按 9B 接入 gateway 后以 interaction 记账修正，授权上界仍由
 * OPERATION_TOKEN_BUDGETS 提供）。
 */
export const OPERATION_LLM_SLOTS: Record<GenerationOperation, Array<"llm.smart" | "llm.flash">> = {
  "topic.generate": ["llm.smart"],
  "script.generate": ["llm.smart"],
  "storyboard.generate": ["llm.smart"],
  "asset_plan.generate": ["llm.smart", "llm.flash"],
  "assets.generate": ["llm.flash"],
  "publish.generate": ["llm.flash"],
};

/** 各 operation 的 token 估算（仅用于估算展示；授权上界由定价服务按 budget 计算）。 */
export const OPERATION_TOKEN_ESTIMATES: Record<
  GenerationOperation,
  { estimated_input_tokens: number; estimated_output_tokens: number }
> = {
  "topic.generate": { estimated_input_tokens: 40000, estimated_output_tokens: 20000 },
  "script.generate": { estimated_input_tokens: 30000, estimated_output_tokens: 15000 },
  "storyboard.generate": { estimated_input_tokens: 40000, estimated_output_tokens: 25000 },
  "asset_plan.generate": { estimated_input_tokens: 50000, estimated_output_tokens: 30000 },
  "assets.generate": { estimated_input_tokens: 8000, estimated_output_tokens: 4000 },
  "publish.generate": { estimated_input_tokens: 10000, estimated_output_tokens: 6000 },
};

/** 视频任务默认估算秒数（任务参数未声明 duration_sec 时；与执行端默认 7s 对齐）。 */
export const DEFAULT_VIDEO_ESTIMATE_SECONDS = 7;

/**
 * 构建标准计价 workload（服务端确定，客户端禁止携带单价）。
 * assets.generate 的媒体项来自 asset plan + selection + resolved 路线：
 * - image_still 任务 → image；video_clip 任务（仅 resolved route=api_video）→ video；
 * - tts_audio 任务 → tts（字符数 = source_excerpt 长度，确定性估算）；
 * - 所有 operation 附加该 operation 的 LLM token 项。
 */
export function buildQuoteWorkload(input: {
  db: DbClient;
  project: ProjectRecord;
  operation: GenerationOperation;
  resolved: ResolvedGenerationConfigurationV1;
  selection?: GenerationQuoteSelection;
}): PricingWorkloadItem[] {
  const { db, project, operation, resolved } = input;
  const workload: PricingWorkloadItem[] = [];

  const llmSlots = OPERATION_LLM_SLOTS[operation] ?? [];
  const estimates = OPERATION_TOKEN_ESTIMATES[operation];
  for (const slot of llmSlots) {
    const capability = resolved.resolved_capabilities[slot];
    workload.push({
      capability: slot,
      provider_model_id: capability.provider_model_id,
      operation,
      unit_type: "token",
      estimated_input_tokens: estimates.estimated_input_tokens,
      estimated_output_tokens: estimates.estimated_output_tokens,
    });
  }

  if (operation !== "assets.generate") return workload;

  const planRecord = project.activeAssetPlanRecordId
    ? db.assetPlanRecords.get(project.activeAssetPlanRecordId)
    : undefined;
  if (!planRecord) return workload;

  const plan = planRecord.planJson as {
    tasks?: Array<{
      task_id: string;
      task_type: string;
      source_segment_id: string | null;
      source_excerpt: string;
      parameters?: Record<string, unknown>;
    }>;
  };
  const tasks = plan.tasks ?? [];
  const selected = selectTasksForQuote(tasks, input.selection, db, project);

  const routesBySegment = new Map(
    resolved.segment_visual_routes.map((route) => [route.segment_id, route.resolved_route]),
  );

  const imageTasks = selected.filter((task) => task.task_type === "image_still");
  const videoTasks = selected.filter(
    (task) =>
      task.task_type === "video_clip" &&
      routesBySegment.get(task.source_segment_id ?? "") === "api_video",
  );
  const ttsTasks = selected.filter((task) => task.task_type === "tts_audio");

  if (imageTasks.length > 0) {
    workload.push({
      capability: "image.generate",
      provider_model_id: resolved.resolved_capabilities["image.generate"].provider_model_id,
      operation,
      unit_type: "image",
      image_count: imageTasks.length,
    });
  }
  if (videoTasks.length > 0) {
    workload.push({
      capability: "video.image_to_video",
      provider_model_id: resolved.resolved_capabilities["video.image_to_video"].provider_model_id,
      operation,
      unit_type: "video_second",
      video_task_count: videoTasks.length,
      estimated_seconds_total: sumVideoEstimatedSeconds(videoTasks),
      parameters: { api_quality: resolved.effective.video.api_quality },
    });
  }
  if (ttsTasks.length > 0) {
    workload.push({
      capability: "tts.synthesize",
      provider_model_id: resolved.resolved_capabilities["tts.synthesize"].provider_model_id,
      operation,
      unit_type: "tts_character",
      character_count: ttsTasks.reduce((sum, task) => sum + task.source_excerpt.length, 0),
    });
  }
  return workload;
}

function sumVideoEstimatedSeconds(
  videoTasks: Array<{ parameters?: Record<string, unknown> }>,
): number {
  return videoTasks.reduce((sum, task) => {
    const duration = task.parameters?.["duration_sec"];
    if (typeof duration === "number" && Number.isFinite(duration) && duration > 0) {
      return sum + duration;
    }
    return sum + DEFAULT_VIDEO_ESTIMATE_SECONDS;
  }, 0);
}

/**
 * selection 过滤：task_ids 优先；missing_only 排除已有 manifest 中
 * completed/accepted 的任务；默认全部任务。
 */
interface QuoteTaskShape {
  task_id: string;
  task_type: string;
  source_segment_id: string | null;
  source_excerpt: string;
  parameters?: Record<string, unknown>;
}

function selectTasksForQuote(
  tasks: QuoteTaskShape[],
  selection: GenerationQuoteSelection | undefined,
  db: DbClient,
  project: ProjectRecord,
): QuoteTaskShape[] {
  if (selection?.task_ids && selection.task_ids.length > 0) {
    const wanted = new Set(selection.task_ids);
    return tasks.filter((task) => wanted.has(task.task_id));
  }
  if (selection?.mode === "missing_only") {
    const manifestRecord = project.activeAssetManifestRecordId
      ? db.assetManifestRecords.get(project.activeAssetManifestRecordId)
      : undefined;
    const completed = new Set<string>();
    if (manifestRecord) {
      const executions = (manifestRecord.manifestJson as { executions?: Array<{ task_id?: string; status?: string }> })
        ?.executions;
      for (const execution of executions ?? []) {
        if (execution.status === "completed" || execution.status === "accepted") {
          if (execution.task_id) completed.add(execution.task_id);
        }
      }
    }
    return tasks.filter((task) => !completed.has(task.task_id));
  }
  return tasks;
}

// --- 解析 -------------------------------------------------------------------

interface QuoteResolutionValue {
  resolved: ResolvedGenerationConfigurationV1;
  configResult: Awaited<ReturnType<typeof getProjectGenerationConfiguration>>;
}

/**
 * 报价/提交共用的确定性解析：项目冻结配置 + 当前目录 + run override + selection。
 * 报价与提交必须走同一实现，保证 configuration_hash 与 fingerprint 可比。
 */
async function resolveQuoteConfiguration(
  db: DbClient,
  project: ProjectRecord,
  input: {
    operation: GenerationOperation;
    runOverrides?: GenerationQuoteRunOverrides;
    selection?: GenerationQuoteSelection;
  },
): Promise<
  | { ok: true; value: QuoteResolutionValue }
  | { ok: false; error: { code: "generation_quote_resolution_failed"; message: string } }
> {
  const configResult = await getProjectGenerationConfiguration(db, project.id, project.ownerId);
  const catalog = listProviderModelCatalog(db).map((entry) => ({
    provider_model_id: entry.id,
    capability: entry.capability,
    provider_key: entry.providerKey,
    model_id: entry.modelId,
    model_version: entry.modelVersion ?? null,
    status: entry.status,
    is_default: entry.isDefault,
  }));

  let segmentInputs: SegmentInput[] | undefined;
  let segmentOverrides: Record<string, SegmentVisualStrategyOverride> | undefined;
  if (input.operation === "assets.generate" && project.activeStoryboardRecordId) {
    const storyboard = db.storyboardRecords.get(project.activeStoryboardRecordId);
    if (storyboard) {
      const plan = storyboard.planJson as {
        segments?: Array<{ segment_id?: string; api_video_suitability?: SegmentInput["api_video_suitability"] }>;
      };
      const segments = (plan.segments ?? []).filter((segment) => segment.segment_id);
      segmentInputs = segments.map((segment) => ({
        segment_id: segment.segment_id!,
        api_video_suitability: segment.api_video_suitability!,
      }));
      const overrides: Record<string, SegmentVisualStrategyOverride> = {};
      for (const override of db.storyboardSegmentOverrides.values()) {
        if (
          override.projectId === project.id &&
          override.storyboardRecordId === storyboard.id &&
          override.strategyOverride !== null
        ) {
          overrides[override.segmentId] = override.strategyOverride;
        }
      }
      if (Object.keys(overrides).length > 0) segmentOverrides = overrides;
    }
  }

  const result = resolveGenerationConfiguration({
    projectConfiguration: configResult.configuration,
    projectConfigurationRevision: configResult.revision,
    sourceUserPreferenceRevision: configResult.sourceUserPreferenceRevision,
    runOverrides: input.runOverrides ?? undefined,
    segmentOverrides,
    systemConstraints: resolveSystemGenerationConstraints(env.demoMode),
    providerModelCatalog: catalog,
    operation: input.operation,
    segmentInputs,
  });
  if (!result.ok) {
    return {
      ok: false,
      error: { code: "generation_quote_resolution_failed", message: result.error.message },
    };
  }
  return { ok: true, value: { resolved: result.value, configResult } };
}

// --- quote 内容指纹（QuoteFingerprintPayloadV1） -----------------------------

export interface QuoteFingerprintItem {
  capability: string;
  provider_model_id: string;
  unit_type: string;
  /** 按 unit_type 固定的 canonical 计量字段（创建与提交同一实现产出）。 */
  units: Record<string, unknown>;
  estimated_cost_micros: string;
}

export interface QuoteFingerprintPayloadInput {
  payload_version: "quote_fingerprint_v1";
  project_id: string;
  operation: string;
  configuration_hash: string;
  catalog_hash: string;
  pricing_hash: string;
  pricing_version_set: string[];
  items: QuoteFingerprintItem[];
  estimated_cost_micros: string;
  authorization_cost_micros: string;
  contains_unbounded_item: boolean;
  budget_limit_micros: string | null;
  expires_at: string;
}

/** workload → 指纹 item 的计量字段（canonical，键固定）。 */
function fingerprintUnitsFromWorkloadItem(item: PricingWorkloadItem): Record<string, unknown> {
  switch (item.unit_type) {
    case "token":
      return {
        estimated_input_tokens: item.estimated_input_tokens,
        estimated_output_tokens: item.estimated_output_tokens,
      };
    case "image":
      return { image_count: item.image_count };
    case "video_second":
      return {
        video_task_count: item.video_task_count,
        estimated_seconds_total: item.estimated_seconds_total ?? null,
      };
    case "tts_character":
      return { character_count: item.character_count };
    case "request":
      return { request_count: item.request_count };
  }
}

/**
 * 按 (capability, provider_model_id, unit_type) 复合键 UTF-16 字典序排序。
 * workload 与定价结果按索引一一对应（priceGenerationWorkload 保序）。
 */
function buildFingerprintItems(
  workload: PricingWorkloadItem[],
  priced: PricedWorkloadItem[],
): QuoteFingerprintItem[] {
  const items = workload.map((item, index) => ({
    capability: item.capability,
    provider_model_id: item.provider_model_id,
    unit_type: item.unit_type,
    units: fingerprintUnitsFromWorkloadItem(item),
    estimated_cost_micros: priced[index]!.estimated_cost_micros ?? "0",
  }));
  items.sort((a, b) => {
    if (a.capability < b.capability) return -1;
    if (a.capability > b.capability) return 1;
    if (a.provider_model_id < b.provider_model_id) return -1;
    if (a.provider_model_id > b.provider_model_id) return 1;
    if (a.unit_type < b.unit_type) return -1;
    if (a.unit_type > b.unit_type) return 1;
    return 0;
  });
  return items;
}

/**
 * 计算 quote 内容指纹：canonical JSON（键排序 + 数组按指定键排序）的 SHA-256。
 * 创建与提交必须使用本函数与相同 payload 形状。函数内部做字段级归一：
 * pricing_version_set 字典序升序、items 按 (capability, provider_model_id,
 * unit_type) 复合键升序——调用方传序不影响指纹（canonical 合同）。
 */
export function computeQuoteFingerprint(payload: QuoteFingerprintPayloadInput): string {
  const normalized: QuoteFingerprintPayloadInput = {
    ...payload,
    pricing_version_set: [...payload.pricing_version_set].sort(),
    items: [...payload.items].sort(compareFingerprintItems),
  };
  const canonical = canonicalStringify(normalized);
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function compareFingerprintItems(a: QuoteFingerprintItem, b: QuoteFingerprintItem): number {
  if (a.capability < b.capability) return -1;
  if (a.capability > b.capability) return 1;
  if (a.provider_model_id < b.provider_model_id) return -1;
  if (a.provider_model_id > b.provider_model_id) return 1;
  if (a.unit_type < b.unit_type) return -1;
  if (a.unit_type > b.unit_type) return 1;
  return 0;
}

/** 金额归一：unbounded（null）在持久化边界归一为 "0"（DB 金额列 NOT NULL 合同）。 */
function normalizeUnboundedTotals(pricing: PricingResultValue): {
  estimatedCostMicros: string;
  authorizationCostMicros: string;
} {
  return {
    estimatedCostMicros: pricing.estimated_cost_micros ?? "0",
    authorizationCostMicros: pricing.authorization_cost_micros ?? "0",
  };
}

/**
 * 预算门禁：预算为 null 时不超额；unbounded 项存在时视为无法用金额证明在预算内
 * （即使预算充足也要求显式授权）；否则比较 authorizationCostMicros（不是估算）。
 */
function computeOverBudget(
  pricing: PricingResultValue,
  budgetLimitMicros: string | null,
): boolean {
  if (budgetLimitMicros === null) return false;
  if (pricing.contains_unbounded_item) return true;
  return BigInt(pricing.authorization_cost_micros!) > BigInt(budgetLimitMicros);
}

// --- quote 创建 -------------------------------------------------------------

export type CreateQuoteErrorCode =
  | "generation_quote_invalid_input"
  | "generation_quote_resolution_failed"
  | "generation_quote_unquotable";

export type CreateQuoteResult =
  | {
      ok: true;
      value: { quote: GenerationCostQuoteRecord; response: GenerationQuoteResponse };
    }
  | { ok: false; error: { code: CreateQuoteErrorCode; message: string } };

export async function createGenerationCostQuote(
  db: DbClient,
  project: ProjectRecord,
  actorUserId: string,
  input: GenerationQuoteRequest,
  deps: { readinessInput: QuoteReadinessInput; now?: () => Date },
): Promise<CreateQuoteResult> {
  const now = deps.now?.() ?? new Date();
  const parsed = GenerationQuoteRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: "generation_quote_invalid_input", message: parsed.error.message },
    };
  }
  const request = parsed.data;

  const resolution = await resolveQuoteConfiguration(db, project, {
    operation: request.operation,
    runOverrides: request.run_overrides,
    selection: request.selection,
  });
  if (!resolution.ok) return { ok: false, error: resolution.error };
  const { resolved } = resolution.value;

  const readiness = evaluateGenerationCapabilityReadiness({
    ...deps.readinessInput,
    catalog: listProviderModelCatalog(db),
  });
  const workload = buildQuoteWorkload({
    db,
    project,
    operation: request.operation,
    resolved,
    selection: request.selection,
  });
  const pricing = priceGenerationWorkload({
    catalog: listProviderModelCatalog(db),
    blockedProviderModelIds: readiness.nonQuotableProviderModelIds,
    workload,
  });
  if (!pricing.ok) {
    return { ok: false, error: { code: "generation_quote_unquotable", message: pricing.error.message } };
  }

  const budgetLimitMicros = resolved.effective.budget.max_paid_cost_micros_per_run;
  const overBudget = computeOverBudget(pricing.value, budgetLimitMicros);
  const normalized = normalizeUnboundedTotals(pricing.value);
  const expiresAt = new Date(now.getTime() + QUOTE_TTL_MS);

  const fingerprintPayload = buildFingerprintPayload({
    projectId: project.id,
    operation: request.operation,
    configurationHash: resolved.configuration_hash,
    catalogHash: resolved.catalog_hash,
    pricing: pricing.value,
    items: buildFingerprintItems(workload, pricing.value.items),
    estimatedCostMicros: normalized.estimatedCostMicros,
    authorizationCostMicros: normalized.authorizationCostMicros,
    budgetLimitMicros,
    expiresAt,
  });

  const record: GenerationCostQuoteRecord = {
    id: db.generateId(),
    projectId: project.id,
    userId: actorUserId,
    operation: request.operation,
    configurationHash: resolved.configuration_hash,
    quoteFingerprint: computeQuoteFingerprint(fingerprintPayload),
    pricingHash: pricing.value.pricing_hash,
    pricingVersionSetJson: pricing.value.pricing_versions,
    itemsJson: pricing.value.items as unknown as unknown[],
    estimatedCostMicros: normalized.estimatedCostMicros,
    authorizationCostMicros: normalized.authorizationCostMicros,
    containsUnboundedItem: pricing.value.contains_unbounded_item,
    budgetLimitMicros,
    overBudget,
    expiresAt,
    consumedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await saveGenerationCostQuote(db, record);

  return {
    ok: true,
    value: { quote: record, response: buildQuoteResponse(record) },
  };
}

function buildFingerprintPayload(input: {
  projectId: string;
  operation: string;
  configurationHash: string;
  catalogHash: string;
  pricing: PricingResultValue;
  items: QuoteFingerprintItem[];
  estimatedCostMicros: string;
  authorizationCostMicros: string;
  budgetLimitMicros: string | null;
  expiresAt: Date;
}): QuoteFingerprintPayloadInput {
  return {
    payload_version: "quote_fingerprint_v1",
    project_id: input.projectId,
    operation: input.operation,
    configuration_hash: input.configurationHash,
    catalog_hash: input.catalogHash,
    pricing_hash: input.pricing.pricing_hash,
    pricing_version_set: [...input.pricing.pricing_versions].sort(),
    items: input.items,
    estimated_cost_micros: input.estimatedCostMicros,
    authorization_cost_micros: input.authorizationCostMicros,
    contains_unbounded_item: input.pricing.contains_unbounded_item,
    budget_limit_micros: input.budgetLimitMicros,
    expires_at: input.expiresAt.toISOString(),
  };
}

/** quote 记录 → API 响应（金额为 CNY 十进制字符串；unbounded 金额归一 "0" + 标志）。 */
function buildQuoteResponse(quote: GenerationCostQuoteRecord): GenerationQuoteResponse {
  const items = (quote.itemsJson as PricedWorkloadItem[]).map((item) => ({
    capability: item.capability,
    provider_model_id: item.provider_model_id,
    unit_type: item.unit_type,
    estimated_cost_cny: microsToCnyDecimal(item.estimated_cost_micros ?? "0"),
    authorization_cost_cny: microsToCnyDecimal(item.authorization_cost_micros ?? "0"),
    unbounded: item.unbounded,
  }));
  const response = GenerationQuoteResponseSchema.parse({
    quote_id: quote.id,
    operation: quote.operation,
    expires_at: quote.expiresAt.toISOString(),
    configuration_hash: quote.configurationHash,
    pricing_versions: quote.pricingVersionSetJson,
    items,
    estimated_cost_cny: microsToCnyDecimal(quote.estimatedCostMicros),
    authorization_cost_cny: microsToCnyDecimal(quote.authorizationCostMicros),
    contains_unbounded_item: quote.containsUnboundedItem,
    budget_limit_cny: quote.budgetLimitMicros === null ? null : microsToCnyDecimal(quote.budgetLimitMicros),
    over_budget: quote.overBudget,
    requires_budget_override: quote.containsUnboundedItem || quote.overBudget,
  });
  return response;
}

// --- 提交重校验 -------------------------------------------------------------

export type RevalidateQuoteResult =
  | {
      ok: true;
      value: {
        resolved: ResolvedGenerationConfigurationV1;
        pricing: PricingResultValue;
        workload: PricingWorkloadItem[];
        fingerprint_payload: QuoteFingerprintPayloadInput;
        requires_budget_override: boolean;
      };
    }
  | { ok: false; error: { code: RevalidateQuoteErrorCode; message: string } };

/**
 * 提交事务前的 quote 重校验（详细设计 8.2 步骤 1-6）：
 * 锁定并校验 owner/project/operation/过期/未消费；按当前配置与目录重新解析并比对
 * configuration_hash；重新计价并比对 pricing_hash；按创建时相同 canonical 输入
 * 重算 quoteFingerprint 比对。预算门禁由调用方在拿到 requires_budget_override 后执行。
 */
export async function revalidateQuoteForCommit(
  db: DbClient,
  project: ProjectRecord,
  quote: GenerationCostQuoteRecord,
  input: {
    operation: GenerationOperation;
    selection?: GenerationQuoteSelection;
    runOverrides?: GenerationQuoteRunOverrides;
  },
  deps: { readinessInput: QuoteReadinessInput; now?: () => Date },
): Promise<RevalidateQuoteResult> {
  const now = deps.now?.() ?? new Date();
  if (quote.projectId !== project.id) {
    return { ok: false, error: { code: "generation_quote_not_owner", message: "quote belongs to another project" } };
  }
  if (quote.operation !== input.operation) {
    return { ok: false, error: { code: "generation_quote_operation_mismatch", message: `quote is for ${quote.operation}, submit is for ${input.operation}` } };
  }
  if (quote.consumedAt !== null) {
    return { ok: false, error: { code: "generation_quote_consumed", message: "quote already consumed (one-time use)" } };
  }
  if (quote.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, error: { code: "generation_quote_expired", message: "quote expired; create a new quote" } };
  }

  const resolution = await resolveQuoteConfiguration(db, project, {
    operation: quote.operation,
    runOverrides: input.runOverrides,
    selection: input.selection,
  });
  if (!resolution.ok) {
    return {
      ok: false,
      error: { code: "generation_quote_configuration_changed", message: `re-resolution failed: ${resolution.error.message}` },
    };
  }
  const { resolved } = resolution.value;
  if (resolved.configuration_hash !== quote.configurationHash) {
    return {
      ok: false,
      error: { code: "generation_quote_configuration_changed", message: "project configuration drifted since the quote was created" },
    };
  }

  const readiness = evaluateGenerationCapabilityReadiness({
    ...deps.readinessInput,
    catalog: listProviderModelCatalog(db),
  });
  const workload = buildQuoteWorkload({
    db,
    project,
    operation: quote.operation,
    resolved,
    selection: input.selection,
  });
  const pricing = priceGenerationWorkload({
    catalog: listProviderModelCatalog(db),
    blockedProviderModelIds: readiness.nonQuotableProviderModelIds,
    workload,
  });
  if (!pricing.ok) {
    return {
      ok: false,
      error: { code: "generation_quote_price_changed", message: `re-pricing failed: ${pricing.error.message}` },
    };
  }
  // 价格漂移检测：按 quote 创建时的条目集合（items 的 provider_model_id）重算
  // pricing hash 与持久化值比对。selection/asset plan 变化只改变条目集合，
  // 不改变"同一批条目的价格内容"，因此价格漂移与内容漂移可以区分：
  // 价格变化 → price_changed；selection/plan 变化 → fingerprint_mismatch（下方）。
  const quoteEntryIds = [...new Set(
    (quote.itemsJson as PricedWorkloadItem[]).map((item) => item.provider_model_id),
  )];
  const catalogById = new Map(listProviderModelCatalog(db).map((entry) => [entry.id, entry]));
  const alignedEntries = quoteEntryIds
    .map((id) => catalogById.get(id))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
  if (alignedEntries.length !== quoteEntryIds.length) {
    return {
      ok: false,
      error: { code: "generation_quote_price_changed", message: "catalog entries used by the quote no longer exist" },
    };
  }
  const alignedPricingHash = computePricingHash(
    alignedEntries.map((entry) => ({
      provider_model_id: entry.id,
      pricing_version: entry.pricingVersion,
      pricing: entry.pricingJson,
    })),
  );
  if (alignedPricingHash !== quote.pricingHash) {
    return {
      ok: false,
      error: { code: "generation_quote_price_changed", message: "catalog pricing drifted since the quote was created" },
    };
  }

  const normalized = normalizeUnboundedTotals(pricing.value);
  const fingerprintPayload = buildFingerprintPayload({
    projectId: quote.projectId,
    operation: quote.operation,
    configurationHash: quote.configurationHash,
    catalogHash: resolved.catalog_hash,
    pricing: pricing.value,
    items: buildFingerprintItems(workload, pricing.value.items),
    estimatedCostMicros: normalized.estimatedCostMicros,
    authorizationCostMicros: normalized.authorizationCostMicros,
    budgetLimitMicros: quote.budgetLimitMicros,
    expiresAt: quote.expiresAt,
  });
  const fingerprint = computeQuoteFingerprint(fingerprintPayload);
  if (fingerprint !== quote.quoteFingerprint) {
    return {
      ok: false,
      error: {
        code: "generation_quote_fingerprint_mismatch",
        message: "quote content drifted (configuration, pricing, asset plan or selection changed); create a new quote",
      },
    };
  }

  const overBudget = computeOverBudget(pricing.value, quote.budgetLimitMicros);
  return {
    ok: true,
    value: {
      resolved,
      pricing: pricing.value,
      workload,
      fingerprint_payload: fingerprintPayload,
      requires_budget_override: pricing.value.contains_unbounded_item || overBudget,
    },
  };
}

// --- 成本只读查询 -----------------------------------------------------------

export async function getProjectCostSummary(
  db: DbClient,
  projectId: string,
): Promise<ProjectCostSummary> {
  const quotes = listQuotesByProject(db, projectId);
  const snapshots = listSnapshotsByProject(db, projectId);
  const usageRecords = listUsageRecordsByProject(db, projectId);
  const runs = listRunsByProject(db, projectId);

  let totalEstimated = 0n;
  let totalAuthorization = 0n;
  for (const snapshot of snapshots) {
    if (snapshot.estimatedCostMicros !== null) totalEstimated += BigInt(snapshot.estimatedCostMicros);
    if (snapshot.authorizationCostMicros !== null) {
      totalAuthorization += BigInt(snapshot.authorizationCostMicros);
    }
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
    total_authorization_cost_cny: microsToCnyDecimal(totalAuthorization.toString()),
    total_actual_cost_cny: microsToCnyDecimal(totalActual.toString()),
    quote_count: quotes.length,
    consumed_quote_count: quotes.filter((quote) => quote.consumedAt !== null).length,
    over_budget_quote_count: quotes.filter((quote) => quote.overBudget).length,
    run_count: runs.length,
    run_status_counts: runStatusCounts,
    capability_breakdown: capabilityBreakdown,
  });
}

export async function listProjectCostRecords(
  db: DbClient,
  projectId: string,
): Promise<ProjectCostRecord[]> {
  const records = listUsageRecordsByProject(db, projectId).map((record) => {
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
      duration_ms: record.durationMs,
      created_at: record.createdAt.toISOString(),
    });
  });
  return records;
}

export async function getRunConfiguration(
  db: DbClient,
  projectId: string,
  runId: string,
): Promise<GenerationRunConfigurationResponse | null> {
  const run = db.generationRuns.get(runId);
  if (!run || run.projectId !== projectId) return null;
  const snapshot: RunConfigurationSnapshotRecord | undefined = db.runConfigurationSnapshots.get(
    run.runConfigurationSnapshotId,
  );
  if (!snapshot) return null;
  return GenerationRunConfigurationResponseSchema.parse({
    run_id: run.id,
    run_status: run.status,
    operation: run.operation,
    quote_id: run.quoteId,
    configuration_hash: snapshot.configurationHash,
    snapshot: snapshot.resolvedConfigurationJson,
    created_at: run.createdAt.toISOString(),
  });
}

export { findQuoteById };
