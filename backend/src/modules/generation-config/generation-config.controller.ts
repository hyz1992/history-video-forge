import type { AppResponse, RouteContext } from "../../app.js";
import { requireUser } from "../../auth/authorization.js";
import { guardOwnedRoute, guardUserRoute } from "../../auth/authorization.js";
import {
  getUserGenerationPreference,
  upsertUserGenerationPreference,
  getProjectGenerationConfiguration,
  upsertProjectGenerationConfiguration,
  listPublicGenerationCapabilities,
} from "./generation-config.repository.js";
import {
  DEFAULT_GENERATION_CONFIGURATION,
  S2_2A_ConfigPatchRequest,
  S2_2A_ProjectConfigPatchRequest,
  type GenerationConfigurationV1,
} from "../../../../shared/src/index.js";
import type { ZodTypeAny } from "zod";

/**
 * S2-2A 生成配置 controller。
 * 所有响应使用 snake_case（与现有 API 一致）。
 * P1-3：请求用 S2_2A_ConfigPatchRequest strict schema 校验（只允许 video/budget）。
 */

// --- 用户默认偏好 ---

export const getUserPreferenceController = guardUserRoute(
  async (context: RouteContext): Promise<AppResponse> => {
    const user = requireUser(context.auth);
    const result = getUserGenerationPreference(context.app.db, user.userId);
    if (!result) {
      // 旧用户无偏好 → backfill 默认
      const backfilled = await upsertUserGenerationPreference(context.app.db, user.userId, {
        expected_revision: null,
        configuration: { ...DEFAULT_GENERATION_CONFIGURATION },
      }, user.userId);
      if (!backfilled.ok) return { statusCode: 500, body: { error: "preference_backfill_failed" } };
      return {
        statusCode: 200,
        body: {
          source: "backfilled_default",
          revision: backfilled.value.revision,
          configuration: backfilled.value.configuration,
          updated_at: backfilled.value.updatedAt.toISOString(),
        },
      };
    }
    return {
      statusCode: 200,
      body: {
        source: "stored",
        revision: result.revision,
        configuration: result.configuration,
        updated_at: result.updatedAt.toISOString(),
      },
    };
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
    return {
      statusCode: 200,
      body: {
        revision: result.value.revision,
        configuration: result.value.configuration,
        updated_at: result.value.updatedAt.toISOString(),
      },
    };
  },
);

// --- 项目冻结配置 ---

export const getProjectConfigController = guardOwnedRoute(
  async (context: RouteContext): Promise<AppResponse> => {
    const user = requireUser(context.auth);
    const result = await getProjectGenerationConfiguration(context.app.db, context.params.projectId, user.userId);
    return {
      statusCode: 200,
      body: {
        configuration: result.configuration,
        revision: result.revision,
        source: result.source,
        source_user_preference_revision: result.sourceUserPreferenceRevision,
        updated_at: result.updatedAt.toISOString(),
        diff_from_user_default: result.diff_from_user_default,
      },
    };
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
    return {
      statusCode: 200,
      body: {
        configuration: result.value.configuration,
        revision: result.value.revision,
        updated_at: result.value.updatedAt.toISOString(),
        invalidation_preview: result.value.invalidation_preview,
      },
    };
  },
);

// --- 目录只读 ---

export const getGenerationCapabilitiesController = guardUserRoute(
  (context: RouteContext): AppResponse => {
    const entries = listPublicGenerationCapabilities(context.app.db);
    return {
      statusCode: 200,
      body: {
        capabilities: entries,
      },
    };
  },
);

// --- 辅助：payload 解析（P1-3：S2_2A strict schema）---

interface ParsedPayload {
  ok: boolean;
  expected_revision: number | null;
  configuration: GenerationConfigurationV1;
  response: AppResponse;
}

function parsePatchPayload(payload: unknown, schema: ZodTypeAny): ParsedPayload {
  // P1-3 + P2-2：用 strict schema 校验请求包装
  const parseResult = schema.safeParse(payload);
  if (!parseResult.success) {
    return {
      ok: false,
      expected_revision: null,
      configuration: { ...DEFAULT_GENERATION_CONFIGURATION },
      response: { statusCode: 400, body: { error: "invalid_patch_payload", detail: parseResult.error.message } },
    };
  }
  const p = parseResult.data;
  // 组装完整 GenerationConfigurationV1（creative 全 null + capabilities 全 auto）
  const fullConfig: GenerationConfigurationV1 = {
    schema_version: "generation_configuration_v1",
    video: p.video,
    budget: p.budget,
    creative: { voice_profile_id: null, art_style_preset_id: null, subtitle_style_preset_id: null },
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
