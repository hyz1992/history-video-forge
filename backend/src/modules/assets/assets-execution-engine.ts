/**
 * Asset execution engine — iterates manifest executions in dependency order,
 * selects registered provider adapters, and produces artifacts.
 */

import { AssetArtifact } from "../../../../shared/src/index.js";
import type {
  AssetManifest,
  AssetPlan,
  AssetTaskExecution,
} from "../../../../shared/src/index.js";
import type { DbClient } from "../../db/client.js";
import { appendAssetsRunEvent } from "./assets-run.service.js";
import { createAssetProviderJobRecord } from "./asset-provider-job.repository.js";
import { recordProviderJobUsage } from "../generation-cost/usage-cost-recorder.js";
import { DEFAULT_VIDEO_ESTIMATE_SECONDS } from "../generation-cost/generation-cost.service.js";
import type {
  AssetProviderAdapter,
  AssetProviderContext,
} from "./assets-provider-adapter.js";
import type { AssetProviderRegistry } from "./assets-provider-registry.js";

// ─── Priority map ──────────────────────────────────────────────────────────

const TASK_TYPE_PRIORITY: Record<AssetTaskExecution["task_type"], number> = {
  tts_audio: 0,
  subtitle_track: 1,
  image_still: 2,
  video_clip: 3,
  sfx_cue: 4,
  bgm_cue: 5,
  render_motion_cue: 6,
};

// ─── Terminal statuses ─────────────────────────────────────────────────────

const TERMINAL_STATUSES: ReadonlySet<AssetTaskExecution["status"]> = new Set([
  "completed",
  "failed",
  "skipped_with_fallback",
  "accepted",
  "rejected",
]);

// ─── Input / Output ────────────────────────────────────────────────────────

export interface ExecuteAssetManifestInput {
  db: DbClient;
  assetManifestRecordId: string;
  assetRunId: string;
  manifest: AssetManifest;
  registry: AssetProviderRegistry;
  assetPlan: AssetPlan;
  projectStorageRootDir: string;
}

export interface ExecuteAssetManifestResult {
  manifest: AssetManifest;
}

// ─── Engine ────────────────────────────────────────────────────────────────

export async function executeAssetManifest(
  input: ExecuteAssetManifestInput,
): Promise<ExecuteAssetManifestResult> {
  const {
    db,
    assetManifestRecordId,
    assetRunId,
    manifest,
    registry,
    assetPlan,
    projectStorageRootDir,
  } = input;

  // Work on a deep-enough copy so the original is not mutated.
  const manifestCopy: AssetManifest = structuredClone(manifest);

  // Sort executions by task type priority.
  const sorted = [...manifestCopy.executions].sort(
    (a, b) => TASK_TYPE_PRIORITY[a.task_type] - TASK_TYPE_PRIORITY[b.task_type],
  );

  for (const execution of sorted) {
    // 1. Skip terminal executions.
    if (TERMINAL_STATUSES.has(execution.status)) continue;

    // 2. Check dependency readiness.
    if (!areDependenciesSatisfied(execution, manifestCopy)) continue;

    // 3. Resolve plan task.
    const planTask = assetPlan.tasks.find(
      (t) => t.task_id === execution.task_id,
    );
    if (!planTask) {
      execution.status = "failed";
      execution.notes = [
        ...execution.notes,
        `[engine] no matching plan task for task_id=${execution.task_id}`,
      ];
      continue;
    }

    // 4. Select adapter.
    // S2-2A 任务 6：all_remotion 永不调用视频 provider——即使客户端构造了
    // video task，也按 manifest 中持久化的策略跳过，不创建 provider job；
    // 段 route 缺失时保守跳过（无法确认策略就不执行视频）。
    // S2-2A 任务 9A（终审 I-A）：quote 绑定 run 的未授权段由 run.service 在
    // manifest 收敛时把 video_clip execution 置为跳过（终态），引擎不再见到；
    // 非绑定 run（free/legacy 升级路径）保持 image_with_motion 上升级语义。
    if (execution.task_type === "video_clip") {
      const route = findSegmentRoute(manifestCopy, planTask.source_segment_id);
      if (!route || (route.video_strategy ?? "prefer_remotion") === "all_remotion") {
        execution.status = "skipped_with_fallback";
        execution.notes = [
          ...execution.notes,
          route
            ? "[strategy] all_remotion 段不调用视频 provider"
            : "[strategy] 段 route 缺失，跳过视频执行",
        ];
        continue;
      }
    }
    const adapter = registry.findAdapter({
      taskType: execution.task_type,
      enabledProviderTypes:
        manifestCopy.execution_options.enabled_provider_types,
    });
    if (!adapter) {
      // S2-2A 任务 6 整改：视频 provider 不可用是正式失败原因，
      // 必须进入同一策略状态机（严格阻塞或自动降级），不能直接跳过。
      if (execution.task_type === "video_clip") {
        execution.status = "failed";
        execution.completed_at = new Date().toISOString();
        execution.notes = [
          ...execution.notes,
          "[engine] no video adapter available",
        ];
        await handleVideoStrategyFailure(
          manifestCopy,
          planTask,
          execution,
          db,
          assetRunId,
          assetPlan,
          "video_provider_unavailable",
          "no video adapter in registry",
        );
      }
      continue;
    }

    // 5. Build context.
    const ctx: AssetProviderContext = {
      manifest: manifestCopy,
      assetPlan,
      execution,
      planTask,
      assetManifestRecordId,
      assetRunId,
      projectStorageRootDir,
    };

    // 6. Run the pipeline.
    await runAdapterPipeline(db, ctx, adapter, assetManifestRecordId, assetRunId, manifestCopy, planTask);
  }

  return { manifest: manifestCopy };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function runAdapterPipeline(
  db: DbClient,
  ctx: AssetProviderContext,
  adapter: AssetProviderAdapter,
  assetManifestRecordId: string,
  assetRunId: string,
  manifest: AssetManifest,
  planTask: AssetPlan["tasks"][number],
): Promise<void> {
  const execution = ctx.execution;
  const startedAtMs = Date.now();
  const startedAt = new Date().toISOString();
  execution.status = "running";
  execution.started_at = startedAt;
  execution.provider_id = adapter.providerName;

  // S2-2A 任务 9A 付费闸门（验收 1）：真实付费 adapter 只在 run/snapshot 上下文
  // 中派发。2026-08-23（报价体系移除）：quote 校验已移除——run 存在且快照
  // 存在即视为已授权上下文（记账与防重复计费由 run/snapshot 承担）。
  // 本地/fake adapter（无 billing 声明）不受限（零外部费用，验收 6）。
  let paidUsageContext: {
    snapshot: import("../../db/client.js").RunConfigurationSnapshotRecord;
    billing: NonNullable<AssetProviderAdapter["billing"]>;
  } | null = null;
  if (adapter.billing) {
    const run = db.generationRuns.get(assetRunId);
    const snapshot = run ? db.runConfigurationSnapshots.get(run.runConfigurationSnapshotId) : undefined;
    if (!run || !snapshot) {
      execution.status = "failed";
      execution.completed_at = new Date().toISOString();
      execution.notes = [
        ...execution.notes,
        "[gate] paid provider blocked: paid_dispatch_context_missing — no run/snapshot context for paid provider dispatch",
      ];
      await handleVideoStrategyFailure(
        manifest,
        planTask,
        execution,
        db,
        assetRunId,
        ctx.assetPlan,
        "paid_dispatch_context_missing",
        "no run/snapshot context for paid provider dispatch",
      );
      return;
    }
    paidUsageContext = { snapshot, billing: adapter.billing };
  }

  // 闸门通过后才递增 attempt（被拦截的任务不消耗重试簿记，M2）
  execution.attempts += 1;

  // job 记录提升到 try 外：创建失败（FK/连接异常）时 catch 分支不引用未声明变量
  let jobRecord: import("../../db/client.js").AssetProviderJobRecord | null = null;

  try {
    // prepare
    const prepared = await adapter.prepare(ctx);

    // Create job record（付费 job 携带 call-intent 身份三元组；真实 job 记录
    // 同时是 usage 记账的外键父记录——记账必须引用真实 id，Prisma 态 FK 强制）
    jobRecord = await createAssetProviderJobRecord(db, {
      assetManifestRecordId,
      assetRunId,
      executionId: execution.execution_id,
      taskId: execution.task_id,
      providerType: adapter.providerType,
      providerName: adapter.providerName,
      providerJobId: prepared.providerJobId,
      status: "prepared",
      attemptCount: execution.attempts,
      // S2-2A 任务 6 整改：job 关联正式 run 与 0-based attempt 索引，
      // 支撑重试不复用旧 quote 的可审计证据。
      generationRunId: assetRunId,
      attemptIndex: Math.max(0, execution.attempts - 1),
      // S2-2A 任务 9A：付费外部提交意图携带稳定 request key（run+task 维度，
      // attemptIndex 区分重试），数据库唯一索引防重复计费提交。
      providerRequestKey: adapter.billing
        ? `assets:${assetRunId}:${execution.task_id}`
        : null,
      rawRequestJson: prepared.rawRequestJson,
      rawResponseJson: null,
      errorCode: null,
      errorMessage: null,
    });

    // submit
    const submitted = await adapter.submit(ctx, prepared);

    // poll
    const pollResult = await adapter.poll(ctx, submitted);

    if (pollResult.status === "failed") {
      execution.status = "failed";
      execution.completed_at = new Date().toISOString();
      execution.notes = [
        ...execution.notes,
        `[engine] provider poll failed: ${pollResult.errorCode ?? "unknown"} — ${pollResult.errorMessage ?? "no message"}`,
      ];
      await recordPaidUsage(db, ctx, paidUsageContext, assetRunId, execution, planTask, jobRecord, "failed", startedAtMs);
      // S2-2A 任务 6：按段视频策略处理失败（严格阻塞或自动降级）
      await handleVideoStrategyFailure(
        manifest,
        planTask,
        execution,
        db,
        assetRunId,
        ctx.assetPlan,
        pollResult.errorCode ?? "video_provider_error",
        pollResult.errorMessage ?? "no message",
      );
      return;
    }

    if (pollResult.status === "running") {
      // Still running — leave as running, do not finalize.
      execution.status = "running";
      execution.notes = [
        ...execution.notes,
        "[engine] provider poll returned running; deferring finalization",
      ];
      await recordPaidUsage(db, ctx, paidUsageContext, assetRunId, execution, planTask, jobRecord, "running", startedAtMs);
      return;
    }

    // completed — download + normalize
    const downloaded = await adapter.download(ctx, pollResult);
    const normalized = await adapter.normalizeResult({
      ctx,
      downloadedArtifacts: downloaded,
      rawResponseJson: pollResult.rawResponseJson,
    });

    // Validate each artifact with Zod
    const validArtifacts = normalized.artifacts.filter((a) => {
      const parsed = AssetArtifact.safeParse(a);
      if (!parsed.success) {
        execution.notes = [
          ...execution.notes,
          `[engine] artifact ${a.artifact_id} failed validation: ${parsed.error.message}`,
        ];
        return false;
      }
      return true;
    });

    // Append artifacts and update execution. Provider outputs replace any
    // planned placeholders with the same artifact id.
    const artifactIds = validArtifacts.map((a) => a.artifact_id);
    const artifactIdSet = new Set(artifactIds);
    manifest.artifacts = manifest.artifacts.filter(
      (artifact) => !artifactIdSet.has(artifact.artifact_id),
    );
    manifest.artifacts.push(...validArtifacts);
    execution.output_artifact_ids = [
      ...new Set([...execution.output_artifact_ids, ...artifactIds]),
    ];
    execution.status = "completed";
    execution.completed_at = new Date().toISOString();
    execution.notes = [...execution.notes, ...normalized.notes];

    // Apply artifacts to segment routes
    applyArtifactRoutes(manifest, validArtifacts, planTask);
    await recordPaidUsage(db, ctx, paidUsageContext, assetRunId, execution, planTask, jobRecord, "completed", startedAtMs);
  } catch (err) {
    execution.status = "failed";
    execution.completed_at = new Date().toISOString();
    const message = err instanceof Error ? err.message : String(err);
    execution.notes = [
      ...execution.notes,
      `[engine] adapter pipeline error: ${message}`,
    ];
    if (jobRecord) {
      await recordPaidUsage(db, ctx, paidUsageContext, assetRunId, execution, planTask, jobRecord, "failed", startedAtMs);
    }
    // S2-2A 任务 6：管线异常同样按段视频策略处理
    await handleVideoStrategyFailure(
      manifest,
      planTask,
      execution,
      db,
      assetRunId,
      ctx.assetPlan,
      "adapter_pipeline_error",
      message,
    );
  }
}

/**
 * S2-2A 任务 9A：付费 adapter 的 usage 记账钩子（验收 2/3/5/8）。
 * 幂等：同 (snapshot, providerRequestKey, attemptIndex) 重放只更新原记录；
 * overrun 处理（run event + catalog 禁用）由 recorder 内部完成。
 */
async function recordPaidUsage(
  db: DbClient,
  ctx: AssetProviderContext,
  paidUsageContext: {
    snapshot: import("../../db/client.js").RunConfigurationSnapshotRecord;
    billing: NonNullable<AssetProviderAdapter["billing"]>;
  } | null,
  assetRunId: string,
  execution: AssetManifest["executions"][number],
  planTask: AssetPlan["tasks"][number],
  jobRecord: import("../../db/client.js").AssetProviderJobRecord,
  jobStatus: "completed" | "failed" | "running",
  startedAtMs: number,
): Promise<void> {
  if (!paidUsageContext) return;
  const { snapshot, billing } = paidUsageContext;
  const measuredUnits = measuredUnitsForTask(planTask, snapshot);
  if (!measuredUnits) return;
  // 记账引用真实 provider job 记录（Prisma 态 assetProviderJobRecordId 外键
  // 强制；providerRequestKey/attemptIndex 与 job 同一身份三元组）
  await recordProviderJobUsage({
    db,
    snapshot,
    runId: assetRunId,
    providerJob: { ...jobRecord, status: jobStatus },
    capability: billing.capability,
    providerKey: billing.providerKey,
    modelId: billing.modelId,
    measuredUnits,
    providerUsage: null,
    durationMs: Date.now() - startedAtMs,
  }).catch(async (error) => {
    // 记账失败不阻断执行主链路；显式留痕（生产态成本台账缺口可审计），
    // 不能静默吞掉——账本缺口由对账工具（needs_reconciliation 族）兜底
    const event: import("../../db/client.js").GenerationRunEventRecord = {
      id: db.generateId(),
      generationRunId: assetRunId,
      segmentId: null,
      eventType: "usage_recording_failed",
      eventJson: {
        task_id: execution.task_id,
        capability: billing.capability,
        message: error instanceof Error ? error.message : String(error),
      },
      createdAt: new Date(),
    };
    // 与既有事件持久化约定一致：先 writer 后 Map（writer 自身失败也容错，
    // 审计留痕尽力而为，不阻断执行主链路）
    if (db.thirdAggregateWriter) {
      await db.thirdAggregateWriter
        .appendGenerationRunEvent(event)
        .catch(() => undefined);
    }
    const events = db.generationRunEvents.get(assetRunId) ?? [];
    events.push(event);
    db.generationRunEvents.set(assetRunId, events);
  });
}

/**
 * 任务类型 → 实测计量单位（确定性本地测量；与报价 workload 同一单位域）。
 * video_second 的质量档位取快照 resolved.effective.video.api_quality——
 * 与报价计价同源（diff 审查 I1：planTask 参数无人写入 api_quality，
 * 按参数取值恒落 standard_720p，1080P 项目费用会被系统性低估）。
 */
function measuredUnitsForTask(
  planTask: AssetPlan["tasks"][number],
  snapshot: import("../../db/client.js").RunConfigurationSnapshotRecord,
): { unitType: "image" | "video_second" | "tts_character"; count: number; quality?: string } | null {
  switch (planTask.task_type) {
    case "tts_audio":
      return { unitType: "tts_character", count: planTask.source_excerpt.length };
    case "image_still":
      return { unitType: "image", count: 1 };
    case "video_clip": {
      const duration = planTask.parameters["duration_sec"];
      const count =
        typeof duration === "number" && Number.isFinite(duration) && duration > 0
          ? duration
          : DEFAULT_VIDEO_ESTIMATE_SECONDS;
      const effective = (snapshot.resolvedConfigurationJson as Record<string, unknown>)["effective"] as
        | { video?: { api_quality?: string } }
        | undefined;
      return {
        unitType: "video_second",
        count,
        quality: effective?.video?.api_quality ?? undefined,
      };
    }
    default:
      return null;
  }
}

// ─── S2-2A 任务 6：视频策略状态机 ────────────────────────────────────────────

function findSegmentRoute(
  manifest: AssetManifest,
  segmentId: string | null,
): AssetManifest["segment_routes"][number] | null {
  if (!segmentId) return null;
  return manifest.segment_routes.find((route) => route.segment_id === segmentId) ?? null;
}

/**
 * API 视频失败后的策略分支：
 * - all_api_video（严格）：进入 blocked_waiting_user，不自动改 manifest route，
 *   fallback artifact 保留，等用户显式 accept-fallback 或重试。
 * - prefer_api_video / prefer_remotion（自动）：降级为 image_with_motion 并记录
 *   automatic_fallback 事件；同段 anchor 或 Remotion cue 缺一不可，否则保持
 *   blocked 不得伪装 ready。
 * - all_remotion：engine 层已跳过，不进入本函数。
 */
async function handleVideoStrategyFailure(
  manifest: AssetManifest,
  planTask: AssetPlan["tasks"][number],
  execution: AssetManifest["executions"][number],
  db: DbClient,
  assetRunId: string,
  assetPlan: AssetPlan,
  reasonCode: string,
  reasonMessage: string,
): Promise<void> {
  if (planTask.task_type !== "video_clip") return;
  const route = findSegmentRoute(manifest, planTask.source_segment_id);
  if (!route) return;

  const strategy = route.video_strategy ?? "prefer_remotion";
  const failureNote = `[strategy] api video failed: ${reasonCode} — ${reasonMessage}`;

  if (strategy === "all_api_video") {
    route.readiness = "blocked_waiting_user";
    route.notes = [...route.notes, failureNote];
    return;
  }

  // 自动降级要求同段 fallback anchor 与 Remotion cue 齐备，且分别由本段
  // image_still / render_motion_cue execution 产出（跨段引用不得伪装 ready）。
  const anchorArtifactId =
    route.fallback_visual_artifact_id ?? route.primary_visual_artifact_id;
  const imageProducerTaskIds = new Set(
    assetPlan.tasks
      .filter(
        (task) =>
          task.source_segment_id === route.segment_id &&
          task.task_type === "image_still",
      )
      .map((task) => task.task_id),
  );
  const motionProducerTaskIds = new Set(
    assetPlan.tasks
      .filter(
        (task) =>
          task.source_segment_id === route.segment_id &&
          task.task_type === "render_motion_cue",
      )
      .map((task) => task.task_id),
  );
  const imageProducerOutputs = new Set(
    manifest.executions
      .filter((execution) => imageProducerTaskIds.has(execution.task_id))
      .flatMap((execution) => execution.output_artifact_ids),
  );
  const motionProducerOutputs = new Set(
    manifest.executions
      .filter((execution) => motionProducerTaskIds.has(execution.task_id))
      .flatMap((execution) => execution.output_artifact_ids),
  );
  // I5 整改：anchor/motion 除 producer 证据外，还必须真实存在于 manifest.artifacts
  // 且类型正确（image / motion_recipe），损坏或错误类型的输出不得标记 ready。
  const anchorArtifact = anchorArtifactId
    ? manifest.artifacts.find((item) => item.artifact_id === anchorArtifactId)
    : undefined;
  const motionCueArtifact = route.motion_artifact_id
    ? manifest.artifacts.find((item) => item.artifact_id === route.motion_artifact_id)
    : undefined;
  const hasAnchor = Boolean(
    anchorArtifactId &&
    anchorArtifact &&
    anchorArtifact.artifact_type === "image" &&
    imageProducerOutputs.has(anchorArtifactId),
  );
  const hasMotion = Boolean(
    route.motion_artifact_id &&
    motionCueArtifact &&
    motionCueArtifact.artifact_type === "motion_recipe" &&
    motionProducerOutputs.has(route.motion_artifact_id),
  );
  if (!hasAnchor || !hasMotion) {
    route.readiness = "blocked";
    route.notes = [
      ...route.notes,
      `[strategy] auto fallback unavailable: anchor=${hasAnchor} motion=${hasMotion}; ${failureNote}`,
    ];
    return;
  }

  // S2-2A 任务 6 整改：正式 route_auto_downgraded 事件必须先成功落库，
  // 持久化失败抛错 → 本次自动降级不得激活（route/execution 均不改动）。
  await appendAssetsRunEvent({
    db,
    runId: assetRunId,
    eventType: "route_auto_downgraded",
    segmentId: route.segment_id,
    eventJson: {
      old_route: "video_clip",
      new_route: "image_with_motion",
      reason_code: reasonCode,
      reason_message: reasonMessage,
      fallback_decision: "automatic",
    },
  });

  if (route.primary_visual_artifact_id === null) {
    route.primary_visual_artifact_id = route.fallback_visual_artifact_id;
  }
  route.visual_route_type = "image_with_motion";
  route.fallback_decision = "automatic";
  route.route_events = [
    ...(route.route_events ?? []),
    {
      event_type: "automatic_fallback",
      occurred_at: new Date().toISOString(),
      reason_code: reasonCode,
    },
  ];
  route.readiness = "ready";
  route.notes = [...route.notes, failureNote];
  // 自动降级成功 → execution 进入 validator 认可的终态，允许继续 Compose
  execution.status = "skipped_with_fallback";
  execution.completed_at = new Date().toISOString();
}

/**
 * Check whether upstream dependencies are satisfied for the given execution.
 *
 * v1 rules:
 * - subtitle_track requires at least one tts_chunk_audio artifact in manifest.
 * - video_clip requires at least one image artifact for the same segment.
 * - Everything else is assumed ready.
 */
function areDependenciesSatisfied(
  execution: AssetTaskExecution,
  manifest: AssetManifest,
): boolean {
  if (execution.task_type === "subtitle_track") {
    return manifest.audio_summary.tts_chunk_artifact_ids.length > 0;
  }

  if (execution.task_type === "video_clip") {
    // v1: just check if any image artifact exists in manifest
    return manifest.artifacts.some((a) => a.artifact_type === "image");
  }

  return true;
}

function pushUnique(target: string[], value: string): void {
  if (!target.includes(value)) {
    target.push(value);
  }
}

/**
 * Apply generated artifacts to the manifest's segment routes and summaries.
 *
 * For `image` artifacts:
 * - If the route's `visual_route_type` is `"video_clip"`: set fallback and
 *   mark readiness as `"fallback_ready"`.
 * - Otherwise: set primary visual, keep `image_only`, mark `"ready"`.
 *
 * For `tts_chunk_audio` artifacts:
 * - Append to `audio_summary.tts_chunk_artifact_ids`.
 * - Update matching `audio_summary.tts_chunk_routes[].artifact_id` by `tts_chunk_id`.
 * - Set matching `segment_routes[].tts_artifact_id` for segments in `segment_ids`.
 *
 * For `tts_merged_audio` artifacts:
 * - Set `audio_summary.tts_merged_artifact_id`.
 * - Set `audio_summary.tts_total_duration_sec` from metadata.
 *
 * For `subtitle_track` artifacts (first SRT):
 * - Set `audio_summary.subtitle_artifact_id` to the first SRT artifact.
 * - Set all `segment_routes[].subtitle_artifact_id`.
 */
function applyArtifactRoutes(
  manifest: AssetManifest,
  artifacts: AssetArtifact[],
  planTask: AssetPlan["tasks"][number],
): void {
  for (const artifact of artifacts) {
    switch (artifact.artifact_type) {
      case "image": {
        const segmentId = planTask.source_segment_id;
        const route = manifest.segment_routes.find(
          (r) => r.segment_id === segmentId,
        );
        if (!route) break;

        if (route.visual_route_type === "video_clip") {
          route.fallback_visual_artifact_id = artifact.artifact_id;
          route.readiness = "fallback_ready";
        } else {
          route.primary_visual_artifact_id = artifact.artifact_id;
          route.visual_route_type = route.motion_artifact_id
            ? "image_with_motion"
            : "image_only";
          route.readiness = "ready";
        }
        break;
      }

      case "video": {
        const segmentId = planTask.source_segment_id;
        const route = manifest.segment_routes.find(
          (item) => item.segment_id === segmentId,
        );
        if (!route) break;

        if (!route.fallback_visual_artifact_id && route.primary_visual_artifact_id) {
          route.fallback_visual_artifact_id = route.primary_visual_artifact_id;
        }
        route.primary_visual_artifact_id = artifact.artifact_id;
        route.visual_route_type = "video_clip";
        route.readiness = "ready";
        break;
      }

      case "tts_chunk_audio": {
        const meta = artifact.metadata as {
          tts_chunk_id: string;
          segment_ids: string[];
        };

        // Add to tts_chunk_artifact_ids
        pushUnique(
          manifest.audio_summary.tts_chunk_artifact_ids,
          artifact.artifact_id,
        );

        // Update matching tts_chunk_route
        const chunkRoute = manifest.audio_summary.tts_chunk_routes.find(
          (r) => r.tts_chunk_id === meta.tts_chunk_id,
        );
        if (chunkRoute) {
          chunkRoute.artifact_id = artifact.artifact_id;
        }

        // Set segment route tts_artifact_id for each segment
        for (const segId of meta.segment_ids) {
          const segRoute = manifest.segment_routes.find(
            (r) => r.segment_id === segId,
          );
          if (segRoute) {
            segRoute.tts_artifact_id = artifact.artifact_id;
          }
        }
        break;
      }

      case "tts_merged_audio": {
        const meta = artifact.metadata as { duration_sec: number };
        manifest.audio_summary.tts_merged_artifact_id = artifact.artifact_id;
        manifest.audio_summary.tts_total_duration_sec = meta.duration_sec;
        break;
      }

      case "subtitle_track": {
        const meta = artifact.metadata as { format: string };

        // Set subtitle_artifact_id for the first SRT artifact
        if (
          meta.format === "srt" &&
          !manifest.audio_summary.subtitle_artifact_id
        ) {
          manifest.audio_summary.subtitle_artifact_id = artifact.artifact_id;

          // Set all segment route subtitle_artifact_ids
          for (const segRoute of manifest.segment_routes) {
            segRoute.subtitle_artifact_id = artifact.artifact_id;
          }
        }
        break;
      }

      case "sfx_audio":
      case "sfx_selection": {
        pushUnique(
          manifest.audio_summary.sfx_artifact_ids,
          artifact.artifact_id,
        );

        if (planTask.source_segment_id) {
          const route = manifest.segment_routes.find(
            (item) => item.segment_id === planTask.source_segment_id,
          );
          if (route) {
            pushUnique(route.sfx_artifact_ids, artifact.artifact_id);
          }
        }
        break;
      }

      case "bgm_audio":
      case "bgm_selection": {
        const expectedLegacyPlacementId = `bgm_place_${planTask.task_id}`;
        const placement =
          manifest.audio_summary.bgm_placements.find(
            (item) => item.source_task_id === planTask.task_id,
          ) ??
          manifest.audio_summary.bgm_placements.find(
            (item) => item.bgm_placement_id === expectedLegacyPlacementId,
          );
        if (placement) {
          placement.artifact_id = artifact.artifact_id;
        }
        break;
      }

      default:
        break;
    }
  }
}
