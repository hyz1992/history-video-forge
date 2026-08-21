import type { AppResponse, RouteContext } from "../../app.js";
import { requireUser } from "../../auth/authorization.js";
import { guardOwnedRoute, guardUserRoute } from "../../auth/authorization.js";
import {
  getOrBackfillUserGenerationPreference,
  upsertUserGenerationPreference,
  getProjectGenerationConfiguration,
  upsertProjectGenerationConfiguration,
  listPublicGenerationCapabilities,
} from "./generation-config.repository.js";
import {
  ConfigurationInvalidationPreview,
  GenerationCapabilitiesResponse,
  ProjectGenerationConfigurationResponse,
  S2_2A_ConfigPatchRequest,
  S2_2A_ProjectConfigPatchRequest,
  UserGenerationPreferenceResponse,
  type GenerationConfigurationV1,
} from "../../../../shared/src/index.js";
import type { ZodTypeAny } from "zod";

/**
 * S2-2A 生成配置 controller。
 * 响应统一经共享 Zod Response schema 校验后返回（请求与响应都用共享合同）。
 */

// --- 用户默认偏好 ---

export const getUserPreferenceController = guardUserRoute(
  async (context: RouteContext): Promise<AppResponse> => {
    const user = requireUser(context.auth);
    // P1：并发幂等读取——两个首次 GET 同时到达时，loser 用数据库记录返回 stored。
    const result = await getOrBackfillUserGenerationPreference(context.app.db, user.userId, user.userId);
    const body = UserGenerationPreferenceResponse.parse({
      source: result.source,
      revision: result.revision,
      configuration: result.configuration,
      updated_at: result.updatedAt.toISOString(),
    });
    return { statusCode: 200, body };
  },
);

export const patchUserPreferenceController = guardUserRoute(
  async (context: RouteContext): Promise<AppResponse> => {
    const user = requireUser(context.auth);
    const parsed = parsePatchPayload(context.payload, S2_2A_ConfigPatchRequest);
    if (!parsed.ok) return parsed.response;
    const result = await upsertUserGenerationPreference(context.app.db, user.userId, {
      expected_revision: parsed.expected_revision,
      configuration: parsed.configuration,
    }, user.userId);
    if (!result.ok) {
      if (result.error.code === "configuration_invalid_s2_2a_scope") {
        return { statusCode: 400, body: { error: result.error.code, reason: result.error.reason } };
      }
      return {
        statusCode: 409,
        body: { error: result.error.code, current_revision: result.error.current_revision },
      };
    }
    const body = UserGenerationPreferenceResponse.parse({
      source: "stored",
      revision: result.value.revision,
      configuration: result.value.configuration,
      updated_at: result.value.updatedAt.toISOString(),
    });
    return { statusCode: 200, body };
  },
);

// --- 项目冻结配置 ---

export const getProjectConfigController = guardOwnedRoute(
  async (context: RouteContext): Promise<AppResponse> => {
    const user = requireUser(context.auth);
    const result = await getProjectGenerationConfiguration(context.app.db, context.params.projectId, user.userId);
    const body = ProjectGenerationConfigurationResponse.parse({
      source: result.source,
      revision: result.revision,
      configuration: result.configuration,
      updated_at: result.updatedAt.toISOString(),
      source_user_preference_revision: result.sourceUserPreferenceRevision,
      diff_from_user_default: result.diff_from_user_default,
      // GET 的失效预览：若把当前用户默认重新应用到项目会影响哪些阶段
      invalidation_preview: previewFromUserDefaultDiff(result.diff_from_user_default),
    });
    return { statusCode: 200, body };
  },
);

export const patchProjectConfigController = guardOwnedRoute(
  async (context: RouteContext): Promise<AppResponse> => {
    const user = requireUser(context.auth);
    const parsed = parsePatchPayload(context.payload, S2_2A_ProjectConfigPatchRequest);
    if (!parsed.ok) return parsed.response;
    const result = await upsertProjectGenerationConfiguration(context.app.db, context.params.projectId, {
      expected_revision: parsed.expected_revision!,
      configuration: parsed.configuration,
    }, user.userId);
    if (!result.ok) {
      if (result.error.code === "configuration_invalid_s2_2a_scope") {
        return { statusCode: 400, body: { error: result.error.code, reason: result.error.reason } };
      }
      return {
        statusCode: 409,
        body: { error: result.error.code, current_revision: result.error.current_revision },
      };
    }
    const body = ProjectGenerationConfigurationResponse.parse({
      source: "stored",
      revision: result.value.revision,
      configuration: result.value.configuration,
      updated_at: result.value.updatedAt.toISOString(),
      source_user_preference_revision: result.value.sourceUserPreferenceRevision,
      diff_from_user_default: result.value.diff_from_user_default,
      invalidation_preview: result.value.invalidation_preview,
    });
    return { statusCode: 200, body };
  },
);

// --- 目录只读 ---

export const getGenerationCapabilitiesController = guardUserRoute(
  (context: RouteContext): AppResponse => {
    const entries = listPublicGenerationCapabilities(context.app.db);
    const body = GenerationCapabilitiesResponse.parse({ capabilities: entries });
    return { statusCode: 200, body };
  },
);

// --- 辅助 ---

interface ParsedPayload {
  ok: boolean;
  expected_revision: number | null;
  configuration: GenerationConfigurationV1;
  response: AppResponse;
}

function parsePatchPayload(payload: unknown, schema: ZodTypeAny): ParsedPayload {
  const parseResult = schema.safeParse(payload);
  if (!parseResult.success) {
    return {
      ok: false,
      expected_revision: null,
      configuration: { schema_version: "generation_configuration_v1" } as GenerationConfigurationV1,
      response: { statusCode: 400, body: { error: "invalid_patch_payload", detail: parseResult.error.message } },
    };
  }
  const p = parseResult.data as { expected_revision: number | null; video: GenerationConfigurationV1["video"]; budget: GenerationConfigurationV1["budget"] };
  const fullConfig: GenerationConfigurationV1 = {
    schema_version: "generation_configuration_v1",
    video: p.video,
    budget: p.budget,
    creative: {
      voice_profile_id: null,
      art_style_preset_id: null,
      subtitle_style_preset_id: null,
      subtitle_style_overrides: {},
    },
    capabilities: {
      "llm.smart": { mode: "auto" },
      "llm.flash": { mode: "auto" },
      "image.generate": { mode: "auto" },
      "video.image_to_video": { mode: "auto" },
      "tts.synthesize": { mode: "auto" },
    },
  };
  return { ok: true, expected_revision: p.expected_revision, configuration: fullConfig, response: { statusCode: 200, body: {} } };
}

/**
 * GET 的失效预览：基于“用户默认 vs 项目配置”的公开差异推断受影响阶段。
 * 无差异（或无用户默认可比）时为 none。
 */
function previewFromUserDefaultDiff(
  diff: Record<string, unknown> | null,
): ConfigurationInvalidationPreview {
  if (!diff || Object.keys(diff).length === 0) {
    return {
      affected_stages: ["none"],
      note: "当前配置与用户默认一致；如需变更请通过项目配置 API。",
    };
  }
  const stages = new Set<string>();
  const videoDiff = diff.video as { from?: { strategy?: string; api_quality?: string }; to?: { strategy?: string; api_quality?: string } } | undefined;
  if (videoDiff?.from?.strategy !== videoDiff?.to?.strategy) {
    stages.add("storyboard_route_resolution");
    stages.add("asset_planning");
  }
  if (videoDiff?.from?.api_quality !== videoDiff?.to?.api_quality) {
    stages.add("asset_planning");
    stages.add("assets");
  }
  return {
    affected_stages: stages.size > 0 ? [...stages] : ["none"],
    note: "重新应用用户默认将影响以上阶段；配置变更不自动触发下游生成。",
  };
}
