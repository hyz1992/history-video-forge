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

/** S2-2C：五个能力槽位（渲染顺序固定；服务端合同五槽齐备）。 */
export const CAPABILITY_SLOTS = [
  "llm.smart",
  "llm.flash",
  "image.generate",
  "video.image_to_video",
  "tts.synthesize",
] as const;

export type CapabilitySlot = (typeof CAPABILITY_SLOTS)[number];

/** S2-2C：单槽选择——auto（平台推荐）或 fixed（provider_model_id = 目录条目 id）。 */
export type CapabilitySlotSelection =
  | { mode: "auto" }
  | { mode: "fixed"; provider_model_id: string };

export type CapabilitySlotSelectionMap = Partial<Record<CapabilitySlot, CapabilitySlotSelection>>;

export interface GenerationConfigurationDto {
  schema_version: "generation_configuration_v1";
  video: {
    strategy: VideoGenerationStrategyValue;
    api_quality: ApiVideoQualityValue;
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

export interface CreativePreferenceInput {
  voice_profile_id: string | null;
  art_style_preset_id: string | null;
  subtitle_style_preset_id: string | null;
  subtitle_style_overrides: Record<string, unknown>;
}

export interface GenerationConfigPatchInput {
  video: {
    strategy: VideoGenerationStrategyValue;
    api_quality: ApiVideoQualityValue;
  };
  /** S2-2B：创作偏好（音色/画风/字幕）；提供即整体替换，缺省保持服务器现值。 */
  creative?: CreativePreferenceInput;
  /**
   * S2-2C：capabilities 选择（五槽）；提供即整体替换，缺省保持服务器现值
   * （首次创建由后端补全 auto）。前端保存时始终携带完整五槽。
   */
  capabilities?: CapabilitySlotSelectionMap;
}

export interface GenerationConfigApi {
  getUserPreference(): Promise<UserPreferenceDto>;
  patchUserPreference(request: {
    expected_revision: number;
    video: GenerationConfigPatchInput["video"];
    creative?: CreativePreferenceInput;
    capabilities?: CapabilitySlotSelectionMap;
  }): Promise<UserPreferenceDto>;
  getProjectConfig(projectId: string): Promise<ProjectGenerationConfigurationDto>;
  patchProjectConfig(
    projectId: string,
    request: {
      expected_revision: number;
      video: GenerationConfigPatchInput["video"];
      creative?: CreativePreferenceInput;
      capabilities?: CapabilitySlotSelectionMap;
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
      const body: Record<string, unknown> = {
        expected_revision: request.expected_revision,
        video: request.video,
      };
      if (request.creative) body.creative = request.creative;
      if (request.capabilities) body.capabilities = request.capabilities;
      return await apiFetch<UserPreferenceDto>(`${baseUrl}/api/me/generation-preferences`, {
        method: "PATCH",
        body,
      });
    },
    async getProjectConfig(projectId) {
      return await apiFetch<ProjectGenerationConfigurationDto>(
        `${baseUrl}/api/projects/${projectId}/generation-configuration`,
      );
    },
    async patchProjectConfig(projectId, request) {
      const body: Record<string, unknown> = {
        expected_revision: request.expected_revision,
        video: request.video,
      };
      if (request.creative) body.creative = request.creative;
      if (request.capabilities) body.capabilities = request.capabilities;
      return await apiFetch<ProjectGenerationConfigurationDto>(
        `${baseUrl}/api/projects/${projectId}/generation-configuration`,
        { method: "PATCH", body },
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
  current: {
    video: GenerationConfigurationDto["video"];
    creative: GenerationConfigurationDto["creative"];
    capabilities: GenerationConfigurationDto["capabilities"];
  },
  draft: {
    video: GenerationConfigPatchInput["video"];
    creative?: CreativePreferenceInput;
    capabilities?: CapabilitySlotSelectionMap;
  },
): ConfigurationInvalidationPreviewDto {
  const strategyChanged = current.video.strategy !== draft.video.strategy;
  const qualityChanged = current.video.api_quality !== draft.video.api_quality;
  // S2-2B：creative 变更（音色 → assets；画风 → asset_planning；字幕 → assets）
  const draftCreative = draft.creative;
  const creativeChanged = {
    voice: draftCreative?.voice_profile_id !== current.creative.voice_profile_id,
    art: draftCreative?.art_style_preset_id !== current.creative.art_style_preset_id,
    subtitle:
      draftCreative?.subtitle_style_preset_id !== current.creative.subtitle_style_preset_id ||
      JSON.stringify(draftCreative?.subtitle_style_overrides ?? {}) !==
        JSON.stringify(current.creative.subtitle_style_overrides ?? {}),
  };
  // S2-2C：capabilities 变更映射（llm → llm_generation；image → asset_planning+assets；
  // video/tts → assets；capabilities 缺省视为无变化——旧调用方语义）
  const slotChanged = (slot: CapabilitySlot): boolean => {
    if (draft.capabilities === undefined) return false;
    return (
      JSON.stringify(draft.capabilities[slot] ?? {}) !==
      JSON.stringify(current.capabilities[slot] ?? {})
    );
  };
  const capabilitiesChanged = {
    llm: slotChanged("llm.smart") || slotChanged("llm.flash"),
    image: slotChanged("image.generate"),
    video: slotChanged("video.image_to_video"),
    tts: slotChanged("tts.synthesize"),
  };
  const stages = new Set<string>();
  if (strategyChanged) {
    stages.add("storyboard_route_resolution");
    stages.add("asset_planning");
  }
  if (qualityChanged) {
    stages.add("asset_planning");
    stages.add("assets");
  }
  if (creativeChanged.voice) {
    stages.add("assets");
  }
  if (creativeChanged.art) {
    stages.add("asset_planning");
  }
  if (creativeChanged.subtitle) {
    stages.add("assets");
  }
  if (capabilitiesChanged.llm) {
    stages.add("llm_generation");
  }
  if (capabilitiesChanged.image) {
    stages.add("asset_planning");
    stages.add("assets");
  }
  if (capabilitiesChanged.video) {
    stages.add("assets");
  }
  if (capabilitiesChanged.tts) {
    stages.add("assets");
  }
  if (stages.size === 0) {
    return {
      affected_stages: ["none"],
      note: "视频策略、画质、创作偏好与 Provider/Model 均未变化；预算变更只影响后续报价，不会使现有阶段产物失效。",
    };
  }
  const note = strategyChanged
    ? "保存后需重新解析分镜路线并重建资产规划；配置变更不会自动触发下游生成。"
    : creativeChanged.art
      ? "保存后需重新生成资产规划（画风影响美术圣经与生图提示词）；配置变更不会自动触发下游生成。"
      : creativeChanged.voice || creativeChanged.subtitle
        ? "保存后需重新生成相关资产（音色/字幕样式影响 TTS 与字幕轨）；配置变更不会自动触发下游生成。"
        : capabilitiesChanged.llm
          ? "保存后需重新生成相关 LLM 阶段（选题/文案/分镜/资产规划/发布使用新的 Provider/Model）；配置变更不会自动触发下游生成。"
          : capabilitiesChanged.image || capabilitiesChanged.video || capabilitiesChanged.tts
            ? "保存后需重新生成相关媒体资产（Provider/Model 变化影响生图/视频/TTS 执行模型）；配置变更不会自动触发下游生成。"
            : "保存后需更新视频任务参数并重建资产生成；配置变更不会自动触发下游生成。";
  return {
    affected_stages: [...stages],
    note,
  };
}

// --- store ------------------------------------------------------------------

interface PreferenceStateSlice {
  data: UserPreferenceDto | null;
  loading: boolean;
  saving: boolean;
  conflict: boolean;
  /**
   * 冲突代际计数（外部审查 B2 整改）：conflict 是布尔，连续两次 409 时
   * true→true 不触发 watcher，表单不会同步最新重载值。每次冲突自增，
   * 组件 watcher 改盯 epoch，保证每次冲突都触发同步。
   */
  conflictEpoch: number;
  error: string | null;
}

interface ProjectConfigStateSlice {
  data: ProjectGenerationConfigurationDto | null;
  loading: boolean;
  saving: boolean;
  conflict: boolean;
  conflictEpoch: number;
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
    userPreference: { data: null, loading: false, saving: false, conflict: false, conflictEpoch: 0, error: null },
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
      conflictEpoch: 0,
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
        ...(input.creative ? { creative: input.creative } : {}),
        ...(input.capabilities ? { capabilities: input.capabilities } : {}),
      });
      slice.conflict = false;
      return { ok: true };
    } catch (error) {
      if (isConflictError(error)) {
        // 乐观并发冲突：先完成重载赋值、再置冲突标记（同一同步块）。
        // 组件 conflict watch（flush pre）在微任务阶段执行，必须读到最新 data，
        // 否则表单会把草稿重置为冲突前的旧服务器值。
        const reloaded = await api.getUserPreference().catch(() => null);
        if (reloaded) slice.data = reloaded;
        slice.conflict = true;
        slice.conflictEpoch += 1;
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
        ...(input.creative ? { creative: input.creative } : {}),
        ...(input.capabilities ? { capabilities: input.capabilities } : {}),
      });
      slice.conflict = false;
      return { ok: true };
    } catch (error) {
      if (isConflictError(error)) {
        // 与 saveUserPreference 相同：先完成重载赋值、再置冲突标记
        const reloaded = await api.getProjectConfig(projectId).catch(() => null);
        if (reloaded) slice.data = reloaded;
        slice.conflict = true;
        slice.conflictEpoch += 1;
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
