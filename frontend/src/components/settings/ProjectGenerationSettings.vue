<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";

import GenerationStrategySettings from "./GenerationStrategySettings.vue";
import CreativeVoiceSettings from "./CreativeVoiceSettings.vue";
import CreativeArtStyleSettings from "./CreativeArtStyleSettings.vue";
import CreativeSubtitleSettings from "./CreativeSubtitleSettings.vue";
import CapabilitySlotSettings from "./CapabilitySlotSettings.vue";
import {
  computeConfigInvalidationPreview,
  useGenerationConfigStore,
  type ApiVideoQualityValue,
  type CapabilitySlotSelectionMap,
  type CreativePreferenceInput,
  type VideoGenerationStrategyValue,
} from "../../stores/generation-config";
import {
  createFetchCreativePresetsApi,
  useCreativePresetsStore,
  type VoicePreviewResult,
} from "../../stores/creative-presets";
import { ApiError, apiFetch } from "../../utils/api";

// 任务11C：项目适用口播模式（narration_first_v1 时禁用 tts 槽与付费试听，引导到文案页口播面板）。
const narrationMode = ref<string | null>(null);

/**
 * S2-2A 任务 10：项目生成设置（工作区内对话框）。
 * 展示项目当前值、来源（继承自创建时用户默认）、与当前用户默认差异、
 * 保存前失效预览；保存走项目配置 PATCH（乐观并发）。
 */

const props = defineProps<{
  projectId: string;
  open: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const store = useGenerationConfigStore();

const draft = reactive({
  strategy: "prefer_remotion" as VideoGenerationStrategyValue,
  apiQuality: "standard_720p" as ApiVideoQualityValue,
  // S2-2B 创作偏好
  voiceProfileId: null as string | null,
  artStylePresetId: null as string | null,
  // 2026-08-25：字幕样式不再提供预设选择，固定系统默认 + 参数覆盖
  subtitleOverrides: {} as Record<string, unknown>,
  // S2-2C Provider/Model 高级选择（五槽；保存时携带完整五槽）
  capabilities: {} as CapabilitySlotSelectionMap,
});

const creativeStore = useCreativePresetsStore();

function draftCreative(): CreativePreferenceInput {
  return {
    voice_profile_id: draft.voiceProfileId,
    art_style_preset_id: draft.artStylePresetId,
    // 2026-08-25：预设选择已移除，统一系统默认 + 参数覆盖
    subtitle_style_preset_id: null,
    subtitle_style_overrides: draft.subtitleOverrides,
  };
}
const saveError = ref<string | null>(null);
const previewError = ref<string | null>(null);
const previewPending = ref(false);
const loaded = ref(false);

const configState = computed(() => store.state.projectConfigs[props.projectId]);
const config = computed(() => configState.value?.data ?? null);

function applyServerData() {
  const data = store.state.projectConfigs[props.projectId]?.data;
  if (!data) return;
  draft.strategy = data.configuration.video.strategy;
  draft.apiQuality = data.configuration.video.api_quality;
  draft.voiceProfileId = data.configuration.creative.voice_profile_id;
  draft.artStylePresetId = data.configuration.creative.art_style_preset_id;
  draft.subtitleOverrides = { ...(data.configuration.creative.subtitle_style_overrides ?? {}) };
  draft.capabilities = { ...(data.configuration.capabilities ?? {}) };
}

watch(
  () => [props.open, props.projectId] as const,
  async ([open, projectId]) => {
    if (!open || !projectId) return;
    loaded.value = false;
    // 重开对话框时清空上次会话残留状态
    saveError.value = null;
    // 任务11C：读取项目口播适用模式（只读快照，失败按未启用处理）；快切项目时丢弃过期响应。
    try {
      const snapshot = await apiFetch(`/api/projects/${projectId}`);
      if (props.projectId !== projectId || !props.open) return;
      narrationMode.value = (snapshot as { narration_timing_mode?: string } | null)?.narration_timing_mode ?? null;
    } catch {
      if (props.projectId !== projectId || !props.open) return;
      narrationMode.value = null;
    }
    await store.loadProjectConfig(projectId);
    await Promise.all([
      creativeStore.loadCreativePresets(),
      creativeStore.loadVoiceProfiles(projectId),
      // S2-2C：高级设置区候选列表与目录同源（store 统一加载）
      store.loadCapabilities(projectId),
    ]);
    if (props.projectId !== projectId || !props.open) return;
    applyServerData();
    loaded.value = true;
  },
  { immediate: true },
);

// 409 冲突重载后表单同步服务器最新值，避免基于旧视图的第二次保存覆盖竞争修改。
// B2 整改：盯 conflictEpoch（每次冲突自增）而非布尔 conflict——连续两次 409
// 时 true→true 不触发 watcher，旧实现会漏掉第二次冲突的同步。
watch(
  () => configState.value?.conflictEpoch,
  () => {
    if (configState.value?.conflict) applyServerData();
  },
);

const sourceNote = computed(() => {
  if (!config.value) return "";
  if (config.value.source_user_preference_revision !== null) {
    return `继承自创建时用户默认（来源偏好版本 ${config.value.source_user_preference_revision}）`;
  }
  return "项目尚未设置，当前为系统默认回填";
});

const hasDiff = computed(() => {
  const diff = config.value?.diff_from_user_default;
  return diff !== null && diff !== undefined && Object.keys(diff).length > 0;
});

const invalidationPreview = computed(() => {
  if (!config.value || !loaded.value) return null;
  return computeConfigInvalidationPreview(
    {
      video: config.value.configuration.video,
      creative: config.value.configuration.creative,
      capabilities: config.value.configuration.capabilities,
    },
    {
      video: { strategy: draft.strategy, api_quality: draft.apiQuality },
      creative: draftCreative(),
      capabilities: draft.capabilities,
    },
  );
});

const previewStageLabels: Record<string, string> = {
  storyboard_route_resolution: "分镜路线解析",
  asset_planning: "资产规划",
  assets: "资产生成",
  llm_generation: "LLM 生成（选题/文案/分镜/资产规划/发布）",
  quote: "报价",
  none: "无",
};

function previewStageText(stages: string[]): string {
  return stages.map((stage) => previewStageLabels[stage] ?? stage).join("、");
}

async function save() {
  saveError.value = null;
  const result = await store.saveProjectConfig(props.projectId, {
    video: { strategy: draft.strategy, api_quality: draft.apiQuality },
    creative: draftCreative(),
    capabilities: draft.capabilities,
  });
  if (!result.ok) {
    if (!result.conflict) {
      saveError.value = "保存失败，请稍后重试。";
    }
    // 409 冲突：保留对话框，让用户看到"配置已被其他会话更新"告警与重载后的值
    return;
  }
  // 保存成功：表单已同步服务器值，关闭对话框
  emit("close");
}

// --- S2-2B 试听（项目级） ----------------------------------------------------
// 2026-08-23（报价体系移除）：试听直连执行——cached 零费用直接返回；
// 真实 TTS 合成写审计留痕；不建 run/不记账（登记已知限制）。
async function handleVoicePreview(voiceProfileId: string): Promise<VoicePreviewResult | null> {
  previewError.value = null;
  previewPending.value = true;
  const previewApi = createFetchCreativePresetsApi();
  try {
    // 2026-08-23（报价体系移除）：试听直连执行（cached 零费用直接返回；
    // 真实 TTS 合成写审计留痕）
    const direct = await previewApi.requestVoicePreview(props.projectId, voiceProfileId);
    if (direct?.preview_audio_uri) {
      playPreviewAudio(direct.preview_audio_uri);
      return direct;
    }
    return null;
  } catch (error) {
    previewError.value = error instanceof Error ? error.message : "试听失败，请稍后重试。";
    return null;
  } finally {
    previewPending.value = false;
  }
}

function playPreviewAudio(uri: string): void {
  const audio = new Audio(uri);
  void audio.play().catch(() => {
    previewError.value = "音频播放失败。";
  });
}

</script>

<template>
  <el-dialog
    :model-value="open"
    title="项目生成设置"
    width="960px"
    class="project-settings-dialog"
    @update:model-value="(value: boolean) => !value && emit('close')"
  >
    <div class="project-settings">
      <section v-if="configState?.loading || !loaded" class="project-settings-loading">正在加载项目配置…</section>
      <template v-else-if="config">
        <el-alert
          v-if="configState?.conflict"
          type="warning"
          :closable="false"
          title="项目配置已被其他会话更新"
          description="已重新加载服务器最新配置，请基于最新值重新调整后再保存。"
          show-icon
        />

        <section class="project-meta">
          <div class="project-meta-row">
            <span class="project-meta-label">配置来源</span>
            <span>{{ sourceNote }}</span>
          </div>
          <div class="project-meta-row">
            <span class="project-meta-label">与当前用户默认差异</span>
            <span>{{ hasDiff ? "与当前用户默认不同（以项目配置为准）" : "与当前用户默认一致" }}</span>
          </div>
        </section>

        <GenerationStrategySettings
          v-model:strategy="draft.strategy"
          v-model:api-quality="draft.apiQuality"
          :disabled="configState?.saving"
          test-id-prefix="project-"
        />

        <section class="creative-section" data-testid="project-creative-settings">
          <CreativeVoiceSettings
            v-model="draft.voiceProfileId"
            :profiles="creativeStore.state.projectVoiceProfiles[projectId] ?? []"
            :disabled="configState?.saving"
            :project-id="props.projectId"
            :on-preview="handleVoicePreview"
            :narration-mode="narrationMode"
          />
          <CreativeArtStyleSettings
            v-model="draft.artStylePresetId"
            :presets="creativeStore.state.artStylePresets"
            :disabled="configState?.saving"
          />
          <CreativeSubtitleSettings
            :overrides="draft.subtitleOverrides"
            :disabled="configState?.saving"
            @update:overrides="(value: Record<string, unknown>) => (draft.subtitleOverrides = value)"
          />
        </section>

        <section class="project-capability-section" data-testid="project-capability-settings">
          <h4 class="project-capability-title">高级设置：Provider/Model 选择</h4>
          <CapabilitySlotSettings
            v-model="draft.capabilities"
            :entries="store.state.projectCapabilities[projectId] ?? []"
            :disabled="configState?.saving"
            :narration-locked="narrationMode === 'narration_first_v1'"
            test-id-prefix="project-"
          />
        </section>

        <section
          v-if="invalidationPreview"
          class="project-invalidation"
          data-testid="project-invalidation-preview"
        >
          <h4 class="project-invalidation-title">保存后影响预览</h4>
          <p class="project-invalidation-stages">
            受影响阶段：<strong>{{ previewStageText(invalidationPreview.affected_stages) }}</strong>
          </p>
          <p class="project-invalidation-note">{{ invalidationPreview.note }}</p>
        </section>

        <p v-if="saveError" class="project-settings-error">{{ saveError }}</p>
      </template>
      <p v-else class="project-settings-error">项目配置加载失败，请关闭后重试。</p>
    </div>
    <p v-if="previewError" class="project-settings-error" data-testid="voice-preview-error">{{ previewError }}</p>
    <template #footer>
      <button class="btn btn-ghost" @click="emit('close')">取消</button>
      <button
        class="btn btn-primary"
        data-testid="save-project-config"
        :disabled="configState?.saving || !loaded"
        @click="save"
      >
        {{ configState?.saving ? "保存中…" : "保存项目设置" }}
      </button>
    </template>
  </el-dialog>
</template>

<style scoped>
.project-settings {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.project-settings-loading {
  color: #a89f94;
  font-size: 13px;
}

.project-meta {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid rgba(201, 162, 39, 0.14);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.015);
}

.project-meta-row {
  display: flex;
  gap: 12px;
  font-size: 13px;
  color: #d8d0c7;
}

.project-meta-label {
  min-width: 132px;
  color: #a89f94;
}

.project-invalidation {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid rgba(224, 122, 95, 0.3);
  border-radius: 10px;
  background: rgba(224, 122, 95, 0.06);
}

.project-invalidation-title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: #e0a883;
}

.project-invalidation-stages,
.project-invalidation-note {
  margin: 0;
  font-size: 12px;
  color: #d8d0c7;
}

.project-settings-error {
  color: #e07a5f;
  font-size: 13px;
  margin: 0;
}

.btn {
  height: 36px;
  padding: 0 16px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
  border: none;
  font-family: inherit;
}

.btn-ghost {
  background: rgba(255, 255, 255, 0.018);
  border: 1px solid rgba(201, 162, 39, 0.13);
  color: #a89f94;
  margin-right: 10px;
}

.btn-primary {
  background: rgba(201, 162, 39, 0.16);
  border: 1px solid rgba(201, 162, 39, 0.4);
  color: #f5f0e8;
}

.btn-primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.creative-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 4px;
}

.project-capability-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-top: 1px solid rgba(201, 162, 39, 0.14);
  padding-top: 14px;
}

.project-capability-title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: #d8d0c7;
}

.preview-quote-text {
  margin: 0;
  font-size: 13px;
  color: #d8d0c7;
  line-height: 1.6;
}
</style>

<!-- 弹窗限高与固定底部操作栏（非 scoped：el-dialog 内部元素跨组件边界） -->
<style>
.project-settings-dialog.el-dialog {
  /* 90vh 会叠加弹窗默认 15vh 顶部偏移导致底部溢出，取 75vh */
  max-height: 75vh;
  display: flex;
  flex-direction: column;
}

.project-settings-dialog .el-dialog__body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.project-settings-dialog .el-dialog__footer {
  flex-shrink: 0;
  border-top: 1px solid rgba(201, 162, 39, 0.14);
  background: #1f1a16;
}
</style>
