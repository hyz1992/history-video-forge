import { ZodError, type ZodType } from "zod";

/**
 * 所有"LLM 输出不符合 schema 或业务约束"的错误的统一类。
 *
 * 调用方（run service）可以 instanceof 判断这是 LLM 输出问题，不是代码 bug
 * 或 provider 网络错。code 是稳定字符串，用于写入数据库 executionStateJson.error
 * 和 diagnostics：
 *   - schema 不匹配：`${stage}_${schema_name}_schema_invalid`
 *     例：storyboard_plan_schema_invalid、script_draft_schema_invalid
 *   - 业务约束失败：`${stage}_${business_rule}_violated`
 *     例：asset_chunk_boundary_violated
 *
 * 原始诊断信息（如 ZodError issues）通过 ES2022 标准 `cause` options 保留，
 * 不丢字段级细节。
 */
export class LlmOutputError extends Error {
  readonly code: string;

  constructor(code: string, options?: { cause?: unknown }) {
    super(code, options);
    this.name = "LlmOutputError";
    this.code = code;
  }
}

/**
 * 用指定 zod schema 校验 LLM 输出；ZodError 包装为 LlmOutputError 再抛出。
 *
 * - 成功：返回 schema.parse 结果。
 * - ZodError：包装为 `new LlmOutputError(code, { cause: error.issues })`。
 * - 非 ZodError 异常：原样 rethrow（不应被吞掉）。
 *
 * 包装在调用方（generation service）内完成，不在 zod schema 层——schema 是
 * 纯数据合同，不应承载运行时错误类型。
 */
export function parseLlmOutput<T>(
  schema: ZodType<T>,
  raw: unknown,
  code: string,
): T {
  try {
    return schema.parse(raw);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new LlmOutputError(code, { cause: error.issues });
    }
    throw error;
  }
}
