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
  | {
      dispatched: false;
      reason: "run_not_found" | "not_claimable" | "lease_held" | "project_context_unavailable";
    };

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
    const run = await options.repository.getRunById(runId);
    if (!run) return { dispatched: false, reason: "run_not_found" };

    // 执行上下文检查在 claim 之前：跨进程 sweep（DB 权威）可能发现本进程镜像
    // 中没有 project 上下文的 run（hydrate 仅启动执行）。此时必须跳过派发——
    // 绝不能置终态 failed（那会永久误杀一个 quote 已消费的可恢复 run）；
    // lease 到期后由持有该 project 上下文的实例接管。
    const project = options.db.projects.get(run.projectId);
    if (!project) {
      return { dispatched: false, reason: "project_context_unavailable" };
    }

    const now = nowFn();
    const leaseUntil = new Date(now.getTime() + options.leaseDurationMs);
    const claimed = await options.repository.claimRun(runId, options.workerId, leaseUntil, now);
    if (!claimed) {
      const current = await options.repository.getRunById(runId);
      if (current && current.status === "running" && current.dispatchLeaseExpiresAt !== null) {
        return { dispatched: false, reason: "lease_held" };
      }
      return { dispatched: false, reason: "not_claimable" };
    }

    const claimedRun = (await options.repository.getRunById(runId))!;
    const handler = options.handlers[claimedRun.operation];

    let outcome: DispatchOutcome;
    if (!handler) {
      outcome = {
        status: "failed",
        reason_code: "dispatch_handler_missing",
        message: `no dispatch handler registered for operation ${claimedRun.operation}`,
      };
    } else {
      // handler 执行期间周期性续期 lease（leaseDurationMs/2 间隔）：
      // 存活 worker 的长任务不会被其他 worker 在 lease 到期后接管重复派发；
      // 崩溃 worker 停止续期，lease 到期后仍可被接管（恢复语义不变）。
      const renewalTimer = setInterval(() => {
        const renewalNow = nowFn();
        void options.repository.renewLease(
          runId,
          options.workerId,
          new Date(renewalNow.getTime() + options.leaseDurationMs),
          renewalNow,
        );
      }, Math.max(1, Math.floor(options.leaseDurationMs / 2)));
      try {
        outcome = await handler(claimedRun, { db: options.db, project });
      } catch (error) {
        outcome = {
          status: "failed",
          reason_code: "dispatch_handler_exception",
          message: error instanceof Error ? error.message : String(error),
        };
      } finally {
        clearInterval(renewalTimer);
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
      const updated = await options.repository.updateRunStatus(runId, "succeeded", {
        releaseLease: true,
        now,
        expectedLeaseOwner: options.workerId,
      });
      await appendFencedOutEventIfRejected(runId, updated, "succeeded");
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
      const updated = await options.repository.updateRunStatus(runId, "needs_reconciliation", {
        releaseLease: true,
        now,
        expectedLeaseOwner: options.workerId,
      });
      await appendFencedOutEventIfRejected(runId, updated, "needs_reconciliation");
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
    const updated = await options.repository.updateRunStatus(runId, "failed", {
      releaseLease: true,
      now,
      expectedLeaseOwner: options.workerId,
    });
    await appendFencedOutEventIfRejected(runId, updated, "failed");
  }

  /**
   * fencing 拒绝的迟到 finalize（I-2）：写入被丢弃，但必须留下审计事件——
   * run 状态以当前 lease 持有者（接管者）的 finalize 为准。
   */
  async function appendFencedOutEventIfRejected(
    runId: string,
    updated: GenerationRunRecord | null,
    discardedStatus: DispatchOutcome["status"],
  ): Promise<void> {
    if (updated !== null) return;
    const event: GenerationRunEventRecord = {
      id: options.db.generateId(),
      generationRunId: runId,
      segmentId: null,
      eventType: "dispatch_finalize_fenced_out",
      eventJson: {
        worker_id: options.workerId,
        discarded_outcome_status: discardedStatus,
        reason: "lease_lost_before_finalize",
      },
      createdAt: nowFn(),
    };
    await options.repository.appendRunEvent(event);
  }

  async function scanAndDispatch(): Promise<{ claimed: number }> {
    const runs = await options.repository.listRecoverableRuns(nowFn());
    let claimed = 0;
    for (const run of runs) {
      const result = await dispatch(run.id);
      if (result.dispatched) claimed += 1;
    }
    // project_context_unavailable：跳过（run 保持原状态，其他实例接管），
    // 不影响其余候选的派发。
    return { claimed };
  }

  return { dispatch, scanAndDispatch };
}
