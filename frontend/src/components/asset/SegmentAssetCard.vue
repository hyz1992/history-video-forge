<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElTooltip, ElTag, ElButton } from "element-plus";
import { Upload, Refresh } from "@element-plus/icons-vue";

import type { StoryboardSegment } from "../../stores/storyboard";
import type { AssetTask } from "../../stores/asset-planning";

/* -------------------------------------------------------------------------- */
/*  Props & Emits                                                             */
/* -------------------------------------------------------------------------- */

const props = defineProps<{
  segment: StoryboardSegment;
  segmentIndex: number;
  imageTasks: AssetTask[];
  videoTasks: AssetTask[];
}>();

const emit = defineEmits<{
  "generate-task": [taskId: string];
  "regenerate-task": [taskId: string];
  "upload-asset": [taskId: string];
}>();

/* -------------------------------------------------------------------------- */
/*  Tab & carousel state                                                      */
/* -------------------------------------------------------------------------- */

type MediaTab = "image" | "video";
const activeTab = ref<MediaTab>("image");
const activeMediaIndex = ref(0);

const activeTasks = computed(() =>
  activeTab.value === "image" ? props.imageTasks : props.videoTasks,
);

const currentTask = computed(
  () => activeTasks.value[activeMediaIndex.value] ?? null,
);

// Reset index when switching tabs
watch(activeTab, () => {
  activeMediaIndex.value = 0;
});

const hasImageTasks = computed(() => props.imageTasks.length > 0);
const hasVideoTasks = computed(() => props.videoTasks.length > 0);

// TODO: replace with actual asset URL check when asset generation is wired up
const hasGeneratedMedia = computed(() => false);

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function formatSeconds(seconds: number): string {
  const rounded = Math.round(seconds * 10) / 10;
  return `${rounded}s`;
}

const primaryImageTask = computed(() => props.imageTasks[0] ?? null);
const primaryVideoTask = computed(() => props.videoTasks[0] ?? null);

const activePromptText = computed(() => {
  if (activeTab.value === 'image') {
    const task = activeTasks.value[activeMediaIndex.value];
    return task?.prompt_draft ?? props.segment.scene_description ?? '—';
  }
  const task = activeTasks.value[activeMediaIndex.value];
  return task?.prompt_draft ?? props.segment.visual_intent ?? '—';
});

const canGenerate = computed(() => {
  if (activeTab.value === "image") return !!primaryImageTask.value;
  return !!primaryVideoTask.value;
});

const activeRiskNotes = computed(() => {
  const task = activeTasks.value[activeMediaIndex.value];
  return task?.risk_notes ?? [];
});

const riskLevel = computed<"high" | "low" | null>(() => {
  if (!activeRiskNotes.value.length) return null;
  return activeRiskNotes.value.length >= 2 ? "high" : "low";
});

const riskTooltipText = computed(() =>
  activeRiskNotes.value.join("\n"),
);

const hasExistingAsset = computed(() => hasGeneratedMedia.value);

function handleGenerate() {
  const task =
    activeTab.value === "image"
      ? primaryImageTask.value
      : primaryVideoTask.value;
  if (task) {
    emit("generate-task", task.task_id);
  }
}

function handleRegenerate() {
  const task =
    activeTab.value === "image"
      ? primaryImageTask.value
      : primaryVideoTask.value;
  if (task) {
    emit("regenerate-task", task.task_id);
  }
}

function handleUpload() {
  const task =
    activeTab.value === "image"
      ? primaryImageTask.value
      : primaryVideoTask.value;
  if (task) {
    emit("upload-asset", task.task_id);
  }
}

function prevMedia() {
  if (activeMediaIndex.value > 0) {
    activeMediaIndex.value--;
  }
}

function nextMedia() {
  if (activeMediaIndex.value < activeTasks.value.length - 1) {
    activeMediaIndex.value++;
  }
}

/* -------------------------------------------------------------------------- */
/*  Audio playback                                                            */
/* -------------------------------------------------------------------------- */

// TODO: wire to actual TTS audio URL from asset store
const audioUrl = ref<string | null>(null);
const hasAudio = computed(() => !!audioUrl.value);
</script>

<template>
  <article class="segment-asset-card">
    <!-- Full-width header -->
    <div class="segment-header">
      <div class="segment-header-row">
        <span class="segment-header-number">#{{ segmentIndex + 1 }}</span>
        <span class="segment-header-time">
          {{ formatSeconds(segment.start_hint_sec) }} ~ {{ formatSeconds(segment.end_hint_sec) }}
        </span>
        <ElTag size="small" type="info">{{ segment.narrative_role }}</ElTag>
      </div>
      <p class="segment-header-excerpt">{{ segment.script_excerpt }}</p>
      <!-- Audio player for narration -->
      <div v-if="hasAudio" class="segment-header-audio">
        <audio controls :src="audioUrl!" class="audio-native" />
      </div>
      <ElTooltip v-else content="音频还未生成" placement="top">
        <div class="segment-header-audio disabled">
          <audio controls disabled class="audio-native" />
        </div>
      </ElTooltip>
    </div>

    <!-- Left: media area -->
    <div class="segment-media">
      <!-- Tab switcher -->
      <div class="segment-media-tabs">
        <button
          class="segment-media-tab"
          :class="{ active: activeTab === 'image' }"
          @click="activeTab = 'image'"
        >
          画面
        </button>
        <button
          class="segment-media-tab"
          :class="{ active: activeTab === 'video' }"
          @click="activeTab = 'video'"
        >
          视频
        </button>
      </div>

      <!-- Preview area -->
      <ElTooltip
        v-if="!hasGeneratedMedia"
        content="资产暂未生成"
        placement="bottom"
      >
        <div class="segment-media-placeholder">
          <span class="segment-media-placeholder-text">暂无</span>
        </div>
      </ElTooltip>

      <div v-else class="segment-media-preview">
        <div class="segment-media-frame">
          <span v-if="activeTasks.length > 1" class="segment-media-frame-index">
            {{ activeMediaIndex + 1 }}/{{ activeTasks.length }}
          </span>
        </div>

        <div v-if="activeTasks.length > 1" class="segment-media-nav">
          <button class="segment-media-arrow" :disabled="activeMediaIndex === 0" @click="prevMedia">
            ‹
          </button>
          <div class="segment-media-dots">
            <span
              v-for="(_, i) in activeTasks"
              :key="i"
              class="segment-media-dot"
              :class="{ active: i === activeMediaIndex }"
              @click="activeMediaIndex = i"
            />
          </div>
          <button class="segment-media-arrow" :disabled="activeMediaIndex === activeTasks.length - 1" @click="nextMedia">
            ›
          </button>
        </div>
      </div>
    </div>

    <!-- Right: prompt & actions -->
    <div class="segment-info">
      <!-- Prompt synced with tab & carousel -->
      <div class="segment-info-prompt">
        <span class="segment-info-prompt-label">
          {{ activeTab === 'image' ? '图片提示词' : '视频提示词' }}
        </span>
        <p class="segment-info-prompt-text">
          {{ activePromptText }}
        </p>
      </div>

      <!-- Risk tag -->
      <div v-if="riskLevel" class="segment-info-risk">
        <ElTooltip popper-class="risk-tooltip" placement="top">
          <template #content>
            <div class="risk-tooltip-content">
              <p v-for="(note, i) in activeRiskNotes" :key="i">{{ note }}</p>
            </div>
          </template>
          <ElTag
            size="small"
            :type="riskLevel === 'high' ? 'danger' : 'warning'"
          >
            {{ riskLevel === 'high' ? '高风险' : '注意' }}
          </ElTag>
        </ElTooltip>
      </div>

      <!-- Action buttons -->
      <div class="segment-info-actions">
        <ElButton
          v-if="!hasExistingAsset && canGenerate"
          type="primary"
          size="small"
          @click="handleGenerate"
        >
          生成
        </ElButton>
        <ElButton
          v-if="hasExistingAsset"
          size="small"
          :icon="Refresh"
          @click="handleRegenerate"
        >
          重新生成
        </ElButton>
        <ElButton
          v-if="canGenerate"
          size="small"
          :icon="Upload"
          @click="handleUpload"
        >
          上传
        </ElButton>
      </div>
    </div>

    <!-- Bottom: voice/BGM left, tags right -->
    <div class="segment-footer">
      <div class="segment-footer-left">
        <span class="segment-footer-item">BGM（自动匹配）</span>
      </div>
      <div class="segment-footer-right">
        <ElTag v-if="segment.framing_hint" size="small">
          构图: {{ segment.framing_hint }}
        </ElTag>
        <ElTag v-if="segment.motion_hint" size="small" type="warning">
          运动: {{ segment.motion_hint }}
        </ElTag>
        <ElTag v-if="segment.content_type" size="small" type="info">
          {{ segment.content_type }}
        </ElTag>
      </div>
    </div>
  </article>
</template>

<style scoped>
.segment-asset-card {
  display: grid;
  grid-template-columns: 220px 1fr;
  grid-template-rows: auto 1fr auto;
  gap: 0 var(--space-md);
  padding: var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--bg-card);
  transition: border-color 160ms ease;
}

.segment-asset-card:hover {
  border-color: var(--border-hover);
}

/* ---- Full-width header ---- */
.segment-header {
  grid-column: 1 / -1;
  grid-row: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding-bottom: var(--space-md);
  border-bottom: 1px solid var(--border-default);
  margin-bottom: var(--space-md);
}

.segment-header-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

.segment-header-number {
  font-weight: var(--font-subheading);
  font-size: 1rem;
  color: var(--accent-primary);
}

.segment-header-time {
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
  color: var(--accent-text);
}

.segment-header-excerpt {
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.65;
  color: var(--text-body);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ---- Audio control ---- */
.segment-header-audio {
  margin-top: var(--space-xs);
}

.segment-header-audio.disabled {
  opacity: 0.4;
}

.audio-native {
  width: 300px;
  height: 32px;
  border-radius: var(--radius-sm);
}

/* ---- Media area (left) ---- */
.segment-media {
  grid-column: 1;
  grid-row: 2;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.segment-media-tabs {
  display: flex;
  gap: 2px;
  background: var(--bg-panel);
  border-radius: var(--radius-sm);
  padding: 2px;
}

.segment-media-tab {
  flex: 1;
  padding: 4px 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: 0.8rem;
  cursor: pointer;
  transition: background 150ms, color 150ms;
}

.segment-media-tab.active {
  background: var(--bg-card);
  color: var(--text-body);
  font-weight: 500;
}

.segment-media-tab:hover:not(.active) {
  color: var(--text-secondary);
}

.segment-media-placeholder {
  aspect-ratio: 16 / 9;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: var(--bg-panel);
  border: 1px dashed var(--border-default);
}

.segment-media-placeholder-text {
  color: var(--text-muted);
  font-size: 0.85rem;
}

.segment-media-preview {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.segment-media-frame {
  aspect-ratio: 16 / 9;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: var(--bg-panel);
  border: 1px solid var(--border-default);
}

.segment-media-frame-index {
  position: absolute;
  bottom: 4px;
  right: 6px;
  font-size: 0.72rem;
  color: var(--text-muted);
  background: var(--bg-base);
  padding: 1px 5px;
  border-radius: 3px;
}

.segment-media-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-xs);
}

.segment-media-arrow {
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: var(--bg-panel);
  color: var(--text-muted);
  font-size: 0.9rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 150ms;
}

.segment-media-arrow:hover:not(:disabled) {
  background: var(--bg-hover);
}

.segment-media-arrow:disabled {
  opacity: 0.3;
  cursor: default;
}

.segment-media-dots {
  display: flex;
  gap: 4px;
}

.segment-media-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--border-default);
  cursor: pointer;
  transition: background 150ms;
}

.segment-media-dot.active {
  background: var(--accent-primary);
}

/* ---- Info area (right) ---- */
.segment-info {
  grid-column: 2;
  grid-row: 2;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  min-width: 0;
}

.segment-info-prompt {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.segment-info-prompt-label {
  font-size: 0.78rem;
  color: var(--text-muted);
  font-weight: 500;
}

.segment-info-prompt-text {
  margin: 0;
  font-size: 0.84rem;
  line-height: 1.6;
  color: var(--text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.segment-info-risk {
  display: flex;
  gap: var(--space-xs);
}

.risk-tooltip-content p {
  margin: 0 0 var(--space-xs);
  font-size: 0.82rem;
  line-height: 1.55;
}

.risk-tooltip-content p:last-child {
  margin-bottom: 0;
}

.segment-info-actions {
  display: flex;
  gap: var(--space-xs);
  margin-top: auto;
  padding-top: var(--space-xs);
}

/* ---- Footer (bottom, spans full width) ---- */
.segment-footer {
  grid-column: 1 / -1;
  grid-row: 3;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-lg);
  padding-top: var(--space-md);
  margin-top: var(--space-sm);
  border-top: 1px solid var(--border-default);
}

.segment-footer-left {
  display: flex;
  gap: var(--space-lg);
}

.segment-footer-right {
  display: flex;
  gap: var(--space-xs);
}

.segment-footer-item {
  font-size: 0.78rem;
  color: var(--text-muted);
}

/* ---- Responsive ---- */
@media (max-width: 719px) {
  .segment-asset-card {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto auto auto;
  }

  .segment-header {
    grid-column: 1;
    grid-row: 1;
  }

  .segment-media {
    grid-column: 1;
    grid-row: 2;
  }

  .segment-info {
    grid-column: 1;
    grid-row: 3;
  }

  .segment-footer {
    grid-column: 1;
    grid-row: 4;
  }
}
</style>

<!-- Global style for tooltip popper (rendered outside component) -->
<style>
.risk-tooltip {
  max-width: 360px;
}
</style>
