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
import { DEFAULT_GENERATION_CONFIGURATION, GenerationConfigurationV1 } from "../../../../shared/src/index.js";

/**
 * S2-2A 生成配置 controller。
 * 所有响应使用 snake_case（与现有 API 一致）。
 */

// --- 用户默认偏好 ---

export const getUserPreferenceController = guardUserRoute(
  (context: RouteContext): AppResponse => {
    const user = requireUser(context.auth);
    const result = getUserGenerationPreference(context.app.db, user.userId);
    if (!result) {
      // 旧用户无偏好 → backfill 默认
      const backfilled = upsertUserGenerationPreference(context.app.db, user.userId, {
        expected_revision: null,
        configuration: getDefaultConfig(),
      });
      if (!backfilled.ok) return { statusCode: 500, body: { error: "preference_backfill_failed" } };
      return {
        statusCode: 200,
        body: {
          source: "backfilled_default",
          revision: backfilled.value.revision,
          configuration: backfilled.value.configuration,
        },
      };
    }
    return {
      statusCode: 200,
      body: {
        source: "stored",
        revision: result.revision,
        configuration: result.configuration,
      },
    };
  },
);

export const patchUserPreferenceController = guardUserRoute(
  (context: RouteContext): AppResponse => {
    const user = requireUser(context.auth);
    const payload = context.payload ?? {};
    const parseResult = parseConfigPatchPayload(payload);
    if (!parseResult.ok) return parseResult.response;
    const result = upsertUserGenerationPreference(context.app.db, user.userId, {
      expected_revision: parseResult.expected_revision,
      configuration: parseResult.configuration,
    });
    if (!result.ok) {
      return {
        statusCode: 409,
        body: {
          error: result.error.code,
          current_revision: result.error.current_revision,
        },
      };
    }
    return {
      statusCode: 200,
      body: {
        revision: result.value.revision,
        configuration: result.value.configuration,
      },
    };
  },
);

// --- 项目冻结配置 ---

export const getProjectConfigController = guardOwnedRoute(
  (context: RouteContext): AppResponse => {
    const result = getProjectGenerationConfiguration(context.app.db, context.params.projectId);
    return {
      statusCode: 200,
      body: {
        configuration: result.configuration,
        revision: result.revision,
        source: result.source,
        source_user_preference_revision: result.sourceUserPreferenceRevision,
      },
    };
  },
);

export const patchProjectConfigController = guardOwnedRoute(
  (context: RouteContext): AppResponse => {
    const payload = context.payload ?? {};
    const parseResult = parseConfigPatchPayload(payload);
    if (!parseResult.ok) return parseResult.response;
    const result = upsertProjectGenerationConfiguration(context.app.db, context.params.projectId, {
      expected_revision: parseResult.expected_revision!,
      configuration: parseResult.configuration,
    });
    if (!result.ok) {
      return {
        statusCode: 409,
        body: {
          error: result.error.code,
          current_revision: result.error.current_revision,
        },
      };
    }
    return {
      statusCode: 200,
      body: {
        configuration: result.value.configuration,
        revision: result.value.revision,
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

// --- 辅助：payload 解析 ---

interface ParsedPayload {
  ok: boolean;
  expected_revision: number | null;
  configuration: GenerationConfigurationV1;
  response: AppResponse;
}

function parseConfigPatchPayload(payload: unknown): ParsedPayload {
  const p = payload as Record<string, unknown>;
  if (!p || typeof p !== "object") {
    return { ok: false, expected_revision: null, configuration: getDefaultConfig(), response: { statusCode: 400, body: { error: "invalid_payload" } } };
  }
  // expected_revision 可以是 null（新建）或 number（更新）
  const expectedRevision = p.expected_revision === null ? null : typeof p.expected_revision === "number" ? p.expected_revision : undefined;
  if (expectedRevision === undefined) {
    return { ok: false, expected_revision: null, configuration: getDefaultConfig(), response: { statusCode: 400, body: { error: "expected_revision_required" } } };
  }
  // 用 shared schema 校验 configuration
  const configResult = GenerationConfigurationV1.safeParse(p.configuration);
  if (!configResult.success) {
    return { ok: false, expected_revision: null, configuration: getDefaultConfig(), response: { statusCode: 400, body: { error: "configuration_invalid", detail: configResult.error.message } } };
  }
  return { ok: true, expected_revision: expectedRevision, configuration: configResult.data, response: { statusCode: 200, body: {} } };
}

function getDefaultConfig(): GenerationConfigurationV1 {
  return { ...DEFAULT_GENERATION_CONFIGURATION };
}
