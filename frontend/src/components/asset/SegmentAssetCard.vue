<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElTooltip, ElTag, ElButton, ElIcon } from "element-plus";
import { Upload, CopyDocument } from "@element-plus/icons-vue";

import type { StoryboardSegment } from "../../stores/storyboard";
import type { AssetTask } from "../../stores/asset-planning";

/* -------------------------------------------------------------------------- */
/*  Props & Emits                                                             */
/* -------------------------------------------------------------------------- */

interface ExecutionInfo {
  task_id: string;
  status: string;
  output_artifact_ids: string[];
}

interface ArtifactInfo {
  artifact_id: string;
  artifact_type: string;
  file_uri: string;
  metadata: Record<string, unknown>;
}

const props = defineProps<{
  segment: StoryboardSegment;
  segmentIndex: number;
  imageTasks: AssetTask[];
  videoTasks: AssetTask[];
  executionsByTaskId: Map<string, ExecutionInfo>;
  artifactsById: Map<string, ArtifactInfo>;
  uploadingTaskId: string | null;
  projectId: string;
  focusTaskId: string | null;
}>();

const emit = defineEmits<{
  "upload-file": [taskId: string, file: File];
}>();

/* -------------------------------------------------------------------------- */
/*  Label mappings (en → zh)                                                  */
/* -------------------------------------------------------------------------- */

const FRAMING_LABELS: Record<string, string> = {
  wide: "远景",
  close: "近景",
  medium: "中景",
  symbolic: "意象构图",
  extreme_close: "特写",
  detail: "细节特写",
};

const MOTION_LABELS: Record<string, string> = {
  push_in: "推进",
  pull_back: "拉远",
  pan: "平移",
  static: "静止",
};

const CONTENT_LABELS: Record<string, string> = {
  live_action: "实拍风格",
};

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

watch(activeTab, () => {
  activeMediaIndex.value = 0;
});

// When a blocked-item chip is clicked in the overview, switch to the
// correct tab and task index within this card.
watch(
  () => props.focusTaskId,
  (taskId) => {
    if (!taskId) return;
    // Check image tasks
    const imgIdx = props.imageTasks.findIndex(t => t.task_id === taskId);
    if (imgIdx >= 0) {
      activeTab.value = "image";
      activeMediaIndex.value = imgIdx;
      return;
    }
    // Check video tasks
    const vidIdx = props.videoTasks.findIndex(t => t.task_id === taskId);
    if (vidIdx >= 0) {
      activeTab.value = "video";
      activeMediaIndex.value = vidIdx;
    }
  },
);

const hasImageTasks = computed(() => props.imageTasks.length > 0);
const hasVideoTasks = computed(() => props.videoTasks.length > 0);

/* -------------------------------------------------------------------------- */
/*  Execution & artifact lookups                                              */
/* -------------------------------------------------------------------------- */

const currentExecution = computed(() => {
  const task = activeTasks.value[activeMediaIndex.value];
  if (!task) return null;
  return props.executionsByTaskId.get(task.task_id) ?? null;
});

const currentArtifact = computed(() => {
  if (!currentExecution.value || currentExecution.value.output_artifact_ids.length === 0) return null;
  const primaryId = currentExecution.value.output_artifact_ids[0]!;
  return props.artifactsById.get(primaryId) ?? null;
});

const hasGeneratedMedia = computed(() => !!currentArtifact.value);

const isCurrentUploading = computed(() => {
  const task = activeTasks.value[activeMediaIndex.value];
  return task ? props.uploadingTaskId === task.task_id : false;
});

/* -------------------------------------------------------------------------- */
/*  Status & actions                                                          */
/* -------------------------------------------------------------------------- */

const statusLabel = computed(() => {
  if (!currentExecution.value) return null;
  const map: Record<string, string> = {
    waiting_manual_upload: "待上传",
    running: "生成中",
    completed: "已完成",
    failed: "失败",
    accepted: "已确认",
    planned: "待执行",
    ready: "就绪",
  };
  return map[currentExecution.value.status] ?? currentExecution.value.status;
});

const canUpload = computed(() => {
  return !!currentExecution.value && (
    currentExecution.value.status === "waiting_manual_upload" ||
    currentExecution.value.status === "completed" ||
    currentExecution.value.status === "accepted"
  ) && (activeTab.value === "image" || activeTab.value === "video");
});

const acceptFileTypes = computed(() => {
  if (activeTab.value === "image") return "image/png,image/jpeg,image/webp";
  return "video/mp4,video/quicktime";
});

const fileInput = ref<HTMLInputElement | null>(null);

function triggerFileUpload() {
  fileInput.value?.click();
}

function onFileSelected(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  const task = activeTasks.value[activeMediaIndex.value];
  if (task) {
    emit("upload-file", task.task_id, file);
  }
  target.value = "";
}

function artifactUrl(artifactId: string): string {
  return `/api/projects/${props.projectId}/artifacts/${artifactId}/file`;
}

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

/* -------------------------------------------------------------------------- */
/*  Audio playback                                                            */
/* -------------------------------------------------------------------------- */

const audioUrl = ref<string | null>(null);
const hasAudio = computed(() => !!audioUrl.value);

// Resolve audio URL from manifest artifacts for this segment
const segmentAudioUrl = computed(() => {
  const ttsExec = Array.from(props.executionsByTaskId.values())
    .find((e) => e.task_type === "tts_audio" || e.task_type === "tts_merged_audio");
  if (ttsExec && ttsExec.output_artifact_ids.length > 0) {
    const artId = ttsExec.output_artifact_ids[0]!;
    const art = props.artifactsById.get(artId);
    if (art) return artifactUrl(art.artifact_id);
  }
  return null;
});

watch(segmentAudioUrl, (url) => {
  audioUrl.value = url;
}, { immediate: true });

/* -------------------------------------------------------------------------- */
/*  Copy                                                                      */
/* -------------------------------------------------------------------------- */

const copyFeedback = ref(false);

function copyPrompt() {
  const text = activePromptText.value;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => showCopyFeedback(),
      () => fallbackCopy(text),
    );
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text: string) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;left:-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
  showCopyFeedback();
}

function showCopyFeedback() {
  copyFeedback.value = true;
  setTimeout(() => { copyFeedback.value = false; }, 1500);
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
        <ElTooltip
          v-if="!hasVideoTasks"
          content="本镜头采用图片+运镜，无需视频"
          placement="top"
        >
          <span class="segment-media-tab disabled">视频</span>
        </ElTooltip>
        <button
          v-else
          class="segment-media-tab"
          :class="{ active: activeTab === 'video' }"
          @click="activeTab = 'video'"
        >
          视频
        </button>
        <span v-if="!hasVideoTasks" class="segment-media-tab-hint">图片+运镜</span>
      </div>

      <!-- No tasks of this type -->
      <div v-if="activeTasks.length === 0" class="segment-media-placeholder">
        <ElTag size="small" type="info">无需生成</ElTag>
        <span class="segment-media-placeholder-text">
          {{ activeTab === 'video' ? '本镜头采用图片+运镜' : '无画面任务' }}
        </span>
      </div>

      <!-- Preview area: no artifact yet -->
      <template v-else-if="!hasGeneratedMedia">
        <div
          class="segment-media-placeholder"
          :class="{ clickable: canUpload }"
          @click="canUpload && triggerFileUpload()"
        >
          <ElTag
            v-if="statusLabel && currentExecution?.status === 'waiting_manual_upload'"
            type="warning"
            size="small"
          >
            {{ statusLabel }}
          </ElTag>
          <ElTag
            v-else-if="statusLabel"
            size="small"
            type="info"
          >
            {{ statusLabel }}
          </ElTag>
          <span class="segment-media-placeholder-text">
            {{ canUpload ? '点击此处上传文件' : (statusLabel ? '' : '暂无') }}
          </span>
        </div>
      </template>

      <!-- Preview area: artifact exists -->
      <template v-else>
        <div class="segment-media-preview">
          <img
            v-if="currentArtifact?.artifact_type === 'image'"
            :src="artifactUrl(currentArtifact.artifact_id)"
            class="segment-media-image"
            alt="上传的图片"
          />
          <video
            v-else-if="currentArtifact?.artifact_type === 'video'"
            :src="artifactUrl(currentArtifact.artifact_id)"
            class="segment-media-video"
            controls
          />
          <!-- Fallback for non-visual artifact types -->
          <div v-else class="segment-media-frame">
            <span class="segment-media-placeholder-text">
              {{ currentArtifact?.artifact_type ?? '未知类型' }}
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
      </template>
    </div>

    <!-- Right: prompt & actions -->
    <div class="segment-info">
      <!-- Prompt synced with tab & carousel -->
      <div class="segment-info-prompt">
        <div class="segment-info-prompt-header">
          <div class="segment-info-prompt-labels">
            <span class="segment-info-prompt-label">
              {{ activeTab === 'image' ? '图片提示词' : '视频提示词' }}
            </span>
            <ElTooltip v-if="riskLevel" popper-class="risk-tooltip" placement="top">
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
          <ElTooltip :content="copyFeedback ? '已复制' : '复制提示词'" placement="top">
            <button class="prompt-copy-btn" aria-label="复制提示词" @click="copyPrompt">
              <ElIcon :size="12"><CopyDocument /></ElIcon>
            </button>
          </ElTooltip>
        </div>
        <p class="segment-info-prompt-text">
          {{ activePromptText }}
        </p>
      </div>

      <!-- Task indicator & switcher (multi-task) + action buttons -->
      <div class="segment-info-actions">
        <!-- Multi-task switcher -->
        <div v-if="activeTasks.length > 1" class="segment-task-switcher">
          <button
            v-for="(t, i) in activeTasks"
            :key="t.task_id"
            class="segment-task-dot"
            :class="{ active: i === activeMediaIndex }"
            :aria-label="'切换到任务 ' + (i + 1)"
            @click="activeMediaIndex = i"
          >
            {{ i + 1 }}
          </button>
          <span class="segment-task-hint">共 {{ activeTasks.length }} 个任务</span>
        </div>

        <template v-if="activeTasks.length === 0">
          <span class="segment-info-action-hint">无需操作</span>
        </template>
        <template v-else-if="!currentTask">
          <span class="segment-info-action-hint">任务加载中...</span>
        </template>
        <template v-else>
          <ElButton
            v-if="canUpload"
            size="small"
            :icon="Upload"
            :loading="isCurrentUploading"
            @click="triggerFileUpload"
          >
            {{ hasGeneratedMedia ? '替换' : '上传' }}
          </ElButton>
          <ElTag
            v-else-if="currentExecution"
            size="small"
            :type="currentExecution.status === 'failed' ? 'danger' : 'info'"
          >
            {{ statusLabel ?? currentExecution.status }}
          </ElTag>
          <ElTag v-else size="small" type="info">待生成</ElTag>
        </template>
        <input
          ref="fileInput"
          type="file"
          :accept="acceptFileTypes"
          style="display:none"
          @change="onFileSelected"
        />
      </div>
    </div>

    <!-- Bottom: voice/BGM left, tags right -->
    <div class="segment-footer">
      <div class="segment-footer-left">
        <span class="segment-footer-item">BGM（自动匹配）</span>
      </div>
      <div class="segment-footer-right">
        <ElTag v-if="segment.framing_hint" size="small">
          构图: {{ FRAMING_LABELS[segment.framing_hint] ?? segment.framing_hint }}
        </ElTag>
        <ElTag v-if="segment.motion_hint" size="small" type="warning">
          运动: {{ MOTION_LABELS[segment.motion_hint] ?? segment.motion_hint }}
        </ElTag>
        <ElTag v-if="segment.content_type" size="small" type="info">
          {{ CONTENT_LABELS[segment.content_type] ?? segment.content_type }}
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

.segment-media-tab.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.segment-media-tab-hint {
  font-size: 0.75rem;
  color: var(--text-muted);
  align-self: center;
  margin-left: 2px;
}

.segment-info-action-hint {
  font-size: 0.82rem;
  color: var(--text-muted);
}

.segment-media-placeholder {
  aspect-ratio: 16 / 9;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-xs);
  border-radius: var(--radius-sm);
  background: var(--bg-panel);
  border: 1px dashed var(--border-default);
}

.segment-media-placeholder-text {
  color: var(--text-muted);
  font-size: 0.85rem;
}

.segment-media-placeholder.clickable {
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.segment-media-placeholder.clickable:hover {
  border-color: var(--accent-primary);
  background: color-mix(in srgb, var(--accent-primary) 5%, var(--bg-panel));
}

/* ---- Task switcher (multi-task) ---- */
.segment-task-switcher {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 2px;
}

.segment-task-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 1px solid var(--border-default);
  border-radius: 50%;
  background: var(--bg-panel);
  cursor: pointer;
  font-size: 0.72rem;
  color: var(--text-secondary);
  transition: border-color 0.15s, background 0.15s;
}

.segment-task-dot.active {
  border-color: var(--accent-primary);
  background: var(--accent-primary);
  color: #fff;
}

.segment-task-dot:hover:not(.active) {
  border-color: var(--accent-primary);
}

.segment-task-hint {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-left: 4px;
}

.segment-media-preview {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.segment-media-image {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: var(--radius-sm);
}

.segment-media-video {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: var(--radius-sm);
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

.segment-info-prompt-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.segment-info-prompt-labels {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.segment-info-prompt-label {
  font-size: 0.78rem;
  color: var(--text-muted);
  font-weight: 500;
}

.prompt-copy-btn {
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
  opacity: 0;
  transition: opacity 150ms, color 150ms;
}

.segment-info-prompt:hover .prompt-copy-btn {
  opacity: 1;
}

.prompt-copy-btn:hover {
  color: var(--accent-text);
}

.segment-info-prompt-text {
  margin: 0;
  font-size: 0.84rem;
  line-height: 1.6;
  color: var(--text-secondary);
  max-height: 6.4em;
  overflow-y: auto;
  word-break: break-word;
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
