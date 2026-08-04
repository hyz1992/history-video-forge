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
 * 按一组"路径 + 键名"定位并删除对象树中的未知键。
 *
 * 路径格式与 ZodError issue.path 一致：`["tasks", 0, "manual_upload_policy"]`
 * 表示从 raw 根开始沿该路径下钻，在终点的对象上删除指定键。
 */
function deleteKeysAtPath(
  raw: unknown,
  issues: Array<{ path: (string | number)[]; keys?: string[] }>,
): { value: unknown; removed: number } {
  if (typeof raw !== "object" || raw === null) return { value: raw, removed: 0 };
  const root = Array.isArray(raw) ? [...raw] : { ...(raw as Record<string, unknown>) };
  let removed = 0;

  for (const issue of issues) {
    if (!issue.keys || issue.keys.length === 0) continue;
    let cursor: unknown = root;
    for (const seg of issue.path) {
      if (typeof cursor !== "object" || cursor === null) {
        cursor = undefined;
        break;
      }
      cursor = (cursor as Record<string | number, unknown>)[seg];
    }
    if (typeof cursor === "object" && cursor !== null && !Array.isArray(cursor)) {
      const target = cursor as Record<string, unknown>;
      for (const key of issue.keys) {
        if (key in target) {
          delete target[key];
          removed += 1;
        }
      }
    }
  }
  return { value: root, removed };
}

/**
 * 递归剥离所有层级的"未知键"：先用 schema parse，如果只有 unrecognized_keys 类
 * 错误，就按 issue 定位删除多余键后重试，直到没有此类错误为止。
 *
 * 设计意图：LLM 输出层 schema 普遍使用 .strict()，但 LLM 天然会多输出语义字段
 * （如给 location 加 role、给 chunk 加 manual_review_notes）。unrecognized_keys
 * 是"LLM 表达了 schema 没声明的字段"，不应当作结构错误；而 invalid_type /
 * invalid_enum / too_small 等是真正的结构问题，仍会正常抛出。
 */
function stripUnknownKeysAndParse<T>(
  schema: ZodType<T, any, any>,
  raw: unknown,
): { ok: true; value: T } | { ok: false; error: ZodError } {
  let current = raw;
  // 上限避免极端情况下死循环
  for (let attempt = 0; attempt < 8; attempt++) {
    const result = schema.safeParse(current);
    if (result.success) {
      return { ok: true, value: result.data };
    }
    const unrecognizedIssues = result.error.issues.filter(
      (issue) => issue.code === "unrecognized_keys",
    );
    if (unrecognizedIssues.length === 0) {
      return { ok: false, error: result.error };
    }
    const next = deleteKeysAtPath(current, unrecognizedIssues);
    if (next.removed === 0) {
      return { ok: false, error: result.error };
    }
    current = next.value;
  }
  // 兜底：最后再 parse 一次拿最新错误
  const finalResult = schema.safeParse(current);
  return finalResult.success
    ? { ok: true, value: finalResult.data }
    : { ok: false, error: finalResult.error };
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
 *
 * 本函数会先尝试剥离 LLM 输出中的"未知键"（unrecognized_keys）再校验，从而
 * 容忍 LLM 自发添加的语义字段（如 role / manual_review_notes）。真正的结构
 * 错误（字段缺失、类型错、枚举非法）仍会抛 LlmOutputError。
 */
export function parseLlmOutput<T>(
  schema: ZodType<T, any, any>,
  raw: unknown,
  code: string,
): T {
  const result = stripUnknownKeysAndParse(schema, raw);
  if (result.ok) {
    return result.value;
  }
  throw new LlmOutputError(code, { cause: result.error.issues });
}
