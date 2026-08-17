import { createHash } from "node:crypto";

import { z } from "zod";
import {
  CAPABILITY_SLOTS,
  canonicalStringify,
  type CapabilitySlot,
  type GenerationOperation,
} from "../../../../shared/src/index.js";
import { GenerationOperationSchema } from "../../../../shared/src/generation/generation-configuration-resolver.js";
import type { ProviderModelCatalogRecord } from "../../db/client.js";

/**
 * S2-2A 任务 7：纯计价服务。
 *
 * 设计依据：详细设计 4.5（pricingHash）、8.4（授权上界语义）与实施计划任务 7 步骤 3。
 *
 * 输入只接受标准 operation workload 与 resolved provider/model（catalog 由服务端
 * 提供）；禁止客户端传入任何单价——workload schema strict，价格字段直接解析失败。
 *
 * 计价单位：token / image / video_second / tts_character / request。
 * 金额一律使用整数微元（BigInt 运算，向上取整保证不低估），JSON 输出为十进制字符串。
 *
 * 上界语义：
 * - token：授权上界使用服务端 OPERATION_TOKEN_BUDGETS（operation token budget），
 *   不得因输出 token 未知而返回零。
 * - image / tts_character / request：报价时计量确定，估算=上界。
 * - video_second：上界=任务数 × 每任务最大秒数（provider clamp 上限）× 单价。
 * - 无法给出可信上界（价格未核实/缺上限参数）的条目标记 unbounded，
 *   估算与授权输出 null，禁止当作零参与预算比较。
 */

export type PricingUnitType =
  | "token"
  | "image"
  | "video_second"
  | "tts_character"
  | "request";

const PositiveInt = z.number().int().positive();
const NonNegativeInt = z.number().int().nonnegative();

const WorkloadBase = {
  capability: z.enum(CAPABILITY_SLOTS),
  provider_model_id: z.string().min(1),
  operation: GenerationOperationSchema,
};

/**
 * 标准 workload item 合同（strict）。除下列字段外的任何字段（尤其是客户端单价：
 * unit_price_micros / price_micros / unit_price / pricing 等）都会被拒绝。
 */
export const PricingWorkloadItemSchema = z.discriminatedUnion("unit_type", [
  z
    .object({
      ...WorkloadBase,
      unit_type: z.literal("token"),
      estimated_input_tokens: NonNegativeInt.default(0),
      estimated_output_tokens: NonNegativeInt.default(0),
    })
    .strict(),
  z
    .object({
      ...WorkloadBase,
      unit_type: z.literal("image"),
      image_count: PositiveInt,
    })
    .strict(),
  z
    .object({
      ...WorkloadBase,
      unit_type: z.literal("video_second"),
      video_task_count: PositiveInt,
      estimated_seconds_total: z.number().nonnegative().optional(),
      // api_quality 接受任意字符串再与目录声明交叉校验：
      // Remotion 风格分辨率串（如 "1080P"）必须落 pricing_quality_not_supported，
      // 而不是在 schema 层被吞掉。
      parameters: z.object({ api_quality: z.string().min(1) }).strict(),
    })
    .strict(),
  z
    .object({
      ...WorkloadBase,
      unit_type: z.literal("tts_character"),
      character_count: NonNegativeInt,
    })
    .strict(),
  z
    .object({
      ...WorkloadBase,
      unit_type: z.literal("request"),
      request_count: NonNegativeInt,
    })
    .strict(),
]);
export type PricingWorkloadItem = z.infer<typeof PricingWorkloadItemSchema>;

/**
 * catalog 条目的运行时结构校验（防脏数据导致裸 TypeError）。
 * passthrough：catalog 记录还有展示字段（displayName 等），这里只守卫计价
 * 必需的结构，不复制完整记录合同（真相源是 DbClient 的 ProviderModelCatalogRecord）。
 */
const CatalogEntrySchema = z
  .object({
    id: z.string().min(1),
    capability: z.enum(CAPABILITY_SLOTS),
    providerKey: z.string().min(1),
    modelId: z.string().min(1),
    status: z.enum(["active", "disabled"]),
    isDefault: z.boolean(),
    pricingVersion: z.string().min(1),
    pricingJson: z.record(z.string(), z.unknown()),
    parameterCapabilitiesJson: z.record(z.string(), z.unknown()),
  })
  .passthrough();

/** 运行时校验后的 catalog 条目结构（内部消费类型）。 */
type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

export const PriceGenerationWorkloadInputSchema = z
  .object({
    catalog: z.array(CatalogEntrySchema),
    /** readiness 判定不可报价的目录项（服务端注入，如 tier 不一致/凭据缺失）。 */
    blockedProviderModelIds: z.array(z.string().min(1)).optional(),
    workload: z.array(PricingWorkloadItemSchema),
  })
  .strict();

/**
 * 计价输入的静态合同。catalog 静态类型使用 DbClient 记录（真相源）；
 * zod schema 只做运行时结构守卫（passthrough 输出带索引签名，不适合作为
* 对外输入类型）。PricingWorkloadItem 是 strict 判别联合，输入输出一致。
 */
export interface PriceGenerationWorkloadInput {
  catalog: ProviderModelCatalogRecord[];
  blockedProviderModelIds?: string[];
  workload: PricingWorkloadItem[];
}

// --- operation token budget --------------------------------------------------

/**
 * 服务端 operation token budget：LLM 授权上界的唯一来源。
 *
 * 这是策略默认值（按 operation 聚合的输入/输出 token 上限），覆盖单次 operation
 * 运行内的全部 LLM 调用；调整只影响新报价的授权上界，不追溯历史 quote。
 * 估算值仍由 workload 的 estimated_*_tokens 提供更贴近实际的数字。
 */
export const OPERATION_TOKEN_BUDGETS: Record<
  GenerationOperation,
  { max_input_tokens: number; max_output_tokens: number }
> = {
  "topic.generate": { max_input_tokens: 80000, max_output_tokens: 40000 },
  "script.generate": { max_input_tokens: 60000, max_output_tokens: 30000 },
  "storyboard.generate": { max_input_tokens: 80000, max_output_tokens: 60000 },
  "asset_plan.generate": { max_input_tokens: 100000, max_output_tokens: 80000 },
  "assets.generate": { max_input_tokens: 40000, max_output_tokens: 20000 },
  "publish.generate": { max_input_tokens: 40000, max_output_tokens: 20000 },
};

// --- 结果合同 -----------------------------------------------------------------

export interface PricedWorkloadItem {
  capability: CapabilitySlot;
  provider_model_id: string;
  unit_type: PricingUnitType;
  /** 十进制微元字符串；unbounded 为 null。 */
  estimated_cost_micros: string | null;
  /** 十进制微元字符串；unbounded 为 null（预算门禁必须显式授权，禁止当作零）。 */
  authorization_cost_micros: string | null;
  unbounded: boolean;
}

export interface PricingResultValue {
  items: PricedWorkloadItem[];
  estimated_cost_micros: string | null;
  authorization_cost_micros: string | null;
  contains_unbounded_item: boolean;
  /** 基于标准化价格内容的 SHA-256（sha256:<64-hex>）。 */
  pricing_hash: string;
  /** 本次报价使用的价格版本集合（字典序升序去重）。 */
  pricing_versions: string[];
}

export type PricingErrorCode =
  | "pricing_invalid_workload"
  | "pricing_catalog_entry_not_found"
  | "pricing_catalog_entry_not_quotable"
  | "pricing_capability_mismatch"
  | "pricing_unit_type_mismatch"
  | "pricing_quality_not_supported";

export type PriceGenerationWorkloadResult =
  | { ok: true; value: PricingResultValue }
  | {
      ok: false;
      error: { code: PricingErrorCode; message: string; provider_model_id?: string };
    };

// --- 微元算术 -----------------------------------------------------------------

const MICRO_PER_UNIT = 1_000_000n;
const CHARS_PER_10K = 10_000n;

/** 向上取整除法：估算与授权都不允许因整除而低估费用。 */
function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

// --- catalog pricing 解析 -----------------------------------------------------

interface TokenPricing {
  kind: "token";
  free: boolean;
  inputMicrosPerMillion: bigint | null;
  outputMicrosPerMillion: bigint | null;
}
interface ImagePricing {
  kind: "image";
  free: boolean;
  microsPerImage: bigint | null;
}
interface VideoSecondPricing {
  kind: "video_second";
  free: boolean;
  microsPerSecondByQuality: Record<string, bigint> | null;
}
interface TtsCharacterPricing {
  kind: "tts_character";
  free: boolean;
  microsPer10kCharacters: bigint | null;
}
interface RequestPricing {
  kind: "request";
  free: boolean;
  microsPerRequest: bigint | null;
}
type CatalogPricing =
  | TokenPricing
  | ImagePricing
  | VideoSecondPricing
  | TtsCharacterPricing
  | RequestPricing
  | { kind: "unknown" };

function parseDecimalMicros(value: unknown): bigint | null {
  // 只接受非负十进制整数字符串；负价为脏数据，按不可解析处理（→unbounded）。
  if (typeof value !== "string" || !/^\d+$/u.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/** 解析目录项 pricingJson。free 条目返回零价；缺失/无法解析的价格返回 null（→unbounded）。 */
function parseCatalogPricing(entry: CatalogEntry): CatalogPricing {
  const pricing = entry.pricingJson as Record<string, unknown>;
  const unitType = pricing["unit_type"];
  const free = pricing["free"] === true;

  switch (unitType) {
    case "token": {
      const input = parseDecimalMicros(pricing["input_price_micros_per_million_tokens"]);
      const output = parseDecimalMicros(pricing["output_price_micros_per_million_tokens"]);
      if (free && input === null && output === null) {
        return { kind: "token", free: true, inputMicrosPerMillion: 0n, outputMicrosPerMillion: 0n };
      }
      return { kind: "token", free, inputMicrosPerMillion: input, outputMicrosPerMillion: output };
    }
    case "image": {
      const price = free
        ? parseDecimalMicros(pricing["price_micros_per_image"]) ?? 0n
        : parseDecimalMicros(pricing["price_micros_per_image"]);
      return { kind: "image", free, microsPerImage: price };
    }
    case "video_second": {
      const raw = pricing["price_micros_per_second_by_quality"];
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {
          kind: "video_second",
          free,
          microsPerSecondByQuality: free ? {} : null,
        };
      }
      const map: Record<string, bigint> = {};
      for (const [quality, value] of Object.entries(raw as Record<string, unknown>)) {
        const parsed = parseDecimalMicros(value);
        if (parsed === null) {
          return { kind: "video_second", free, microsPerSecondByQuality: null };
        }
        map[quality] = parsed;
      }
      return { kind: "video_second", free, microsPerSecondByQuality: map };
    }
    case "tts_character": {
      const price = free
        ? parseDecimalMicros(pricing["price_micros_per_10k_characters"]) ?? 0n
        : parseDecimalMicros(pricing["price_micros_per_10k_characters"]);
      return { kind: "tts_character", free, microsPer10kCharacters: price };
    }
    case "request": {
      const price = free
        ? parseDecimalMicros(pricing["price_micros_per_request"]) ?? 0n
        : parseDecimalMicros(pricing["price_micros_per_request"]);
      return { kind: "request", free, microsPerRequest: price };
    }
    default:
      return { kind: "unknown" };
  }
}

// --- 主入口 -------------------------------------------------------------------

export function priceGenerationWorkload(
  rawInput: unknown,
): PriceGenerationWorkloadResult {
  const parsed = PriceGenerationWorkloadInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "pricing_invalid_workload",
        message: `计价输入不合法（禁止携带任何单价字段，价格只来自服务端目录）: ${parsed.error.message}`,
      },
    };
  }
  const input = parsed.data;
  const blocked = new Set(input.blockedProviderModelIds ?? []);
  const catalogById = new Map(input.catalog.map((entry) => [entry.id, entry]));

  const items: PricedWorkloadItem[] = [];
  const usedEntries: CatalogEntry[] = [];

  for (const workloadItem of input.workload) {
    const entry = catalogById.get(workloadItem.provider_model_id);
    if (!entry) {
      return {
        ok: false,
        error: {
          code: "pricing_catalog_entry_not_found",
          provider_model_id: workloadItem.provider_model_id,
          message: `目录中不存在 ${workloadItem.provider_model_id}`,
        },
      };
    }
    if (entry.status !== "active" || blocked.has(entry.id)) {
      return {
        ok: false,
        error: {
          code: "pricing_catalog_entry_not_quotable",
          provider_model_id: entry.id,
          message: `目录项 ${entry.id} 不可报价（disabled 或 readiness 交叉校验未通过）`,
        },
      };
    }
    if (entry.capability !== workloadItem.capability) {
      return {
        ok: false,
        error: {
          code: "pricing_capability_mismatch",
          provider_model_id: entry.id,
          message: `workload capability ${workloadItem.capability} 与目录项 ${entry.id} 的 capability ${entry.capability} 不一致`,
        },
      };
    }

    const pricing = parseCatalogPricing(entry);
    const priced = priceItem(workloadItem, entry, pricing);
    if (!priced.ok) {
      return priced;
    }
    items.push(priced.value);
    usedEntries.push(entry);
  }

  // 汇总：任何 unbounded 项都使总估算/总授权为 null（预算比较不得当零）。
  // 空 workload 是零费用报价（免费/纯本地运行），金额为 "0" 而不是 null——
  // null 保留给 unbounded 语义。
  const containsUnbounded = items.some((item) => item.unbounded);
  const totalEstimated = containsUnbounded
    ? null
    : items.reduce((sum, item) => sum + BigInt(item.estimated_cost_micros!), 0n).toString();
  const totalAuthorization = containsUnbounded
    ? null
    : items.reduce((sum, item) => sum + BigInt(item.authorization_cost_micros!), 0n).toString();

  // pricing hash：对本次报价实际使用的目录价格内容做标准化 SHA-256。
  const uniqueUsedEntries = [...new Map(usedEntries.map((e) => [e.id, e])).values()].sort((a, b) => {
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
  const hashPayload = {
    schema_version: "pricing_hash_v1",
    entries: uniqueUsedEntries.map((entry) => ({
      provider_model_id: entry.id,
      pricing_version: entry.pricingVersion,
      pricing: entry.pricingJson,
    })),
  };
  const pricingHash = `sha256:${createHash("sha256")
    .update(canonicalStringify(hashPayload))
    .digest("hex")}`;
  const pricingVersions = [...new Set(uniqueUsedEntries.map((e) => e.pricingVersion))].sort();

  return {
    ok: true,
    value: {
      items,
      estimated_cost_micros: totalEstimated,
      authorization_cost_micros: totalAuthorization,
      contains_unbounded_item: containsUnbounded,
      pricing_hash: pricingHash,
      pricing_versions: pricingVersions,
    },
  };
}

function priceItem(
  workloadItem: PricingWorkloadItem,
  entry: CatalogEntry,
  pricing: CatalogPricing,
): { ok: true; value: PricedWorkloadItem } | { ok: false; error: { code: PricingErrorCode; message: string; provider_model_id?: string } } {
  // 单位必须与目录计价单位一致（目录未声明单位视作 unknown，不参与计价）。
  if (pricing.kind !== "unknown" && pricing.kind !== workloadItem.unit_type) {
    return {
      ok: false,
      error: {
        code: "pricing_unit_type_mismatch",
        provider_model_id: entry.id,
        message: `workload 单位 ${workloadItem.unit_type} 与目录项 ${entry.id} 计价单位 ${pricing.kind} 不一致`,
      },
    };
  }

  const base = {
    capability: workloadItem.capability,
    provider_model_id: entry.id,
    unit_type: workloadItem.unit_type,
  };
  const unboundedItem: PricedWorkloadItem = {
    ...base,
    estimated_cost_micros: null,
    authorization_cost_micros: null,
    unbounded: true,
  };

  switch (workloadItem.unit_type) {
    case "token": {
      const tokenPricing =
        pricing.kind === "token"
          ? pricing
          : { kind: "token" as const, free: false, inputMicrosPerMillion: null, outputMicrosPerMillion: null };
      if (
        tokenPricing.inputMicrosPerMillion === null ||
        tokenPricing.outputMicrosPerMillion === null
      ) {
        return { ok: true, value: unboundedItem };
      }
      const inPrice = tokenPricing.inputMicrosPerMillion;
      const outPrice = tokenPricing.outputMicrosPerMillion;
      const estimated =
        ceilDiv(BigInt(workloadItem.estimated_input_tokens) * inPrice, MICRO_PER_UNIT) +
        ceilDiv(BigInt(workloadItem.estimated_output_tokens) * outPrice, MICRO_PER_UNIT);
      // 授权上界以 operation token budget 为基线；但当估算 token 已超出 budget 时
      // （如超大 prompt），budget 不再是该 workload 的上界——授权取两者较大值，
      // 保证 authorizationCostMicros 永远 >= estimatedCostMicros（预算门禁不变量）。
      // 注：同一 operation 的多个 LLM item 各自套用完整 budget，方向保守（门禁更严）。
      const budget = OPERATION_TOKEN_BUDGETS[workloadItem.operation];
      const budgetBound =
        ceilDiv(BigInt(budget.max_input_tokens) * inPrice, MICRO_PER_UNIT) +
        ceilDiv(BigInt(budget.max_output_tokens) * outPrice, MICRO_PER_UNIT);
      const authorization = estimated > budgetBound ? estimated : budgetBound;
      return {
        ok: true,
        value: {
          ...base,
          estimated_cost_micros: estimated.toString(),
          authorization_cost_micros: authorization.toString(),
          unbounded: false,
        },
      };
    }
    case "image": {
      const imagePricing =
        pricing.kind === "image"
          ? pricing
          : { kind: "image" as const, free: false, microsPerImage: null };
      if (imagePricing.microsPerImage === null) {
        return { ok: true, value: unboundedItem };
      }
      const micros = BigInt(workloadItem.image_count) * imagePricing.microsPerImage;
      return {
        ok: true,
        value: {
          ...base,
          estimated_cost_micros: micros.toString(),
          authorization_cost_micros: micros.toString(),
          unbounded: false,
        },
      };
    }
    case "video_second": {
      const videoPricing =
        pricing.kind === "video_second"
          ? pricing
          : { kind: "video_second" as const, free: false, microsPerSecondByQuality: null };

      // api_quality 必须同时是目录声明的能力档位与已定价档位；
      // Remotion 成片分辨率语义（720P/1080P 等）一律拒绝，不做映射猜测。
      const caps = entry.parameterCapabilitiesJson as Record<string, unknown>;
      const declaredQualities = Array.isArray(caps["api_video_qualities"])
        ? (caps["api_video_qualities"] as unknown[])
        : [];
      const requestedQuality = workloadItem.parameters.api_quality;
      if (
        !declaredQualities.includes(requestedQuality) ||
        !videoPricing.microsPerSecondByQuality ||
        !(requestedQuality in videoPricing.microsPerSecondByQuality)
      ) {
        return {
          ok: false,
          error: {
            code: "pricing_quality_not_supported",
            provider_model_id: entry.id,
            message: `目录项 ${entry.id} 不支持 API 视频质量 ${requestedQuality}（声明档位: ${declaredQualities.join(", ") || "无"}）`,
          },
        };
      }
      const pricePerSecond = videoPricing.microsPerSecondByQuality[requestedQuality]!;

      const capsMaxSeconds = caps["max_duration_seconds_per_task"];
      const maxSecondsPerTask =
        typeof capsMaxSeconds === "number" && Number.isFinite(capsMaxSeconds) && capsMaxSeconds > 0
          ? capsMaxSeconds
          : null;
      if (maxSecondsPerTask === null) {
        // 缺少可信每任务秒数上限 → 无法给出授权上界。
        return { ok: true, value: unboundedItem };
      }

      const taskCount = BigInt(workloadItem.video_task_count);
      // 估算秒数向上取整，不因小数秒低估费用；授权按任务数×每任务上限秒数。
      const estimatedSecondsCeil = BigInt(
        Math.ceil(workloadItem.estimated_seconds_total ?? Number(taskCount * BigInt(maxSecondsPerTask))),
      );
      const estimated = estimatedSecondsCeil * pricePerSecond;
      const taskBound = taskCount * BigInt(maxSecondsPerTask) * pricePerSecond;
      // 估算秒数超出任务上限合计时（输入不一致），授权取较大值，保持 auth >= est 不变量。
      const authorization = estimated > taskBound ? estimated : taskBound;
      return {
        ok: true,
        value: {
          ...base,
          estimated_cost_micros: estimated.toString(),
          authorization_cost_micros: authorization.toString(),
          unbounded: false,
        },
      };
    }
    case "tts_character": {
      const ttsPricing =
        pricing.kind === "tts_character"
          ? pricing
          : { kind: "tts_character" as const, free: false, microsPer10kCharacters: null };
      if (ttsPricing.microsPer10kCharacters === null) {
        return { ok: true, value: unboundedItem };
      }
      const micros = ceilDiv(
        BigInt(workloadItem.character_count) * ttsPricing.microsPer10kCharacters,
        CHARS_PER_10K,
      );
      return {
        ok: true,
        value: {
          ...base,
          estimated_cost_micros: micros.toString(),
          authorization_cost_micros: micros.toString(),
          unbounded: false,
        },
      };
    }
    case "request": {
      const requestPricing =
        pricing.kind === "request"
          ? pricing
          : { kind: "request" as const, free: false, microsPerRequest: null };
      if (requestPricing.microsPerRequest === null) {
        return { ok: true, value: unboundedItem };
      }
      const micros = BigInt(workloadItem.request_count) * requestPricing.microsPerRequest;
      return {
        ok: true,
        value: {
          ...base,
          estimated_cost_micros: micros.toString(),
          authorization_cost_micros: micros.toString(),
          unbounded: false,
        },
      };
    }
  }
}
