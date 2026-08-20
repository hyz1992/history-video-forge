import type {
  DbClient,
  GenerationCostQuoteRecord,
  GenerationRunRecord,
  ProjectRecord,
  RunConfigurationSnapshotRecord,
} from "../../db/client.js";
import {
  canonicalStringify,
  deterministicHash,
  type GenerationOperation,
  type GenerationQuoteRunOverrides,
  type GenerationQuoteSelection,
  type GenerationSubmitErrorCode,
  type ResolvedGenerationConfigurationV1,
} from "../../../../shared/src/index.js";
import type { QuoteReadinessInput } from "../generation-cost/generation-cost.service.js";
import type { AppPrismaClient } from "../../db/prisma-client.types.js";

import {
  revalidateQuoteForCommit,
  type RevalidateQuoteResult,
} from "../generation-cost/generation-cost.service.js";
import type {
  GenerationRunRepository,
} from "./generation-run.repository.js";

/**
 * S2-2A 任务 8：GenerationRun 提交服务（详细设计 8.2）。
 *
 * 提交协议：现有生成 API 携带 cost_quote_id / authorize_budget_override /
 * idempotency_key，本服务统一创建/恢复 run（不新增公开 /generation-runs 路由）。
 *
 * 流程（8.2 步骤 1-8）：
 * 1. 锁定并校验 quote owner/project/operation/过期/未消费（repository 事务内原子消费）；
 * 2. 计算 payload fingerprint（quote + selection + override 的 canonical hash）；
 *    同 (projectId, operation, idempotencyKey) 已有 run：同 fingerprint 返回同 run，
 *    不同 fingerprint 返回 409 generation_idempotency_payload_conflict；
 * 3. 重新解析配置并比对 configuration hash（漂移检测）；
 * 4. 重新验证 catalog status / readiness / 价格版本（pricing hash 比对）；
 * 5. 按创建时相同 canonical 输入重算 quoteFingerprint 比对；
 * 6. authorizationCostMicros 超预算或存在 unbounded item 且无授权 → 409
 *    generation_budget_exceeded；
 * 7. 同一事务创建 RunConfigurationSnapshot 与 GenerationRun(status=pending_dispatch)；
 * 8. 同一事务标记 quote consumed，并写超额授权 AuditLog（如适用）。
 *
 * 事务提交后由可恢复 dispatcher 立即派发；本服务绝不调用外部 provider。
 */

export interface SubmitGenerationInput {
  operation: GenerationOperation;
  costQuoteId: string;
  authorizeBudgetOverride: boolean;
  idempotencyKey: string;
  selection?: GenerationQuoteSelection;
  runOverrides?: GenerationQuoteRunOverrides;
  /**
   * assets.generate 的 provider 类型执行过滤（F5）：必须与 quote 创建时的
   * enabled_provider_types 一致，否则重算 workload 与 quote 指纹漂移被拒；
   * 同 key 不同过滤按幂等 payload 冲突处理。
   */
  enabledProviderTypes?: string[];
  /** 恢复执行所需的最小非敏感 payload（不含密钥；凭据只在执行时从服务端解析）。 */
  dispatchPayload: Record<string, unknown>;
}

export type SubmitGenerationResult =
  | {
      ok: true;
      value: {
        run: GenerationRunRecord;
        snapshot: RunConfigurationSnapshotRecord;
        created: boolean;
      };
    }
  | { ok: false; error: { code: GenerationSubmitErrorCode; message: string } };

export interface SubmitGenerationDeps {
  readinessInput: QuoteReadinessInput;
  repository: GenerationRunRepository;
  /** Prisma 激活态：提交重校验输入以数据库为权威（任务 8 终审 I-1'）。 */
  prismaClient?: AppPrismaClient;
  now?: () => Date;
}

/** 运行幂等 payload 指纹（canonical：键排序 + selection/过滤归一）。 */
export function computeRunPayloadFingerprint(input: {
  operation: string;
  quote_id: string;
  selection?: GenerationQuoteSelection;
  run_overrides?: GenerationQuoteRunOverrides;
  enabled_provider_types?: string[];
}): string {
  const normalizedSelection = input.selection
    ? {
        mode: input.selection.mode ?? null,
        task_ids: [...(input.selection.task_ids ?? [])].sort(),
      }
    : null;
  const payload = {
    schema_version: "generation_run_payload_v1",
    operation: input.operation,
    quote_id: input.quote_id,
    selection: normalizedSelection,
    run_overrides: input.run_overrides ?? null,
    enabled_provider_types: input.enabled_provider_types
      ? [...input.enabled_provider_types].sort()
      : null,
  };
  // canonical hash（与 legacy 路径一致的确定性 hash；幂等判重键）
  return deterministicHash(canonicalStringify(payload));
}

export async function createOrRestoreGenerationRun(
  db: DbClient,
  project: ProjectRecord,
  actorUserId: string,
  input: SubmitGenerationInput,
  deps: SubmitGenerationDeps,
): Promise<SubmitGenerationResult> {
  const now = deps.now?.() ?? new Date();

  // 1. quote 校验（project-scoped；Prisma 态由 repository 直查数据库并同步镜像，
  //    冷镜像进程对有效 quote 不再误报 not_found；原子消费在事务内完成）
  const quote = await deps.repository.getQuoteById(input.costQuoteId, project.id);
  if (!quote) {
    return { ok: false, error: { code: "generation_quote_not_found", message: "quote not found for this project" } };
  }

  // 2. payload fingerprint + 既有 run 幂等裁决
  const payloadFingerprint = computeRunPayloadFingerprint({
    operation: input.operation,
    quote_id: quote.id,
    selection: input.selection,
    run_overrides: input.runOverrides,
    enabled_provider_types: input.enabledProviderTypes,
  });
  const existing = await deps.repository.getRunByKey(project.id, input.operation, input.idempotencyKey);
  if (existing) {
    if (existing.payloadFingerprint !== payloadFingerprint) {
      return {
        ok: false,
        error: {
          code: "generation_idempotency_payload_conflict",
          message: "same idempotency key submitted with a different payload; use a new key for a new payload",
        },
      };
    }
    // 快照随 run 一次从权威源加载（Prisma 态为 DB，Map 态为内存）
    const snapshot = await deps.repository.getSnapshotById(existing.runConfigurationSnapshotId);
    if (!snapshot) {
      return { ok: false, error: { code: "generation_run_persistence_failed", message: "existing run snapshot missing" } };
    }
    return { ok: true, value: { run: existing, snapshot, created: false } };
  }

  // 3-6. 提交重校验（configuration hash / pricing hash / quoteFingerprint / 预算门禁）
  const revalidated = await revalidateQuoteForCommit(
    db,
    project,
    quote,
    {
      operation: input.operation,
      selection: input.selection,
      runOverrides: input.runOverrides,
      enabledProviderTypes: input.enabledProviderTypes,
    },
    { readinessInput: deps.readinessInput, now: deps.now, prismaClient: deps.prismaClient },
  );
  if (!revalidated.ok) return { ok: false, error: revalidated.error };
  if (revalidated.value.requires_budget_override && !input.authorizeBudgetOverride) {
    return {
      ok: false,
      error: {
        code: "generation_budget_exceeded",
        message: "authorization cost exceeds the budget or contains unbounded items; explicit budget override required",
      },
    };
  }

  // 7-8. 同一事务：snapshot + pending_dispatch run + quote 消费 + 审计。
  // 9A 步骤 2（终审 I-A）：把授权绑定的 plan/storyboard 身份写入 dispatch
  // payload——执行端按此身份执行，而不是实例内存中的活动指针。
  const dispatchPayload = { ...input.dispatchPayload };
  if (revalidated.value.bound.assetPlanRecordId !== null) {
    dispatchPayload["bound_asset_plan_record_id"] = revalidated.value.bound.assetPlanRecordId;
  }
  if (revalidated.value.bound.storyboardRecordId !== null) {
    dispatchPayload["bound_storyboard_record_id"] = revalidated.value.bound.storyboardRecordId;
  }
  const runId = db.generateId();
  const snapshot = buildSnapshot(db, project, quote, input, revalidated.value, runId, now);
  const run: GenerationRunRecord = {
    id: runId,
    projectId: project.id,
    userId: actorUserId,
    operation: input.operation,
    idempotencyKey: input.idempotencyKey,
    payloadFingerprint,
    quoteId: quote.id,
    runConfigurationSnapshotId: snapshot.id,
    dispatchPayloadJson: dispatchPayload,
    status: "pending_dispatch",
    dispatchLeaseOwner: null,
    dispatchLeaseExpiresAt: null,
    dispatchClaimCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  let transaction: Awaited<ReturnType<GenerationRunRepository["createRunTransaction"]>>;
  try {
    transaction = await deps.repository.createRunTransaction({
      quote,
      snapshot,
      run,
      audit: input.authorizeBudgetOverride
        ? {
            actorUserId,
            projectId: project.id,
            action: "generation.budget_override_authorized",
            targetType: "generation_quote",
            targetId: quote.id,
            metadataJson: {
              // 授权上界使用重校验后的可信上界（unbounded 为 null，不把归一金额当真相）
              authorization_cost_micros: revalidated.value.pricing.authorization_cost_micros,
              budget_limit_micros: quote.budgetLimitMicros,
              reason: "user_authorized_budget_override",
            },
          }
        : null,
      now,
    });
  } catch (error) {
    // 事务内任何未结构化异常（FK/约束/连接）都按持久化失败返回：
    // 事务已整体回滚，quote 未消费、snapshot/run/审计均未落库。
    return {
      ok: false,
      error: {
        code: "generation_run_persistence_failed",
        message: error instanceof Error ? error.message : "run transaction failed",
      },
    };
  }
  if (!transaction.ok) {
    if (transaction.error.code === "generation_run_conflict") {
      // 并发同 key 提交：唯一约束为最终防线，按 fingerprint 做幂等裁决
      const existingRun = transaction.error.existing;
      if (existingRun.payloadFingerprint !== payloadFingerprint) {
        return {
          ok: false,
          error: {
            code: "generation_idempotency_payload_conflict",
            message: "same idempotency key submitted with a different payload; use a new key for a new payload",
          },
        };
      }
      const restoredSnapshot = await deps.repository.getSnapshotById(existingRun.runConfigurationSnapshotId);
      if (!restoredSnapshot) {
        return { ok: false, error: { code: "generation_run_persistence_failed", message: "existing run snapshot missing" } };
      }
      return { ok: true, value: { run: existingRun, snapshot: restoredSnapshot, created: false } };
    }
    if (
      transaction.error.code === "generation_quote_consumed" ||
      transaction.error.code === "generation_quote_expired"
    ) {
      // 并发同 key 提交的败者路径（Prisma read-committed：事务内 run 查询看不到
      // 未提交的胜者，败者在 quote 行锁上中止）。胜者此时已提交——事务外回查
      // run-by-key：同 fingerprint 幂等恢复同 run；否则才是真正的 quote 状态错误。
      const winner = await deps.repository.getRunByKey(project.id, input.operation, input.idempotencyKey);
      if (winner) {
        if (winner.payloadFingerprint !== payloadFingerprint) {
          return {
            ok: false,
            error: {
              code: "generation_idempotency_payload_conflict",
              message: "same idempotency key submitted with a different payload; use a new key for a new payload",
            },
          };
        }
        const winnerSnapshot = await deps.repository.getSnapshotById(winner.runConfigurationSnapshotId);
        if (!winnerSnapshot) {
          return { ok: false, error: { code: "generation_run_persistence_failed", message: "existing run snapshot missing" } };
        }
        return { ok: true, value: { run: winner, snapshot: winnerSnapshot, created: false } };
      }
      const message =
        transaction.error.code === "generation_quote_consumed"
          ? "quote already consumed"
          : "quote expired; create a new quote";
      return { ok: false, error: { code: transaction.error.code, message } };
    }
    return { ok: false, error: { code: "generation_run_persistence_failed", message: "run transaction failed" } };
  }

  return { ok: true, value: { run: transaction.run, snapshot, created: true } };
}

/** 构建不可变运行快照（quote 绑定字段成套复制；snapshot 不提供 update）。 */
function buildSnapshot(
  db: DbClient,
  project: ProjectRecord,
  quote: GenerationCostQuoteRecord,
  input: SubmitGenerationInput,
  revalidated: Extract<RevalidateQuoteResult, { ok: true }>["value"],
  runId: string,
  now: Date,
): RunConfigurationSnapshotRecord {
  const resolved = revalidated.resolved as ResolvedGenerationConfigurationV1;
  const pricing = revalidated.pricing;
  return {
    id: db.generateId(),
    projectId: project.id,
    userId: project.ownerId,
    stage: input.operation,
    operation: input.operation,
    runId,
    projectConfigurationRevision: resolved.source_revisions.project_configuration_revision,
    schemaVersion: "resolved_generation_configuration_v1",
    configurationHash: quote.configurationHash,
    resolvedConfigurationJson: resolved as unknown as Record<string, unknown>,
    resolutionTraceJson: resolved.resolution_trace as unknown as unknown[],
    quoteId: quote.id,
    quoteFingerprint: quote.quoteFingerprint,
    estimatedCostMicros: quote.estimatedCostMicros,
    authorizationCostMicros: quote.authorizationCostMicros,
    budgetLimitMicros: quote.budgetLimitMicros,
    budgetOverrideAuthorized: revalidated.requires_budget_override,
    pricingHash: pricing.pricing_hash,
    pricingVersionSetJson: pricing.pricing_versions,
    createdAt: now,
    updatedAt: now,
  };
}
