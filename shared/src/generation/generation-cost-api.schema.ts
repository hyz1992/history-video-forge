import { z } from "zod";

import { ApiVideoQuality, VideoGenerationStrategy } from "./generation-configuration.schema.js";
import { GenerationOperationSchema } from "./generation-configuration-resolver.js";
import { CreativeRunOverrideSchema } from "./generation-configuration.schema.js";
import { AssetProviderType } from "../assets/asset-manifest.schema.js";

/**
 * S2-2A 任务 8：报价、成本与运行配置的 API 合同（详细设计 4.5/4.6/4.7/8/9.4 节）。
 *
 * 金额约定：HTTP JSON 中所有金额一律为 CNY 十进制字符串（微元/1e6，固定 6 位小数），
 * 禁止 Number 传输（超安全整数）。预算比较由服务端在微元上完成，客户端只展示。
 */

// --- 报价请求 ---------------------------------------------------------------

/**
 * quote 请求的 run override 子集（与 resolver 的 RunOverridesSchema 同构：
 * 允许覆盖 video/budget（S2-2A）与 creative（S2-2B 起），capabilities 由项目配置决定）。
 * quote 创建与提交必须重放同一 run_overrides（逐字段一致，不一致按内容漂移拒绝）。
 */
export const GenerationQuoteRunOverridesSchema = z
  .object({
    video: z
      .object({
        strategy: VideoGenerationStrategy.optional(),
        api_quality: ApiVideoQuality.optional(),
      })
      .strict()
      .optional(),
    budget: z
      .object({
        max_paid_cost_micros_per_run: z
          .string()
          .regex(/^(0|[1-9][0-9]*)$/)
          .nullable()
          .optional(),
      })
      .strict()
      .optional(),
    creative: CreativeRunOverrideSchema.optional(),
  })
  .strict()
  .optional();
export type GenerationQuoteRunOverrides = z.infer<
  typeof GenerationQuoteRunOverridesSchema
>;

/** 报价/提交的 selection（与 assets 生成 API 的 mode/task_ids 同构）。 */
export const GenerationQuoteSelectionSchema = z
  .object({
    mode: z.literal("missing_only").optional(),
    task_ids: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type GenerationQuoteSelection = z.infer<
  typeof GenerationQuoteSelectionSchema
>;

/**
 * 报价/提交的 provider 类型执行过滤（与 assets 执行端 enabled_provider_types
 * 同一取值域 AssetProviderType）。quote 与提交必须重放同一过滤，否则内容指纹
 * 漂移被拒（任务 8 终审 F5：授权上界不得包含执行时会被过滤掉的任务）。
 */
export const GenerationQuoteProviderTypesSchema = z.array(AssetProviderType);
export type GenerationQuoteProviderTypes = z.infer<
  typeof GenerationQuoteProviderTypesSchema
>;

export const GenerationQuoteRequestSchema = z
  .object({
    operation: GenerationOperationSchema,
    run_overrides: GenerationQuoteRunOverridesSchema,
    selection: GenerationQuoteSelectionSchema.optional(),
    enabled_provider_types: GenerationQuoteProviderTypesSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // 执行过滤只对 assets 媒体 operation 有语义；其他 operation 携带属合同误用
    if (value.operation !== "assets.generate" && value.enabled_provider_types !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "enabled_provider_types is only valid for operation assets.generate",
      });
    }
  });
export type GenerationQuoteRequest = z.infer<typeof GenerationQuoteRequestSchema>;

// --- 报价响应 ---------------------------------------------------------------

/** CNY 十进制字符串（微元/1e6，固定 6 位小数）。 */
export const CnyDecimalString = z
  .string()
  .regex(/^(0|[1-9][0-9]*)\.\d{6}$/);

export const GenerationQuoteItemSchema = z
  .object({
    capability: z.string().min(1),
    provider_model_id: z.string().min(1),
    unit_type: z.enum(["token", "image", "video_second", "tts_character", "request"]),
    estimated_cost_cny: CnyDecimalString,
    authorization_cost_cny: CnyDecimalString,
    /** 无法给出可信上界：授权值为占位零，预算门禁必须显式授权。 */
    unbounded: z.boolean(),
  })
  .strict();
export type GenerationQuoteItem = z.infer<typeof GenerationQuoteItemSchema>;

export const GenerationQuoteResponseSchema = z
  .object({
    quote_id: z.string().min(1),
    operation: GenerationOperationSchema,
    expires_at: z.string().datetime({ offset: true }),
    configuration_hash: z.string().min(1),
    pricing_versions: z.array(z.string().min(1)),
    items: z.array(GenerationQuoteItemSchema),
    estimated_cost_cny: CnyDecimalString,
    authorization_cost_cny: CnyDecimalString,
    contains_unbounded_item: z.boolean(),
    budget_limit_cny: CnyDecimalString.nullable(),
    over_budget: z.boolean(),
    requires_budget_override: z.boolean(),
  })
  .strict();
export type GenerationQuoteResponse = z.infer<typeof GenerationQuoteResponseSchema>;

// --- 提交协议错误码 ---------------------------------------------------------

/** quote 提交（GenerationRunService）的结构化错误码，HTTP 映射见 controller。 */
export const GENERATION_SUBMIT_ERROR_CODES = [
  "generation_quote_not_found",
  "generation_quote_not_owner",
  "generation_quote_operation_mismatch",
  "generation_quote_expired",
  "generation_quote_consumed",
  "generation_quote_configuration_changed",
  "generation_quote_price_changed",
  "generation_quote_fingerprint_mismatch",
  "generation_budget_exceeded",
  "generation_idempotency_payload_conflict",
  "generation_run_persistence_failed",
  // 2026-08-23（报价体系移除）：提交路径重解析失败（配置/目录/绑定源不可用）。
  "generation_run_resolution_failed",
  // S2-2B（外部审查 P1-5）：客户端 voice_profile_id 与快照 resolved_creative
  // 不一致。校验先于 quote 消费事务——失败时 quote 未消费、无 snapshot/run。
  "generation_voice_profile_conflict",
] as const;
export type GenerationSubmitErrorCode = (typeof GENERATION_SUBMIT_ERROR_CODES)[number];

// --- 成本只读 API -----------------------------------------------------------

export const ProjectCostSummarySchema = z
  .object({
    currency: z.literal("CNY"),
    total_estimated_cost_cny: CnyDecimalString,
    total_actual_cost_cny: CnyDecimalString,
    run_count: z.number().int().nonnegative(),
    run_status_counts: z
      .object({
        pending_dispatch: z.number().int().nonnegative(),
        running: z.number().int().nonnegative(),
        succeeded: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        needs_reconciliation: z.number().int().nonnegative(),
      })
      .strict(),
    capability_breakdown: z
      .array(
        z
          .object({
            capability: z.string().min(1),
            estimated_cost_cny: CnyDecimalString,
            actual_cost_cny: CnyDecimalString,
            record_count: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();
export type ProjectCostSummary = z.infer<typeof ProjectCostSummarySchema>;

/** 成本台账条目：统一计量与成本视图（UsageCostRecord 投影，全部金额为十进制字符串）。 */
export const ProjectCostRecordSchema = z
  .object({
    id: z.string().min(1),
    run_id: z.string().min(1).nullable(),
    run_status: z.string().nullable(),
    snapshot_id: z.string().min(1),
    operation: z.string().min(1),
    capability: z.string().min(1),
    provider_key: z.string().min(1),
    model_id: z.string().min(1),
    status: z.enum(["planned", "submitted", "succeeded", "failed", "canceled"]),
    unit_type: z.enum(["token", "image", "video_second", "tts_character", "request"]),
    input_units: z.number().int().nonnegative().nullable(),
    output_units: z.number().int().nonnegative().nullable(),
    estimated_cost_cny: CnyDecimalString,
    actual_cost_cny: CnyDecimalString.nullable(),
    cost_basis: z.enum(["estimate", "provider_usage", "provider_invoice"]),
    duration_ms: z.number().int().nonnegative().nullable(),
    created_at: z.string().datetime({ offset: true }),
  })
  .strict();
export type ProjectCostRecord = z.infer<typeof ProjectCostRecordSchema>;

export const ProjectCostRecordsResponseSchema = z
  .object({
    records: z.array(ProjectCostRecordSchema),
    total: z.number().int().nonnegative(),
  })
  .strict();
export type ProjectCostRecordsResponse = z.infer<
  typeof ProjectCostRecordsResponseSchema
>;

/** GET /runs/:runId/configuration：运行 + 不可变快照（存储 JSON 原样返回，附 run 状态）。 */
export const GenerationRunConfigurationResponseSchema = z
  .object({
    run_id: z.string().min(1),
    run_status: z.enum([
      "pending_dispatch",
      "running",
      "succeeded",
      "failed",
      "needs_reconciliation",
    ]),
    operation: z.string().min(1),
    configuration_hash: z.string().min(1),
    snapshot: z.record(z.string(), z.unknown()),
    created_at: z.string().datetime({ offset: true }),
  })
  .strict();
export type GenerationRunConfigurationResponse = z.infer<
  typeof GenerationRunConfigurationResponseSchema
>;
