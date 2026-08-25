<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";

import GenerationStrategySettings from "../components/settings/GenerationStrategySettings.vue";
import CreativeVoiceSettings from "../components/settings/CreativeVoiceSettings.vue";
import CreativeArtStyleSettings from "../components/settings/CreativeArtStyleSettings.vue";
import CreativeSubtitleSettings from "../components/settings/CreativeSubtitleSettings.vue";
import CapabilitySlotSettings from "../components/settings/CapabilitySlotSettings.vue";
import {
  useGenerationConfigStore,
  type ApiVideoQualityValue,
  type CapabilitySlotSelectionMap,
  type CreativePreferenceInput,
  type VideoGenerationStrategyValue,
} from "../stores/generation-config";
import { useCreativePresetsStore } from "../stores/creative-presets";

/**
 * S2-2A 任务 10：用户默认生成设置页（/settings）。
 * 用户默认只在创建新项目时复制为项目配置，不影响已有项目。
 */

const router = useRouter();
const store = useGenerationConfigStore();

const draft = reactive({
  strategy: "prefer_remotion" as VideoGenerationStrategyValue,
  apiQuality: "standard_720p" as ApiVideoQualityValue,
  // S2-2B 创作偏好（用户默认；只影响新项目）
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

function applyServerData() {
  const data = store.state.userPreference.data;
  if (!data) return;
  draft.strategy = data.configuration.video.strategy;
  draft.apiQuality = data.configuration.video.api_quality;
  draft.voiceProfileId = data.configuration.creative.voice_profile_id;
  draft.artStylePresetId = data.configuration.creative.art_style_preset_id;
  draft.subtitleOverrides = { ...(data.configuration.creative.subtitle_style_overrides ?? {}) };
  draft.capabilities = { ...(data.configuration.capabilities ?? {}) };
}

onMounted(async () => {
  await store.loadUserPreference();
  applyServerData();
  await Promise.all([
    store.loadCapabilities(),
    creativeStore.loadCreativePresets(),
    creativeStore.loadVoiceProfiles(),
  ]);
});

// 409 冲突重载后表单同步服务器最新值：用户看得见竞争修改，避免基于旧
// 视图的第二次保存静默覆盖其他会话的变更。
// B2 整改：盯 conflictEpoch（每次冲突自增）而非布尔 conflict——连续两次 409
// 时 true→true 不触发 watcher，旧实现会漏掉第二次冲突的同步。
watch(
  () => store.state.userPreference.conflictEpoch,
  () => {
    if (store.state.userPreference.conflict) applyServerData();
  },
);

const loadFailed = computed(
  () => store.state.userPreference.error !== null && store.state.userPreference.data === null,
);

async function save() {
  saveError.value = null;
  const result = await store.saveUserPreference({
    video: { strategy: draft.strategy, api_quality: draft.apiQuality },
    creative: draftCreative(),
    capabilities: draft.capabilities,
  });
  if (!result.ok && !result.conflict) {
    saveError.value = "保存失败，请稍后重试。";
  }
}

function goBack() {
  router.push("/projects");
}
</script>

<template>
  <div class="settings-page">
    <header class="settings-header">
      <button class="btn btn-ghost" @click="goBack">返回项目列表</button>
      <h2 class="settings-title">生成偏好设置</h2>
      <p class="settings-subtitle">这里的默认配置只影响新项目：创建项目时会复制为该项目的初始配置；已有项目请在工作区的项目设置中单独修改。</p>
    </header>

    <main class="settings-body">
      <section v-if="store.state.userPreference.loading" class="settings-loading">正在加载…</section>
      <section v-else-if="loadFailed" class="settings-load-failed" data-testid="preference-load-error">
        <p>用户偏好加载失败（{{ store.state.userPreference.error }}），为避免误覆盖已有配置，暂不展示编辑表单。</p>
        <button class="btn btn-primary" @click="store.loadUserPreference().then(applyServerData)">重试加载</button>
      </section>
      <template v-else>
        <el-alert
          v-if="store.state.userPreference.conflict"
          data-testid="preference-conflict"
          type="warning"
          :closable="false"
          title="配置已被其他会话更新"
          description="服务器上的配置比本页更新（可能是你在其他窗口保存过）。已为你重新加载最新配置，请基于最新值重新调整后再保存。"
          show-icon
        />
        <GenerationStrategySettings
          v-model:strategy="draft.strategy"
          v-model:api-quality="draft.apiQuality"
          :disabled="store.state.userPreference.saving"
        />

        <section class="creative-section" data-testid="user-creative-settings">
          <CreativeVoiceSettings
            v-model="draft.voiceProfileId"
            :profiles="creativeStore.state.voiceProfiles"
            :disabled="store.state.userPreference.saving"
            :project-id="null"
          />
          <CreativeArtStyleSettings
            v-model="draft.artStylePresetId"
            :presets="creativeStore.state.artStylePresets"
            :disabled="store.state.userPreference.saving"
          />
          <CreativeSubtitleSettings
            :overrides="draft.subtitleOverrides"
            :disabled="store.state.userPreference.saving"
            @update:overrides="(value: Record<string, unknown>) => (draft.subtitleOverrides = value)"
          />
        </section>
        <p v-if="saveError" class="settings-error">{{ saveError }}</p>
        <div class="settings-actions">
          <button
            class="btn btn-primary"
            data-testid="save-preference"
            :disabled="store.state.userPreference.saving"
            @click="save"
          >
            {{ store.state.userPreference.saving ? "保存中…" : "保存默认设置" }}
          </button>
        </div>

        <section class="capability-section">
          <h3 class="capability-title">高级设置：Provider/Model 选择</h3>
          <p class="capability-hint">
            选择各生成能力使用的模型：自动 = 平台按能力目录推荐；也可固定到目录中的具体模型（候选随部署目录自动扩展）。
          </p>
          <CapabilitySlotSettings
            v-model="draft.capabilities"
            :entries="store.state.capabilities"
            :disabled="store.state.userPreference.saving"
            data-testid="capability-settings"
          />
        </section>
      </template>
    </main>
  </div>
</template>

<style scoped>
.creative-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 16px;
}

.settings-page {
  min-height: 100vh;
  /* 与项目工作区同一背景：暖黑渐变 + 径向暖光，正文 #d8cec0 */
  background:
    radial-gradient(ellipse at 18% 16%, rgba(184, 115, 51, 0.16) 0%, transparent 44%),
    radial-gradient(ellipse at 84% 20%, rgba(201, 162, 39, 0.11) 0%, transparent 42%),
    linear-gradient(180deg, #0b0b0a 0%, #0d0d0d 38%, #130f0d 100%);
  color: #d8cec0;
  display: flex;
  flex-direction: column;
  position: relative;
}

/* 与工作区一致的点阵网格纹理（顶部径向渐隐） */
.settings-page::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  opacity: 0.12;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.018) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: radial-gradient(circle at 50% 0%, black 0%, transparent 82%);
  z-index: 0;
}

.settings-header {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 932px;
  margin: 0 auto;
  padding: 22px 36px 14px;
  border-bottom: 1px solid rgba(201, 162, 39, 0.14);
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}

.settings-title {
  margin: 0;
  font-size: 20px;
  font-weight: 750;
  color: #f5f0e8;
}

.settings-subtitle {
  margin: 0;
  font-size: 13px;
  color: #a89f94;
}

.settings-body {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 932px;
  margin: 0 auto;
  padding: 26px 36px 48px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.settings-loading {
  color: #a89f94;
  font-size: 13px;
}

.settings-load-failed {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid rgba(224, 122, 95, 0.3);
  border-radius: 10px;
  background: rgba(224, 122, 95, 0.06);
  color: #e0a883;
  font-size: 13px;
}

.settings-error {
  color: #e07a5f;
  font-size: 13px;
  margin: 0;
}

.settings-actions {
  display: flex;
  gap: 12px;
}

.btn {
  height: 38px;
  padding: 0 18px;
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

.capability-section {
  margin-top: 18px;
  border-top: 1px solid rgba(201, 162, 39, 0.14);
  padding-top: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.capability-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}

.capability-hint {
  margin: 0;
  font-size: 12px;
  color: #6b635a;
}

.capability-summary {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.capability-group {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 8px 12px;
  border: 1px solid rgba(201, 162, 39, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.015);
}

.capability-group-label {
  font-size: 13px;
  font-weight: 650;
  min-width: 150px;
}

.capability-group-models {
  font-size: 12px;
  color: #a89f94;
}

.capability-empty {
  margin: 0;
  font-size: 12px;
  color: #6b635a;
}
</style>
