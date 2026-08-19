import type {
  DbClient,
  GenerationRunEventRecord,
  GenerationRunRecord,
  ProjectRecord,
} from "../../db/client.js";
import type { GenerationRunRepository } from "./generation-run.repository.js";

/**
 * S2-2A 任务 8：可恢复 GenerationRun dispatcher（详细设计 4.7）。
 *
 * 派发顺序：
 * 1. 条件更新原子 claim pending_dispatch 或 lease 已过期的 run，写
 *    dispatchLeaseOwner/dispatchLeaseExpiresAt 并递增 claimCount；
 * 2. 未取得 lease 立即退出（不重复派发）；
 * 3. 由 operation handler 为每个外部意图持久化带稳定 providerRequestKey 的
 *    provider job/intent；唯一冲突时加载已有 intent，不重复 submit（provider 层合同）；
 * 4. 再调用 provider；
 * 5. 追加 append-only run event；
 * 6. 更新 run 状态并释放 lease，不修改 snapshot。
 *
 * 恢复触发：提交事务完成后立即 dispatch；启动扫描 pending/lease-expired；
 * 服务存活期间低频 sweep。扫描与 sweep 永远跳过 needs_reconciliation——
 * provider 不支持幂等且远端结果不确定时进入该状态，禁止自动二次提交。
 */

export type DispatchOutcome =
  | { status: "succeeded"; response?: { statusCode: number; body: unknown } }
  | {
      status: "failed";
      reason_code: string;
      message: string;
      response?: { statusCode: number; body: unknown };
    }
  | { status: "needs_reconciliation"; reason_code: string; message: string };

export interface GenerationRunDispatchHandler {
  (run: GenerationRunRecord, context: { db: DbClient; project: ProjectRecord }): Promise<DispatchOutcome>;
}

export type DispatchResult =
  | { dispatched: true; outcome: DispatchOutcome }
  | { dispatched: false; reason: "run_not_found" | "not_claimable" | "lease_held" };

export interface GenerationRunDispatcher {
  /** 提交后立即派发：claim → handler → event → 终态。 */
  dispatch(runId: string): Promise<DispatchResult>;
  /** 启动扫描 / 低频 sweep 的显式 tick；跳过 needs_reconciliation。 */
  scanAndDispatch(): Promise<{ claimed: number }>;
}

export function createGenerationRunDispatcher(options: {
  db: DbClient;
  repository: GenerationRunRepository;
  workerId: string;
  leaseDurationMs: number;
  now?: () => Date;
  handlers: Record<string, GenerationRunDispatchHandler>;
}): GenerationRunDispatcher {
  const nowFn = options.now ?? (() => new Date());

  async function dispatch(runId: string): Promise<DispatchResult> {
    const run = options.repository.getRunById(runId);
    if (!run) return { dispatched: false, reason: "run_not_found" };

    const now = nowFn();
    const leaseUntil = new Date(now.getTime() + options.leaseDurationMs);
    const claimed = await options.repository.claimRun(runId, options.workerId, leaseUntil, now);
    if (!claimed) {
      const current = options.repository.getRunById(runId);
      if (current && current.status === "running" && current.dispatchLeaseExpiresAt !== null) {
        return { dispatched: false, reason: "lease_held" };
      }
      return { dispatched: false, reason: "not_claimable" };
    }

    const claimedRun = options.repository.getRunById(runId)!;
    const project = options.db.projects.get(claimedRun.projectId);
    const handler = options.handlers[claimedRun.operation];

    let outcome: DispatchOutcome;
    if (!handler) {
      outcome = {
        status: "failed",
        reason_code: "dispatch_handler_missing",
        message: `no dispatch handler registered for operation ${claimedRun.operation}`,
      };
    } else if (!project) {
      outcome = {
        status: "failed",
        reason_code: "project_not_found",
        message: `project ${claimedRun.projectId} not found for run ${runId}`,
      };
    } else {
      try {
        outcome = await handler(claimedRun, { db: options.db, project });
      } catch (error) {
        outcome = {
          status: "failed",
          reason_code: "dispatch_handler_exception",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }

    await finalizeDispatch(runId, outcome, claimedRun);
    return { dispatched: true, outcome };
  }

  async function finalizeDispatch(
    runId: string,
    outcome: DispatchOutcome,
    claimedRun: GenerationRunRecord,
  ): Promise<void> {
    const now = nowFn();
    const eventBase = {
      generationRunId: runId,
      segmentId: null,
      createdAt: now,
    };
    if (outcome.status === "succeeded") {
      const event: GenerationRunEventRecord = {
        id: options.db.generateId(),
        ...eventBase,
        eventType: "dispatch_succeeded",
        eventJson: { worker_id: options.workerId, dispatch_claim_count: claimedRun.dispatchClaimCount },
      };
      await options.repository.appendRunEvent(event);
      await options.repository.updateRunStatus(runId, "succeeded", { releaseLease: true, now });
      return;
    }
    if (outcome.status === "needs_reconciliation") {
      const event: GenerationRunEventRecord = {
        id: options.db.generateId(),
        ...eventBase,
        eventType: "needs_reconciliation",
        eventJson: {
          worker_id: options.workerId,
          reason_code: outcome.reason_code,
          message: outcome.message,
        },
      };
      await options.repository.appendRunEvent(event);
      // 终态：释放 lease，扫描与 sweep 永不重新派发该状态
      await options.repository.updateRunStatus(runId, "needs_reconciliation", { releaseLease: true, now });
      return;
    }
    const event: GenerationRunEventRecord = {
      id: options.db.generateId(),
      ...eventBase,
      eventType: "dispatch_failed",
      eventJson: {
        worker_id: options.workerId,
        reason_code: outcome.reason_code,
        message: outcome.message,
      },
    };
    await options.repository.appendRunEvent(event);
    await options.repository.updateRunStatus(runId, "failed", { releaseLease: true, now });
  }

  async function scanAndDispatch(): Promise<{ claimed: number }> {
    const runs = options.repository.listRecoverableRuns(nowFn());
    let claimed = 0;
    for (const run of runs) {
      const result = await dispatch(run.id);
      if (result.dispatched) claimed += 1;
    }
    return { claimed };
  }

  return { dispatch, scanAndDispatch };
}
