<script setup lang="ts">
import { ref } from "vue";

import type { VoicePreviewResult, VoiceProfileDto } from "../../stores/creative-presets";

/**
 * S2-2B 任务 9：音色设置区。
 * - "自动匹配"= null；选中档案 = voice_profile_id。
 * - 试听：cached 音频（列表 preview_audio_uri）直接播放（零费用）；
 *   无缓存时需项目上下文走 quote + 提交协议（父组件注入 onPreview）；
 *   用户设置页（无项目）对非 cached 显示引导文案。
 */
const props = defineProps<{
  modelValue: string | null;
  profiles: VoiceProfileDto[];
  disabled?: boolean;
  /** 项目上下文：提供时非 cached 试听走项目级 quote 流程。 */
  projectId?: string | null;
  onPreview?: (voiceProfileId: string) => Promise<VoicePreviewResult | null>;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string | null): void;
}>();

const previewError = ref<string | null>(null);
const previewingId = ref<string | null>(null);

async function handlePreview(profile: VoiceProfileDto) {
  previewError.value = null;
  // cached：零费用直接播放
  if (profile.preview_audio_uri) {
    playAudio(profile.preview_audio_uri);
    return;
  }
  if (!props.projectId || !props.onPreview) {
    previewError.value = "该音色尚未生成试听音频。请在项目设置中试听（付费部署下会先展示报价确认）。";
    return;
  }
  previewingId.value = profile.voice_profile_id;
  try {
    const result = await props.onPreview(profile.voice_profile_id);
    if (result?.preview_audio_uri) {
      playAudio(result.preview_audio_uri);
    } else {
      previewError.value = "试听失败，请稍后重试。";
    }
  } finally {
    previewingId.value = null;
  }
}

function playAudio(uri: string) {
  const audio = new Audio(uri);
  void audio.play().catch(() => {
    previewError.value = "音频播放失败。";
  });
}

function traitText(profile: VoiceProfileDto): string {
  const parts: string[] = [];
  if (profile.gender_tone) parts.push(profile.gender_tone);
  if (profile.age_band) parts.push(profile.age_band);
  if (profile.pitch) parts.push(profile.pitch);
  if (profile.pace) parts.push(profile.pace);
  return parts.join(" · ");
}
</script>

<template>
  <section class="creative-voice" data-testid="creative-voice-settings">
    <h3 class="creative-title">音色</h3>
    <p class="creative-hint">选择口播音色；「自动匹配」由系统按内容风格从可用音色中匹配。</p>
    <div class="voice-cards">
      <button
        type="button"
        class="voice-card"
        :class="{ active: modelValue === null }"
        :disabled="disabled"
        data-testid="voice-auto"
        @click="emit('update:modelValue', null)"
      >
        <span class="voice-card-name">自动匹配</span>
        <span class="voice-card-desc">按内容风格自动选择最合适的音色</span>
      </button>
      <div
        v-for="profile in profiles"
        :key="profile.voice_profile_id"
        class="voice-card"
        :class="{ active: modelValue === profile.voice_profile_id }"
      >
        <button
          type="button"
          class="voice-card-select"
          :disabled="disabled"
          :data-testid="`voice-${profile.voice_profile_id}`"
          @click="emit('update:modelValue', profile.voice_profile_id)"
        >
          <span class="voice-card-name">{{ profile.name }}</span>
          <span class="voice-card-desc">{{ profile.description }}</span>
          <span class="voice-card-traits">{{ traitText(profile) }}</span>
        </button>
        <button
          type="button"
          class="voice-preview-btn"
          :disabled="disabled || previewingId === profile.voice_profile_id"
          :data-testid="`voice-preview-${profile.voice_profile_id}`"
          @click="handlePreview(profile)"
        >
          {{ previewingId === profile.voice_profile_id ? "试听中…" : "试听" }}
        </button>
      </div>
    </div>
    <p v-if="previewError" class="creative-error" data-testid="voice-preview-error">{{ previewError }}</p>
  </section>
</template>

<style scoped>
.creative-voice {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  border: 1px solid rgba(201, 162, 39, 0.14);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.015);
}

.creative-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: #e8dfd2;
}

.creative-hint {
  margin: 0;
  font-size: 12px;
  color: #a89f94;
}

.voice-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.voice-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.012);
}

.voice-card.active {
  border-color: rgba(201, 162, 39, 0.55);
  background: rgba(201, 162, 39, 0.07);
}

.voice-card-select {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
  background: none;
  border: none;
  color: inherit;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
}

.voice-card-name {
  font-size: 13px;
  font-weight: 650;
  color: #f0e9dd;
}

.voice-card-desc,
.voice-card-traits {
  font-size: 11px;
  color: #a89f94;
}

.voice-preview-btn {
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid rgba(201, 162, 39, 0.35);
  background: rgba(201, 162, 39, 0.1);
  color: #e8dfd2;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}

.voice-preview-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.creative-error {
  margin: 0;
  font-size: 12px;
  color: #e07a5f;
}
</style>
