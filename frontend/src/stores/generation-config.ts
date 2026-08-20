import { inject, reactive, readonly, type InjectionKey } from "vue";
import { apiFetch } from "../utils/api";

/**
 * S2-2A 任务 10：用户默认与项目生成配置 store。
 *
 * - PATCH 携带 expected_revision（乐观并发）；409 冲突时置冲突标记并重新
 *   加载服务器配置，不用本地草稿覆盖较新配置。
 * - 金额一律微元十进制字符串；CNY 输入转换用字符串运算，不经 Number
 *   处理（超安全整数风险）。
 * - 能力摘要只保留 availability=enabled 项；不请求/展示凭据字段。
 */

export type VideoGenerationStrategyValue =
  | "all_api_video"
  | "prefer_api_video"
  | "prefer_remotion"
  | "all_remotion";

export type ApiVideoQualityValue = "standard_720p" | "high_1080p";

export interface GenerationConfigurationDto {
  schema_version: "generation_configuration_v1";
  video: {
    strategy: VideoGenerationStrategyValue;
    api_quality: ApiVideoQualityValue;
  };
  budget: {
    currency: "CNY";
    max_paid_cost_micros_per_run: string | null;
  };
  creative: {
    voice_profile_id: string | null;
    art_style_preset_id: string | null;
    subtitle_style_preset_id: string | null;
  };
  capabilities: Record<string, { mode: "auto" | "fixed"; provider_model_id?: string }>;
}

export interface UserPreferenceDto {
  source: "stored" | "backfilled_default";
  revision: number;
  configuration: GenerationConfigurationDto;
  updated_at: string;
}

export interface ConfigurationInvalidationPreviewDto {
  affected_stages: string[];
  note: string;
}

export interface ProjectGenerationConfigurationDto {
  source: "stored" | "backfilled_default";
  revision: number;
  configuration: GenerationConfigurationDto;
  updated_at: string;
  source_user_preference_revision: number | null;
  diff_from_user_default: Record<string, unknown> | null;
  invalidation_preview: ConfigurationInvalidationPreviewDto;
}

export interface PublicCapabilityEntryDto {
  id: string;
  capability: string;
  provider_key: string;
  model_id: string;
  model_version: string | null;
  display_name: string;
  quality_tier: string | null;
  speed_tier: string | null;
  parameter_capabilities: Record<string, unknown>;
  pricing_version: string;
  pricing: Record<string, unknown>;
  status: "active" | "disabled";
  is_default: boolean;
  availability: "enabled" | "disabled";
}

export interface GenerationConfigPatchInput {
  video: {
    strategy: VideoGenerationStrategyValue;
    api_quality: ApiVideoQualityValue;
  };
  budgetMicros: string | null;
}

export interface GenerationConfigApi {
  getUserPreference(): Promise<UserPreferenceDto>;
  patchUserPreference(request: {
    expected_revision: number;
    video: GenerationConfigPatchInput["video"];
    budget: { currency: "CNY"; max_paid_cost_micros_per_run: string | null };
  }): Promise<UserPreferenceDto>;
  getProjectConfig(projectId: string): Promise<ProjectGenerationConfigurationDto>;
  patchProjectConfig(
    projectId: string,
    request: {
      expected_revision: number;
      video: GenerationConfigPatchInput["video"];
      budget: { currency: "CNY"; max_paid_cost_micros_per_run: string | null };
    },
  ): Promise<ProjectGenerationConfigurationDto>;
  listCapabilities(): Promise<{ capabilities: PublicCapabilityEntryDto[] }>;
}

export function createFetchGenerationConfigApi(baseUrl = ""): GenerationConfigApi {
  return {
    async getUserPreference() {
      return await apiFetch<UserPreferenceDto>(`${baseUrl}/api/me/generation-preferences`);
    },
    async patchUserPreference(request) {
      return await apiFetch<UserPreferenceDto>(`${baseUrl}/api/me/generation-preferences`, {
        method: "PATCH",
        body: request,
      });
    },
    async getProjectConfig(projectId) {
      return await apiFetch<ProjectGenerationConfigurationDto>(
        `${baseUrl}/api/projects/${projectId}/generation-configuration`,
      );
    },
    async patchProjectConfig(projectId, request) {
      return await apiFetch<ProjectGenerationConfigurationDto>(
        `${baseUrl}/api/projects/${projectId}/generation-configuration`,
        { method: "PATCH", body: request },
      );
    },
    async listCapabilities() {
      return await apiFetch<{ capabilities: PublicCapabilityEntryDto[] }>(
        `${baseUrl}/api/generation-capabilities`,
      );
    },
  };
}

// --- 金额转换（字符串运算，不经 Number） ------------------------------------

/** CNY 金额输入 → 微元十进制字符串；非法输入（负数/非数字/>6 位小数）返回 null。 */
export function cnyInputToMicrosString(input: string): string | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return null;
  const [intPart, fracPart = ""] = trimmed.split(".");
  const micros = (intPart + fracPart.padEnd(6, "0")).replace(/^0+(?=\d)/, "");
  return micros;
}

/** 微元十进制字符串 → CNY 展示字符串（截去尾零；null → 空串）。 */
export function microsStringToCnyInput(micros: string | null): string {
  if (micros === null) return "";
  const digits = micros.replace(/^0+(?=\d)/, "").padStart(7, "0");
  const intPart = digits.slice(0, -6).replace(/^0+(?=\d)/, "0");
  const fracPart = digits.slice(-6).replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

// --- 保存前失效预览（设计文档 §10 映射的展示层投影） --------------------------

export function computeConfigInvalidationPreview(
  current: { video: GenerationConfigurationDto["video"] },
  draft: { video: GenerationConfigPatchInput["video"] },
): ConfigurationInvalidationPreviewDto {
  const stages = new Set<string>();
  if (current.video.strategy !== draft.video.strategy) {
    stages.add("storyboard_route_resolution");
    stages.add("asset_planning");
  }
  if (current.video.api_quality !== draft.video.api_quality) {
    stages.add("asset_planning");
    stages.add("assets");
  }
  if (stages.size === 0) {
    return {
      affected_stages: ["none"],
      note: "视频策略与画质未变化；预算变更只影响后续报价，不会使现有阶段产物失效。",
    };
  }
  return {
    affected_stages: [...stages],
    note: "保存后需重新解析分镜路线并重建资产规划；配置变更不会自动触发下游生成。",
  };
}

// --- store ------------------------------------------------------------------

interface PreferenceStateSlice {
  data: UserPreferenceDto | null;
  loading: boolean;
  saving: boolean;
  conflict: boolean;
  error: string | null;
}

interface ProjectConfigStateSlice {
  data: ProjectGenerationConfigurationDto | null;
  loading: boolean;
  saving: boolean;
  conflict: boolean;
  error: string | null;
}

export interface GenerationConfigStoreState {
  userPreference: PreferenceStateSlice;
  capabilities: PublicCapabilityEntryDto[];
  capabilitiesLoading: boolean;
  projectConfigs: Record<string, ProjectConfigStateSlice>;
}

export interface GenerationConfigStore {
  state: Readonly<GenerationConfigStoreState>;
  loadUserPreference: () => Promise<void>;
  saveUserPreference: (input: GenerationConfigPatchInput) => Promise<{ ok: true } | { ok: false; conflict: boolean }>;
  loadCapabilities: () => Promise<void>;
  loadProjectConfig: (projectId: string) => Promise<void>;
  saveProjectConfig: (
    projectId: string,
    input: GenerationConfigPatchInput,
  ) => Promise<{ ok: true } | { ok: false; conflict: boolean }>;
}

function isConflictError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === 409
  );
}

export const generationConfigStoreKey: InjectionKey<GenerationConfigStore> = Symbol("generation-config-store");

export function createGenerationConfigStore(api: GenerationConfigApi): GenerationConfigStore {
  const state = reactive<GenerationConfigStoreState>({
    userPreference: { data: null, loading: false, saving: false, conflict: false, error: null },
    capabilities: [],
    capabilitiesLoading: false,
    projectConfigs: {},
  });

  function projectSlice(projectId: string): ProjectConfigStateSlice {
    const existing = state.projectConfigs[projectId];
    if (existing) return existing;
    const created: ProjectConfigStateSlice = {
      data: null,
      loading: false,
      saving: false,
      conflict: false,
      error: null,
    };
    state.projectConfigs[projectId] = created;
    return created;
  }

  async function loadUserPreference(): Promise<void> {
    const slice = state.userPreference;
    slice.loading = true;
    slice.error = null;
    try {
      slice.data = await api.getUserPreference();
      slice.conflict = false;
    } catch (error) {
      slice.error = error instanceof Error ? error.message : "load_failed";
    } finally {
      slice.loading = false;
    }
  }

  async function saveUserPreference(
    input: GenerationConfigPatchInput,
  ): Promise<{ ok: true } | { ok: false; conflict: boolean }> {
    const slice = state.userPreference;
    if (!slice.data) return { ok: false, conflict: false };
    slice.saving = true;
    slice.error = null;
    try {
      slice.data = await api.patchUserPreference({
        expected_revision: slice.data.revision,
        video: input.video,
        budget: { currency: "CNY", max_paid_cost_micros_per_run: input.budgetMicros },
      });
      slice.conflict = false;
      return { ok: true };
    } catch (error) {
      if (isConflictError(error)) {
        // 乐观并发冲突：重新加载服务器较新配置，不覆盖
        slice.conflict = true;
        await api.getUserPreference().then((data) => {
          slice.data = data;
        }).catch(() => undefined);
        return { ok: false, conflict: true };
      }
      slice.error = error instanceof Error ? error.message : "save_failed";
      return { ok: false, conflict: false };
    } finally {
      slice.saving = false;
    }
  }

  async function loadCapabilities(): Promise<void> {
    state.capabilitiesLoading = true;
    try {
      const response = await api.listCapabilities();
      state.capabilities = response.capabilities.filter((entry) => entry.availability === "enabled");
    } catch {
      state.capabilities = [];
    } finally {
      state.capabilitiesLoading = false;
    }
  }

  async function loadProjectConfig(projectId: string): Promise<void> {
    const slice = projectSlice(projectId);
    slice.loading = true;
    slice.error = null;
    try {
      slice.data = await api.getProjectConfig(projectId);
      slice.conflict = false;
    } catch (error) {
      slice.error = error instanceof Error ? error.message : "load_failed";
    } finally {
      slice.loading = false;
    }
  }

  async function saveProjectConfig(
    projectId: string,
    input: GenerationConfigPatchInput,
  ): Promise<{ ok: true } | { ok: false; conflict: boolean }> {
    const slice = projectSlice(projectId);
    if (!slice.data) return { ok: false, conflict: false };
    slice.saving = true;
    slice.error = null;
    try {
      slice.data = await api.patchProjectConfig(projectId, {
        expected_revision: slice.data.revision,
        video: input.video,
        budget: { currency: "CNY", max_paid_cost_micros_per_run: input.budgetMicros },
      });
      slice.conflict = false;
      return { ok: true };
    } catch (error) {
      if (isConflictError(error)) {
        slice.conflict = true;
        await api.getProjectConfig(projectId).then((data) => {
          slice.data = data;
        }).catch(() => undefined);
        return { ok: false, conflict: true };
      }
      slice.error = error instanceof Error ? error.message : "save_failed";
      return { ok: false, conflict: false };
    } finally {
      slice.saving = false;
    }
  }

  return {
    state: readonly(state),
    loadUserPreference,
    saveUserPreference,
    loadCapabilities,
    loadProjectConfig,
    saveProjectConfig,
  };
}

export function useGenerationConfigStore(): GenerationConfigStore {
  const store = inject(generationConfigStoreKey);
  if (store) return store;
  // 页面局部兜底：未全局 provide 时自建（与 ProjectWorkspace 局部创建
  // workspaceStore 同模式）；设置页每次打开都重新拉取服务器数据。
  return createGenerationConfigStore(createFetchGenerationConfigApi());
}
