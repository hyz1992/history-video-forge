import { createAutodlImageToVideoProvider, AUTODL_VIDEO_MODEL } from './providers/autodl/autodl-image-to-video-provider.js';
import { captureNarrationAssetsSource, withNarrationAssetsSource } from "./narration-assets-context.js";
import { importNarrationManifest } from "./narration-manifest-importer.js";
import { characterSheetArtifactMetadata } from "./character-sheet-reference.js";
import { NarrationSourceError } from "../narration/narration-invalidation.js";
import { Prisma } from "../../generated/prisma/client.js";
import { AssetManifestV2, AssetPlan as AssetPlanSchema } from "../../../../shared/src/index.js";
import { checkNarrationExecutionCompatibility, readProjectNarrationContext } from "../narration/narration-execution-compatibility.js";
import type {
  DbClient,
  ProjectRecord,
} from "../../db/client";
import {
  persistProjectRunArtifacts,
} from "../../runtime/trace/project-storage.js";
import type {
  AssetArtifact,
  AssetExecutionOptions,
  AssetManifest,
  AssetPlan,
  ResolvedCapabilityMap,
  ResolvedGenerationConfigurationV1,
} from "../../../../shared/src/index.js";
import {
  AssetArtifact as AssetArtifactSchema,
  AssetExecutionOptions as AssetExecutionOptionsSchema,
  canonicalStringify,
  deterministicHash,
  type GenerationConfigurationV1,
} from "../../../../shared/src/index.js";
import { getProjectGenerationConfiguration } from "../generation-config/generation-config.repository.js";
import { saveAssetManifestRecord } from "./asset-manifest-record.repository";
import { getAssetManifestRecordById } from "./asset-manifest-record.repository";
import { buildInitialAssetManifest } from "./assets-manifest-builder";
import { validateAssetsManifest } from "./assets-local-validator";
import { createAssetProviderRegistry } from "./assets-provider-registry.js";
import type { AssetProviderAdapter } from "./assets-provider-adapter.js";
import { checkProviderDispatchGate, type PaidMediaCapability } from "../generation-cost/provider-dispatch-gate.js";
import { resolveDashscopeDeploymentScope } from "../generation-cost/pricing-catalog.seed.js";
import { executeAssetManifest } from "./assets-execution-engine.js";
import { createFakeTtsProvider } from "./providers/fake-tts-provider.js";
import { createFakeImageProvider } from "./providers/fake-image-provider.js";
import { createLocalSubtitleProvider } from "./providers/local-subtitle-provider.js";
import { createLocalBgmProvider } from "./providers/local-bgm-provider.js";
import { createLocalSfxProvider } from "./providers/local-sfx-provider.js";
import { createDashscopeTtsProvider } from "./providers/dashscope/dashscope-tts-provider.js";
import { createDashscopeImageProvider } from "./providers/dashscope/dashscope-image-provider.js";
import { createDashscopeImageToVideoProvider } from "./providers/dashscope/dashscope-image-to-video-provider.js";
import { configureVoiceProfilePersistence } from "./voice/voice-profile.repository.js";
import { resolveVoiceProfile } from "./voice/voice-resolution.service.js";
import { normalizeAssetPlanTtsForExecution } from "./tts-chunking.service.js";
import { preserveAssetsRunStorage, resolveAssetsRunStorage } from "./assets-file-storage.js";

type AssetsProviderMode = "fake" | "dashscope" | "dashscope_tts";
type DashscopeTtsFormat = "mp3" | "wav" | "flac" | "pcm";

interface DashscopeProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  imageModel?: string;
  imageSize?: string;
  imagePollIntervalMs?: number;
  imageMaxPollAttempts?: number;
  imageToVideoModel?: string;
  imageToVideoResolution?: string;
  imageToVideoDurationSec?: number;
  imageToVideoPollIntervalMs?: number;
  imageToVideoMaxPollAttempts?: number;
  ttsModel?: string;
  ttsFormat?: DashscopeTtsFormat;
  ttsSampleRate?: number;
  asrModel?: string;
}

export interface RunAssetsGenerationInput {
  db: DbClient;
  project: ProjectRecord;
  voiceProfileId: string;
  executionMode: string;
  enabledProviderTypes?: string[];
  /**
   * S2-2B：最终解析字幕样式（快照 resolved_creative.subtitle.resolved_style）。
   * 投影进 manifest execution_options，subtitle provider 写入 artifact metadata，
   * renderer 消费；null/缺省 = 系统默认样式。
   */
  resolvedSubtitleStyle?: unknown;
  /** Only process tasks that are not yet completed/accepted. */
  missingOnly?: boolean;
  /** Only process these specific task IDs. */
  taskIds?: string[];
  /**
   * S2-2A 任务 8：由 GenerationRunService 提交事务预建的 run。
   * 传入时跳过 ensureAssetsGenerationRun（run/snapshot 已由事务创建），
   * runId 即该 run 的 id（恢复执行与事件归属复用同一 run）。
   */
  generationRunId?: string;
  /**
   * S2-2A 任务 9A（终审 I-A 收口）：quote 绑定 run 的授权执行上下文。
   * 提供时 plan/storyboard 按绑定身份执行、视频策略与路线按快照解析结果
   * 执行——授权上界与实际执行范围同源；实例内存中的活动指针不参与。
   */
  boundContext?: {
    assetPlanRecordId?: string;
    storyboardRecordId?: string;
    resolved: ResolvedGenerationConfigurationV1;
  };
  /**
   * S2-2C 任务 6（§6.2）：运行快照冻结的 resolved_capabilities（只读引用）。
   * 提供时 buildProviderRegistry 按快照 model 构造 tts/image/video adapter
   * （auto/fixed 一律）；缺省（免 quote 本地路径）→ env 模型（现状）。
   */
  resolvedCapabilities?: ResolvedCapabilityMap;
}

/**
 * S2-2A 任务 6：判断 route 决策字段是否为"未决策"默认值。
 * 用于局部重试合并时决定是否用旧 route 的决策覆盖新默认值。
 */
function isDefaultRouteDecision(field: string, value: unknown): boolean {
  switch (field) {
    // S2-2A 任务 6 整改：video_strategy 总是本轮配置解析结果（含合法的
    // prefer_remotion），字段缺失才算未决策；避免旧策略覆盖新配置。
    case "video_strategy":
      return value === undefined;
    case "fallback_decision":
      return value === "none";
    case "route_events":
      return Array.isArray(value) && value.length === 0;
    case "notes":
      return Array.isArray(value) && value.length === 0;
    default:
      return value === undefined || value === null || value === "";
  }
}

/**
 * S2-2A 任务 6：为 assets run 建立正式 GenerationRun 与配置快照（幂等）。
 * run event 的 generationRunId 必须指向存在的 GenerationRun（外键约束）。
 */
async function ensureAssetsGenerationRun(input: {
  db: DbClient;
  project: ProjectRecord;
  runId: string;
  configResult: Awaited<ReturnType<typeof getProjectGenerationConfiguration>>;
  segmentIds: string[];
}) {
  const { db, project, runId, configResult, segmentIds } = input;
  // S2-2A 任务 8：run 已由 GenerationRunService 提交事务预建（quote 消费 + snapshot
  // 同事务完成），此处不再创建，保持 run/snapshot 身份唯一。
  if (db.generationRuns.has(runId)) return;

  const snapshot: import("../../db/client.js").RunConfigurationSnapshotRecord = {
    id: db.generateId(),
    projectId: project.id,
    userId: project.ownerId,
    stage: "assets",
    operation: "assets.generate",
    runId,
    projectConfigurationRevision: configResult.revision,
    schemaVersion: configResult.schemaVersion,
    configurationHash: deterministicHash(canonicalStringify(configResult.configuration)),
    resolvedConfigurationJson: configResult.configuration,
    resolutionTraceJson: [],
    quoteId: null,
    quoteFingerprint: null,
    estimatedCostMicros: null,
    authorizationCostMicros: null,
    containsUnboundedItem: false,
    budgetLimitMicros: null,
    budgetOverrideAuthorized: false,
    pricingHash: null,
    pricingVersionSetJson: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const run: import("../../db/client.js").GenerationRunRecord = {
    id: runId,
    projectId: project.id,
    userId: project.ownerId,
    operation: "assets.generate",
    idempotencyKey: runId,
    payloadFingerprint: deterministicHash(canonicalStringify({ segmentIds })),
    quoteId: null,
    runConfigurationSnapshotId: snapshot.id,
    dispatchPayloadJson: { segmentIds },
    status: "running",
    dispatchLeaseOwner: null,
    dispatchLeaseExpiresAt: null,
    dispatchClaimCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  db.runConfigurationSnapshots.set(snapshot.id, snapshot);
  db.generationRuns.set(run.id, run);
  // I 整改：正式 run/snapshot 持久化失败必须阻断派发（Provider 调用前），
  // 否则后续 run event 会因缺少外键父记录而丢失，且无法证明运行来源。
  try {
    if (db.thirdAggregateWriter) {
      await db.thirdAggregateWriter.appendRunConfigurationSnapshot(snapshot);
      await db.thirdAggregateWriter.saveGenerationRun(run);
    }
  } catch (error) {
    db.generationRuns.delete(run.id);
    db.runConfigurationSnapshots.delete(snapshot.id);
    throw new Error(
      `assets_generation_run_persistence_failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * S2-2A 任务 6：追加 append-only run event（不提供 update）。
 * 数据库写入成功后才发布内存事件；持久化失败必须抛错——
 * 正式路线变更事件（route_auto_downgraded / fallback_accepted）丢失时
 * 不得静默继续，调用方据此阻止激活或进入 reconciliation。
 */
export async function appendAssetsRunEvent(input: {
  db: DbClient;
  runId: string;
  eventType: "route_auto_downgraded" | "fallback_accepted";
  segmentId: string | null;
  eventJson: Record<string, unknown>;
}) {
  const { db, runId, eventType, segmentId, eventJson } = input;
  const record: import("../../db/client.js").GenerationRunEventRecord = {
    id: db.generateId(),
    generationRunId: runId,
    eventType,
    segmentId,
    eventJson,
    createdAt: new Date(),
  };
  if (db.thirdAggregateWriter) {
    await db.thirdAggregateWriter.appendGenerationRunEvent(record);
  }
  db.generationRunEvents.set(runId, [...(db.generationRunEvents.get(runId) ?? []), record]);
}

/**
 * S2-2A 任务 6：正式 GenerationRun 状态收尾（succeeded/failed）。
 * throwOnFailure=true（成功路径）：数据库收尾失败必须显式失败，不能把
 * "重启后仍 running" 当成功；false（失败路径）：标记 needs_reconciliation
 * 并警告，避免覆盖原有业务错误。
 */
async function finalizeAssetsGenerationRun(
  db: DbClient,
  runId: string,
  status: "succeeded" | "failed",
  options: { throwOnFailure?: boolean } = {},
) {
  const run = db.generationRuns.get(runId);
  if (!run) return;
  run.status = status;
  run.updatedAt = new Date();
  if (!db.thirdAggregateWriter) return;
  try {
    await db.thirdAggregateWriter.saveGenerationRun(run);
  } catch (error) {
    run.status = "needs_reconciliation";
    if (options.throwOnFailure) {
      throw new Error(
        `assets_generation_run_finalize_failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    console.warn("[assets] generation run finalize failed, marked needs_reconciliation", error);
  }
}

function isRealArtifact(art: Record<string, unknown>): boolean {
  const uri = typeof art.file_uri === "string" ? art.file_uri : "";
  return uri.length > 0 && !uri.startsWith("planned://");
}

function buildTraceSummary(input: {
  runId: string;
  validationDecision: string;
  staleSourceDetected: boolean;
}) {
  const now = new Date().toISOString();
  const steps = [
    {
      step_name: "assets-manifest-build",
      phase: "assets",
      status: "succeeded",
      started_at: now,
      ended_at: now,
      duration_ms: 0,
    },
    {
      step_name: "assets-local-validate",
      phase: "assets",
      status:
        input.validationDecision === "ready_for_compose"
          ? "succeeded"
          : "failed",
      started_at: now,
      ended_at: now,
      duration_ms: 0,
    },
  ];

  if (input.staleSourceDetected) {
    steps.push({
      step_name: "assets-source-recheck",
      phase: "assets",
      status: "failed",
      started_at: now,
      ended_at: now,
      duration_ms: 0,
    });
  }

  return {
    phase: "assets",
    run_id: input.runId,
    nodes: [
      {
        node_name: "assets-manifest-build",
        input_ref: "active-asset-plan:current",
        output_ref: "asset-manifest:candidate",
        failure_reason: null,
      },
      {
        node_name: "assets-local-validate",
        input_ref: "asset-manifest:candidate",
        output_ref: "assets-local-validation:current",
        failure_reason:
          input.validationDecision === "ready_for_compose"
            ? null
            : "assets_local_validation_failed",
      },
      {
        node_name: "assets-source-recheck",
        input_ref: "active-asset-plan:current",
        output_ref: "asset-manifest-activation:current",
        failure_reason: input.staleSourceDetected
          ? "stale_assets_source"
          : null,
      },
    ],
    steps,
  };
}

function buildExecutionOptions(input: {
  executionMode: string;
  voiceProfileId: string;
  enabledProviderTypes?: string[];
  /** S2-2B：最终解析字幕样式（快照投影）；缺省时执行端用系统默认。 */
  subtitleStyle?: unknown;
}) {
  return AssetExecutionOptionsSchema.safeParse({
    execution_mode: input.executionMode,
    voice_profile_id: input.voiceProfileId,
    enabled_provider_types: input.enabledProviderTypes ?? ["tts", "image", "video", "sfx", "bgm"],
    allow_manual_placeholders: false,
    ...(input.subtitleStyle ? { subtitle_style: input.subtitleStyle } : {}),
  });
}

// S2-2A 任务 7 重开：导出供 generation-cost bootstrap 构建媒体支持矩阵
// （目录 readiness 用 env 覆盖后的真实执行模型做精确交叉校验）。只加导出，不改逻辑。
export function readDashscopeConfig(input: DashscopeProviderConfig | undefined) {
  return {
    apiKey: input?.apiKey ?? process.env.ALIYUN_DASHSCOPE_API_KEY ?? "",
    // S2-2A 任务 7 四审（codex I-1）：baseUrl 配置语义统一为 nullish——
    // 显式空字符串（.env 中 ALIYUN_DASHSCOPE_BASE_URL=）归一为 undefined，
    // 使 adapter 的 `?? "https://dashscope.aliyuncs.com"` 默认值生效，
    // 不再拼出相对 /api/v1 路径；bootstrap、gate 与 adapter 消费同一规范化值。
    baseUrl: readOptionalDashscopeBaseUrl(
      input?.baseUrl ?? process.env.ALIYUN_DASHSCOPE_BASE_URL,
    ),
    imageModel:
      input?.imageModel ??
      process.env.ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL ??
      process.env.ALIYUN_DASHSCOPE_MODEL ??
      // 2026-09-22 用户决策：默认生图模型切换为 wan2.7-image（价格与 wan2.6-t2i 持平
      // 0.20 元/张且不按尺寸分档；live check 证实写实度更高且无现代器物污染，
      // 见 docs/records/2026-09-21-asset-character-sheet-live-check.md §3.4 与
      // docs/records/2026-09-22-default-image-model-switch.md）。该模型同时支持
      // 0 图与参考图调用，是角色 sheet 一致性（候选 c）的生效前提。
      "wan2.7-image",
    imageSize: input?.imageSize,
    imagePollIntervalMs: input?.imagePollIntervalMs,
    imageMaxPollAttempts: input?.imageMaxPollAttempts,
    imageToVideoModel:
      input?.imageToVideoModel ??
      process.env.ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_MODEL ??
      "wan2.7-i2v-2026-04-25",
    imageToVideoResolution:
      input?.imageToVideoResolution ??
      process.env.ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_RESOLUTION,
    imageToVideoDurationSec:
      input?.imageToVideoDurationSec ??
      readOptionalNumber(process.env.ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_DURATION_SEC),
    imageToVideoPollIntervalMs:
      input?.imageToVideoPollIntervalMs ??
      readOptionalNumber(process.env.ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_POLL_INTERVAL_MS),
    imageToVideoMaxPollAttempts:
      input?.imageToVideoMaxPollAttempts ??
      readOptionalNumber(process.env.ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_MAX_POLL_ATTEMPTS),
    ttsModel:
      input?.ttsModel ??
      process.env.ALIYUN_DASHSCOPE_TTS_MODEL ??
      process.env.TTS_MODEL ??
      "qwen3-tts-instruct-flash",
    ttsFormat: input?.ttsFormat,
    ttsSampleRate: input?.ttsSampleRate,
    asrModel:
      input?.asrModel ??
      process.env.ALIYUN_DASHSCOPE_ASR_MODEL ??
      "qwen3-asr-flash-filetrans",
  };
}

function readOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** baseUrl 空字符串/纯空白归一为 undefined（adapter 的 nullish 默认值生效）。 */
function readOptionalDashscopeBaseUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

// S2-2A 任务 7 二次重开（codex P1-A）：导出供 gate 相关测试直接构造 registry。
// 真实 DashScope adapter 注册前必须通过权威目录 gate。
export function buildProviderRegistry(input: {
  db: DbClient;
  resolvedCapabilities?: ResolvedCapabilityMap;
}) {
  // S2-2A 任务 6：provider 授权只来自后端 env（API key 存在时启用真实 provider），
  // 客户端不得指定 provider_mode / model / api key。
  const autodlSlot = input.resolvedCapabilities?.['video.image_to_video'];
  const autodlKey = process.env.AUTODL_COMFYUI_TOKEN?.trim();
  const autodlAdapters: AssetProviderAdapter[] = [];
  if (autodlSlot?.provider_key === 'autodl' && autodlSlot.model_id === AUTODL_VIDEO_MODEL && autodlKey) {
    const gate = checkProviderDispatchGate(input.db, {capability:'video.image_to_video',providerKey:'autodl',modelId:autodlSlot.model_id,deploymentScope:'autodl'});
    if (gate.allowed) autodlAdapters.push(createAutodlImageToVideoProvider({apiKey:autodlKey,model:autodlSlot.model_id}));
    else warnDispatchGateBlocked('video.image_to_video',gate);
  }
  const providerMode: AssetsProviderMode | undefined =
    process.env.ALIYUN_DASHSCOPE_API_KEY ? "dashscope" : undefined;
  if (providerMode === "dashscope") {
    const dashscope = readDashscopeConfig(undefined);

    // S2-2A 任务 7 二次重开：真实付费 adapter（tts/image/video）逐个过目录 gate；
    // 未通过的 adapter 不注册——执行引擎 no-adapter 路径保证不创建外部调用、
    // 不 fetch、不建 provider job（视频走策略状态机，其余任务跳过）。
    // 目录由启动 bootstrap 按当前环境物化：demo/test、模型失配、区域未知、
    // 凭据缺失都会在此 fail-closed；目录为空（bootstrap 未运行）同样拒绝。
    // S2-2C 任务 6（§6.2）：resolvedCapabilities 提供时 tts/image/video 一律按
    // 快照冻结的 model_id 构造（auto/fixed 同源，mode 只说明选择来源）；槽位
    // 缺失或 provider_key 非 dashscope → 该 adapter 不注册（no-adapter
    // fail-closed，输出公开原因日志）；resolved 缺省（免 quote 本地路径）→
    // env 模型（现状回归）。
    const snapshotMediaModel = (
      capability: PaidMediaCapability,
      envModel: string,
    ): string | null => {
      if (input.resolvedCapabilities === undefined) return envModel;
      const slot = input.resolvedCapabilities[capability];
      if (!slot) {
        console.warn(
          `[assets-snapshot-binding] capability ${capability} 未在运行快照中解析，禁止注册真实 adapter（快照损坏或合同变更）`,
        );
        return null;
      }
      if (slot.provider_key !== "dashscope") {
        console.warn(
          `[assets-snapshot-binding] capability ${capability} 快照 provider (${slot.provider_key}) 不是 dashscope，该 adapter 不注册`,
        );
        return null;
      }
      return slot.model_id;
    };

    const adapters: AssetProviderAdapter[] = [
      createLocalSubtitleProvider({
        dashscopeApiKey: dashscope.apiKey,
        dashscopeBaseUrl: dashscope.baseUrl,
        dashscopeAsrModel: dashscope.asrModel,
      }),
      createLocalSfxProvider(input.db),
      createLocalBgmProvider(input.db),
    ];

    const ttsModel = snapshotMediaModel("tts.synthesize", dashscope.ttsModel);
    if (ttsModel !== null) {
      const gateTts = checkProviderDispatchGate(input.db, {
        capability: "tts.synthesize",
        providerKey: "dashscope",
        modelId: ttsModel,
        deploymentScope: resolveDashscopeDeploymentScope(dashscope.baseUrl),
      });
      if (gateTts.allowed) {
        adapters.unshift(
          createDashscopeTtsProvider({
            apiKey: dashscope.apiKey,
            baseUrl: dashscope.baseUrl,
            model: ttsModel,
            format: dashscope.ttsFormat,
            sampleRate: dashscope.ttsSampleRate,
            db: input.db,
          }),
        );
      } else {
        warnDispatchGateBlocked("tts.synthesize", gateTts);
      }
    }

    const imageModel = snapshotMediaModel("image.generate", dashscope.imageModel);
    if (imageModel !== null) {
      const gateImage = checkProviderDispatchGate(input.db, {
        capability: "image.generate",
        providerKey: "dashscope",
        modelId: imageModel,
        deploymentScope: resolveDashscopeDeploymentScope(dashscope.baseUrl),
      });
      if (gateImage.allowed) {
        adapters.unshift(
          createDashscopeImageProvider({
            apiKey: dashscope.apiKey,
            baseUrl: dashscope.baseUrl,
            model: imageModel,
            size: dashscope.imageSize,
            pollIntervalMs: dashscope.imagePollIntervalMs,
            maxPollAttempts: dashscope.imageMaxPollAttempts,
          }),
        );
      } else {
        warnDispatchGateBlocked("image.generate", gateImage);
      }
    }

    const videoModel = snapshotMediaModel("video.image_to_video", dashscope.imageToVideoModel);
    if (videoModel !== null) {
      const gateVideo = checkProviderDispatchGate(input.db, {
        capability: "video.image_to_video",
        providerKey: "dashscope",
        modelId: videoModel,
        deploymentScope: resolveDashscopeDeploymentScope(dashscope.baseUrl),
      });
      if (gateVideo.allowed) {
        adapters.unshift(
          createDashscopeImageToVideoProvider({
            apiKey: dashscope.apiKey,
            baseUrl: dashscope.baseUrl,
            model: videoModel,
            resolution: dashscope.imageToVideoResolution,
            durationSec: dashscope.imageToVideoDurationSec,
            pollIntervalMs: dashscope.imageToVideoPollIntervalMs,
            maxPollAttempts: dashscope.imageToVideoMaxPollAttempts,
          }),
        );
      } else {
        warnDispatchGateBlocked("video.image_to_video", gateVideo);
      }
    }

    return createAssetProviderRegistry([...autodlAdapters, ...adapters]);
  }

  return createAssetProviderRegistry([
    ...autodlAdapters,
    createFakeTtsProvider(),
    createLocalSubtitleProvider(),
    createFakeImageProvider(),
    createLocalSfxProvider(input.db),
    createLocalBgmProvider(input.db),
  ]);
}

function warnDispatchGateBlocked(
  capability: string,
  decision:
    | { allowed: true }
    | { allowed: false; reason_code: string; message: string },
): void {
  if (decision.allowed) return;
  // 只输出公开原因码与公开消息，不含密钥/环境变量名。
  console.warn(
    `[assets-dispatch-gate] capability ${capability} 真实派发被目录闸门阻止（${decision.reason_code}）：${decision.message}`,
  );
}

/**
 * 手动上传路径的 artifact 类型白名单。
 * 「只加导出，不改逻辑」：导出供「角色 sheet 的 artifact 类型面」单测直接断言返回值
 *（缺 case 的表现是上传路径拿到 undefined 后抛 TypeError/500，不是类型错误）。
 */
export function allowedArtifactTypesForTask(taskType: AssetPlan["tasks"][number]["task_type"]) {
  switch (taskType) {
    case "tts_audio":
      return ["tts_chunk_audio", "tts_merged_audio"];
    case "image_still":
      return ["image"];
    // 角色 sheet 的产物类型与手动上传类型都与分镜图一致（设计 §3.1：artifact_type 仍为 image）。
    // 缺此 case 时手动上传路径会取到 undefined 并抛 TypeError/500（设计 §3.7 第 4 项）。
    case "character_sheet":
      return ["image"];
    case "video_clip":
      return ["video"];
    case "subtitle_track":
      return ["subtitle_track"];
    case "sfx_cue":
      return ["sfx_audio", "sfx_selection"];
    case "bgm_cue":
      return ["bgm_audio", "bgm_selection"];
    case "render_motion_cue":
      return ["motion_recipe"];
  }
}

function applyArtifactToManifestRoutes(input: {
  manifest: AssetManifest;
  planTask: AssetPlan["tasks"][number];
  artifact: AssetArtifact;
}) {
  const { manifest, planTask, artifact } = input;

  if (artifact.artifact_type === "subtitle_track") {
    manifest.audio_summary.subtitle_artifact_id = artifact.artifact_id;
    for (const route of manifest.segment_routes) {
      route.subtitle_artifact_id = artifact.artifact_id;
    }
    return;
  }

  if (artifact.artifact_type === "tts_merged_audio") {
    manifest.audio_summary.tts_merged_artifact_id = artifact.artifact_id;
    return;
  }

  if (artifact.artifact_type === "tts_chunk_audio") {
    const chunkId = artifact.metadata.tts_chunk_id;
    const segmentIds = artifact.metadata.segment_ids;
    const chunkRoute = manifest.audio_summary.tts_chunk_routes.find(
      (route) => route.tts_chunk_id === chunkId,
    );
    if (chunkRoute) {
      chunkRoute.artifact_id = artifact.artifact_id;
    }
    for (const segmentId of segmentIds) {
      const route = manifest.segment_routes.find(
        (item) => item.segment_id === segmentId,
      );
      if (route) {
        route.tts_artifact_id = artifact.artifact_id;
      }
    }
    if (!manifest.audio_summary.tts_chunk_artifact_ids.includes(artifact.artifact_id)) {
      manifest.audio_summary.tts_chunk_artifact_ids.push(artifact.artifact_id);
    }
    return;
  }

  if (artifact.artifact_type === "sfx_audio" || artifact.artifact_type === "sfx_selection") {
    if (!manifest.audio_summary.sfx_artifact_ids.includes(artifact.artifact_id)) {
      manifest.audio_summary.sfx_artifact_ids.push(artifact.artifact_id);
    }
    if (planTask.source_segment_id) {
      const route = manifest.segment_routes.find(
        (item) => item.segment_id === planTask.source_segment_id,
      );
      if (route && !route.sfx_artifact_ids.includes(artifact.artifact_id)) {
        route.sfx_artifact_ids.push(artifact.artifact_id);
      }
    }
    return;
  }

  if (artifact.artifact_type === "bgm_audio" || artifact.artifact_type === "bgm_selection") {
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
    return;
  }

  if (!planTask.source_segment_id) {
    return;
  }

  const route = manifest.segment_routes.find(
    (item) => item.segment_id === planTask.source_segment_id,
  );
  if (!route) {
    return;
  }

  if (artifact.artifact_type === "image") {
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
  }

  if (artifact.artifact_type === "video") {
    route.primary_visual_artifact_id = artifact.artifact_id;
    route.visual_route_type = "video_clip";
    route.readiness = "ready";
  }

  if (artifact.artifact_type === "motion_recipe") {
    route.motion_artifact_id = artifact.artifact_id;
    if (route.primary_visual_artifact_id) {
      route.visual_route_type = "image_with_motion";
      route.readiness = "ready";
    }
  }
}

export async function runAssetsGeneration(input: RunAssetsGenerationInput) {
  const { db, project } = input;
  const currentMode = await readProjectNarrationContext(db, project.id, project.ownerId);
  const narrationContext = currentMode.mode === "narration_first_v1" ? await captureNarrationAssetsSource(db, project.id, project.ownerId) : null;
  const checkNarrationSource = narrationContext ? () => withNarrationAssetsSource(db, project.id, project.ownerId, narrationContext.identity, () => undefined) : undefined;
  const frozenTts = narrationContext ? undefined : input.resolvedCapabilities?.["tts.synthesize"];
  const compatibility = checkNarrationExecutionCompatibility({
    catalog: db.providerModelCatalog.values(),
    operation: "assets.generate",
    projectMode: project.narrationTimingMode,
    modelId: frozenTts?.model_id,
    providerKey: frozenTts?.provider_key,
  });
  if (!compatibility.compatible) {
    return { statusCode: 422, body: { error: compatibility.code, reason: compatibility.reason } };
  }
  const previousActiveAssetManifestRecordId = project.activeAssetManifestRecordId;
  if (!db.voiceProfilePersistence.enabled) {
    const voiceRoot = process.env.VITEST
      ? process.env.STORAGE_ROOT_DIR
      : project.storageRootDir;
    if (voiceRoot?.trim()) {
      configureVoiceProfilePersistence(db, { rootDir: voiceRoot });
    }
  }

  // Step 1: Check project has active asset plan。
  // 9A 步骤 2（终审 I-A）：绑定 run 优先使用授权时绑定的 plan 身份；
  // 绑定 run 无绑定 plan（纯 LLM 运行）同样拒绝——回退活动指针会让纯 LLM
  // 运行放行未授权媒体派发（diff 审查 I2）。非绑定运行保持活动指针语义。
  // 2026-08-23（报价体系移除）：无 plan 统一返回 active_asset_plan_missing。
  const capturedAssetPlanRecordId =
    input.boundContext !== undefined
      ? input.boundContext.assetPlanRecordId
      : narrationContext?.planRecord.id ?? project.activeAssetPlanRecordId;
  if (!capturedAssetPlanRecordId) {
    return {
      statusCode: 409,
      body: { error: "active_asset_plan_missing", message: "本次运行未绑定资产规划（无可用 plan）；无法执行媒体生成" },
    };
  }

  // Step 2: Get the active asset plan record
  if (narrationContext && capturedAssetPlanRecordId !== narrationContext.planRecord.id) throw new NarrationSourceError("narration_assets_source_stale");
  const assetPlanRecord = narrationContext?.planRecord ?? db.assetPlanRecords.get(capturedAssetPlanRecordId);
  if (!assetPlanRecord) {
    return {
      statusCode: 404,
      body: {
        error: "asset_plan_record_not_found",
      },
    };
  }

  // Step 3: Get storyboard record to extract segment IDs。
  // 绑定 storyboard 优先（授权计价用的同一 storyboard）；未绑定时回退 plan 关联。
  const storyboardRecord = narrationContext ? { id: narrationContext.planRecord.storyboardRecordId, planJson: narrationContext.storyboardPlan } :
    (input.boundContext?.storyboardRecordId
      ? db.storyboardRecords.get(input.boundContext.storyboardRecordId)
      : undefined) ??
    db.storyboardRecords.get(assetPlanRecord.storyboardRecordId);
  if (!storyboardRecord) {
    return {
      statusCode: 404,
      body: {
        error: "storyboard_record_not_found",
      },
    };
  }

  // Extract segment IDs from storyboard plan
  const storyboardPlan = storyboardRecord.planJson as { segments?: Array<{ segment_id: string }> };
  const segmentIds = storyboardPlan.segments?.map((s) => s.segment_id) ?? [];
  const normalizedTts = narrationContext ? { assetPlan: narrationContext.assetPlan, ttsChunkRoutes: [] } : normalizeAssetPlanTtsForExecution({
    assetPlan: AssetPlanSchema.parse(assetPlanRecord.planJson),
    segmentIds,
  });

  // Step 4: Resolve local global voice profile before manifest build
  // S2-2B：以项目 owner 限定音色库可见性（公共 + 本人私有，详细设计 §6.4）
  const voiceResolution = narrationContext ? { voiceProfileId: narrationContext.record.settings.voice } : await resolveVoiceProfile({
    db,
    requestedVoiceProfileId: input.voiceProfileId,
    assetPlan: normalizedTts.assetPlan,
    ownerId: project.ownerId,
  });

  // Write resolved voice profile ID back to the asset plan
  if (normalizedTts.assetPlan.plan_version === "asset_plan_v1" && voiceResolution.voiceProfileId && voiceResolution.voiceProfileId !== (normalizedTts.assetPlan.tts_plan as Record<string, unknown>)?.voice_profile_id) {
    (normalizedTts.assetPlan.tts_plan as Record<string, unknown>).voice_profile_id = voiceResolution.voiceProfileId;
  }

  // Step 5: Build execution options from resolved voice profile
  const executionOptionsResult = buildExecutionOptions({
    executionMode: input.executionMode,
    voiceProfileId: voiceResolution.voiceProfileId,
    enabledProviderTypes: input.enabledProviderTypes,
    subtitleStyle: input.resolvedSubtitleStyle,
  });
  if (!executionOptionsResult.success) {
    return {
      statusCode: 422,
      body: {
        error: "assets_execution_options_invalid",
      },
    };
  }
  let executionOptions = executionOptionsResult.data;

  // Step 6: Build manifest
  let manifest: AssetManifest = narrationContext ? await importNarrationManifest({ assetPlanRecordId: assetPlanRecord.id, assetPlan: narrationContext.assetPlan, storyboard: narrationContext.storyboardPlan, record: narrationContext.record, revision: narrationContext.revision, storageRootDir: project.storageRootDir, executionOptions }) : buildInitialAssetManifest({
    assetPlanRecordId: assetPlanRecord.id,
    assetPlan: normalizedTts.assetPlan,
    segmentIds,
    ttsChunkRoutes: normalizedTts.ttsChunkRoutes,
    executionOptions,
  });

  executionOptions = manifest.execution_options;
  await checkNarrationSource?.();

  // Step 6a-0: S2-2A 任务 6——解析项目视频策略并写入每条 route。
  // 策略是项目冻结配置（客户端不可覆盖），决定 API 视频失败时严格阻塞或自动降级。
  // 9A 步骤 2（终审 I-A）：quote 绑定 run 一律用快照解析结果（授权同源），
  // 不再按当前项目配置重解析——提交后配置漂移不改变已授权运行的执行语义。
  let videoStrategy: ResolvedGenerationConfigurationV1["effective"]["video"]["strategy"];
  // 绑定 run 无需当前项目配置（快照为权威）；free run 仍按项目配置解析，
  // configResult 同时供 ensureAssetsGenerationRun（free run 快照）使用。
  let configResult: Awaited<ReturnType<typeof getProjectGenerationConfiguration>> | null = null;
  if (input.boundContext) {
    videoStrategy = input.boundContext.resolved.effective.video.strategy;
  } else {
    try {
      configResult = await getProjectGenerationConfiguration(
        db,
        project.id,
        project.ownerId,
      );
    } catch {
      return {
        statusCode: 500,
        body: { error: "assets_video_strategy_resolution_failed" },
      };
    }
    videoStrategy = configResult.configuration.video.strategy;
  }
  for (const route of manifest.segment_routes) {
    route.video_strategy = videoStrategy;
  }
  // 9A 步骤 2（终审 I-A）：绑定 run 的路线按快照解析结果收敛——快照未授权
  // api_video 的段不得以 video_clip 路线执行（授权上界=执行范围）。
  // 收敛同时把该段 video_clip execution 置为跳过：引擎按终态跳过，
  // 不创建 provider job、不产生外部调用（非绑定 run 的升级路径不受影响）。
  if (input.boundContext) {
    const authorizedRoutes = new Map(
      input.boundContext.resolved.segment_visual_routes.map(
        (route) => [route.segment_id, route.resolved_route] as const,
      ),
    );
    const planTasksBySegment = new Map<string, string[]>();
    for (const task of (assetPlanRecord.planJson as { tasks?: Array<{ task_id?: string; task_type?: string; source_segment_id?: string | null }> }).tasks ?? []) {
      if (!task.task_id) continue;
      const list = planTasksBySegment.get(task.source_segment_id ?? "") ?? [];
      list.push(task.task_id);
      planTasksBySegment.set(task.source_segment_id ?? "", list);
    }
    for (const route of manifest.segment_routes) {
      const authorized = authorizedRoutes.get(route.segment_id);
      if (route.visual_route_type === "video_clip" && authorized !== "api_video") {
        route.visual_route_type = "image_with_motion";
        const videoTaskIds = new Set(planTasksBySegment.get(route.segment_id) ?? []);
        for (const execution of manifest.executions) {
          if (execution.task_type !== "video_clip") continue;
          if (!videoTaskIds.has(execution.task_id)) continue;
          execution.status = "skipped_with_fallback";
          execution.notes = [
            ...execution.notes,
            "[strategy] 段路线未授权 api_video（快照解析路线），跳过视频执行",
          ];
        }
      }
    }
  }

  // Step 6a: For missing_only / task_ids modes, load the existing manifest
  // so we can merge new results into it rather than replacing everything.
  let existingManifest: Record<string, unknown> | null = null;
  if (input.missingOnly || (input.taskIds && input.taskIds.length > 0)) {
    const retryManifestId = narrationContext?.project.activeAssetManifestRecordId ?? project.activeAssetManifestRecordId;
    if (retryManifestId) {
      const existingRecord = narrationContext ? narrationContext.activeManifest : db.assetManifestRecords.get(retryManifestId);
      if (existingRecord) {
        existingManifest = existingRecord.manifestJson as Record<string, unknown>;
        if (narrationContext) {
          const parsed = AssetManifestV2.safeParse(existingManifest);
          if (!parsed.success || parsed.data.source_asset_plan_id !== assetPlanRecord.id || canonicalStringify(parsed.data.narration_reference) !== canonicalStringify(narrationContext.assetPlan.narration_reference) || parsed.data.subtitle_revision_id !== narrationContext.revision.id || parsed.data.subtitle_settings_hash !== narrationContext.revision.subtitleSettingsHash) existingManifest = null;
        }
      }
    }
  }

  // Step 6b: Determine which tasks to actually execute in this run.
  const taskIdSet = input.taskIds ? new Set(input.taskIds) : null;

  // S2-2A 任务 6 整改：在 executions 过滤前注入旧 producer executions 的产出证据。
  // 局部重试时 image_still / render_motion_cue 的新 executions 是 planned 且无
  // output（本轮不重跑它们），但 fallback 决策的 producer 绑定依赖这些证据。
  if (existingManifest && taskIdSet) {
    const oldExecutions = (Array.isArray(existingManifest.executions) ? existingManifest.executions : []) as Array<Record<string, unknown>>;
    for (const exec of manifest.executions) {
      if (exec.task_type !== "image_still" && exec.task_type !== "render_motion_cue") continue;
      if (exec.output_artifact_ids.length > 0) continue;
      const oldExec = oldExecutions.find((candidate) => candidate.task_id === exec.task_id);
      if (!oldExec) continue;
      exec.status = (oldExec.status as AssetManifest["executions"][number]["status"]) ?? exec.status;
      exec.completed_at = (oldExec.completed_at as string | null) ?? exec.completed_at;
      exec.output_artifact_ids = [
        ...new Set([...(oldExec.output_artifact_ids as string[] ?? []), ...exec.output_artifact_ids]),
      ];
    }
  }
  if (input.missingOnly || taskIdSet) {
    const existingCompletedIds = new Set<string>();
    if (existingManifest) {
      const existingExecs = existingManifest.executions;
      if (Array.isArray(existingExecs)) {
        for (const exec of existingExecs) {
          if (exec && typeof exec === "object") {
            const s = (exec as Record<string, unknown>).status;
            if (s === "completed" || s === "accepted") {
              existingCompletedIds.add((exec as Record<string, unknown>).task_id as string);
            }
          }
        }
      }
    }

    manifest.executions = manifest.executions.filter((exec) => {
      // 显式请求的任务总是执行，不因之前已完成而跳过
      if (taskIdSet?.has(exec.task_id)) return true;
      // S2-2A 任务 6 整改：保留目标段 image_still / render_motion_cue 的
      // producer executions（含旧产出证据），维持 fallback 决策的绑定链。
      if (taskIdSet) {
        const planTask = (normalizedTts.assetPlan.tasks ?? []).find(
          (task) => task.task_id === exec.task_id,
        );
        if (
          planTask?.source_segment_id &&
          (planTask.task_type === "image_still" ||
            planTask.task_type === "render_motion_cue") &&
          [...taskIdSet].some((taskId) => {
            const target = (normalizedTts.assetPlan.tasks ?? []).find(
              (task) => task.task_id === taskId,
            );
            return target?.source_segment_id === planTask.source_segment_id;
          })
        ) {
          return true;
        }
      }
      if (existingCompletedIds.has(exec.task_id)) return false;
      if (taskIdSet) return false;
      return true;
    });
  }

  // Step 6b-ii: Before executing the filtered manifest, inject the old
  // manifest's artifacts, segment routes, and audio summary so that
  // dependency lookups (e.g. video_clip finding source image by segment)
  // work during provider execution.
  if (existingManifest) {
    const oldArtifacts = (Array.isArray(existingManifest.artifacts) ? existingManifest.artifacts : []) as Record<string, unknown>[];
    const oldRoutes = (Array.isArray(existingManifest.segment_routes) ? existingManifest.segment_routes : []) as Record<string, unknown>[];
    const oldAudio = (existingManifest.audio_summary ?? {}) as Record<string, unknown>;

    // Inject old artifacts that aren't already in the new manifest
    const newArtifactIds = new Set(manifest.artifacts.map(a => a.artifact_id));
    for (const a of oldArtifacts) {
      if (!newArtifactIds.has(a.artifact_id as string)) {
        manifest.artifacts.push(a as unknown as typeof manifest.artifacts[number]);
      }
    }


    // Merge old routes into the working manifest so dependency lookups
    // (e.g. video_clip finding source image by segment) work.
    // For segments NOT in the new manifest, add the whole old route.
    // For segments in BOTH, inject old visual-dependency fields so the
    // fresh (empty) route has source image/video references.
    const DEPENDENCY_ROUTE_FIELDS = new Set([
      "primary_visual_artifact_id", "fallback_visual_artifact_id",
      "motion_artifact_id", "image_artifact_id", "video_artifact_id",
    ]);
    // S2-2A 任务 6 整改：策略决策字段同样参与合并。新 route 是 builder 默认值时
    // （本轮未触碰该段/未产生新决策）保留旧 route 的决策与诊断，避免局部重试丢失。
    const STRATEGY_DECISION_FIELDS = new Set([
      "video_strategy", "fallback_decision", "route_events", "notes",
    ]);

    const existingNewRoutes = (Array.isArray((manifest as Record<string, unknown>).segment_routes)
      ? (manifest as Record<string, unknown>).segment_routes as Record<string, unknown>[]
      : []) as Record<string, unknown>[];
    const newRouteBySeg = new Map<string, Record<string, unknown>>();
    for (const r of existingNewRoutes) {
      const sid = r.segment_id as string | undefined;
      if (sid) newRouteBySeg.set(sid, r);
    }

    const mergedPreRoutes: Record<string, unknown>[] = [];
    const seenSegs = new Set<string>();

    for (const newRoute of existingNewRoutes) {
      const sid = newRoute.segment_id as string;
      const oldRoute = oldRoutes.find(r => r.segment_id === sid);
      if (oldRoute) {
        // Same segment exists in old manifest — inject dependency fields.
        const merged = { ...newRoute };
        for (const field of DEPENDENCY_ROUTE_FIELDS) {
          const oldVal = (oldRoute as Record<string, unknown>)[field];
          const newVal = (merged as Record<string, unknown>)[field];
          // Fill null / empty / undefined values from the old route.
          if (oldVal != null && oldVal !== "" && (newVal == null || newVal === "")) {
            (merged as Record<string, unknown>)[field] = oldVal;
          }
        }
        // 决策字段：新值为默认（未决策）时保留旧值；新值已有决策则不覆盖。
        for (const field of STRATEGY_DECISION_FIELDS) {
          const oldVal = (oldRoute as Record<string, unknown>)[field];
          const newVal = (merged as Record<string, unknown>)[field];
          if (isDefaultRouteDecision(field, newVal) && !isDefaultRouteDecision(field, oldVal)) {
            (merged as Record<string, unknown>)[field] = oldVal;
          }
        }
        mergedPreRoutes.push(merged);
      } else {
        mergedPreRoutes.push(newRoute);
      }
      seenSegs.add(sid);
    }

    // Add old routes for segments not in the new manifest at all.
    for (const r of oldRoutes) {
      if (!seenSegs.has(r.segment_id as string)) {
        mergedPreRoutes.push(r);
      }
    }

    (manifest as Record<string, unknown>).segment_routes = mergedPreRoutes;

    // Inject old audio summary as fallback context.
    // The initial manifest may have audio_summary present but with many
    // null fields. Merge the old values when new ones are missing.
    const currentAudio = (manifest as Record<string, unknown>).audio_summary as Record<string, unknown> | null | undefined;
    if (!currentAudio) {
      (manifest as Record<string, unknown>).audio_summary = oldAudio;
    } else {
      for (const [key, value] of Object.entries(oldAudio)) {
        if (
          (currentAudio[key] === null || currentAudio[key] === undefined) &&
          value !== null &&
          value !== undefined
        ) {
          currentAudio[key] = value;
        }
      }
    }
  }

  // Step 6c: Execution engine integration
  const runId = input.generationRunId ?? `assets_run_${db.generateId()}`;
  const runStorage = resolveAssetsRunStorage({
    projectStorageRootDir: project.storageRootDir,
    runId,
  });

  // S2-2A 任务 6 整改：建立正式 GenerationRun + 配置快照，供 append-only
  // run event（automatic_fallback / fallback_accepted）引用。
  await ensureAssetsGenerationRun({
    db,
    project,
    runId,
    // 绑定 run：run 已存在，ensure 提前返回不解引用；free run：上方已解析非空
    configResult: configResult!,
    segmentIds,
  });

  // I2 整改：run 创建后的整个流程共享失败收尾——
  // 任何异常（generating 保存、临时 manifest 保存、engine、校验、激活）都
  // 必须把正式 GenerationRun 收尾为 failed，不能遗留 running。
  try {
  let executionManifestRecordId: string | null = null;

  // Set active pointer BEFORE execution so refresh during generation shows status
  const generatingManifestRecord = await saveAssetManifestRecord(db, {
    projectId: project.id,
    topicPackageId: assetPlanRecord.topicPackageId,
    scriptRecordId: assetPlanRecord.scriptRecordId,
    storyboardRecordId: assetPlanRecord.storyboardRecordId,
    assetPlanRecordId: assetPlanRecord.id,
    manifestJson: manifest,
    validationResultJson: { stage: "assets_local_validation", decision: "generating", errors: [], warnings: [], metrics: {} },
    executionStateJson: { generating: true, run_id: runId, activated: false },
    graphTraceSummaryJson: null,
    runtimeDiagnosticsJson: null,
  });
  if (!narrationContext) {
    project.status = "assets_generating";
    await db.firstAggregateWriter?.syncProject(project);
  }

  if (executionOptions.execution_mode === "dry_run") {
    if (!narrationContext) manifest.artifacts = [];
  } else if (executionOptions.execution_mode === "auto_available") {
    const registry = buildProviderRegistry({
      db,
      resolvedCapabilities: input.resolvedCapabilities,
    });

    const tempManifestRecord = await saveAssetManifestRecord(db, {
      projectId: project.id,
      topicPackageId: assetPlanRecord.topicPackageId,
      scriptRecordId: assetPlanRecord.scriptRecordId,
      storyboardRecordId: assetPlanRecord.storyboardRecordId,
      assetPlanRecordId: assetPlanRecord.id,
      manifestJson: manifest,
      validationResultJson: { stage: "assets_local_validation", decision: "generating", errors: [], warnings: [], metrics: {} },
      executionStateJson: { generating: true, run_id: runId, execution_staging: true, activated: false },
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
    });
    executionManifestRecordId = tempManifestRecord.id;
    const engineResult = await executeAssetManifest({
      db,
      assetManifestRecordId: tempManifestRecord.id,
      beforeDispatch: checkNarrationSource,
      assetRunId: runId,
      manifest,
      registry,
      assetPlan: normalizedTts.assetPlan,
      projectStorageRootDir: project.storageRootDir,
    });

    manifest = engineResult.manifest;
  }

  // Step 6d: Merge new results into the existing manifest at the
  // field and task level.  Visual fields update for touched segments;
  // audio / subtitle / SFX / BGM references are preserved from the
  // old manifest unless their provider tasks were actually re-executed.
  if (existingManifest) {
    const oldExecs = (Array.isArray(existingManifest.executions) ? existingManifest.executions : []) as Record<string, unknown>[];
    const oldArtifacts = (Array.isArray(existingManifest.artifacts) ? existingManifest.artifacts : []) as Record<string, unknown>[];
    const oldRoutes = (Array.isArray(existingManifest.segment_routes) ? existingManifest.segment_routes : []) as Record<string, unknown>[];
    const oldAudio = (existingManifest.audio_summary ?? {}) as Record<string, unknown>;
    const newExecTaskIds = new Set(manifest.executions.map(e => e.task_id));
    const newArtifactIds = new Set(manifest.artifacts.map(a => a.artifact_id));

    // Map: task_id → source_segment_id and task_type (segment tasks only)
    // Separate: task_id → task_type for ALL tasks (including global tts/subtitle)
    const planTasks = (normalizedTts.assetPlan.tasks ?? []) as Array<{
      task_id: string; source_segment_id: string | null; task_type: string;
    }>;
    const taskMeta = new Map<string, { segId: string; type: string }>();
    const taskTypeById = new Map<string, string>();
    for (const t of planTasks) {
      taskTypeById.set(t.task_id, t.task_type);
      if (t.source_segment_id) taskMeta.set(t.task_id, { segId: t.source_segment_id, type: t.task_type });
    }

    // Which segments and task types were touched by this run?
    const touchedSegments = new Set<string>();
    const touchedTaskTypes = new Set<string>();
    for (const tid of newExecTaskIds) {
      const meta = taskMeta.get(tid);
      if (meta) touchedSegments.add(meta.segId);
      // Always record the touched task type, even for global tasks (tts/subtitle)
      const ttype = taskTypeById.get(tid);
      if (ttype) touchedTaskTypes.add(ttype);
    }

    // ---- segment_routes: field-level merge for touched segments ----
    const VISUAL_ROUTE_FIELDS = new Set([
      "primary_visual_artifact_id", "visual_route_type",
      "image_route", "video_route", "readiness",
      "fallback_visual_artifact_id",
    ]);
    const oldRouteBySegment = new Map<string, Record<string, unknown>>();
    for (const r of oldRoutes) {
      const sid = r.segment_id as string | undefined;
      if (sid) oldRouteBySegment.set(sid, r);
    }

    const newRoutes = (Array.isArray((manifest as Record<string, unknown>).segment_routes)
      ? (manifest as Record<string, unknown>).segment_routes as Record<string, unknown>[]
      : []) as Record<string, unknown>[];
    const mergedRoutes: Record<string, unknown>[] = [];

    for (const newRoute of newRoutes) {
      const sid = newRoute.segment_id as string | undefined;
      const oldRoute = sid ? oldRouteBySegment.get(sid) : undefined;

      if (!oldRoute || !touchedSegments.has(sid!)) {
        // Untouched segment: keep old route, or use new if no old exists.
        mergedRoutes.push(oldRoute ?? newRoute);
      } else {
        // Touched segment: visual fields from new, everything else from old.
        const merged: Record<string, unknown> = { ...oldRoute };

        // Only switch to video_clip if a video artifact was actually produced
        // by this run.  Otherwise keep the old visual_route_type (image_with_motion).
        const newRouteType = newRoute.visual_route_type as string | undefined;
        if (newRouteType === "video_clip") {
          const hasNewVideoArtifact = manifest.artifacts.some(
            a => a.artifact_type === "video" && newExecTaskIds.has(
              // Find which execution produced this artifact
              manifest.executions.find(e => e.output_artifact_ids.includes(a.artifact_id))?.task_id ?? "",
            ),
          );
          if (hasNewVideoArtifact) {
            merged.visual_route_type = "video_clip";
          }
          // else: keep old visual_route_type (image_with_motion)
        } else {
          merged.visual_route_type = newRouteType ?? merged.visual_route_type;
        }

        for (const [key, value] of Object.entries(newRoute)) {
          if (VISUAL_ROUTE_FIELDS.has(key) || !(key in merged)) {
            // Skip visual_route_type — already handled above
            if (key === "visual_route_type") continue;
            merged[key] = value;
          }
        }
        // S2-2A 任务 6 整改：touched 段的策略决策字段以本轮新决策为准
        // （非默认值时覆盖旧值，避免视频重试产生的新 fallback 决策丢失）。
        for (const field of ["video_strategy", "fallback_decision", "route_events", "notes"] as const) {
          const newVal = newRoute[field];
          if (!isDefaultRouteDecision(field, newVal)) merged[field] = newVal;
        }
        mergedRoutes.push(merged);
      }
    }

    // ---- executions: old untouched + new touched ----
    const replacedVideoArtifactIds = new Set<string>();
    const oldExecByTaskId = new Map<string, Record<string, unknown>>();
    for (const e of oldExecs) {
      const tid = e.task_id as string | undefined;
      if (tid) oldExecByTaskId.set(tid, e);
    }
    const mergedExecs: Record<string, unknown>[] = [
      ...oldExecs.filter(e => !newExecTaskIds.has(e.task_id as string)),
    ];
    for (const newExec of manifest.executions) {
      const oldExec = oldExecByTaskId.get(newExec.task_id);
      if (oldExec) {
        const oldIds = (Array.isArray(oldExec.output_artifact_ids) ? oldExec.output_artifact_ids : []) as string[];
        const newIds = (Array.isArray(newExec.output_artifact_ids) ? newExec.output_artifact_ids : []) as string[];
        const replacesVideo = !!narrationContext && newExec.task_type === "video_clip" && newIds.length > 0;
        if (replacesVideo) for (const id of oldIds) if (!newIds.includes(id)) replacedVideoArtifactIds.add(id);
        // 角色定妆图的 output_artifact_ids[0] 是当前选择：本轮成功重生成后，
        // 新图必须成为当前件，同时保留旧图供手动改选。失败/跳过则保留原选择。
        const selectsNewSheet = newExec.task_type === "character_sheet" &&
          newExec.status === "completed" && newIds.length > 0;
        const mergedIds = [...new Set(
          replacesVideo ? newIds : selectsNewSheet ? [...newIds, ...oldIds] : [...oldIds, ...newIds],
        )];
        (newExec as Record<string, unknown>).output_artifact_ids = mergedIds;
      }
      mergedExecs.push(newExec as unknown as Record<string, unknown>);
    }

    // ---- artifacts: prefer old when it has a real file_uri ----
    const oldArtById = new Map<string, Record<string, unknown>>();
    for (const a of oldArtifacts) {
      oldArtById.set(a.artifact_id as string, a);
    }
    const mergedArtifacts = [
      ...oldArtifacts.filter(a => !newArtifactIds.has(a.artifact_id as string) && !replacedVideoArtifactIds.has(a.artifact_id as string)),
    ];
    for (const newArt of manifest.artifacts) {
      if (replacedVideoArtifactIds.has(newArt.artifact_id)) continue;
      const oldArt = oldArtById.get(newArt.artifact_id as string);
      if (oldArt && isRealArtifact(oldArt) && !isRealArtifact(newArt as Record<string, unknown>)) {
        // Old artifact has a real file; new one is a planned placeholder — keep old.
        mergedArtifacts.push(oldArt);
      } else {
        mergedArtifacts.push(newArt as unknown as Record<string, unknown>);
      }
    }

    // ---- audio_summary: field-level merge based on touched task types ----
    const newAudio = ((manifest as Record<string, unknown>).audio_summary ?? {}) as Record<string, unknown>;
    const AUDIO_FIELDS_BY_TASK_TYPE: Record<string, string[]> = {
      tts_audio: ["tts_merged_artifact_id", "tts_total_duration_sec", "tts_chunk_artifact_ids", "tts_chunk_routes"],
      subtitle_track: ["subtitle_artifact_id"],
      bgm_cue: ["bgm_placements"],
      sfx_cue: ["sfx_artifact_ids"],
    };
    const mergedAudio: Record<string, unknown> = { ...oldAudio };
    for (const [taskType, fields] of Object.entries(AUDIO_FIELDS_BY_TASK_TYPE)) {
      if (touchedTaskTypes.has(taskType)) {
        for (const f of fields) {
          if (f in newAudio) mergedAudio[f] = newAudio[f];
        }
      }
    }
    // For untouched audio fields, keep old values (already in mergedAudio from spread).

    manifest.executions = mergedExecs as typeof manifest.executions;
    manifest.artifacts = mergedArtifacts as typeof manifest.artifacts;
    (manifest as Record<string, unknown>).segment_routes = mergedRoutes;
    (manifest as Record<string, unknown>).audio_summary = mergedAudio;
  }

  await checkNarrationSource?.();
  if (narrationContext) AssetManifestV2.parse(manifest);

  // Step 7: Validate manifest (after engine execution for auto_available)
  const localValidation = await validateAssetsManifest({
    assetPlanRecordId: assetPlanRecord.id,
    storyboardRecordId: assetPlanRecord.storyboardRecordId,
    scriptRecordId: assetPlanRecord.scriptRecordId,
    topicPackageId: assetPlanRecord.topicPackageId,
    assetPlan: normalizedTts.assetPlan,
    manifest,
    projectStorageRootDir: project.storageRootDir,
  });
  manifest.readiness = localValidation.decision;

  // Step 8: Stale check — verify activeAssetPlanRecordId hasn't changed
  let staleSourceDetected = false;
  if (!narrationContext && project.activeAssetPlanRecordId !== capturedAssetPlanRecordId) {
    staleSourceDetected = true;
  }

  if (staleSourceDetected) {
    await preserveAssetsRunStorage(runStorage).catch(() => undefined);
    // Clean up generating state — delete placeholder record, don't leave dirty state
    db.assetManifestRecords.delete(generatingManifestRecord.id);
    project.activeAssetManifestRecordId = previousActiveAssetManifestRecordId;
    project.status = "asset_plan_ready";
    project.updatedAt = new Date();
    await db.firstAggregateWriter?.syncProject(project);
    // C3 整改：stale-source 是失败出口，正式 run 必须收尾
    await finalizeAssetsGenerationRun(db, runId, "failed");
    const traceSummary = buildTraceSummary({
      runId,
      validationDecision: localValidation.decision,
      staleSourceDetected: true,
    });

    return {
      statusCode: 409,
      body: {
        error: "stale_assets_source",
        project_id: project.id,
        source_asset_plan_record_id: capturedAssetPlanRecordId,
        manifest,
        local_validation: localValidation,
        execution_state: {
          ...executionOptions,
          activated: false,
        },
        graph_trace_summary: traceSummary,
        runtime_diagnostics: null,
      },
    };
  }

  // Step 9: Create and save manifest record
  // S2-2A 任务 6 整改：保留 run_id，accept-fallback 依赖它校验当前运行。
  const executionState = {
    execution_mode: executionOptions.execution_mode,
    voice_profile_id: executionOptions.voice_profile_id,
    run_id: runId,
    activated: !narrationContext,
  };

  const traceSummary = buildTraceSummary({
    runId,
    validationDecision: localValidation.decision,
    staleSourceDetected: false,
  });

  let assetManifestRecord;
  try {
    assetManifestRecord = await saveAssetManifestRecord(db, {
      id: generatingManifestRecord.id,
      projectId: project.id,
      topicPackageId: assetPlanRecord.topicPackageId,
      scriptRecordId: assetPlanRecord.scriptRecordId,
      storyboardRecordId: assetPlanRecord.storyboardRecordId,
      assetPlanRecordId: assetPlanRecord.id,
      manifestJson: manifest,
      validationResultJson: localValidation,
      executionStateJson: executionState,
      graphTraceSummaryJson: traceSummary,
      runtimeDiagnosticsJson: null,
    });
  } catch (error) {
    await preserveAssetsRunStorage(runStorage).catch(() => undefined);
    await finalizeAssetsGenerationRun(db, runId, "failed");
    throw error;
  }

  if (executionManifestRecordId) try {
    for (const job of db.assetProviderJobRecords.values()) {
      if (job.assetManifestRecordId !== executionManifestRecordId || job.assetRunId !== runId) continue;
      job.assetManifestRecordId = assetManifestRecord.id;
      job.updatedAt = new Date();
      const projectOwnerId = db.projects.get(assetManifestRecord.projectId)?.ownerId ?? "system";
      const persisted = await db.thirdAggregateWriter?.saveProviderJob(job, projectOwnerId) ?? job;
      if (persisted.id !== job.id) db.assetProviderJobRecords.delete(job.id);
      db.assetProviderJobRecords.set(persisted.id, persisted);
    }
  } catch (error) {
    await preserveAssetsRunStorage(runStorage).catch(() => undefined);
    await finalizeAssetsGenerationRun(db, runId, "failed");
    throw error;
  }

  if (narrationContext) {
    const patch = { activeAssetManifestRecordId: assetManifestRecord.id, activeComposeRecordId: null, activeRenderJobRecordId: null, activePublishPackageRecordId: null,
      status: localValidation.decision === "ready_for_compose" ? "assets_ready" : localValidation.decision === "partial" ? "assets_partial" : "assets_blocked",
      latestAssetsRunTraceJson: traceSummary, latestComposeRunTraceJson: null, latestRenderRunTraceJson: null, updatedAt: new Date() };
    await withNarrationAssetsSource(db, project.id, project.ownerId, narrationContext.identity, async ({ project: current }, tx) => {
      if (tx) {
        await tx.assetManifestRecord.update({ where: { id: assetManifestRecord.id }, data: { executionStateJson: { ...executionState, activated: true } } });
        await tx.project.update({ where: { id: current.id }, data: { ...patch, latestAssetsRunTraceJson: traceSummary as unknown as Prisma.InputJsonValue, latestComposeRunTraceJson: Prisma.DbNull, latestRenderRunTraceJson: Prisma.DbNull } });
      } else {
        assetManifestRecord.executionStateJson = { ...executionState, activated: true };
        Object.assign(current, patch);
      }
    });
    // Prisma 事务分支不触碰内存 Map：提交后同步指针，否则读 Map 的路由
    // （如 artifacts/:artifactId/file 文件服务）拿不到新 activeAssetManifestRecordId 而 404。
    const mapProject = db.projects.get(project.id);
    if (mapProject) Object.assign(mapProject, patch);
    executionState.activated = true;
  } else {
  // Step 10: Update project status based on validation decision
  if (localValidation.decision === "ready_for_compose") {
    project.status = "assets_ready";
  } else if (localValidation.decision === "partial") {
    project.status = "assets_partial";
  } else {
    project.status = "assets_blocked";
  }

  project.latestAssetsRunTraceJson = traceSummary as unknown as Record<string, unknown>;
  project.latestComposeRunTraceJson = null;
  project.latestRenderRunTraceJson = null;
  project.updatedAt = new Date();
  try {
    await db.thirdAggregateWriter?.activateAssetManifest(project, assetManifestRecord);
  } catch (error) {
    await preserveAssetsRunStorage(runStorage).catch(() => undefined);
    await finalizeAssetsGenerationRun(db, runId, "failed");
    project.activeAssetManifestRecordId = previousActiveAssetManifestRecordId;
    project.status = previousActiveAssetManifestRecordId ? "assets_ready" : "asset_plan_ready";
    await db.firstAggregateWriter?.syncProject(project);
    throw error;
  }
  project.activeAssetManifestRecordId = assetManifestRecord.id;
  project.activeComposeRecordId = null;
  project.activeRenderJobRecordId = null;
  project.activePublishPackageRecordId = null;

  }

  persistProjectRunArtifacts({
    project,
    phase: "assets",
    runId,
    traceSummary: traceSummary as unknown as Record<string, unknown>,
  });

  // C1 整改：正式 run 收尾为 succeeded（失败路径在 catch 中置 failed）；
  // 成功路径的收尾失败必须显式暴露（throwOnFailure）。
  await finalizeAssetsGenerationRun(db, runId, "succeeded", { throwOnFailure: true });

  return {
    statusCode: 200,
    body: {
      project_id: project.id,
      asset_manifest_record_id: assetManifestRecord.id,
      source_asset_plan_record_id: assetPlanRecord.id,
      version: String(assetManifestRecord.revision),
      manifest,
      local_validation: localValidation,
      execution_state: executionState,
      graph_trace_summary: traceSummary,
      runtime_diagnostics: null,
    },
  };
  } catch (error) {
    // 统一失败收尾：任何未处理的异常都结束 run，避免永久 running
    await finalizeAssetsGenerationRun(db, runId, "failed");
    throw error;
  }
}

// ─── Manual Artifact Registration ───────────────────────────────────────────

export interface RegisterManualArtifactInput {
  db: DbClient;
  project: ProjectRecord;
  taskId: string;
  artifactType: string;
  fileUri: string;
  mimeType: string;
  metadata: Record<string, unknown>;
}

export async function registerManualArtifact(input: RegisterManualArtifactInput) {
  const { db, project, taskId, artifactType, fileUri, mimeType, metadata } = input;

  // Step 1: Check active manifest exists
  if (!project.activeAssetManifestRecordId) {
    return {
      statusCode: 409,
      body: { error: "active_assets_missing" },
    };
  }

  // Step 2: Get the active manifest record
  const manifestRecord = await getAssetManifestRecordById(db, project.activeAssetManifestRecordId);
  if (!manifestRecord) {
    return {
      statusCode: 409,
      body: { error: "active_assets_missing" },
    };
  }

  const manifest = manifestRecord.manifestJson as unknown as AssetManifest;

  // Step 3: Find the execution by task_id
  const execution = manifest.executions.find((e) => e.task_id === taskId);
  if (!execution) {
    return {
      statusCode: 404,
      body: { error: "asset_task_not_found" },
    };
  }

  // Step 4: Get the asset plan to check MIME type
  const assetPlanRecord = db.assetPlanRecords.get(manifestRecord.assetPlanRecordId);
  if (!assetPlanRecord) {
    return {
      statusCode: 404,
      body: { error: "asset_plan_record_not_found" },
    };
  }
  const assetPlan = assetPlanRecord.planJson as unknown as AssetPlan;
  const planTask = assetPlan.tasks.find((t) => t.task_id === taskId);
  if (!planTask) {
    return {
      statusCode: 404,
      body: { error: "asset_task_not_found" },
    };
  }

  if (!planTask.manual_upload_policy.allowed && !planTask.manual_upload_policy.required) {
    return {
      statusCode: 422,
      body: { error: "asset_manual_upload_not_allowed" },
    };
  }

  // Step 5: Validate MIME type
  const allowedTypes = planTask.manual_upload_policy.accepted_file_types;
  if (!allowedTypes.includes(mimeType)) {
    return {
      statusCode: 422,
      body: { error: "asset_manual_upload_type_not_allowed" },
    };
  }

  const allowedArtifactTypes = allowedArtifactTypesForTask(planTask.task_type);
  if (!allowedArtifactTypes.includes(artifactType)) {
    return {
      statusCode: 422,
      body: { error: "asset_manual_artifact_type_not_allowed" },
    };
  }

  // Step 6: Create new artifact
  const now = new Date().toISOString();
  const artifactId = `artifact_manual_${db.generateId()}_${Date.now().toString(36)}`;

  const newArtifactCandidate = {
    artifact_id: artifactId,
    artifact_type: artifactType,
    origin: "manual_upload",
    file_uri: fileUri,
    created_at: now,
    // 角色 sheet 的手动上传件必须与 provider 产物携带同一套可追溯元数据：执行期的参考图
    // 注入按 metadata（sheet_role + character_id）查找，漏盖章会让"上传替换后的定妆图"
    // 静默不参与注入（2026-09-23 计划自审发现 1）。其余任务类型零变化。
    metadata: { ...metadata, ...characterSheetArtifactMetadata(planTask) },
  };

  const parsedArtifact = AssetArtifactSchema.safeParse(newArtifactCandidate);
  if (!parsedArtifact.success) {
    return {
      statusCode: 422,
      body: { error: "asset_manual_artifact_invalid" },
    };
  }
  const newArtifact = parsedArtifact.data;

  // Step 7: Add artifact to manifest
  manifest.artifacts.push(newArtifact);

  // Step 8: Add artifact_id to execution output_artifact_ids (new ID at front = current selection)
  execution.output_artifact_ids = [
    artifactId,
    ...execution.output_artifact_ids,
  ];

  // Step 9: Update execution status to completed and origin to manual_upload
  execution.status = "completed";
  execution.origin = "manual_upload";
  execution.completed_at = now;

  applyArtifactToManifestRoutes({
    manifest,
    planTask,
    artifact: newArtifact,
  });

  // Step 10: Re-run validator
  const localValidation = await validateAssetsManifest({
    assetPlanRecordId: manifestRecord.assetPlanRecordId,
    storyboardRecordId: manifestRecord.storyboardRecordId,
    scriptRecordId: manifestRecord.scriptRecordId,
    topicPackageId: manifestRecord.topicPackageId,
    assetPlan,
    manifest,
    projectStorageRootDir: project.storageRootDir,
  });

  // Step 11: Update manifest readiness
  manifest.readiness = localValidation.decision;

  // Step 12: Save updated manifest record
  manifestRecord.manifestJson = manifest as unknown as Record<string, unknown>;
  manifestRecord.validationResultJson = localValidation as unknown as Record<string, unknown>;

  // Step 12b: **落库**（2026-09-23 修复既有缺口）
  // 此前上传只改内存对象：进程重启即丢失，且口播前置项目的 run 从数据库的 active manifest
  // 取工作副本（narrationContext.activeManifest）——上传替换/手动上传因此对后续运行完全不可见。
  // 持久化沿用 run 路径的 writer 组合（saveAssetManifestRecord + saveAssetManifest + syncProject）。
  await saveAssetManifestRecord(db, {
    id: manifestRecord.id,
    projectId: project.id,
    topicPackageId: manifestRecord.topicPackageId,
    scriptRecordId: manifestRecord.scriptRecordId,
    storyboardRecordId: manifestRecord.storyboardRecordId,
    assetPlanRecordId: manifestRecord.assetPlanRecordId,
    manifestJson: manifestRecord.manifestJson,
    validationResultJson: manifestRecord.validationResultJson,
    executionStateJson: manifestRecord.executionStateJson,
    graphTraceSummaryJson: manifestRecord.graphTraceSummaryJson,
    runtimeDiagnosticsJson: manifestRecord.runtimeDiagnosticsJson,
  });
  // （saveAssetManifestRecord 内部已调用 thirdAggregateWriter.saveAssetManifest 落库，
  //   此处只需同步 project 聚合。）
  await db.firstAggregateWriter?.syncProject(project);

  // Step 13: Update project status based on validation decision
  if (localValidation.decision === "ready_for_compose") {
    project.status = "assets_ready";
  } else if (localValidation.decision === "partial") {
    project.status = "assets_partial";
  } else {
    project.status = "assets_blocked";
  }
  project.updatedAt = new Date();

  return {
    statusCode: 200,
    body: {
      project_id: project.id,
      asset_manifest_record_id: manifestRecord.id,
      manifest,
      local_validation: localValidation,
    },
  };
}

// ─── Accept Artifact ────────────────────────────────────────────────────────

export interface AcceptArtifactInput {
  db: DbClient;
  project: ProjectRecord;
  taskId: string;
  artifactId: string;
}

export interface AcceptSegmentFallbackInput {
  db: DbClient;
  project: ProjectRecord;
  /** accept-fallback 请求路径中的 run id（用于审计与防过期校验）。 */
  runId: string;
  segmentId: string;
  /** 客户端声明的预期 run id；与 manifest 记录的执行 run 不一致时拒绝。 */
  expectedRunId: string;
  /** 客户端看到的 manifest 指纹（CAS）；与当前记录不一致时拒绝并发覆盖。 */
  expectedVersion: string;
  /** 触发接受的授权用户（审计 actor）；缺省用项目 owner。 */
  actorUserId?: string | null;
}



/**
 * S2-2A 任务 6：用户显式接受严格模式（all_api_video）失败段的 Remotion fallback。
 * - 仅允许对 blocked_waiting_user 状态的段接受；
 * - 必须携带预期 run id，防止对过期失败接受 fallback；
 * - 激活 image-with-motion 前校验同段 anchor 与 Remotion cue 齐备（不能伪装成功）；
 * - 写 fallback_accepted 事件；原运行快照（旧 manifest 记录）保持不变，
 *   只更新当前可变执行视图（active manifest 记录）。
 */
export async function acceptSegmentFallback(
  input: AcceptSegmentFallbackInput,
) {
  const { db, project, runId, segmentId, expectedRunId, expectedVersion } = input;
  const actorUserId = input.actorUserId ?? project.ownerId ?? null;

  if (!project.activeAssetManifestRecordId) {
    return { statusCode: 409, body: { error: "active_assets_missing" } };
  }
  const manifestRecord = await getAssetManifestRecordById(
    db,
    project.activeAssetManifestRecordId,
  );
  if (!manifestRecord) {
    return { statusCode: 409, body: { error: "active_assets_missing" } };
  }

  // 防过期：请求必须针对当前执行 run
  const executionRunId =
    typeof manifestRecord.executionStateJson?.run_id === "string"
      ? manifestRecord.executionStateJson.run_id
      : null;
  if (runId !== expectedRunId || executionRunId !== expectedRunId) {
    return {
      statusCode: 409,
      body: { error: "assets_fallback_run_mismatch" },
    };
  }

  const manifest = manifestRecord.manifestJson as unknown as AssetManifest;
  // CAS：客户端必须基于当前 revision 接受，防止并发覆盖。
  const expectedRevision = Number.parseInt(expectedVersion, 10);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    return {
      statusCode: 422,
      body: { error: "expected_version_invalid" },
    };
  }
  if (expectedRevision !== manifestRecord.revision) {
    return {
      statusCode: 409,
      body: { error: "assets_fallback_version_mismatch" },
    };
  }

  const route = manifest.segment_routes.find(
    (item) => item.segment_id === segmentId,
  );
  if (!route) {
    return { statusCode: 404, body: { error: "segment_route_not_found" } };
  }
  if (route.readiness !== "blocked_waiting_user") {
    return {
      statusCode: 409,
      body: { error: "segment_fallback_not_awaiting_decision" },
    };
  }

  // 激活前必须同段 anchor + Remotion cue 齐备，且 artifact 真实存在、类型正确，
  // 且分别由当前 segment 的 image_still / render_motion_cue execution 产出，
  // 否则不能伪装 ready。
  const assetPlanRecord = db.assetPlanRecords.get(manifestRecord.assetPlanRecordId);
  const assetPlan = assetPlanRecord
    ? (assetPlanRecord.planJson as unknown as AssetPlan)
    : null;
  const imageProducerTaskIds = new Set(
    assetPlan
      ? assetPlan.tasks
          .filter(
            (task) =>
              task.source_segment_id === segmentId &&
              task.task_type === "image_still",
          )
          .map((task) => task.task_id)
      : [],
  );
  const motionProducerTaskIds = new Set(
    assetPlan
      ? assetPlan.tasks
          .filter(
            (task) =>
              task.source_segment_id === segmentId &&
              task.task_type === "render_motion_cue",
          )
          .map((task) => task.task_id)
      : [],
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
  const anchorArtifactId =
    route.fallback_visual_artifact_id ?? route.primary_visual_artifact_id;
  const anchorArtifact = anchorArtifactId
    ? manifest.artifacts.find((item) => item.artifact_id === anchorArtifactId)
    : undefined;
  const motionArtifact = route.motion_artifact_id
    ? manifest.artifacts.find((item) => item.artifact_id === route.motion_artifact_id)
    : undefined;
  if (
    !anchorArtifact ||
    anchorArtifact.artifact_type !== "image" ||
    !imageProducerOutputs.has(anchorArtifactId ?? "") ||
    !motionArtifact ||
    motionArtifact.artifact_type !== "motion_recipe" ||
    !motionProducerOutputs.has(route.motion_artifact_id ?? "")
  ) {
    return {
      statusCode: 409,
      body: { error: "segment_fallback_incomplete" },
    };
  }

  // C2 整改：先在隔离副本上完成全部修改与校验；数据库 CAS 成功后才发布内存状态，
  // CAS 冲突不产生任何内存副作用（route/execution/project/event 均不动）。
  const candidateManifest: AssetManifest = structuredClone(manifest);
  const candidateRoute = candidateManifest.segment_routes.find(
    (item) => item.segment_id === segmentId,
  )!;
  candidateRoute.visual_route_type = "image_with_motion";
  candidateRoute.primary_visual_artifact_id = anchorArtifactId;
  candidateRoute.fallback_decision = "user_accepted";
  candidateRoute.route_events = [
    ...(candidateRoute.route_events ?? []),
    {
      event_type: "fallback_accepted",
      occurred_at: new Date().toISOString(),
      reason_code: "user_accept_fallback",
    },
  ];
  candidateRoute.readiness = "ready";
  candidateRoute.notes = [
    ...candidateRoute.notes,
    `[strategy] user accepted Remotion fallback for segment ${segmentId} (run ${runId})`,
  ];

  // 该段的 video execution 转为 validator 认可的终态
  const segmentVideoTaskIds = new Set(
    assetPlan
      ? assetPlan.tasks
          .filter(
            (task) =>
              task.task_type === "video_clip" &&
              task.source_segment_id === segmentId,
          )
          .map((task) => task.task_id)
      : [],
  );
  for (const execution of candidateManifest.executions) {
    if (!segmentVideoTaskIds.has(execution.task_id)) continue;
    execution.status = "skipped_with_fallback";
    execution.completed_at = new Date().toISOString();
    execution.notes = [
      ...execution.notes,
      `[strategy] user accepted Remotion fallback for segment ${segmentId} (run ${runId})`,
    ];
  }

  // 重跑 validator 更新就绪度（基于候选副本，只读）
  let candidateDecision: "ready_for_compose" | "blocked" | "partial" = "blocked";
  let candidateValidation:
    | Awaited<ReturnType<typeof validateAssetsManifest>>
    | null = null;
  if (assetPlanRecord && assetPlan) {
    const localValidation = await validateAssetsManifest({
      assetPlanRecordId: manifestRecord.assetPlanRecordId,
      storyboardRecordId: manifestRecord.storyboardRecordId,
      scriptRecordId: manifestRecord.scriptRecordId,
      topicPackageId: manifestRecord.topicPackageId,
      assetPlan,
      manifest: candidateManifest,
      projectStorageRootDir: project.storageRootDir,
    });
    candidateDecision = localValidation.decision;
    candidateManifest.readiness = localValidation.decision;
    candidateValidation = localValidation;
  }

  const candidateRecord = structuredClone(manifestRecord);
  candidateRecord.manifestJson = candidateManifest as unknown as Record<string, unknown>;
  // I6 整改：持久化真实 validator 结果（errors/warnings/metrics 不伪造）
  candidateRecord.validationResultJson = candidateValidation
    ? (candidateValidation as unknown as Record<string, unknown>)
    : { stage: "assets_local_validation", decision: candidateDecision, errors: [], warnings: [], metrics: {} };
  const projectOwnerId = db.projects.get(project.id)?.ownerId ?? "system";
  const targetProjectStatus =
    candidateDecision === "ready_for_compose"
      ? "assets_ready"
      : candidateDecision === "partial"
        ? "assets_partial"
        : "assets_blocked";

  // C2 整改：数据库原子事务（CAS manifest + project + run event + audit），
  // 任一失败整体回滚；成功后才发布内存状态。
  // 注意：必须保留 writer 接收者调用类方法，解绑提取会丢失 this。
  // Minor1 整改：事件由服务预生成（id/createdAt），事务与内存镜像使用同一身份。
  const fallbackEvent: import("../../db/client.js").GenerationRunEventRecord = {
    id: db.generateId(),
    generationRunId: runId,
    eventType: "fallback_accepted",
    segmentId,
    eventJson: {
      reason: "user_accept_fallback",
      old_route: "video_clip",
      new_route: "image_with_motion",
      actor_user_id: actorUserId,
    },
    createdAt: new Date(),
  };
  const writer = db.thirdAggregateWriter;
  if (writer?.acceptSegmentFallbackCommit) {
    const applied = await writer.acceptSegmentFallbackCommit({
      manifestRecord: candidateRecord,
      expectedRevision,
      projectStatus: targetProjectStatus,
      actorUserId,
      projectOwnerId,
      runId,
      segmentId,
      event: fallbackEvent,
    });
    if (!applied) {
      return {
        statusCode: 409,
        body: { error: "assets_fallback_version_mismatch" },
      };
    }
  } else if (writer) {
    // 无事务能力（旧 writer）：顺序执行 CAS/保存，事件只写内存通道
    if (writer.casUpsertAssetManifest) {
      const applied = await writer.casUpsertAssetManifest(candidateRecord, expectedRevision, projectOwnerId);
      if (!applied) {
        return {
          statusCode: 409,
          body: { error: "assets_fallback_version_mismatch" },
        };
      }
    } else {
      await writer.saveAssetManifest(candidateRecord, projectOwnerId);
    }
  }
  candidateRecord.revision = expectedRevision + 1;

  // 事务成功：只发布内存镜像。
  // 数据库侧（manifest CAS、project、event、audit）已由 acceptSegmentFallbackCommit
  // 在单个事务内完成；这里不再调用 syncProject / appendAssetsRunEvent，避免
  // 重复写入与"数据库已提交但接口报错"的模糊状态。
  db.assetManifestRecords.set(candidateRecord.id, candidateRecord);
  project.updatedAt = new Date();
  project.status = targetProjectStatus;
  if (writer?.acceptSegmentFallbackCommit) {
    // 事务已写数据库；用同一预生成事件镜像到内存通道（身份稳定）
    db.generationRunEvents.set(runId, [
      ...(db.generationRunEvents.get(runId) ?? []),
      fallbackEvent,
    ]);
  } else {
    // 无事务 writer（内存模式）：顺序补项目同步与内存事件通道
    await db.firstAggregateWriter?.syncProject(project);
    await appendAssetsRunEvent({
      db,
      runId,
      eventType: "fallback_accepted",
      segmentId,
      eventJson: {
        reason: "user_accept_fallback",
        visual_route_type: "image_with_motion",
        actor_user_id: actorUserId,
      },
    });
  }

  return {
    statusCode: 200,
    body: {
      project_id: project.id,
      asset_manifest_record_id: candidateRecord.id,
      segment_id: segmentId,
      version: String(candidateRecord.revision),
      manifest: candidateManifest,
    },
  };
}


export async function acceptArtifact(input: AcceptArtifactInput) {
  const { db, project, taskId, artifactId } = input;

  // Step 1: Check active manifest exists
  if (!project.activeAssetManifestRecordId) {
    return {
      statusCode: 409,
      body: { error: "active_assets_missing" },
    };
  }

  // Step 2: Get the active manifest record
  const manifestRecord = await getAssetManifestRecordById(db, project.activeAssetManifestRecordId);
  if (!manifestRecord) {
    return {
      statusCode: 409,
      body: { error: "active_assets_missing" },
    };
  }

  const manifest = manifestRecord.manifestJson as unknown as AssetManifest;

  // Step 3: Find the execution by task_id
  const execution = manifest.executions.find((e) => e.task_id === taskId);
  if (!execution) {
    return {
      statusCode: 404,
      body: { error: "asset_task_not_found" },
    };
  }

  // Step 4: Verify the artifact_id exists in execution output_artifact_ids
  if (!execution.output_artifact_ids.includes(artifactId)) {
    return {
      statusCode: 404,
      body: { error: "artifact_not_found_in_execution" },
    };
  }

  // Step 5: Move the accepted artifact to the front of output_artifact_ids
  // This convention marks it as the "selected" artifact
  execution.output_artifact_ids = [
    artifactId,
    ...execution.output_artifact_ids.filter((id) => id !== artifactId),
  ];

  // Step 6: Update execution status to accepted
  execution.status = "accepted";

  // Step 7: Re-run validator to update readiness
  const assetPlanRecord = db.assetPlanRecords.get(manifestRecord.assetPlanRecordId);
  if (assetPlanRecord) {
    const assetPlan = assetPlanRecord.planJson as unknown as AssetPlan;

    const localValidation = await validateAssetsManifest({
      assetPlanRecordId: manifestRecord.assetPlanRecordId,
      storyboardRecordId: manifestRecord.storyboardRecordId,
      scriptRecordId: manifestRecord.scriptRecordId,
      topicPackageId: manifestRecord.topicPackageId,
      assetPlan,
      manifest,
      projectStorageRootDir: project.storageRootDir,
    });

    manifest.readiness = localValidation.decision;
    manifestRecord.validationResultJson = localValidation as unknown as Record<string, unknown>;

    if (localValidation.decision === "ready_for_compose") {
      project.status = "assets_ready";
    } else if (localValidation.decision === "partial") {
      project.status = "assets_partial";
    } else {
      project.status = "assets_blocked";
    }
  }

  // Step 8: Save updated manifest record
  manifestRecord.manifestJson = manifest as unknown as Record<string, unknown>;
  project.updatedAt = new Date();

  return {
    statusCode: 200,
    body: {
      project_id: project.id,
      asset_manifest_record_id: manifestRecord.id,
      manifest,
    },
  };
}

// ─── GenerationRun dispatcher handler（S2-2A 任务 8） ────────────────────────

/**
 * snapshot 不可用（数据异常）的统一 fail-closed 结局（与 LLM handler
 * SNAPSHOT_MISSING_OUTCOME 同一模式）。当前实现只查内存镜像、缺失时
 * boundContext=undefined 继续执行属既有漏洞（外部审查 P1 整改，S2-2C 收口）。
 */
const SNAPSHOT_MISSING_OUTCOME: import("../generation-run/generation-run-dispatcher.js").DispatchOutcome =
  {
    status: "failed",
    reason_code: "dispatch_snapshot_missing",
    message:
      "run 的配置快照不可用（内存镜像与数据库均缺失），拒绝派发——禁止无快照执行媒体生成或回退 env 模型",
  };

/**
 * assets.generate 的 dispatcher handler。
 *
 * 从 run.dispatchPayloadJson 恢复执行输入（提交时持久化的最小非敏感 payload；
 * 凭据只在执行时从服务端 credential registry 解析），以预建 run 身份执行既有
 * assets 流程。流程的 AppResponse 原样透传给同步提交方（2xx = succeeded，
 * 其余为 failed；内部异常由 dispatcher 统一捕获）。
 *
 * 外部调用意图的防重（provider job + providerRequestKey + attemptIndex）由
 * 既有 provider job 合同承担（任务 6 call-intent 字段）；usage 记账与
 * needs_reconciliation 细化在任务 9A 接入。
 */
export function createAssetsDispatchHandler(): import("../generation-run/generation-run-dispatcher.js").GenerationRunDispatchHandler {
  return async (run, context) => {
    const { db, project, repository } = context;
    const payload = run.dispatchPayloadJson as {
      voice_profile_id?: string;
      execution_mode?: string;
      enabled_provider_types?: string[];
      mode?: string | null;
      task_ids?: string[];
      bound_asset_plan_record_id?: string;
      bound_storyboard_record_id?: string;
    };
    // S2-2C 任务 6（复审整改 P1）：与 LLM handler 等价的快照权威——内存镜像
    // 缺失时经 repository 以数据库为权威加载（跨实例冷恢复）；内存与 DB 均
    // 缺失 → dispatch_snapshot_missing 拒绝派发，禁止无快照执行/回退 env。
    const inMemorySnapshot = db.runConfigurationSnapshots.get(run.runConfigurationSnapshotId);
    const snapshot =
      inMemorySnapshot ?? (await repository.getSnapshotById(run.runConfigurationSnapshotId));
    if (!snapshot) return SNAPSHOT_MISSING_OUTCOME;
    const resolved = snapshot.resolvedConfigurationJson as unknown as ResolvedGenerationConfigurationV1;
    // 9A 步骤 2（终审 I-A）：执行绑定授权身份——plan/storyboard 用提交时
    // 绑定的记录，视频策略与路线用快照解析结果（授权与执行同源）。
    const boundContext = {
      assetPlanRecordId: payload.bound_asset_plan_record_id,
      storyboardRecordId: payload.bound_storyboard_record_id,
      resolved,
    };
    // S2-2B（详细设计 §6.2）：快照是音色唯一权威——fixed 用指定档案；
    // auto 传空串触发 intent 匹配。客户端 payload.voice_profile_id 已废弃。
    const resolvedVoice = boundContext.resolved.resolved_creative.voice;
    const voiceProfileId =
      resolvedVoice && resolvedVoice.mode === "fixed" && resolvedVoice.voice_profile_id
        ? resolvedVoice.voice_profile_id
        : "";
    // S2-2B（详细设计 §8）：字幕样式同样来自快照（fixed → 最终样式；
    // none → null，执行端用系统默认）。
    const resolvedSubtitleStyle =
      boundContext.resolved.resolved_creative.subtitle.mode === "fixed"
        ? boundContext.resolved.resolved_creative.subtitle.resolved_style
        : null;
    const response = await runAssetsGeneration({
      db,
      project,
      voiceProfileId,
      executionMode: payload.execution_mode ?? "auto_available",
      enabledProviderTypes: payload.enabled_provider_types,
      missingOnly: payload.mode === "missing_only",
      taskIds:
        Array.isArray(payload.task_ids) && payload.task_ids.length > 0
          ? payload.task_ids
          : undefined,
      generationRunId: run.id,
      boundContext,
      resolvedCapabilities: boundContext.resolved.resolved_capabilities,
      resolvedSubtitleStyle,
    });
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return { status: "succeeded", response };
    }
    const errorCode =
      (response.body as { error?: string } | undefined)?.error ?? "assets_generation_failed";
    return {
      status: "failed",
      reason_code: errorCode,
      message: `assets generation returned HTTP ${response.statusCode}`,
      response,
    };
  };
}
