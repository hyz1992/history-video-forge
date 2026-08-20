import type { AppInstance, AppResponse, RouteContext } from "../../app";
import { getProjectById } from "../projects/project.repository";
import { demoStageGuard } from "../../shared/demo-stage-guard";
import { runStoryboardGeneration, runStoryboardSegmentRegeneration } from "./storyboard-run.service";
import { extractSubmitFields, submitGenerationRun } from "../generation-run/submit-protocol.js";
import { isPaidLlmDispatchPossible } from "../generation-cost/provider-dispatch-gate.js";
import { getStoryboardRecordById } from "./storyboard-record.repository";
import { getSegmentOverride, upsertSegmentOverride } from "./storyboard-segment-override.repository";
import { decodeStoredStoryboardPlan } from "./storyboard-plan-compatibility";
import { guardOwnedRoute, requireUser } from "../../auth/authorization.js";
import { resolveGenerationConfiguration } from "../../../../shared/src/index.js";
import { getProjectGenerationConfiguration } from "../generation-config/generation-config.repository.js";
import { resolveSystemGenerationConstraints, unavailableReasonFromRoute } from "../generation-config/system-constraints.js";

interface StoryboardGeneratePayload {
  user_feedback?: string;
}

interface StoryboardUpdateStrategyPayload {
  segment_id: string;
  visual_strategy_override: "remotion_motion" | "api_video" | null;
  expected_revision: number | null;
}

interface StoryboardSegmentRegenPayload {
  user_feedback: string;
}

async function regenerateSegmentController(
  context: RouteContext,
): Promise<AppResponse> {
  const project = await getProjectById(context.app.db, context.params.projectId);
  if (!project) {
    return { statusCode: 404, body: { error: "project_not_found" } };
  }

  const demoBlock = demoStageGuard(project, context.app.env.demoMode, "分镜");
  if (demoBlock) return demoBlock;

  const payload = context.payload as StoryboardSegmentRegenPayload;
  return runStoryboardSegmentRegeneration({
    db: context.app.db,
    project,
    segmentId: context.params.segmentId,
    userFeedback: payload.user_feedback,
  });
}

async function generateStoryboardController(
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

  const demoBlock = demoStageGuard(project, context.app.env.demoMode, "分镜");
  if (demoBlock) return demoBlock;

  const payload = (context.payload ?? {}) as Record<string, unknown>;
  // S2-2A 任务 9B：quote 提交协议
  const submit = extractSubmitFields(payload);
  if (submit.present) {
    if (submit.invalid) {
      return { statusCode: 400, body: { error: "generation_submit_fields_incomplete", message: "cost_quote_id 与 idempotency_key 必须同时提供" } };
    }
    return submitGenerationRun(context, "storyboard.generate", undefined, {
      user_feedback: payload.user_feedback,
    });
  }
  if (isPaidLlmDispatchPossible(context.app.db)) {
    return {
      statusCode: 409,
      body: { error: "paid_generation_quote_required", message: "当前部署可调用付费 LLM provider：请先创建报价并在生成请求中携带 cost_quote_id 与 idempotency_key" },
    };
  }
  return runStoryboardGeneration({
    db: context.app.db,
    project,
    userFeedback: (payload as StoryboardGeneratePayload | undefined)?.user_feedback,
  });
}

async function updateSegmentStrategyController(
  context: RouteContext,
): Promise<AppResponse> {
  const project = await getProjectById(context.app.db, context.params.projectId);
  if (!project) {
    return { statusCode: 404, body: { error: "project_not_found" } };
  }

  if (!project.activeStoryboardRecordId) {
    return { statusCode: 400, body: { error: "no_active_storyboard" } };
  }

  const record = await getStoryboardRecordById(
    context.app.db,
    project.activeStoryboardRecordId,
  );
  if (!record) {
    return { statusCode: 404, body: { error: "storyboard_record_not_found" } };
  }

  const payload = context.payload as StoryboardUpdateStrategyPayload;
  // 兼容读取：旧 plan 经 decoder 后才读 suitability
  const decoded = decodeStoredStoryboardPlan(record.planJson);
  if (!decoded.ok) {
    return { statusCode: 500, body: { error: "storyboard_plan_invalid" } };
  }
  const segment = decoded.value.plan.segments.find(
    (s) => s.segment_id === payload.segment_id,
  );
  if (!segment) {
    return { statusCode: 404, body: { error: "segment_not_found" } };
  }

  const user = requireUser(context.auth);
  // S2-2A 任务 4：写独立 override（不修改 planJson），数据库级 CAS
  const upsert = await upsertSegmentOverride(context.app.db, {
    projectId: project.id,
    storyboardRecordId: record.id,
    segmentId: payload.segment_id,
    strategyOverride: payload.visual_strategy_override,
    expectedRevision: payload.expected_revision,
    updatedByUserId: user.userId,
  });
  if (!upsert.ok) {
    if (upsert.error.code === "invalid_override_value") {
      return { statusCode: 400, body: { error: upsert.error.code, reason: upsert.error.reason } };
    }
    return {
      statusCode: 409,
      body: { error: upsert.error.code, current_revision: upsert.error.current_revision },
    };
  }

  // 解析最终路线：项目配置 + 分镜覆盖 + suitability。
  // P2：真实系统约束单一来源（demo/测试态禁用真实视频 provider）
  const projectConfig = await getProjectGenerationConfiguration(context.app.db, project.id, user.userId);
  const resolved = resolveGenerationConfiguration({
    projectConfiguration: projectConfig.configuration,
    projectConfigurationRevision: projectConfig.revision,
    sourceUserPreferenceRevision: projectConfig.sourceUserPreferenceRevision,
    systemConstraints: resolveSystemGenerationConstraints(context.app.env.demoMode),
    providerModelCatalog: [...context.app.db.providerModelCatalog.values()].map((entry) => ({
      provider_model_id: entry.id,
      capability: entry.capability,
      provider_key: entry.providerKey,
      model_id: entry.modelId,
      model_version: entry.modelVersion,
      status: entry.status,
      is_default: entry.isDefault,
    })),
    operation: "assets.generate",
    segmentInputs: [{ segment_id: segment.segment_id, api_video_suitability: segment.api_video_suitability }],
    segmentOverrides: { [segment.segment_id]: payload.visual_strategy_override },
  });
  const routeInfo = resolved.ok && resolved.value.segment_visual_routes[0]
    ? resolved.value.segment_visual_routes[0]
    : null;
  const reasonCode = routeInfo?.reason_code ?? (resolved.ok ? "route_resolution_failed" : "route_resolution_error");

  return {
    statusCode: 200,
    body: {
      updated: true,
      segment_id: payload.segment_id,
      revision: upsert.value.revision,
      strategy_override: upsert.value.strategyOverride,
      api_video_suitability: segment.api_video_suitability,
      resolved_route: routeInfo?.resolved_route ?? "remotion",
      // P1：reason_code → 不可用原因统一映射（与快照共用）
      reason_code: reasonCode,
      unavailable_reason: resolved.ok
        ? unavailableReasonFromRoute(reasonCode)
        : "配置或目录解析失败，暂按 Remotion 预览",
    },
  };
}


export function registerStoryboardRoutes(app: AppInstance) {
  app.addRoute(
    "POST",
    "/api/projects/:projectId/storyboard/generate",
    guardOwnedRoute(generateStoryboardController),
  );
  app.addRoute(
    "PATCH",
    "/api/projects/:projectId/storyboard/strategy",
    guardOwnedRoute(updateSegmentStrategyController),
  );
  app.addRoute(
    "POST",
    "/api/projects/:projectId/storyboard/segments/:segmentId/regen",
    guardOwnedRoute(regenerateSegmentController),
  );
}
