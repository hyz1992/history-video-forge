import type { AppResponse, RouteContext } from "../../app";
import {
  GenerationQuoteProviderTypesSchema,
  type GenerationOperation,
  type GenerationQuoteSelection,
} from "../../../../shared/src/index.js";
import { createOrRestoreGenerationRun } from "./generation-run.service.js";
import { resolveGenerationCostBootstrapInputFromEnv } from "../generation-cost/generation-cost-bootstrap.js";

/**
 * S2-2 生成提交协议（2026-08-23 报价体系移除后简化版）。
 *
 * 生成 API 不再要求 cost_quote_id / authorize_budget_override / run_overrides：
 * 任何部署都直接走 GenerationRunService 创建/恢复 run（统一创建不可变快照、
 * 幂等判重与请求级记账；stub/fake 部署同样落账零金额记录）。
 *
 * - `idempotency_key` 可选：提供时按 (project, operation, key) 判重，相同
 *   payload 指纹重放返回既有 run；不提供时服务端生成随机 key（单次请求语义）。
 * - `enabled_provider_types` 可选：仅 assets.generate 有语义，作为执行过滤
 *   原样进入 run 的 dispatch payload（与执行端过滤同源）。
 */

export interface SubmitFieldsResult {
  idempotency_key?: string;
  enabled_provider_types?: string[];
  /** enabled_provider_types 提供了但格式非法。 */
  invalid?: boolean;
}

export function extractSubmitFields(payload: Record<string, unknown>): SubmitFieldsResult {
  const idempotencyKey =
    typeof payload.idempotency_key === "string" && payload.idempotency_key.length > 0
      ? payload.idempotency_key
      : undefined;
  let enabledProviderTypes: string[] | undefined;
  if (payload.enabled_provider_types !== undefined) {
    const filterParse = GenerationQuoteProviderTypesSchema.safeParse(payload.enabled_provider_types);
    if (!filterParse.success) {
      return { idempotency_key: idempotencyKey, invalid: true };
    }
    enabledProviderTypes = filterParse.data;
  }
  return { idempotency_key: idempotencyKey, enabled_provider_types: enabledProviderTypes };
}

/**
 * 统一生成提交：创建/恢复 GenerationRun（无 quote）。事务提交后立即由
 * dispatcher 派发（operation handler 同步执行并透传响应）。
 * 幂等重放返回既有 run 状态。Prisma 激活态传 app.prismaClient：
 * 重解析输入以数据库为权威（跨实例一致性）。
 */
export async function submitGenerationRun(
  context: RouteContext,
  operation: GenerationOperation,
  selection: GenerationQuoteSelection | undefined,
  dispatchPayload: Record<string, unknown>,
  options: { replayExtraBody?: Record<string, unknown> } = {},
): Promise<AppResponse> {
  const submit = extractSubmitFields(context.payload as Record<string, unknown>);
  if (submit.invalid) {
    return {
      statusCode: 400,
      body: { error: "generation_submit_fields_incomplete", message: "enabled_provider_types 格式非法" },
    };
  }
  const enabledProviderTypes = submit.enabled_provider_types;
  const dispatchPayloadWithFilter = {
    ...dispatchPayload,
    enabled_provider_types: enabledProviderTypes,
  };
  const project = context.app.db.projects.get(context.params.projectId)!;
  const actorUserId = context.auth.anonymous ? null : context.auth.userId;
  const readinessInput =
    context.app.generationQuoteReadinessInput ?? resolveGenerationCostBootstrapInputFromEnv();
  // 客户端不提供幂等键时服务端生成（单次请求语义；客户端幂等重试应自行携带）
  const idempotencyKey = submit.idempotency_key ?? `${operation}-${context.app.db.generateId()}`;

  const result = await createOrRestoreGenerationRun(
    context.app.db,
    project,
    actorUserId ?? "system",
    {
      operation,
      idempotencyKey,
      selection,
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
    // 422：负载与快照冲突（voice_profile_id）；500：服务端持久化故障（可重试）；
    // 其余业务冲突（配置解析失败/幂等负载冲突）一律 409
    let statusCode = 409;
    if (result.error.code === "generation_voice_profile_conflict") statusCode = 422;
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
