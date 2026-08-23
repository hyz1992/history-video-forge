import type { AppResponse, RouteContext } from "../../app.js";
import { requireUser } from "../../auth/authorization.js";
import { guardOwnedRoute, guardUserRoute } from "../../auth/authorization.js";
import {
  getOrBackfillUserGenerationPreference,
  getUserPreferenceDbAuthoritative,
  upsertUserGenerationPreference,
  getProjectGenerationConfiguration,
  upsertProjectGenerationConfiguration,
  listPublicGenerationCapabilities,
} from "./generation-config.repository.js";
import {
  ConfigurationInvalidationPreview,
  CreativePresetsResponse,
  GenerationCapabilitiesResponse,
  ProjectGenerationConfigurationResponse,
  S2_2C_ConfigPatchRequest,
  S2_2C_ProjectConfigPatchRequest,
  UserGenerationPreferenceResponse,
  type CapabilitySelectionMap,
  type CreativePreferences,
  type GenerationConfigurationV1,
} from "../../../../shared/src/index.js";
import {
  ART_STYLE_PRESET_REGISTRY_V1,
  SUBTITLE_STYLE_PRESET_REGISTRY_V1,
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
    // S2-2C（详细设计 §4.1）：capabilities 缺省 = 保留现有配置值（不静默清空
    // 已保存的 fixed 选择）；仅首次创建（无现有记录）缺省才用全 auto。
    // 复审整改 P2：以数据库为权威读取（跨实例内存缺失时经 writer 查询同步），
    // 保证保留语义与 revision 检查不依赖本实例内存。
    const existing = await getUserPreferenceDbAuthoritative(context.app.db, user.userId);
    const currentCapabilities = existing?.configuration.capabilities;
    const parsed = parsePatchPayload(
      context.payload,
      S2_2C_ConfigPatchRequest,
      currentCapabilities,
    );
    if (!parsed.ok) return parsed.response;
    const result = await upsertUserGenerationPreference(context.app.db, user.userId, {
      expected_revision: parsed.expected_revision,
      configuration: parsed.configuration,
    }, user.userId);
    if (!result.ok) {
      if (result.error.code === "configuration_invalid_s2_2c_scope") {
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
    // S2-2C（详细设计 §4.1）：capabilities 缺省 = 保留现有项目配置值
    // （getProjectGenerationConfiguration 幂等 backfill，旧客户端不静默清空 fixed）。
    const current = await getProjectGenerationConfiguration(context.app.db, context.params.projectId, user.userId);
    const parsed = parsePatchPayload(
      context.payload,
      S2_2C_ProjectConfigPatchRequest,
      current.configuration.capabilities,
    );
    if (!parsed.ok) return parsed.response;
    const result = await upsertProjectGenerationConfiguration(context.app.db, context.params.projectId, {
      expected_revision: parsed.expected_revision!,
      configuration: parsed.configuration,
    }, user.userId);
    if (!result.ok) {
      if (result.error.code === "configuration_invalid_s2_2c_scope") {
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

function parsePatchPayload(
  payload: unknown,
  schema: ZodTypeAny,
  currentCapabilities?: GenerationConfigurationV1["capabilities"],
): ParsedPayload {
  const parseResult = schema.safeParse(payload);
  if (!parseResult.success) {
    return {
      ok: false,
      expected_revision: null,
      configuration: { schema_version: "generation_configuration_v1" } as GenerationConfigurationV1,
      response: { statusCode: 400, body: { error: "invalid_patch_payload", detail: parseResult.error.message } },
    };
  }
  const p = parseResult.data as {
    expected_revision: number | null;
    video: GenerationConfigurationV1["video"];
    creative?: CreativePreferences;
    capabilities?: CapabilitySelectionMap;
  };
  // S2-2B：creative 提供时整体替换；缺省时回 A 期默认（全 null + 空覆盖）——
  // 对不携带 creative 的旧 A 客户端零行为变化；B 前端总是携带 creative。
  const creative: CreativePreferences = p.creative ?? {
    voice_profile_id: null,
    art_style_preset_id: null,
    subtitle_style_preset_id: null,
    subtitle_style_overrides: {},
  };
  // S2-2C（外部审查 P1 整改）：capabilities 提供时整体替换；缺省时**保留现有
  // 配置值**（旧 A/B 客户端修改 video/creative 不会静默清空已保存的 fixed 选择）；
  // 无现有记录（首次创建）才使用全 auto。
  const capabilities: GenerationConfigurationV1["capabilities"] =
    p.capabilities ?? currentCapabilities ?? {
      "llm.smart": { mode: "auto" },
      "llm.flash": { mode: "auto" },
      "image.generate": { mode: "auto" },
      "video.image_to_video": { mode: "auto" },
      "tts.synthesize": { mode: "auto" },
    };
  const fullConfig: GenerationConfigurationV1 = {
    schema_version: "generation_configuration_v1",
    video: p.video,
    creative,
    capabilities,
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
  // S2-2B：creative 变更的失效映射（详细设计 §10）
  const creativeDiff = diff.creative as
    | { from?: { voice_profile_id?: string | null; art_style_preset_id?: string | null; subtitle_style_preset_id?: string | null }; to?: { voice_profile_id?: string | null; art_style_preset_id?: string | null; subtitle_style_preset_id?: string | null } }
    | undefined;
  if (creativeDiff?.from?.voice_profile_id !== creativeDiff?.to?.voice_profile_id) {
    stages.add("assets");
  }
  if (creativeDiff?.from?.art_style_preset_id !== creativeDiff?.to?.art_style_preset_id) {
    stages.add("asset_planning");
  }
  if (creativeDiff?.from?.subtitle_style_preset_id !== creativeDiff?.to?.subtitle_style_preset_id) {
    stages.add("assets");
  }
  // S2-2C（详细设计 §4.3）：capabilities 变更的失效映射
  // llm.smart/llm.flash → llm_generation；image.generate → asset_planning+assets；
  // video.image_to_video/tts.synthesize → assets。
  const capabilitiesDiff = diff.capabilities as
    | { from?: Record<string, { mode?: string; provider_model_id?: string }>; to?: Record<string, { mode?: string; provider_model_id?: string }> }
    | undefined;
  if (capabilitiesDiff?.from && capabilitiesDiff?.to) {
    for (const slot of ["llm.smart", "llm.flash", "image.generate", "video.image_to_video", "tts.synthesize"]) {
      if (JSON.stringify(capabilitiesDiff.from[slot]) !== JSON.stringify(capabilitiesDiff.to[slot])) {
        if (slot === "llm.smart" || slot === "llm.flash") {
          stages.add("llm_generation");
        } else if (slot === "image.generate") {
          stages.add("asset_planning");
          stages.add("assets");
        } else {
          stages.add("assets");
        }
      }
    }
  }
  return {
    affected_stages: stages.size > 0 ? [...stages] : ["none"],
    note: "重新应用用户默认将影响以上阶段；配置变更不自动触发下游生成。",
  };
}

// --- 画风/字幕 preset 公开目录（S2-2B） --------------------------------------

export const getCreativePresetsController = (): AppResponse => {
  const body = CreativePresetsResponse.parse({
    art_style: ART_STYLE_PRESET_REGISTRY_V1.map((preset) => ({
      preset_id: preset.preset_id,
      preset_version: preset.preset_version,
      display_name: preset.display_name,
      description: preset.description,
      overridable_fields: null,
      summary: preset.resolved_params.visual_tone_hint + "；必达负面清单 " + preset.resolved_params.global_negative_prompts.length + " 项",
    })),
    subtitle: SUBTITLE_STYLE_PRESET_REGISTRY_V1.map((preset) => ({
      preset_id: preset.preset_id,
      preset_version: preset.preset_version,
      display_name: preset.display_name,
      description: preset.description,
      overridable_fields: [...preset.resolved_params.overridable_fields],
      summary: preset.resolved_params.style.style_id,
    })),
  });
  return { statusCode: 200, body };
}
