import { inject, reactive, readonly, type InjectionKey } from "vue";
import { apiFetch } from "../utils/api";

/**
 * S2-2B 任务 9：创作偏好目录与试听 store。
 *
 * - 画风/字幕 preset 公开目录（GET /api/creative-presets）。
 * - 音色库列表（GET /api/me/voice-profiles，公共 + 本人私有；含 cached 音频）。
 * - 试听：cached 音频经列表直接播放（零费用）；无缓存时项目设置页走
 *   quote + 提交协议（POST /api/projects/:id/voice-profiles/:vid/preview），
 *   提交前弹窗展示报价（estimated/authorization/unbounded）。
 */

export interface CreativePresetDto {
  preset_id: string;
  preset_version: string;
  display_name: string;
  description: string;
  overridable_fields: string[] | null;
  summary: string;
}

export interface VoiceProfileDto {
  voice_profile_id: string;
  kind: "preset" | "generated" | "system";
  name: string;
  description: string;
  voice_traits: string[];
  avoid_traits: string[];
  gender_tone: string | null;
  age_band: string | null;
  pitch: string | null;
  pace: string | null;
  energy: number | null;
  authority: number | null;
  suspense: number | null;
  warmth: number | null;
  preview_text: string;
  preview_audio_uri: string | null;
  visibility: "public" | "private";
  provider_status: string;
}

export interface VoicePreviewResult {
  preview_audio_uri: string;
  source: "cached" | "generated";
  provider_voice_id: string | null;
}

/** 2026-08-23（报价体系移除）：试听直连，无额外提交字段。 */
export interface VoicePreviewRequestOptions {
  /** 预留：未来如需要单次覆盖语义可在此扩展。 */
  [key: string]: unknown;
}

export interface CreativePresetsApi {
  listCreativePresets(): Promise<{ art_style: CreativePresetDto[]; subtitle: CreativePresetDto[] }>;
  listVoiceProfiles(): Promise<{ profiles: VoiceProfileDto[] }>;
  requestVoicePreview(
    projectId: string,
    voiceProfileId: string,
    options?: VoicePreviewRequestOptions,
  ): Promise<VoicePreviewResult>;
}

export function createFetchCreativePresetsApi(baseUrl = ""): CreativePresetsApi {
  return {
    async listCreativePresets() {
      return await apiFetch<{ art_style: CreativePresetDto[]; subtitle: CreativePresetDto[] }>(
        `${baseUrl}/api/creative-presets`,
      );
    },
    async listVoiceProfiles() {
      return await apiFetch<{ profiles: VoiceProfileDto[] }>(`${baseUrl}/api/me/voice-profiles`);
    },
    async requestVoicePreview(projectId, voiceProfileId, options) {
      const body: Record<string, unknown> = {};
      if (options?.cost_quote_id) body.cost_quote_id = options.cost_quote_id;
      if (options?.idempotency_key) body.idempotency_key = options.idempotency_key;
      if (options?.authorize_budget_override) body.authorize_budget_override = true;
      if (options?.run_overrides) body.run_overrides = options.run_overrides;
      return await apiFetch<VoicePreviewResult>(
        `${baseUrl}/api/projects/${projectId}/voice-profiles/${voiceProfileId}/preview`,
        { method: "POST", body },
      );
    },
  };
}

export interface CreativePresetsStoreState {
  artStylePresets: CreativePresetDto[];
  subtitlePresets: CreativePresetDto[];
  voiceProfiles: VoiceProfileDto[];
  loading: boolean;
  previewing: Record<string, boolean>;
  error: string | null;
}

export interface CreativePresetsStore {
  state: Readonly<CreativePresetsStoreState>;
  loadCreativePresets: () => Promise<void>;
  loadVoiceProfiles: () => Promise<void>;
  previewVoice: (
    projectId: string,
    voiceProfileId: string,
    options?: VoicePreviewRequestOptions,
  ) => Promise<VoicePreviewResult | null>;
}

export const creativePresetsStoreKey: InjectionKey<CreativePresetsStore> = Symbol("creative-presets-store");

export function createCreativePresetsStore(api: CreativePresetsApi): CreativePresetsStore {
  const state = reactive<CreativePresetsStoreState>({
    artStylePresets: [],
    subtitlePresets: [],
    voiceProfiles: [],
    loading: false,
    previewing: {},
    error: null,
  });

  async function loadCreativePresets(): Promise<void> {
    state.loading = true;
    state.error = null;
    try {
      const response = await api.listCreativePresets();
      state.artStylePresets = response.art_style;
      state.subtitlePresets = response.subtitle;
    } catch (error) {
      state.error = error instanceof Error ? error.message : "creative_presets_load_failed";
    } finally {
      state.loading = false;
    }
  }

  async function loadVoiceProfiles(): Promise<void> {
    state.loading = true;
    state.error = null;
    try {
      const response = await api.listVoiceProfiles();
      state.voiceProfiles = response.profiles;
    } catch (error) {
      state.error = error instanceof Error ? error.message : "voice_profiles_load_failed";
    } finally {
      state.loading = false;
    }
  }

  async function previewVoice(
    projectId: string,
    voiceProfileId: string,
    options?: VoicePreviewRequestOptions,
  ): Promise<VoicePreviewResult | null> {
    state.previewing[voiceProfileId] = true;
    state.error = null;
    try {
      return await api.requestVoicePreview(projectId, voiceProfileId, options);
    } catch (error) {
      state.error = error instanceof Error ? error.message : "voice_preview_failed";
      return null;
    } finally {
      state.previewing[voiceProfileId] = false;
    }
  }

  return {
    state: readonly(state),
    loadCreativePresets,
    loadVoiceProfiles,
    previewVoice,
  };
}

export function useCreativePresetsStore(): CreativePresetsStore {
  const store = inject(creativePresetsStoreKey);
  if (store) return store;
  return createCreativePresetsStore(createFetchCreativePresetsApi());
}

// --- 字幕样式预览（纯前端投影，与后端解析规则同源） --------------------------

const SHADOW_VALUES: Record<string, string> = {
  none: "none",
  soft: "0 2px 8px rgba(0,0,0,0.6)",
  strong: "0 4px 12px rgba(0,0,0,0.8)",
};

export interface SubtitleStylePreview {
  font_size_px: number;
  font_weight: number;
  line_height: number;
  max_lines: number;
  text_color: string;
  stroke_color: string;
  stroke_width_px: number;
  shadow: string;
  background_color: string;
  background_opacity: number;
  position: "bottom" | "middle" | "top";
  max_width_pct: number;
  text_align: "left" | "center" | "right";
}

/** 系统默认字幕样式（DEFAULT_SUBTITLE_STYLE 的展示层投影）：参数表单默认值
 * 与预览骨架同源，避免两处维护漂移。 */
export const SUBTITLE_STYLE_BASE_PREVIEW: SubtitleStylePreview = {
  font_size_px: 46,
  font_weight: 700,
  line_height: 1.5,
  max_lines: 2,
  text_color: "#ffffff",
  stroke_color: "#000000",
  stroke_width_px: 2.5,
  shadow: "0 2px 8px rgba(0,0,0,0.6)",
  background_color: "#000000",
  background_opacity: 0,
  position: "bottom",
  max_width_pct: 0.9,
  text_align: "center",
};

/** 解析后的字幕样式预览（后端 applySubtitleStyleOverrides 的展示层投影）。 */
export function resolveSubtitleStylePreview(
  preset: CreativePresetDto | null,
  overrides: Record<string, unknown>,
): SubtitleStylePreview {
  const base: SubtitleStylePreview = { ...SUBTITLE_STYLE_BASE_PREVIEW };
  void preset; // 预设具体样式值由后端解析冻结；预览框使用默认骨架 + 覆盖值
  // 数值边界与后端 SubtitleStyleOverrideSet 一致（预览层投影同源钳制）
  const clamp = (value: unknown, min: number, max: number): number | undefined =>
    typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
      ? value
      : undefined;
  const fontSize = clamp(overrides.font_size_px, 18, 96);
  const fontWeight = clamp(overrides.font_weight, 100, 900);
  const maxLines = clamp(overrides.max_lines, 1, 4);
  const strokeWidth = clamp(overrides.stroke_width_px, 0, 12);
  const backgroundOpacity = clamp(overrides.background_opacity, 0, 1);
  const maxWidthPct = clamp(overrides.max_width_pct, 0.4, 1);
  return {
    ...base,
    ...(fontSize !== undefined ? { font_size_px: fontSize } : {}),
    ...(fontWeight !== undefined ? { font_weight: fontWeight } : {}),
    ...(typeof overrides.line_height === "number" &&
    overrides.line_height >= 1 &&
    overrides.line_height <= 2
      ? { line_height: overrides.line_height }
      : {}),
    ...(maxLines !== undefined ? { max_lines: maxLines } : {}),
    ...(typeof overrides.text_color === "string" ? { text_color: overrides.text_color } : {}),
    ...(typeof overrides.stroke_color === "string" ? { stroke_color: overrides.stroke_color } : {}),
    ...(strokeWidth !== undefined ? { stroke_width_px: strokeWidth } : {}),
    ...(typeof overrides.shadow === "string" ? { shadow: SHADOW_VALUES[overrides.shadow] ?? overrides.shadow } : {}),
    ...(typeof overrides.background_color === "string" ? { background_color: overrides.background_color } : {}),
    ...(backgroundOpacity !== undefined ? { background_opacity: backgroundOpacity } : {}),
    ...(overrides.position === "bottom" || overrides.position === "middle" || overrides.position === "top"
      ? { position: overrides.position }
      : {}),
    ...(maxWidthPct !== undefined ? { max_width_pct: maxWidthPct } : {}),
    ...(overrides.text_align === "left" || overrides.text_align === "center" || overrides.text_align === "right"
      ? { text_align: overrides.text_align }
      : {}),
  };
}
