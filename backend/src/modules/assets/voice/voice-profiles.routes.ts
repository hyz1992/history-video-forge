import type { AppResponse, RouteContext } from "../../../app.js";
import { guardOwnedRoute, guardUserRoute, requireUser } from "../../../auth/authorization.js";
import { getProjectById } from "../../projects/project.repository.js";
import { listVoiceProfiles, getVoiceProfileById, seedGlobalVoiceProfiles } from "./voice-profile.repository.js";
import { appendVoicePreviewAudit, executeVoicePreview } from "./voice-preview.service.js";

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
    // P1-3（外部审查）：fresh 数据库首次打开设置页也能看到公共 seed 音色——
    // 幂等 seed 不依赖业务请求顺序（执行链路的 seed 保持不变）。
    await seedGlobalVoiceProfiles(context.app.db);
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

    // P1-3：试听同样先幂等 seed（fresh DB 下公共档案可用）
    await seedGlobalVoiceProfiles(context.app.db);
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

    // 2026-08-23（报价体系移除）：试听恢复免 quote 直连执行（不建 run/不记账；
    // cached 零费用直接返回；真实 TTS 合成写审计留痕）
    try {
      const result = await executeVoicePreview({
        db: context.app.db,
        voiceProfileId,
      });
      await appendVoicePreviewAudit(context.app.db, {
        actorUserId: user.userId,
        projectId: project.id,
        voiceProfileId,
        metadata: { source: result.source, used_real_provider: result.usedRealProvider },
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
