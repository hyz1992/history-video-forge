import { NarrationCreativeSettings } from "../../../../shared/src/index.js";
import { getVoiceProfileById } from "../assets/voice/voice-profile.repository.js";
import { assertNarrationExecutionCompatibility } from "../narration/narration-execution-compatibility.js";
import { settingsFromResolvedNarration } from "../narration/narration-readiness.js";
import type {
  DbClient,
  GenerationRunRecord,
  ProjectRecord,
  RunConfigurationSnapshotRecord,
} from "../../db/client.js";
import {
  canonicalStringify,
  deterministicHash,
  type GenerationOperation,
  type GenerationQuoteSelection,
  type GenerationSubmitErrorCode,
  type ResolvedCreativeVoice,
  type ResolvedGenerationConfigurationV1,
} from "../../../../shared/src/index.js";
import { resolveQuoteConfiguration } from "../generation-cost/generation-cost.service.js";
import type { AppPrismaClient } from "../../db/prisma-client.types.js";
import type {
  GenerationRunRepository,
} from "./generation-run.repository.js";

/**
 * S2-2 生成提交服务（2026-08-23 报价体系移除后简化版）。
 *
 * 生成 API 不再要求 cost_quote_id / authorize_budget_override：任何部署
 * 都直接创建/恢复 run（不新增公开 /generation-runs 路由）。
 *
 * 流程：
 * 1. 计算 payload fingerprint（selection + 执行过滤的 canonical hash）；
 *    同 (projectId, operation, idempotencyKey) 已有 run：同 fingerprint
 *    返回同 run，不同 fingerprint 返回 409 generation_idempotency_payload_conflict；
 * 2. 重新解析配置（数据库为权威）→ 构建不可变快照（无 quote 绑定，free 形态）；
 * 3. 校验客户端 voice_profile_id 与快照 resolved_creative 一致（不一致 422）；
 * 4. 同一事务创建 RunConfigurationSnapshot 与 GenerationRun(status=pending_dispatch)。
 *
 * 事务提交后由可恢复 dispatcher 立即派发；本服务绝不调用外部 provider。
 */

export interface SubmitGenerationInput {
  operation: GenerationOperation;
  idempotencyKey: string;
  selection?: GenerationQuoteSelection;
  /**
   * assets.generate 的 provider 类型执行过滤：原样进入 run 的 dispatch payload，
   * 执行端按此过滤收缩任务（授权范围与执行范围同源）。
   */
  enabledProviderTypes?: string[];
  /** 恢复执行所需的最小非敏感 payload（不含密钥；凭据只在执行时从服务端解析）。 */
  dispatchPayload: Record<string, unknown>;
  /** 仅口播 operation 接受，调用者先完成来源和资格校验。 */
  narration?: NarrationRunFingerprintInput;
  narrationExpectedConfigurationRevision?: number;
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
  repository: GenerationRunRepository;
  /** Prisma 激活态：提交重解析输入以数据库为权威（跨实例一致性）。 */
  prismaClient?: AppPrismaClient;
  now?: () => Date;
}

export interface NarrationRunFingerprintInput {
  source_script_record_id: string;
  source_text_sha256: string;
  settings_override: { tone?: "neutral"; rate?: 1; };
  source_project_tts_settings_sha256: string;
  projection_version: string;
}

/** 运行幂等 payload 指纹（canonical：键排序 + selection/过滤归一）。 */
export function computeRunPayloadFingerprint(input: {
  operation: string;
  selection?: GenerationQuoteSelection;
  enabled_provider_types?: string[];
  narration?: NarrationRunFingerprintInput;
}): string {
  if (input.operation === "script.narration.generate") {
    return deterministicHash(canonicalStringify({ schema_version: "narration_run_payload_v1", operation: input.operation, narration: input.narration ?? null }));
  }
  const normalizedSelection = input.selection
    ? {
        mode: input.selection.mode ?? null,
        task_ids: [...(input.selection.task_ids ?? [])].sort(),
      }
    : null;
  const payload = {
    schema_version: "generation_run_payload_v1",
    operation: input.operation,
    selection: normalizedSelection,
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

  if (input.operation === "script.narration.generate") {
    if (!input.narration || !NarrationCreativeSettings.partial().strict().safeParse(input.narration.settings_override).success) return { ok: false, error: { code: "generation_run_resolution_failed", message: "narration_request_invalid" } };
  }
  // 1. payload fingerprint + 既有 run 幂等裁决
  const payloadFingerprint = computeRunPayloadFingerprint({
    operation: input.operation,
    selection: input.selection,
    enabled_provider_types: input.enabledProviderTypes,
    narration: input.narration,
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

  // 2. 重新解析配置（数据库为权威）→ 快照 resolved 内容 + plan/storyboard 绑定身份
  const resolution = await resolveQuoteConfiguration(
    db,
    project,
    {
      operation: input.operation, selection: input.selection,
      ...(input.operation === "script.narration.generate" && input.narration ? { runOverrides: { creative: { narration: input.narration.settings_override } } } : {}),
    },
    deps.prismaClient,
  );
  if (!resolution.ok) {
    return {
      ok: false,
      error: { code: "generation_run_resolution_failed", message: resolution.error.message },
    };
  }
  const { resolved, source } = resolution.value;
  if (input.operation === "script.narration.generate" && resolved.source_revisions.project_configuration_revision !== input.narrationExpectedConfigurationRevision) return { ok: false, error: { code: "generation_run_resolution_failed", message: "narration_configuration_conflict" } };
  if (input.operation === "script.narration.generate") {
    try {
      const selected = resolved.resolved_capabilities["tts.synthesize"];
      const voice = await getVoiceProfileById(db, resolved.resolved_creative.voice.voice_profile_id ?? "", { ownerId: project.ownerId });
      const settings = settingsFromResolvedNarration(resolved, voice?.provider_voice_id);
      assertNarrationExecutionCompatibility({ catalog: source.catalog, projectMode: project.narrationTimingMode, operation: "script.narration.generate", model: source.catalog.find(m => m.id === selected.provider_model_id), voice, settings, modelId: selected.model_id, providerKey: selected.provider_key, deploymentScope: settings.region });
    } catch { return { ok: false, error: { code: "generation_run_resolution_failed", message: "narration_execution_incompatible" } }; }
  }

  // S2-2B：客户端 voice_profile_id 与快照 resolved_creative 不一致时拒绝——
  // 失败时不创建 snapshot/run、无任何 provider 调用；重试只需修正负载。
  const voiceProfileConflict = checkVoiceProfileConflict(
    (input.dispatchPayload as { voice_profile_id?: unknown } | undefined)?.voice_profile_id,
    resolved.resolved_creative.voice,
  );
  if (voiceProfileConflict) {
    return {
      ok: false,
      error: {
        code: "generation_voice_profile_conflict",
        message: voiceProfileConflict,
      },
    };
  }

  // 3. 把绑定身份写入 dispatch payload——执行端按此身份执行，
  //    而不是实例内存中的活动指针（9A I-A 语义延续）。
  const dispatchPayload = { ...input.dispatchPayload };
  if (input.operation !== "script.narration.generate" && source.assetPlan?.id) {
    dispatchPayload["bound_asset_plan_record_id"] = source.assetPlan.id;
  }
  if (input.operation !== "script.narration.generate" && source.storyboard?.id) {
    dispatchPayload["bound_storyboard_record_id"] = source.storyboard.id;
  }
  const runId = db.generateId();
  const snapshot = buildSnapshot(db, project, resolved, input, runId, now);
  const run: GenerationRunRecord = {
    id: runId,
    projectId: project.id,
    userId: actorUserId,
    operation: input.operation,
    idempotencyKey: input.idempotencyKey,
    payloadFingerprint,
    quoteId: null,
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
    transaction = await deps.repository.createRunTransaction({ snapshot, run, now });
  } catch (error) {
    if (input.operation === "script.narration.generate" && error instanceof Error && (error.message === "narration_submission_source_conflict" || error.message === "project_scope_denied")) return { ok: false, error: { code: "generation_run_resolution_failed", message: error.message === "project_scope_denied" ? "project_scope_denied" : "narration_source_conflict" } };
    // 事务内任何未结构化异常（FK/约束/连接）都按持久化失败返回：
    // 事务已整体回滚，snapshot/run 均未落库。
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
    return { ok: false, error: { code: "generation_run_persistence_failed", message: "run transaction failed" } };
  }

  return { ok: true, value: { run: transaction.run, snapshot, created: true } };
}

/**
 * S2-2B（外部审查 P1-5）：客户端 voice_profile_id 与快照 resolved_creative
 * 一致性校验。返回 null = 一致；返回字符串 = 冲突原因。
 * - 快照 fixed：客户端必须携带相同 id（或省略）——不一致即冲突。
 * - 快照 auto：客户端不得携带任何非空显式 id（执行端按 intent 匹配）。
 */
function checkVoiceProfileConflict(
  clientVoiceProfileId: unknown,
  resolvedVoice: ResolvedCreativeVoice,
): string | null {
  const clientId =
    typeof clientVoiceProfileId === "string" && clientVoiceProfileId.length > 0
      ? clientVoiceProfileId
      : null;

  if (resolvedVoice.mode === "fixed") {
    if (clientId !== null && clientId !== resolvedVoice.voice_profile_id) {
      return `client voice_profile_id "${clientId}" conflicts with resolved snapshot voice profile "${resolvedVoice.voice_profile_id}"`;
    }
    return null;
  }

  // auto：客户端显式指定即冲突（快照才是权威；B 起该字段废弃）
  if (clientId !== null) {
    return `client voice_profile_id "${clientId}" conflicts with resolved snapshot voice mode=auto (client field is deprecated)`;
  }
  return null;
}

/**
 * 构建不可变运行快照（2026-08-23：无 quote 绑定，free 形态——quote 相关
 * 字段全部置空/零，满足 RunConfigurationSnapshotV1 免费运行分支约束；
 * snapshot 不提供 update）。
 */
function buildSnapshot(
  db: DbClient,
  project: ProjectRecord,
  resolved: ResolvedGenerationConfigurationV1,
  input: SubmitGenerationInput,
  runId: string,
  now: Date,
): RunConfigurationSnapshotRecord {
  return {
    id: db.generateId(),
    projectId: project.id,
    userId: project.ownerId,
    stage: input.operation === "script.narration.generate" ? "script" : input.operation,
    operation: input.operation,
    runId,
    projectConfigurationRevision: resolved.source_revisions.project_configuration_revision,
    schemaVersion: "resolved_generation_configuration_v1",
    configurationHash: resolved.configuration_hash,
    resolvedConfigurationJson: resolved as unknown as Record<string, unknown>,
    resolutionTraceJson: resolved.resolution_trace as unknown as unknown[],
    quoteId: null,
    quoteFingerprint: null,
    estimatedCostMicros: "0",
    authorizationCostMicros: "0",
    containsUnboundedItem: false,
    budgetLimitMicros: null,
    budgetOverrideAuthorized: false,
    pricingHash: null,
    pricingVersionSetJson: [],
    createdAt: now,
    updatedAt: now,
  };
}
