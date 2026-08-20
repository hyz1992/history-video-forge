import type { AppResponse, RouteContext } from "../../app";
import {
  GenerationQuoteProviderTypesSchema,
  GenerationQuoteRunOverridesSchema,
  type GenerationOperation,
  type GenerationQuoteRunOverrides,
  type GenerationQuoteSelection,
} from "../../../../shared/src/index.js";
import { createOrRestoreGenerationRun } from "./generation-run.service.js";
import { resolveGenerationCostBootstrapInputFromEnv } from "../generation-cost/generation-cost-bootstrap.js";

/**
 * S2-2A 任务 9A/9B：生成 API 的 quote 提交协议（公共实现）。
 *
 * 兼容迁移合同（实施计划 9A 步骤 2 / 9B 步骤 2）：
 * - UI 仍调用现有生成 API，但必须先取得 quote，并在同一现有请求中提交
 *   cost_quote_id / authorize_budget_override / idempotency_key；
 * - GenerationRun 是后端内部运行记录，不新增公开提交链路；
 * - 提交后由 dispatcher 同步派发（operation handler 执行生成并透传响应）。
 *
 * 本模块是 9A assets 与 9B 五个 LLM 入口的单一实现，杜绝各模块复制。
 */

export type SubmitFieldsResult =
  | { present: false }
  | {
      present: true;
      invalid: boolean;
      fields?: {
        cost_quote_id: string;
        authorize_budget_override: boolean;
        idempotency_key: string;
        run_overrides: GenerationQuoteRunOverrides;
        /** F5：与 quote 创建时同一执行过滤重放；undefined = 未提供（全开）。 */
        enabled_provider_types?: string[];
      };
    };

export function extractSubmitFields(payload: Record<string, unknown>): SubmitFieldsResult {
  const hasQuote = typeof payload.cost_quote_id === "string" && payload.cost_quote_id.length > 0;
  const hasKey = typeof payload.idempotency_key === "string" && payload.idempotency_key.length > 0;
  if (!hasQuote && !hasKey) return { present: false };
  if (!hasQuote || !hasKey) return { present: true, invalid: true };
  // 提交可重放 quote 创建时的 run_overrides（GenerationQuoteRunOverridesSchema strict 校验）
  const runOverridesParse = GenerationQuoteRunOverridesSchema.safeParse(payload.run_overrides);
  if (!runOverridesParse.success) {
    return { present: true, invalid: true };
  }
  // 提交可重放 quote 创建时的执行过滤（F5）；undefined = 未提供，与 quote 创建语义一致
  let enabledProviderTypes: string[] | undefined;
  if (payload.enabled_provider_types !== undefined) {
    const filterParse = GenerationQuoteProviderTypesSchema.safeParse(payload.enabled_provider_types);
    if (!filterParse.success) {
      return { present: true, invalid: true };
    }
    enabledProviderTypes = filterParse.data;
  }
  return {
    present: true,
    invalid: false,
    fields: {
      cost_quote_id: payload.cost_quote_id as string,
      authorize_budget_override: payload.authorize_budget_override === true,
      idempotency_key: payload.idempotency_key as string,
      run_overrides: runOverridesParse.data,
      enabled_provider_types: enabledProviderTypes,
    },
  };
}

/**
 * GenerationRunService 统一创建/恢复 run（不新增公开 /generation-runs 路由）；
 * 事务提交后立即由 dispatcher 派发（operation handler 同步执行并透传响应）。
 * 幂等重放返回既有 run 状态。Prisma 激活态传 app.prismaClient：
 * 提交重校验输入以数据库为权威（I-1'）。
 */
export async function submitGenerationRun(
  context: RouteContext,
  operation: GenerationOperation,
  selection: GenerationQuoteSelection | undefined,
  dispatchPayload: Record<string, unknown>,
  options: { replayExtraBody?: Record<string, unknown> } = {},
): Promise<AppResponse> {
  const submit = extractSubmitFields(context.payload as Record<string, unknown>);
  if (!submit.present || submit.invalid || !submit.fields) {
    return { statusCode: 400, body: { error: "generation_submit_fields_incomplete" } };
  }
  const fields = submit.fields;
  // F5：执行过滤从提交字段重放（与 quote 创建时的 enabled_provider_types 对齐）。
  // 授权过滤与执行过滤必须同源：dispatchPayload 的 enabled_provider_types 统一
  // 被本值覆盖（各入口单一来源，防止授权上界与执行范围脱节）
  const enabledProviderTypes = fields.enabled_provider_types;
  const dispatchPayloadWithFilter = {
    ...dispatchPayload,
    enabled_provider_types: enabledProviderTypes,
  };
  const project = context.app.db.projects.get(context.params.projectId)!;
  const actorUserId = context.auth.anonymous ? null : context.auth.userId;
  const readinessInput =
    context.app.generationQuoteReadinessInput ?? resolveGenerationCostBootstrapInputFromEnv();

  const result = await createOrRestoreGenerationRun(
    context.app.db,
    project,
    actorUserId ?? "system",
    {
      operation,
      costQuoteId: fields.cost_quote_id,
      authorizeBudgetOverride: fields.authorize_budget_override,
      idempotencyKey: fields.idempotency_key,
      selection,
      runOverrides: fields.run_overrides,
      enabledProviderTypes,
      dispatchPayload: dispatchPayloadWithFilter,
    },
    {
      readinessInput,
      repository: context.app.generationRunRepository,
      prismaClient: context.app.prismaClient,
    },
  );
  if (!result.ok) {
    // 404：quote 不存在；500：服务端持久化故障（可重试）；其余业务冲突一律 409
    let statusCode = 409;
    if (result.error.code === "generation_quote_not_found") statusCode = 404;
    if (result.error.code === "generation_run_persistence_failed") statusCode = 500;
    return { statusCode, body: { error: result.error.code, message: result.error.message } };
  }

  const { run, created } = result.value;
  if (created) {
    const dispatchResult = await context.app.generationRunDispatcher.dispatch(run.id);
    if (
      dispatchResult.dispatched &&
      dispatchResult.outcome.status !== "needs_reconciliation" &&
      dispatchResult.outcome.response
    ) {
      // 透传生成流程响应，并附 run id 供客户端幂等关联（additive，不改原响应形状）
      const body = dispatchResult.outcome.response.body;
      const mergedBody =
        typeof body === "object" && body !== null
          ? { ...(body as Record<string, unknown>), generation_run_id: run.id }
          : body;
      return { statusCode: dispatchResult.outcome.response.statusCode, body: mergedBody };
    }
    if (dispatchResult.dispatched && dispatchResult.outcome.status === "failed") {
      return {
        statusCode: 500,
        body: {
          error: "generation_run_dispatch_failed",
          reason_code: dispatchResult.outcome.reason_code,
        },
      };
    }
  }
  // 幂等重放 / 进行中（lease 未到期不重复派发）：返回 run 状态
  return {
    statusCode: 200,
    body: {
      generation_run_id: run.id,
      run_status: run.status,
      idempotency_replayed: !created,
      ...options.replayExtraBody,
    },
  };
}
