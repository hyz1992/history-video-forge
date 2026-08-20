import type { AppInstance, AppResponse, RouteContext } from "../../app";
import { getProjectById } from "../projects/project.repository";
import {
  runAssetsGeneration,
  registerManualArtifact,
  acceptArtifact,
  acceptSegmentFallback,
} from "./assets-run.service";
import { env } from "../../config/env.js";
import { createPromptRegistry } from "../../runtime/prompts/prompt-registry.js";
import { guardOwnedRoute } from "../../auth/authorization.js";
import { createLlmGateway } from "../../runtime/llm/llm-gateway.js";
import { createTierAwareProviderFromEnv } from "../../runtime/llm/tier-aware-provider-factory.js";
import { createCompositeInteractionLogWriter } from "../../runtime/trace/project-storage.js";
import { probeImageMetadata } from "../../http/image-probe.js";
import { probeVideoMetadata } from "../../http/video-probe.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, relative, isAbsolute, sep, extname } from "node:path";
import { randomBytes } from "node:crypto";
import { createOrRestoreGenerationRun } from "../generation-run/generation-run.service.js";
import { resolveGenerationCostBootstrapInputFromEnv } from "../generation-cost/generation-cost-bootstrap.js";
import { isPaidMediaDispatchPossible } from "../generation-cost/provider-dispatch-gate.js";
import {
  GenerationQuoteProviderTypesSchema,
  GenerationQuoteRunOverridesSchema,
  type GenerationQuoteRunOverrides,
  type GenerationQuoteSelection,
} from "../../../../shared/src/index.js";

// --- S2-2A 任务 8：提交协议（cost_quote_id / authorize_budget_override / idempotency_key） ---

type SubmitFieldsResult =
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

function extractSubmitFields(payload: Record<string, unknown>): SubmitFieldsResult {
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
 * 事务提交后立即由 dispatcher 派发。幂等重放返回既有 run 状态。
 * Prisma 激活态传 app.prismaClient：提交重校验输入以数据库为权威（I-1'）。
 */
async function submitGenerationRun(
  context: RouteContext,
  operation: "assets.generate",
  selection: GenerationQuoteSelection,
  dispatchPayload: Record<string, unknown>,
): Promise<AppResponse> {
  const submit = extractSubmitFields(context.payload as Record<string, unknown>);
  if (!submit.present || submit.invalid || !submit.fields) {
    return { statusCode: 400, body: { error: "generation_submit_fields_incomplete" } };
  }
  const fields = submit.fields;
  // F5：执行过滤从提交字段重放（与 quote 创建时的 enabled_provider_types 对齐）。
  // 授权过滤与执行过滤必须同源：dispatchPayload 的 enabled_provider_types 统一
  // 被本值覆盖（bulk/单任务两个入口单一来源，防止授权上界与执行范围脱节）
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
      // 透传 assets 流程响应，并附 run id 供客户端幂等关联（additive，不改原响应形状）
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
      asset_manifest_record_id: project.activeAssetManifestRecordId ?? null,
    },
  };
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readDashscopeTtsFormat(value: unknown) {
  return value === "mp3" || value === "wav" || value === "flac" || value === "pcm"
    ? value
    : undefined;
}

/** DEMO_MODE: check whether visual (image/video) generation is blocked. */
function checkDemoModeVisualBlock(context: RouteContext, taskTypes: string[]): AppResponse | null {
  if (!env.demoMode) return null;
  const hasVisual = taskTypes.some((t) => t === "image_still" || t === "video_clip");
  if (!hasVisual) return null;
  return {
    statusCode: 403,
    body: {
      error: "demo_mode_visual_blocked",
      message: "比赛演示模式下图片和视频生成已关闭，请浏览已有示例项目查看成品效果。",
    },
  };
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

  // DEMO_MODE: block if payload includes image/video generation
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
  const demoBlock = checkDemoModeVisualBlock(context, targetTaskTypes);
  if (demoBlock) return demoBlock;

  const voiceProfileId =
    payload.voice_profile_id as string | undefined
      ?? "voice_default_male_storyteller";
  const executionMode =
    payload.execution_mode as string | undefined
      ?? "auto_available";
  const missingOnly = requestedMode === "missing_only";

  // S2-2A 任务 8：提交协议（cost_quote_id / authorize_budget_override / idempotency_key）。
  // 提供任一字段时走 GenerationRunService 事务创建/恢复 run；都不提供则保持旧路径。
  // demo 视觉拦截与凭据拦截同样适用于提交路径（在事务创建前返回）。
  const submitFields = extractSubmitFields(payload);
  if (submitFields.present) {
    if (submitFields.invalid) {
      return {
        statusCode: 400,
        body: { error: "generation_submit_fields_incomplete", message: "cost_quote_id 与 idempotency_key 必须同时提供" },
      };
    }
    const selection: GenerationQuoteSelection = {
      mode: missingOnly ? "missing_only" : undefined,
      task_ids: requestedTaskIds ?? [],
    };
    return submitGenerationRun(context, "assets.generate", selection, {
      voice_profile_id: voiceProfileId,
      execution_mode: executionMode,
      mode: requestedMode ?? null,
      task_ids: requestedTaskIds ?? [],
    });
  }

  // S2-2A 任务 6：provider 授权只来自后端 env/resolved 配置，
  // 客户端不得通过 provider_mode / dashscope api key / model 指定。
  // S2-2A 任务 9A（验收 7）：付费部署下旧无 quote 路径明确拒绝——
  // 不静默替用户创建无限预算授权；纯本地部署（无付费派发可能）保留本地路径。
  if (isPaidMediaDispatchPossible(context.app.db)) {
    return {
      statusCode: 409,
      body: {
        error: "paid_generation_quote_required",
        message: "当前部署可调用付费媒体 provider：请先创建报价并在生成请求中携带 cost_quote_id 与 idempotency_key",
      },
    };
  }
  return runAssetsGeneration({
    db: context.app.db,
    project,
    voiceProfileId,
    executionMode,
    enabledProviderTypes,
    missingOnly,
    taskIds: requestedTaskIds,
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

  // DEMO_MODE: check task type
  const taskId = context.params.taskId;
  if (env.demoMode && project.activeAssetPlanRecordId) {
    const planRecord = context.app.db.assetPlanRecords.get(project.activeAssetPlanRecordId);
    if (planRecord) {
      const plan = planRecord.planJson as { tasks?: Array<{ task_id: string; task_type: string }> };
      const task = plan.tasks?.find((t) => t.task_id === taskId);
      if (task && (task.task_type === "image_still" || task.task_type === "video_clip")) {
        return {
          statusCode: 403,
          body: {
            error: "demo_mode_visual_blocked",
            message: "比赛演示模式下图片和视频生成已关闭，请浏览已有示例项目查看成品效果。",
          },
        };
      }
    }
  }

  const payload = context.payload as Record<string, unknown>;
  const credentialsBlock = rejectClientProviderCredentials(payload);
  if (credentialsBlock) return credentialsBlock;
  const voiceProfileId =
    (payload.voice_profile_id as string | undefined) ?? "voice_default_male_storyteller";

  // S2-2A 任务 8：单任务生成同样接受提交协议（selection 只含该任务）。
  const submitFields = extractSubmitFields(payload);
  if (submitFields.present) {
    if (submitFields.invalid) {
      return {
        statusCode: 400,
        body: { error: "generation_submit_fields_incomplete", message: "cost_quote_id 与 idempotency_key 必须同时提供" },
      };
    }
    return submitGenerationRun(context, "assets.generate", { task_ids: [taskId] }, {
      voice_profile_id: voiceProfileId,
      execution_mode: "auto_available",
      mode: null,
      task_ids: [taskId],
    });
  }

  // S2-2A 任务 9A（验收 7）：单任务入口的付费部署闸门与 bulk 入口同一语义
  if (isPaidMediaDispatchPossible(context.app.db)) {
    return {
      statusCode: 409,
      body: {
        error: "paid_generation_quote_required",
        message: "当前部署可调用付费媒体 provider：请先创建报价并在生成请求中携带 cost_quote_id 与 idempotency_key",
      },
    };
  }
  return runAssetsGeneration({
    db: context.app.db,
    project,
    voiceProfileId,
    executionMode: "auto_available",
    taskIds: [taskId],
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

  // DEMO_MODE: video upgrade is always visual
  if (env.demoMode) {
    return {
      statusCode: 403,
      body: {
        error: "demo_mode_visual_blocked",
        message: "比赛演示模式下视频生成已关闭，请浏览已有示例项目查看成品效果。",
      },
    };
  }

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

  const assetPlan = planRecord.planJson as {
    tasks: Array<{
      task_id: string; task_type: string; source_segment_id: string | null;
      prompt_draft?: string | null; parameters?: Record<string, unknown>;
      manual_upload_policy?: { allowed: boolean; required: boolean; accepted_file_types: string[]; acceptance_notes?: string[] };
    }>;
  };

  // Check if a video_clip task already exists for this segment
  const existingVideo = assetPlan.tasks.find(
    t => t.task_type === "video_clip" && t.source_segment_id === segmentId,
  );
  if (existingVideo) {
    return {
      statusCode: 200,
      body: { created: false, task_id: existingVideo.task_id, message: "video_task_already_exists" },
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
  const durationSec = (payload.duration_sec as number) ?? 5;
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

  return {
    statusCode: 200,
    body: { created: true, task_id: newTaskId },
  };
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
