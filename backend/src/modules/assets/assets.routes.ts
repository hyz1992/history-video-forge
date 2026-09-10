import type { AppInstance, AppResponse, RouteContext } from "../../app";
import { getProjectById } from "../projects/project.repository";
import {
  registerManualArtifact,
  acceptArtifact,
  acceptSegmentFallback,
} from "./assets-run.service";
import { env } from "../../config/env.js";
import { createPromptRegistry } from "../../runtime/prompts/prompt-registry.js";
import { guardOwnedRoute, requireUser } from "../../auth/authorization.js";
import { createLlmGateway } from "../../runtime/llm/llm-gateway.js";
import { createTierAwareProviderFromEnv } from "../../runtime/llm/tier-aware-provider-factory.js";
import { createCompositeInteractionLogWriter } from "../../runtime/trace/project-storage.js";
import { saveAssetPlanRecord } from "../asset-planning/asset-plan-record.repository.js";
import {
  getSegmentOverride,
  upsertSegmentOverride,
} from "../storyboard/storyboard-segment-override.repository.js";
import { probeImageMetadata } from "../../http/image-probe.js";
import { probeVideoMetadata } from "../../http/video-probe.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, relative, isAbsolute, sep, extname } from "node:path";
import { randomBytes } from "node:crypto";
import {
  submitGenerationRun,
} from "../generation-run/submit-protocol.js";
import type { GenerationQuoteSelection } from "../../../../shared/src/index.js";

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readDashscopeTtsFormat(value: unknown) {
  return value === "mp3" || value === "wav" || value === "flac" || value === "pcm"
    ? value
    : undefined;
}

/**
 * S2-2A 任务 6：客户端不得携带 provider 授权信息（provider_mode / dashscope api key）。
 * 发现即明确拒绝，不静默忽略。
 */
function rejectClientProviderCredentials(
  payload: Record<string, unknown>,
): AppResponse | null {
  const hasProviderMode =
    typeof payload.provider_mode === "string" && payload.provider_mode.length > 0;
  const dashscopePayload =
    typeof payload.dashscope === "object" && payload.dashscope !== null
      ? (payload.dashscope as Record<string, unknown>)
      : {};
  const hasApiKey =
    typeof dashscopePayload.api_key === "string" &&
    dashscopePayload.api_key.length > 0;
  if (hasProviderMode || hasApiKey) {
    return {
      statusCode: 400,
      body: { error: "client_provider_credentials_not_allowed" },
    };
  }
  return null;
}

/**
 * 提交资产生成前，对 plan 中所有 video_clip 任务做一致性收敛：
 * 1. 幂等补写 override=api_video——历史/遗漏升级（90e5bf1 之前）缺授权，
 *    绑定 run 的快照路线收敛会把该段判为未授权而跳过（skipped_with_fallback，
 *    批量生成剩余时用户看到"失败"但实际是静默跳过）。任务存在本身即用户意图。
 * 2. 对齐 upgrade 任务时长到分镜预期（end-start，clamp 2-15s）——历史升级任务
 *    固定 5s 兜底，与口播时长不匹配（如 6s 分镜生成 5s 视频）。
 * 原生 video 任务（非 upgrade 前缀）不动：其时长由 asset planning 按口播确定。
 */
async function ensureVideoTaskConsistency(
  context: RouteContext,
  projectId: string,
): Promise<void> {
  const project = await getProjectById(context.app.db, projectId);
  if (!project?.activeAssetPlanRecordId) return;
  const planRecord = context.app.db.assetPlanRecords.get(project.activeAssetPlanRecordId);
  if (!planRecord) return;
  const plan = planRecord.planJson as {
    tasks?: Array<{
      task_id: string;
      task_type: string;
      source_segment_id: string | null;
      parameters?: Record<string, unknown>;
    }>;
  };
  let planChanged = false;
  for (const task of plan.tasks ?? []) {
    if (task.task_type !== "video_clip" || !task.source_segment_id) continue;
    const segmentId = task.source_segment_id;
    await authorizeSegmentApiVideo(context, projectId, planRecord.storyboardRecordId, segmentId);
    if (!task.task_id.startsWith("video_upgrade_")) continue;
    // 2026-09-04：升级任务时长对齐到实际口播（TTS chunk），保证视频与口播等长
    // （段预期时长只是无口播信息时的兜底）。
    const narrationSec = readSegmentNarrationDurationSec(context, projectId, segmentId);
    const segment = readStoryboardSegmentById(context, planRecord.storyboardRecordId, segmentId);
    const expectedRaw =
      narrationSec ??
      (segment &&
      typeof segment.end_hint_sec === "number" &&
      typeof segment.start_hint_sec === "number"
        ? segment.end_hint_sec - segment.start_hint_sec
        : null);
    if (expectedRaw === null) continue;
    const expected = Math.min(15, Math.max(2, Math.ceil(expectedRaw)));
    const params = task.parameters ?? {};
    if (params.duration_sec !== expected) {
      task.parameters = { ...params, duration_sec: expected };
      planChanged = true;
    }
  }
  if (planChanged) {
    await saveAssetPlanRecord(context.app.db, {
      id: planRecord.id,
      projectId: planRecord.projectId,
      topicPackageId: planRecord.topicPackageId,
      scriptRecordId: planRecord.scriptRecordId,
      storyboardRecordId: planRecord.storyboardRecordId,
      planJson: planRecord.planJson,
      validationResultJson: planRecord.validationResultJson,
      executionStateJson: planRecord.executionStateJson,
      graphTraceSummaryJson: planRecord.graphTraceSummaryJson,
      runtimeDiagnosticsJson: planRecord.runtimeDiagnosticsJson,
      createdAt: planRecord.createdAt,
    });
  }
}

async function generateAssetsController(
  context: RouteContext,
): Promise<AppResponse> {
  const project = await getProjectById(context.app.db, context.params.projectId);
  if (!project) {
    return {
      statusCode: 404,
      body: {
        error: "project_not_found",
      },
    };
  }

  const payload = context.payload as Record<string, unknown>;
  const credentialsBlock = rejectClientProviderCredentials(payload);
  if (credentialsBlock) return credentialsBlock;
  const enabledProviderTypes = Array.isArray(payload.enabled_provider_types)
    ? payload.enabled_provider_types as string[]
    : undefined;
  const requestedMode = payload.mode as string | undefined;
  const requestedTaskIds = Array.isArray(payload.task_ids) && payload.task_ids.every((id: unknown) => typeof id === "string")
    ? payload.task_ids as string[]
    : undefined;

  // Determine which task types would be triggered
  // If specific taskIds are given, look up their types from the asset plan
  let targetTaskTypes: string[] = [];
  if (requestedTaskIds && requestedTaskIds.length > 0 && project.activeAssetPlanRecordId) {
    const planRecord = context.app.db.assetPlanRecords.get(project.activeAssetPlanRecordId);
    if (planRecord) {
      const plan = planRecord.planJson as { tasks?: Array<{ task_id: string; task_type: string }> };
      targetTaskTypes = requestedTaskIds
        .map((tid) => plan.tasks?.find((t) => t.task_id === tid)?.task_type)
        .filter((t): t is string => !!t);
    }
  } else if (enabledProviderTypes && enabledProviderTypes.length > 0) {
    // enabledProviderTypes like ["tts", "sfx", "bgm"] won't include image/video
    // But if not specified, default auto_available may include everything
    targetTaskTypes = enabledProviderTypes;
  } else {
    // No specific types — assume all types could be included
    targetTaskTypes = ["image_still", "video_clip", "tts_audio"];
  }

  const executionMode =
    payload.execution_mode as string | undefined
      ?? "auto_available";
  const missingOnly = requestedMode === "missing_only";

  // 2026-08-23（报价体系移除）：生成统一走 run 提交协议（无需 quote 字段；
  // S2-2B：客户端 voice_profile_id 已废弃——执行音色由快照 resolved_creative 决定，
  // 冲突由提交服务在 run 创建前校验）。
  // demo 视觉拦截与凭据拦截在路由注册前已生效（与提交路径同一防线）。
  const selection: GenerationQuoteSelection = {
    mode: missingOnly ? "missing_only" : undefined,
    task_ids: requestedTaskIds ?? [],
  };
  // 2026-09-04：历史/遗漏升级缺 override 授权会被快照收敛跳过，提交前自动补齐
  await ensureVideoTaskConsistency(context, project.id);
  return submitGenerationRun(context, "assets.generate", selection, {
    // S2-2B：旧客户端若仍携带 voice_profile_id 则原样透传，由提交服务与快照
    // resolved_creative 比对（一致放行/不一致 422）。执行端一律以快照为唯一权威。
    ...(typeof payload.voice_profile_id === "string"
      ? { voice_profile_id: payload.voice_profile_id }
      : {}),
    execution_mode: executionMode,
    mode: requestedMode ?? null,
    task_ids: requestedTaskIds ?? [],
  }, {
    replayExtraBody: {
      asset_manifest_record_id: project.activeAssetManifestRecordId ?? null,
    },
  });
}

async function updateTaskPromptController(
  context: RouteContext,
): Promise<AppResponse> {
  const project = await getProjectById(context.app.db, context.params.projectId);
  if (!project) {
    return { statusCode: 404, body: { error: "project_not_found" } };
  }

  const assetPlanRecordId = project.activeAssetPlanRecordId;
  if (!assetPlanRecordId) {
    return { statusCode: 409, body: { error: "no_active_asset_plan" } };
  }

  const assetPlanRecord = context.app.db.assetPlanRecords.get(assetPlanRecordId);
  if (!assetPlanRecord) {
    return { statusCode: 409, body: { error: "asset_plan_not_found" } };
  }

  const taskId = context.params.taskId;
  const payload = context.payload as { prompt_draft?: string } | undefined;
  if (!payload || typeof payload.prompt_draft !== "string") {
    return { statusCode: 400, body: { error: "missing_prompt_draft" } };
  }

  const plan = assetPlanRecord.planJson as Record<string, unknown> as { tasks?: Array<{ task_id: string; prompt_draft?: string | null }> };
  const tasks = plan.tasks ?? [];
  const task = tasks.find((t) => t.task_id === taskId);
  if (!task) {
    return { statusCode: 404, body: { error: "task_not_found" } };
  }

  task.prompt_draft = payload.prompt_draft;
  assetPlanRecord.planJson = plan as unknown as typeof assetPlanRecord.planJson;

  return {
    statusCode: 200,
    body: { task_id: taskId, prompt_draft: task.prompt_draft },
  };
}

async function optimizeTaskPromptController(
  context: RouteContext,
): Promise<AppResponse> {
  const project = await getProjectById(context.app.db, context.params.projectId);
  if (!project) {
    return { statusCode: 404, body: { error: "project_not_found" } };
  }

  const assetPlanRecordId = project.activeAssetPlanRecordId;
  if (!assetPlanRecordId) {
    return { statusCode: 409, body: { error: "no_active_asset_plan" } };
  }

  const assetPlanRecord = context.app.db.assetPlanRecords.get(assetPlanRecordId);
  if (!assetPlanRecord) {
    return { statusCode: 409, body: { error: "asset_plan_not_found" } };
  }

  // 2026-08-23（报价体系移除）：辅助入口不再封口，恢复本地直连执行
  // （不建 run/不记账，登记已知限制：辅助入口费用不入项目成本清单）

  const payload = context.payload as {
    user_feedback?: string;
    current_prompt?: string;
    task_type?: string;
    segment_id?: string;
  } | undefined;
  if (!payload || typeof payload.current_prompt !== "string") {
    return { statusCode: 400, body: { error: "missing_current_prompt" } };
  }

  const plan = assetPlanRecord.planJson as Record<string, unknown>;
  const artBible = (plan.art_bible ?? {}) as Record<string, unknown>;
  const tasks = (plan.tasks ?? []) as Array<{ task_id: string; prompt_draft?: string | null; risk_notes?: string[]; source_segment_id?: string | null }>;

  // Gather segment context
  const storyboardRecordId = assetPlanRecord.storyboardRecordId;
  const storyboardRecord = storyboardRecordId
    ? context.app.db.storyboardRecords.get(storyboardRecordId) ?? null
    : null;
  const storyboardPlan = (storyboardRecord?.planJson ?? {}) as Record<string, unknown>;
  const segments = (storyboardPlan.segments ?? []) as Array<Record<string, unknown>>;
  const segment = payload.segment_id
    ? segments.find((s) => s.segment_id === payload.segment_id) ?? null
    : null;

  // Build risks from the current prompt
  const risks: Array<{ code: string; label: string; risk: string; suggestion: string }> = [];
  // Simple local risk check for context — the LLM will do the heavy lifting
  const hasEra = /春秋|战国|秦汉|先秦|楚国|齐国|秦朝|汉代|唐代|宋代|明代|清代|服饰|深衣|甲胄|长袍/.test(payload.current_prompt);
  if (!hasEra) risks.push({ code: "era_detail", label: "时代质感", risk: "缺乏时代/服饰约束", suggestion: "补充朝代、服饰、器物等具体元素" });
  const hasNegative = /无现代|不包含现代|避免现代|无动漫|不包含动漫/.test(payload.current_prompt);
  if (!hasNegative) risks.push({ code: "anachronism", label: "时代穿帮风险", risk: "未明确排除现代元素或动漫风格", suggestion: "补充排除现代物品、动漫风、奇幻特效" });

  // Only call LLM if not in stub mode
  if (env.llm.provider === "stub") {
    // Stub: return a simple optimization
    const optimized = payload.current_prompt +
      (payload.user_feedback
        ? `\n\n【优化调整】根据反馈：${payload.user_feedback}。增强画面表现力，写实历史质感。`
        : "\n\n【优化调整】增强时代质感、构图光线和画面叙事，写实历史质感。");
    return {
      statusCode: 200,
      body: {
        optimized_prompt: optimized,
        change_summary: payload.user_feedback
          ? ["根据用户反馈调整视觉表达", "增强写实历史质感"]
          : ["增强时代质感和画面叙事", "补充构图光线描述"],
        remaining_risks: risks.length > 0 ? risks.map((r) => r.risk) : [],
      },
    };
  }

  try {
    const registry = createPromptRegistry();
    const provider = createTierAwareProviderFromEnv();
    const gateway = createLlmGateway({ registry, provider });

    const interactionLogWriter = createCompositeInteractionLogWriter({
      project,
      phase: "assets",
      runId: context.app.db.generateId(),
    });

    const result = await gateway.invokeStructuredPrompt<{
      optimized_prompt: string;
      change_summary: string[];
      remaining_risks?: string[];
    }>({
      promptId: "asset.prompt-optimizer",
      input: {
        current_prompt: payload.current_prompt,
        user_feedback: payload.user_feedback ?? "",
        task_type: payload.task_type ?? "image_still",
        segment: segment
          ? {
              script_excerpt: segment.script_excerpt ?? "",
              scene_description: segment.scene_description ?? "",
              visual_intent: segment.visual_intent ?? "",
              narrative_role: segment.narrative_role ?? "",
            }
          : null,
        art_bible: {
          era_style: artBible.era_style ?? "",
          visual_tone: artBible.visual_tone ?? "",
          characters: artBible.characters ?? [],
          locations: artBible.locations ?? [],
          props: artBible.props ?? [],
        },
        risks,
      },
      interactionLogWriter,
    });

    return {
      statusCode: 200,
      body: {
        optimized_prompt: result.optimized_prompt,
        change_summary: result.change_summary,
        remaining_risks: result.remaining_risks ?? [],
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "optimize_failed";
    return { statusCode: 500, body: { error: message } };
  }
}

async function registerArtifactController(
  context: RouteContext,
): Promise<AppResponse> {
  const project = await getProjectById(context.app.db, context.params.projectId);
  if (!project) {
    return {
      statusCode: 404,
      body: {
        error: "project_not_found",
      },
    };
  }

  const payload = context.payload as Record<string, unknown>;

  return registerManualArtifact({
    db: context.app.db,
    project,
    taskId: context.params.taskId,
    artifactType: payload.artifact_type as string,
    fileUri: payload.file_uri as string,
    mimeType: payload.mime_type as string,
    metadata: (payload.metadata as Record<string, unknown>) ?? {},
  });
}

async function acceptArtifactController(
  context: RouteContext,
): Promise<AppResponse> {
  const project = await getProjectById(context.app.db, context.params.projectId);
  if (!project) {
    return {
      statusCode: 404,
      body: {
        error: "project_not_found",
      },
    };
  }

  const payload = context.payload as Record<string, unknown>;

  return acceptArtifact({
    db: context.app.db,
    project,
    taskId: context.params.taskId,
    artifactId: payload.artifact_id as string,
  });
}

function isPathInside(filePath: string, root: string): boolean {
  const fileAbs = resolve(filePath);
  const rootAbs = resolve(root);
  const rel = relative(rootAbs, fileAbs);
  return rel !== "" && rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
}

const MAGIC_NUMBERS: Record<string, number[]> = {
  "image/jpeg": [0xFF, 0xD8, 0xFF],
  "image/png": [0x89, 0x50, 0x4E, 0x47],
};

function checkMagicNumber(buffer: Buffer, mimeType: string): boolean {
  const mp4Check = mimeType === "video/mp4";
  if (mp4Check) {
    // MP4: check for "ftyp" box at offset 4
    return buffer.length >= 8 &&
      buffer[4] === 0x66 && buffer[5] === 0x74 &&
      buffer[6] === 0x79 && buffer[7] === 0x70;
  }
  const magic = MAGIC_NUMBERS[mimeType];
  if (!magic) return true; // No magic check for unknown MIME types
  if (buffer.length < magic.length) return false;
  return magic.every((byte, i) => buffer[i] === byte);
}

const TASK_TYPE_TO_ARTIFACT_TYPE: Record<string, string> = {
  image_still: "image",
  video_clip: "video",
};

async function uploadArtifactController(
  context: RouteContext,
): Promise<AppResponse> {
  const project = await getProjectById(context.app.db, context.params.projectId);
  if (!project) {
    return { statusCode: 404, body: { error: "project_not_found" } };
  }

  const payload = context.payload as Record<string, unknown>;
  const file = payload.file as { buffer: Buffer; originalName: string; mimeType: string; truncated: boolean } | undefined;

  // Step 0: File size check
  if (!file || !file.buffer) {
    return { statusCode: 400, body: { error: "asset_upload_file_missing" } };
  }
  if (file.truncated) {
    return { statusCode: 413, body: { error: "asset_upload_file_too_large" } };
  }

  const taskId = context.params.taskId;

  // Step 1: Check active manifest
  if (!project.activeAssetManifestRecordId) {
    return { statusCode: 409, body: { error: "active_assets_missing" } };
  }
  const manifestRecord = context.app.db.assetManifestRecords.get(project.activeAssetManifestRecordId);
  if (!manifestRecord) {
    return { statusCode: 409, body: { error: "active_assets_missing" } };
  }

  // Step 2: Get asset plan task
  const assetPlanRecord = context.app.db.assetPlanRecords.get(manifestRecord.assetPlanRecordId);
  if (!assetPlanRecord) {
    return { statusCode: 404, body: { error: "asset_plan_record_not_found" } };
  }
  const assetPlan = assetPlanRecord.planJson as { tasks: Array<{ task_id: string; task_type: string; manual_upload_policy: { allowed: boolean; required: boolean; accepted_file_types: string[] } }> };
  const planTask = assetPlan.tasks.find((t) => t.task_id === taskId);
  if (!planTask) {
    return { statusCode: 404, body: { error: "asset_task_not_found" } };
  }

  // Step 3: Check manual upload allowed
  if (!planTask.manual_upload_policy.allowed && !planTask.manual_upload_policy.required) {
    return { statusCode: 422, body: { error: "asset_manual_upload_not_allowed" } };
  }

  // Step 4: Check MIME type
  if (!planTask.manual_upload_policy.accepted_file_types.includes(file.mimeType)) {
    return { statusCode: 422, body: { error: "asset_manual_upload_type_not_allowed" } };
  }

  // Step 5: Magic number check
  if (!checkMagicNumber(file.buffer, file.mimeType)) {
    return { statusCode: 422, body: { error: "asset_upload_magic_number_mismatch" } };
  }

  // Step 6: Determine artifact type
  const artifactType = TASK_TYPE_TO_ARTIFACT_TYPE[planTask.task_type];
  if (!artifactType) {
    return { statusCode: 422, body: { error: "asset_manual_upload_not_allowed" } };
  }

  // Step 7: Write file
  const ext = extname(file.originalName) || (file.mimeType === "image/png" ? ".png" : file.mimeType === "image/jpeg" ? ".jpg" : ".mp4");
  const safeFilename = `${taskId}-${Date.now()}-${randomBytes(3).toString("hex")}${ext}`;
  const manifestRecordId = project.activeAssetManifestRecordId;
  const uploadDir = resolve(project.storageRootDir, "assets-runs", manifestRecordId, "uploads");
  mkdirSync(uploadDir, { recursive: true });
  const filePath = resolve(uploadDir, safeFilename);

  // Step 8: Path safety check
  if (!isPathInside(filePath, project.storageRootDir)) {
    return { statusCode: 403, body: { error: "path_traversal_denied" } };
  }

  writeFileSync(filePath, file.buffer);

  // Step 9: Probe metadata
  let metadata: Record<string, unknown>;
  try {
    if (artifactType === "image") {
      const imgMeta = probeImageMetadata(filePath);
      metadata = { width: imgMeta.width, height: imgMeta.height };
    } else {
      const vidMeta = await probeVideoMetadata(filePath);
      metadata = { duration_sec: vidMeta.duration_sec, width: vidMeta.width, height: vidMeta.height, fps: vidMeta.fps };
    }
  } catch (err: any) {
    return { statusCode: 422, body: { error: "asset_upload_metadata_probe_failed", detail: err.message } };
  }

  // Step 10: Register artifact via existing service
  return registerManualArtifact({
    db: context.app.db,
    project,
    taskId,
    artifactType,
    fileUri: filePath,
    mimeType: file.mimeType,
    metadata,
  });
}

async function generateTaskController(
  context: RouteContext,
): Promise<AppResponse> {
  const project = await getProjectById(context.app.db, context.params.projectId);
  if (!project) {
    return { statusCode: 404, body: { error: "project_not_found" } };
  }

  const taskId = context.params.taskId;
  const payload = context.payload as Record<string, unknown>;
  const credentialsBlock = rejectClientProviderCredentials(payload);
  if (credentialsBlock) return credentialsBlock;

  // 2026-09-04：历史/遗漏升级缺 override 授权会被快照收敛跳过，提交前自动补齐
  await ensureVideoTaskConsistency(context, project.id);

  // 2026-08-23（报价体系移除）：单任务生成统一走 run 提交协议（selection 只含该任务）
  return submitGenerationRun(context, "assets.generate", { task_ids: [taskId] }, {
    ...(typeof payload.voice_profile_id === "string"
      ? { voice_profile_id: payload.voice_profile_id }
      : {}),
    execution_mode: "auto_available",
    mode: null,
    task_ids: [taskId],
  }, {
    replayExtraBody: {
      asset_manifest_record_id: project.activeAssetManifestRecordId ?? null,
    },
  });
}

async function acceptSegmentFallbackController(
  context: RouteContext,
): Promise<AppResponse> {
  const project = await getProjectById(context.app.db, context.params.projectId);
  if (!project) {
    return { statusCode: 404, body: { error: "project_not_found" } };
  }

  const payload = context.payload as Record<string, unknown>;
  const expectedRunId =
    typeof payload.expected_run_id === "string" ? payload.expected_run_id : "";
  const expectedVersion =
    typeof payload.expected_version === "string" ? payload.expected_version : "";
  if (!expectedRunId || !expectedVersion) {
    return {
      statusCode: 422,
      body: { error: "expected_run_id_and_version_required" },
    };
  }

  return acceptSegmentFallback({
    db: context.app.db,
    project,
    runId: context.params.runId,
    segmentId: context.params.segmentId,
    expectedRunId,
    expectedVersion,
    // 审计 actor：认证用户（guardOwnedRoute 保证已登录且为项目 owner）
    actorUserId: context.auth.anonymous ? null : context.auth.userId,
  });
}

async function upgradeSegmentToVideoController(
  context: RouteContext,
): Promise<AppResponse> {
  const project = await getProjectById(context.app.db, context.params.projectId);
  if (!project) {
    return { statusCode: 404, body: { error: "project_not_found" } };
  }

  // 2026-08-23（报价体系移除）：辅助入口不再封口，恢复本地直连执行
  // （不建 run/不记账，登记已知限制：辅助入口费用不入项目成本清单）

  const segmentId = context.params.segmentId;
  const payload = context.payload as Record<string, unknown>;
  const credentialsBlock = rejectClientProviderCredentials(payload);
  if (credentialsBlock) return credentialsBlock;

  // Validate the project has an active asset plan and manifest
  if (!project.activeAssetManifestRecordId) {
    return { statusCode: 409, body: { error: "active_assets_missing" } };
  }
  if (!project.activeAssetPlanRecordId) {
    return { statusCode: 409, body: { error: "active_asset_plan_missing" } };
  }

  const planRecord = context.app.db.assetPlanRecords.get(project.activeAssetPlanRecordId);
  if (!planRecord) {
    return { statusCode: 404, body: { error: "asset_plan_record_not_found" } };
  }

  // planJson 本身就是正式 AssetPlan（AssetPlanRecord.planJson）；不得窄化成
  // 局部形状再回传 saveAssetPlanRecord——会丢必填字段导致 TS2740。
  const assetPlan = planRecord.planJson;

  // 2026-09-04：升级视频时长以实际口播为准（TTS chunk 探测时长，与口播等长），
  // 段预期时长只是无口播信息时的兜底——视频必须完整覆盖口播且不被 compose 裁剪。
  // 范围收敛到 provider 单任务上限（2-15s，与 clamp 同源）。
  const narrationDurationSec = readSegmentNarrationDurationSec(
    context,
    project.id,
    segmentId,
  );
  const storyboardSegment = readStoryboardSegmentById(
    context,
    planRecord.storyboardRecordId,
    segmentId,
  );
  const expectedDurationSec =
    narrationDurationSec ??
    (typeof storyboardSegment?.end_hint_sec === "number" &&
    typeof storyboardSegment?.start_hint_sec === "number"
      ? Math.round(storyboardSegment.end_hint_sec - storyboardSegment.start_hint_sec)
      : 5);
  const clampedDurationSec = Math.min(15, Math.max(2, Math.ceil(expectedDurationSec)));
  const resolveDurationSec = (payloadValue: unknown): number => {
    if (typeof payloadValue === "number" && Number.isFinite(payloadValue)) {
      return Math.min(15, Math.max(2, Math.round(payloadValue)));
    }
    return clampedDurationSec;
  };
  const persistPlan = () =>
    saveAssetPlanRecord(context.app.db, {
      id: planRecord.id,
      projectId: planRecord.projectId,
      topicPackageId: planRecord.topicPackageId,
      scriptRecordId: planRecord.scriptRecordId,
      storyboardRecordId: planRecord.storyboardRecordId,
      planJson: assetPlan,
      validationResultJson: planRecord.validationResultJson,
      executionStateJson: planRecord.executionStateJson,
      graphTraceSummaryJson: planRecord.graphTraceSummaryJson,
      runtimeDiagnosticsJson: planRecord.runtimeDiagnosticsJson,
      createdAt: planRecord.createdAt,
    });

  // Check if a video_clip task already exists for this segment
  const existingVideo = assetPlan.tasks.find(
    t => t.task_type === "video_clip" && t.source_segment_id === segmentId,
  );
  if (existingVideo) {
    // 2026-09-02：旧升级可能缺 override 授权（绑定 run 收敛按快照路线跳过视频执行），
    // 幂等补写 override=api_video，让已升级段可真正生成。
    await authorizeSegmentApiVideo(context, project.id, planRecord.storyboardRecordId, segmentId);
    // 2026-09-03：旧升级任务时长固定 5s（硬编码兜底），与分镜预期不符时修正。
    const existingParams = existingVideo.parameters ?? {};
    const existingDuration = typeof existingParams.duration_sec === "number"
      ? existingParams.duration_sec
      : null;
    if (existingDuration !== clampedDurationSec) {
      existingVideo.parameters = { ...existingParams, duration_sec: clampedDurationSec };
      await persistPlan();
    }
    return {
      statusCode: 200,
      body: {
        created: false,
        task_id: existingVideo.task_id,
        message: "video_task_already_exists",
        duration_sec: clampedDurationSec,
      },
    };
  }

  // Find an existing image task on this segment to clone parameters from
  const imageTask = assetPlan.tasks.find(
    t => t.task_type === "image_still" && t.source_segment_id === segmentId,
  );
  if (!imageTask) {
    return { statusCode: 422, body: { error: "segment_has_no_image_task" } };
  }

  // Create an ad-hoc video_clip task based on the image task
  const newTaskId = `video_upgrade_${context.app.db.generateId().slice(0, 8)}`;
  const durationSec = resolveDurationSec(payload.duration_sec);
  const resolution = (payload.resolution as string) ?? "720P";

  // Prefer pre-generated video prompt from asset planning (image_still.parameters.video_prompt_reserve)
  const imageParams = imageTask.parameters as Record<string, unknown> | undefined;
  const preGeneratedVideoPrompt = typeof imageParams?.video_prompt_reserve === "string"
    ? imageParams.video_prompt_reserve as string
    : null;

  let videoPromptDraft: string | null = null;
  if (preGeneratedVideoPrompt) {
    videoPromptDraft = preGeneratedVideoPrompt;
  } else {
    // Generate a proper video prompt: use LLM to transform image prompt into video prompt,
    // incorporating storyboard segment context (scene_description, visual_intent).
    try {
      const storyboardRecord = planRecord.storyboardRecordId
        ? context.app.db.storyboardRecords.get(planRecord.storyboardRecordId) ?? null
        : null;
      const storyboardPlan = (storyboardRecord?.planJson ?? {}) as Record<string, unknown>;
      const segments = (storyboardPlan.segments ?? []) as Array<Record<string, unknown>>;
      const segment = segments.find((s) => s.segment_id === segmentId) ?? null;

      const artBible = planRecord.planJson && typeof planRecord.planJson === "object"
        ? (planRecord.planJson as Record<string, unknown>).art_bible as Record<string, unknown> ?? {}
        : {};

      const imagePrompt = (payload.prompt_draft as string) ?? imageTask.prompt_draft ?? "";
      const sceneDesc = (segment?.scene_description as string) ?? "";
      const visualIntent = (segment?.visual_intent as string) ?? "";
      const eraStyle = (artBible.era_style as string) ?? "";

      if (env.llm.provider === "stub") {
        videoPromptDraft = imagePrompt
          ? `${imagePrompt}\n\n视频要求：主体动作路径、镜头运动方向、场景内光线与环境变化、时长约${durationSec}秒。`
          : null;
      } else {
        const registry = createPromptRegistry();
        const provider = createTierAwareProviderFromEnv();
        const gateway = createLlmGateway({ registry, provider });
        const interactionLogWriter = createCompositeInteractionLogWriter({
          project,
          phase: "assets",
          runId: context.app.db.generateId(),
        });
        const result = await gateway.invokeStructuredPrompt<{
          optimized_prompt: string;
        }>({
          promptId: "asset.prompt-optimizer",
          input: {
            current_prompt: imagePrompt || `${sceneDesc}\n${visualIntent}`,
            user_feedback: `请将从图片提示词扩展为视频提示词。需要补充：主体动作路径、镜头运动方向（推拉摇移等）、场景内光线和环境随时间的变化、持续约${durationSec}秒的叙事弧线。${eraStyle ? `时代风格：${eraStyle}。` : ""}`,
            task_type: "video_clip",
            segment: segment ? {
              segment_id: segment.segment_id,
              narrative_role: segment.narrative_role,
              script_excerpt: segment.script_excerpt,
              scene_description: segment.scene_description,
              visual_intent: segment.visual_intent,
            } : null,
            art_bible: artBible,
          },
          interactionLogWriter,
        });
        videoPromptDraft = result.optimized_prompt || null;
      }
    } catch {
      // Fallback: simple concatenation
      const imagePromptFallback = imageTask.prompt_draft ?? null;
      videoPromptDraft = imagePromptFallback
        ? `${imagePromptFallback}\n\n视频要求：主体动作路径、镜头运动方向、场景内光线与环境变化、时长约${durationSec}秒。`
        : null;
    }
  }

  const adHocTask: Record<string, unknown> = {
    ...(imageTask as Record<string, unknown>),
    task_id: newTaskId,
    task_type: "video_clip",
    prompt_draft: videoPromptDraft,
    parameters: {
      ...((imageTask as Record<string, unknown>).parameters as Record<string, unknown> ?? {}),
      duration_sec: durationSec,
      resolution,
      source_image_task_id: imageTask.task_id,
    },
    manual_upload_policy: {
      allowed: true,
      required: false,
      accepted_file_types: ["video/mp4", "video/quicktime"],
      acceptance_notes: ["支持 MP4/MOV 格式"],
    },
  };

  // Persist the new task in the asset plan so the frontend can find
  // it on refresh and subsequent regens work correctly.
  assetPlan.tasks.push(adHocTask as typeof assetPlan.tasks[number]);

  // 2026-09-02 修复：仅 push 内存 planJson 会在服务重启/重载后丢失任务——
  // 升级的分镜回到 Remotion、后续生成 run 查不到执行报"状态：未知"。
  // saveAssetPlanRecord 重建 record 并写 DB（保留原 id/createdAt）。
  await saveAssetPlanRecord(context.app.db, {
    id: planRecord.id,
    projectId: planRecord.projectId,
    topicPackageId: planRecord.topicPackageId,
    scriptRecordId: planRecord.scriptRecordId,
    storyboardRecordId: planRecord.storyboardRecordId,
    planJson: assetPlan,
    validationResultJson: planRecord.validationResultJson,
    executionStateJson: planRecord.executionStateJson,
    graphTraceSummaryJson: planRecord.graphTraceSummaryJson,
    runtimeDiagnosticsJson: planRecord.runtimeDiagnosticsJson,
    createdAt: planRecord.createdAt,
  });

  // 2026-09-02：升级必须同时写分镜级 override=api_video——绑定 run 的路线收敛
  // 按提交快照解析（resolveSegmentRoute：override 优先于策略矩阵），
  // 只加 plan task 不授权会让该段 video_clip 在快照里被判 remotion 而跳过
  // （skipped_with_fallback，空跑 run，用户看不到任何执行）。
  await authorizeSegmentApiVideo(context, project.id, planRecord.storyboardRecordId, segmentId);

  return {
    statusCode: 200,
    body: { created: true, task_id: newTaskId },
  };
}

/**
 * 读取分镜段的预期时间窗（start/end hint），供升级视频时长推导。
 * 无 storyboard 记录或找不到段时返回 null（调用方回退 5s）。
 */
function readStoryboardSegmentById(
  context: RouteContext,
  storyboardRecordId: string | null,
  segmentId: string,
): { start_hint_sec?: number; end_hint_sec?: number } | null {
  if (!storyboardRecordId) return null;
  const record = context.app.db.storyboardRecords.get(storyboardRecordId);
  if (!record) return null;
  const plan = (record.planJson ?? {}) as {
    segments?: Array<{ segment_id?: string; start_hint_sec?: number; end_hint_sec?: number }>;
  };
  return plan.segments?.find((s) => s.segment_id === segmentId) ?? null;
}

/**
 * 读取分镜段的实际口播时长（TTS chunk 音频探测值，manifest 权威）。
 * 视频时长必须与口播等长：plan 里的估计时长与真实口播偏差可达数秒，
 * 过长被 compose 裁剪、过短截断口播。chunk 跨段时按段数均分（与 compose
 * deriveSegmentTimings 同源）。仅认带真实探测标记（duration_source 存在且
 * ≠ estimated——fake TTS/探测失败路径写 estimated）的 chunk。
 * 返回 null 表示无可靠口播信息。
 */
function readSegmentNarrationDurationSec(
  context: RouteContext,
  projectId: string,
  segmentId: string,
): number | null {
  const project = context.app.db.projects.get(projectId);
  if (!project?.activeAssetManifestRecordId) return null;
  const manifestRecord = context.app.db.assetManifestRecords.get(
    project.activeAssetManifestRecordId,
  );
  if (!manifestRecord) return null;
  const manifest = manifestRecord.manifestJson as {
    audio_summary?: {
      tts_chunk_routes?: Array<{ artifact_id?: string | null; segment_ids?: string[] }>;
    };
    artifacts?: Array<{ artifact_id: string; metadata?: Record<string, unknown> }>;
  };
  const routes = manifest.audio_summary?.tts_chunk_routes ?? [];
  const artifacts = manifest.artifacts ?? [];
  let total = 0;
  let found = false;
  for (const route of routes) {
    if (!route.artifact_id || !route.segment_ids?.includes(segmentId)) continue;
    const artifact = artifacts.find((a) => a.artifact_id === route.artifact_id);
    const metadata = artifact?.metadata;
    const durationSec = metadata?.duration_sec;
    if (typeof durationSec !== "number" || !Number.isFinite(durationSec)) continue;
    const durationSource = metadata?.duration_source;
    if (typeof durationSource !== "string" || durationSource === "estimated") continue;
    total += durationSec / route.segment_ids.length;
    found = true;
  }
  return found ? total : null;
}

/**
 * 把分镜的视觉策略 override 置为 api_video（幂等：已授权则跳过）。
 * 失败不阻断升级主流程（任务已落盘），记录警告；next run 由 resolve 读取。
 */
async function authorizeSegmentApiVideo(
  context: RouteContext,
  projectId: string,
  storyboardRecordId: string | null,
  segmentId: string,
): Promise<void> {
  if (!storyboardRecordId) return;
  try {
    const existing = getSegmentOverride(context.app.db, storyboardRecordId, segmentId);
    if (existing?.strategyOverride === "api_video") return;
    const user = requireUser(context.auth);
    await upsertSegmentOverride(context.app.db, {
      projectId,
      storyboardRecordId,
      segmentId,
      strategyOverride: "api_video",
      expectedRevision: existing?.revision ?? null,
      updatedByUserId: user.userId,
    });
  } catch (error) {
    console.warn(
      `[assets] upgrade-video override 授权失败（segment=${segmentId}）：`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function registerAssetsRoutes(app: AppInstance) {
  app.addRoute(
    "POST",
    "/api/projects/:projectId/assets/generate",
    guardOwnedRoute(generateAssetsController),
  );
  app.addRoute(
    "POST",
    "/api/projects/:projectId/assets/tasks/:taskId/generate",
    guardOwnedRoute(generateTaskController),
  );
  app.addRoute(
    "PATCH",
    "/api/projects/:projectId/assets/tasks/:taskId/prompt",
    guardOwnedRoute(updateTaskPromptController),
  );
  app.addRoute(
    "POST",
    "/api/projects/:projectId/assets/tasks/:taskId/prompt/optimize",
    guardOwnedRoute(optimizeTaskPromptController),
  );
  app.addRoute(
    "POST",
    "/api/projects/:projectId/assets/segments/:segmentId/upgrade-video",
    guardOwnedRoute(upgradeSegmentToVideoController),
  );
  app.addRoute(
    "POST",
    "/api/projects/:projectId/assets/runs/:runId/segments/:segmentId/accept-fallback",
    guardOwnedRoute(acceptSegmentFallbackController),
  );
  app.addRoute(
    "POST",
    "/api/projects/:projectId/assets/tasks/:taskId/artifacts/register",
    guardOwnedRoute(registerArtifactController),
  );
  app.addRoute(
    "POST",
    "/api/projects/:projectId/assets/tasks/:taskId/artifacts/upload",
    guardOwnedRoute(uploadArtifactController),
  );
  app.addRoute(
    "POST",
    "/api/projects/:projectId/assets/tasks/:taskId/accept",
    guardOwnedRoute(acceptArtifactController),
  );
}
