import type { AppResponse, RouteContext } from "../../../app.js";
import { guardOwnedRoute, guardUserRoute, requireUser } from "../../../auth/authorization.js";
import { getProjectById } from "../../projects/project.repository.js";
import { listVoiceProfiles, getVoiceProfileById } from "./voice-profile.repository.js";
import { executeVoicePreview } from "./voice-preview.service.js";
import { submitGenerationRun } from "../../generation-run/submit-protocol.js";
import { isPaidMediaDispatchPossible } from "../../generation-cost/provider-dispatch-gate.js";

/**
 * S2-2B 音色目录与试听 API（详细设计 §6.3/§9.2/§9.3）。
 *
 * - GET /api/me/voice-profiles：公共 + 本人私有档案公开字段（同源授权）。
 * - POST /api/projects/:projectId/voice-profiles/:voiceProfileId/preview：
 *   项目级试听（quote 协议是 project-scoped 的既有冻结合同）——
 *   cached 零费用直接返回；付费部署必须 quote+提交（无 quote → 409）；
 *   stub/fake 环境免 quote 本地合成。
 */

export const listMyVoiceProfilesController = guardUserRoute(
  async (context: RouteContext): Promise<AppResponse> => {
    const user = requireUser(context.auth);
    const profiles = await listVoiceProfiles(context.app.db, { ownerId: user.userId });
    const body = {
      profiles: profiles.map((profile) => ({
        voice_profile_id: profile.voice_profile_id,
        kind: profile.kind,
        name: profile.name,
        description: profile.description,
        voice_traits: profile.voice_traits,
        avoid_traits: profile.avoid_traits,
        gender_tone: profile.gender_tone,
        age_band: profile.age_band,
        pitch: profile.pitch,
        pace: profile.pace,
        energy: profile.energy,
        authority: profile.authority,
        suspense: profile.suspense,
        warmth: profile.warmth,
        preview_text: profile.preview_text,
        preview_audio_uri: profile.preview_audio_uri,
        visibility: profile.visibility ?? (profile.kind === "generated" ? "private" : "public"),
        provider_status: profile.provider_status,
        usage_count: profile.usage_count,
      })),
    };
    return { statusCode: 200, body };
  },
);

export const previewVoiceProfileController = guardOwnedRoute(
  async (context: RouteContext): Promise<AppResponse> => {
    const user = requireUser(context.auth);
    const voiceProfileId = context.params.voiceProfileId;
    const project = await getProjectById(context.app.db, context.params.projectId);
    if (!project) {
      return { statusCode: 404, body: { error: "project_not_found" } };
    }

    // 可见性同源授权：公共 + 项目 owner 私有；非可见按不存在处理
    const profile = await getVoiceProfileById(context.app.db, voiceProfileId, {
      ownerId: project.ownerId,
    });
    if (!profile || profile.provider_status === "deleted") {
      return { statusCode: 404, body: { error: "voice_profile_not_found" } };
    }

    // cached：零费用，直接返回（防御性支持；前端通常经列表直读）
    if (profile.preview_audio_uri) {
      return {
        statusCode: 200,
        body: {
          preview_audio_uri: profile.preview_audio_uri,
          source: "cached",
          provider_voice_id: profile.provider_voice_id,
        },
      };
    }

    const payload = context.payload as Record<string, unknown>;
    const submitFields = extractPreviewSubmitFields(payload);
    if (submitFields.present) {
      if (submitFields.invalid) {
        return {
          statusCode: 400,
          body: { error: "generation_submit_fields_incomplete", message: "cost_quote_id 与 idempotency_key 必须同时提供" },
        };
      }
      return submitGenerationRun(context, "voice.preview", undefined, {
        voice_profile_id: voiceProfileId,
      });
    }

    // 付费部署：试听可能触发真实付费 TTS/设计 → 必须 quote（fail-closed）
    if (isPaidMediaDispatchPossible(context.app.db)) {
      return {
        statusCode: 409,
        body: {
          error: "paid_generation_quote_required",
          message: "当前部署可调用付费媒体 provider：请先创建 voice.preview 报价并在试听请求中携带 cost_quote_id 与 idempotency_key",
        },
      };
    }

    // stub/fake 本地路径：免 quote 合成（不进入运行成本协议；写审计留痕）
    try {
      const result = await executeVoicePreview({
        db: context.app.db,
        voiceProfileId,
      });
      context.app.db.auditLogs.set(context.app.db.generateId(), {
        id: context.app.db.generateId(),
        actorUserId: user.userId,
        projectId: project.id,
        action: "voice.profile_previewed",
        targetType: "voice_profile",
        targetId: voiceProfileId,
        metadataJson: { source: result.source, used_real_provider: result.usedRealProvider },
        createdAt: new Date(),
      });
      return {
        statusCode: 200,
        body: {
          preview_audio_uri: result.preview_audio_uri,
          source: result.source,
          provider_voice_id: result.provider_voice_id,
        },
      };
    } catch (error) {
      return {
        statusCode: 500,
        body: {
          error: "voice_preview_failed",
          reason_code: error instanceof Error ? error.message : "unknown",
        },
      };
    }
  },
);

function extractPreviewSubmitFields(payload: Record<string, unknown>): {
  present: boolean;
  invalid: boolean;
} {
  const hasQuote = typeof payload.cost_quote_id === "string" && payload.cost_quote_id.length > 0;
  const hasKey = typeof payload.idempotency_key === "string" && payload.idempotency_key.length > 0;
  return {
    present: hasQuote || hasKey,
    invalid: hasQuote !== hasKey,
  };
}

export function registerVoiceProfileRoutes(app: {
  addRoute: (
    method: string,
    pattern: string,
    handler: (context: RouteContext) => Promise<AppResponse> | AppResponse,
  ) => void;
}): void {
  app.addRoute("GET", "/api/me/voice-profiles", listMyVoiceProfilesController);
  app.addRoute(
    "POST",
    "/api/projects/:projectId/voice-profiles/:voiceProfileId/preview",
    previewVoiceProfileController,
  );
}
