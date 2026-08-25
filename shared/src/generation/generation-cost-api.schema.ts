import { z } from "zod";

import { GenerationOperationSchema } from "./generation-configuration-resolver.js";
import { AssetProviderType } from "../assets/asset-manifest.schema.js";

/**
 * S2-2A 任务 8：报价、成本与运行配置的 API 合同（详细设计 4.5/4.6/4.7/8/9.4 节）。
 *
 * 金额约定：HTTP JSON 中所有金额一律为 CNY 十进制字符串（微元/1e6，固定 6 位小数），
 * 禁止 Number 传输（超安全整数）。预算比较由服务端在微元上完成，客户端只展示。
 */

/**
 * S2-2 成本只读 API 合同（2026-08-23 报价体系移除后保留）。
 *
 * 金额约定：HTTP JSON 中所有金额一律为 CNY 十进制字符串（微元/1e6，固定 6 位小数），
 * 禁止 Number 传输（超安全整数）。
 */

/** CNY 十进制字符串（微元/1e6，固定 6 位小数）。 */
export const CnyDecimalString = z
  .string()
  .regex(/^(0|[1-9][0-9]*)\.\d{6}$/);

// --- run 提交协议输入（2026-08-23 报价移除后保留） --------------------------

/** 提交的 selection（与 assets 生成 API 的 mode/task_ids 同构）。 */
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
 * 提交的 provider 类型执行过滤（与 assets 执行端 enabled_provider_types
 * 同一取值域 AssetProviderType）；原样进入 run 的 dispatch payload。
 */
export const GenerationQuoteProviderTypesSchema = z.array(AssetProviderType);
export type GenerationQuoteProviderTypes = z.infer<
  typeof GenerationQuoteProviderTypesSchema
>;

// --- 提交协议错误码 ---------------------------------------------------------

/** run 提交（GenerationRunService）的结构化错误码，HTTP 映射见 controller。 */
export const GENERATION_SUBMIT_ERROR_CODES = [
  "generation_idempotency_payload_conflict",
  "generation_run_persistence_failed",
  "generation_run_resolution_failed",
  // S2-2B（外部审查 P1-5）：客户端 voice_profile_id 与快照 resolved_creative
  // 不一致。校验先于 run 创建——失败时无 snapshot/run。
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
    /** 2026-08-23：单位规格明细（图片分辨率、视频画质等）；旧数据缺省为 null。 */
    unit_detail: z.record(z.string(), z.unknown()).nullable().default(null),
    duration_ms: z.number().int().nonnegative().nullable(),
    created_at: z.string().datetime({ offset: true }),
    /**
     * 2026-08-25：LLM 调用角色（prompt id，如 topic.candidate-builder）；
     * 媒体记录为 null。用于费用面板标注调用用途。
     */
    operation_name: z.string().min(1).nullable(),
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
