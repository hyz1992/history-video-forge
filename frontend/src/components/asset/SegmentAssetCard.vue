<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from "vue";
import { ElTooltip, ElTag, ElButton, ElIcon, ElMessage, ElMessageBox, ElDialog, ElInput } from "element-plus";
import { Upload, CopyDocument } from "@element-plus/icons-vue";

import { checkPromptQuality, optimizePromptFromRisks } from "../../utils/prompt-quality";

import { checkArtRisks } from "../../utils/asset-art-quality";

import type { StoryboardSegment } from "../../stores/storyboard";
import type { AssetTask } from "../../stores/asset-planning";
import { useAssetsStore } from "../../stores/assets";

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
  "generate-task": [taskId: string];
  "upgrade-video": [segmentId: string];
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

const assetsStore = useAssetsStore();

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
/** Always allow the video tab so users can preview motion effects
 *  or upgrade an image_with_motion segment to API video. */
const showVideoTab = true;

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

/** True when the current task is being generated (single-task API call). */
const isCurrentGenerating = computed(() => {
  const task = activeTasks.value[activeMediaIndex.value];
  return task ? assetsStore.state.generatingTaskId === task.task_id : false;
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

/** Task types that support automatic (non-manual) generation. */
const AUTO_GENERATABLE_TYPES = new Set(["image_still", "video_clip", "tts_audio"]);

const canAutoGenerate = computed(() => {
  const task = currentTask.value;
  if (!task) return false;
  return AUTO_GENERATABLE_TYPES.has(task.task_type);
});

const acceptFileTypes = computed(() => {
  if (activeTab.value === "image") return "image/png,image/jpeg,image/webp";
  return "video/mp4,video/quicktime";
});

const fileInput = ref<HTMLInputElement | null>(null);
const showPreview = ref(false);

function togglePreview() {
  if (hasGeneratedMedia.value) showPreview.value = !showPreview.value;
}

function closePreview() {
  showPreview.value = false;
}

function previewPrev() {
  const all = activeTasks.value;
  if (all.length <= 1) return;
  let idx = activeMediaIndex.value - 1;
  if (idx < 0) idx = all.length - 1;
  activeMediaIndex.value = idx;
}

function previewNext() {
  const all = activeTasks.value;
  if (all.length <= 1) return;
  let idx = activeMediaIndex.value + 1;
  if (idx >= all.length) idx = 0;
  activeMediaIndex.value = idx;
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === "Escape" && showPreview.value) {
    closePreview();
  } else if (e.key === "ArrowLeft" && showPreview.value) {
    previewPrev();
  } else if (e.key === "ArrowRight" && showPreview.value) {
    previewNext();
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKeyDown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeyDown);
});

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

const promptQuality = computed(() => {
  const task = activeTasks.value[activeMediaIndex.value];
  if (!task?.prompt_draft) return null;
  const taskType = task.task_type === "image_still" ? "image_still" : "video_clip";
  return checkPromptQuality(task.prompt_draft, taskType);
});

const artRisks = computed(() => {
  const task = activeTasks.value[activeMediaIndex.value];
  if (!task?.prompt_draft) return [];
  const taskType = task.task_type === "image_still" ? "image_still" : "video_clip";
  return checkArtRisks(task.prompt_draft, taskType).filter(h => h.triggered);
});

const riskLevel = computed<"high" | "low" | null>(() => {
  if (!activeRiskNotes.value.length) return null;
  return activeRiskNotes.value.length >= 2 ? "high" : "low";
});

const riskTooltipText = computed(() =>
  activeRiskNotes.value.join("\n"),
);

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

/* -------------------------------------------------------------------------- */
/*  Prompt optimize / edit                                                    */
/* -------------------------------------------------------------------------- */

const optimizing = ref(false);
const showEditDialog = ref(false);
const editDraft = ref("");

async function handleOptimizePrompt() {
  const task = currentTask.value;
  if (!task?.prompt_draft) return;
  const risks = checkArtRisks(task.prompt_draft, activeTab.value === "video" ? "video_clip" : "image_still");
  const triggered = risks.filter(r => r.triggered);
  if (triggered.length === 0) {
    ElMessage.info("当前提示词未检测到可优化项");
    return;
  }
  try {
    await ElMessageBox.confirm(
      `将根据 ${triggered.length} 项画面建议自动补充提示词（不会立即生成图片/视频）。\n优化后提示词将被覆盖，建议先复制原文备份。\n确定继续？`,
      "确认优化提示词",
      { confirmButtonText: "确定优化", cancelButtonText: "取消", type: "info" },
    );
  } catch { return; }

  optimizing.value = true;
  try {
    const optimized = optimizePromptFromRisks(task.prompt_draft, risks);
    await savePromptDraft(task.task_id, optimized);
    ElMessage.success("提示词已优化，可点击生成查看效果");
  } catch (e) {
    ElMessage.error("优化失败：" + (e instanceof Error ? e.message : "未知错误"));
  } finally {
    optimizing.value = false;
  }
}

function handleOpenEdit() {
  editDraft.value = currentTask.value?.prompt_draft ?? "";
  showEditDialog.value = true;
}

async function handleSaveEdit() {
  const task = currentTask.value;
  if (!task) return;
  try {
    await savePromptDraft(task.task_id, editDraft.value);
    showEditDialog.value = false;
    ElMessage.success("提示词已保存");
  } catch (e) {
    ElMessage.error("保存失败：" + (e instanceof Error ? e.message : "未知错误"));
  }
}

async function savePromptDraft(taskId: string, promptDraft: string) {
  const res = await fetch(`/api/projects/${props.projectId}/assets/tasks/${taskId}/prompt`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt_draft: promptDraft }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as Record<string, unknown>).error as string ?? `status ${res.status}`);
  }
  // Update local task reference so UI reflects the change immediately
  const task = activeTasks.value[activeMediaIndex.value];
  if (task) {
    (task as { prompt_draft?: string | null }).prompt_draft = promptDraft;
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
          content="当前为图片+运镜路线，视频由 Remotion 合成渲染"
          placement="top"
        >
          <button
            class="segment-media-tab"
            :class="{ active: activeTab === 'video' }"
            @click="activeTab = 'video'"
          >
            视频
          </button>
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
      <div v-if="activeTasks.length === 0 && activeTab !== 'video'" class="segment-media-placeholder">
        <ElTag size="small" type="info">无需生成</ElTag>
        <span class="segment-media-placeholder-text">无画面任务</span>
      </div>
      <div v-else-if="activeTasks.length === 0 && activeTab === 'video'" class="segment-media-placeholder">
        <ElTag size="small" type="info">图片+运镜</ElTag>
        <span class="segment-media-placeholder-text">
          当前路线：图片 + {{ segment.motion_hint ? MOTION_LABELS[segment.motion_hint] ?? segment.motion_hint : '运镜' }}<br/>
          视频由 Remotion 合成渲染。
        </span>
        <el-button
          size="small"
          type="primary"
          plain
          :loading="assetsStore.state.isGenerating"
          @click="emit('upgrade-video', segment.segment_id)"
        >
          {{ assetsStore.state.isGenerating ? '处理中...' : '升级为 API 视频' }}
        </el-button>
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
            :alt="'#' + (segmentIndex + 1) + ' 分镜图：' + (segment.scene_description || segment.script_excerpt || '').slice(0, 40)"
            @click="togglePreview"
          />
          <video
            v-else-if="currentArtifact?.artifact_type === 'video'"
            :src="artifactUrl(currentArtifact.artifact_id)"
            class="segment-media-video"
            controls
            @click="togglePreview"
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
            <ElTooltip
              v-if="promptQuality && promptQuality.score !== 'strong'"
              :content="'提示词可优化：' + promptQuality.checks.filter(c => !c.passed).map(c => c.label).join('、')"
              placement="top"
            >
              <ElTag
                size="small"
                :type="promptQuality.score === 'weak' ? 'warning' : 'info'"
              >
                {{ promptQuality.score === 'weak' ? '提示词偏弱' : '可优化' }}
              </ElTag>
            </ElTooltip>
            <ElTooltip
              v-if="artRisks.length > 0"
              placement="top"
            >
              <template #content>
                <div class="risk-tooltip-content">
                  <p v-for="hint in artRisks" :key="hint.code" style="margin:0 0 4px">
                    <strong>{{ hint.label }}</strong>：{{ hint.risk }}
                    <br/>建议：{{ hint.suggestion }}
                  </p>
                </div>
              </template>
              <ElTag size="small" type="warning">
                画面建议 {{ artRisks.length }}
              </ElTag>
            </ElTooltip>
          </div>
          <div class="segment-info-prompt-actions">
            <ElButton
              v-if="currentTask?.prompt_draft && artRisks.length > 0"
              size="small"
              text
              type="primary"
              :loading="optimizing"
              @click="handleOptimizePrompt"
            >
              自动优化
            </ElButton>
            <ElButton
              v-if="currentTask?.prompt_draft"
              size="small"
              text
              @click="handleOpenEdit"
            >
              手动编辑
            </ElButton>
            <ElTooltip :content="copyFeedback ? '已复制' : '复制提示词'" placement="top">
              <button class="prompt-copy-btn" aria-label="复制提示词" @click="copyPrompt">
                <ElIcon :size="12"><CopyDocument /></ElIcon>
              </button>
            </ElTooltip>
          </div>
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
          <span class="segment-task-hint">
            共 {{ activeTasks.length }} 个任务 · 当前操作作用于任务 {{ activeMediaIndex + 1 }}
          </span>
        </div>

        <template v-if="activeTasks.length === 0">
          <span class="segment-info-action-hint">
            {{ activeTab === 'video' ? '图片+运镜路线，视频由 Remotion 合成' : '无需操作' }}
          </span>
        </template>
        <template v-else-if="!currentTask">
          <span class="segment-info-action-hint">任务加载中...</span>
        </template>
        <template v-else>
          <!-- Generate / Regenerate (auto-generatable tasks) -->
          <ElButton
            v-if="canAutoGenerate && !hasGeneratedMedia"
            size="small"
            :loading="isCurrentGenerating"
            @click="emit('generate-task', currentTask!.task_id)"
          >
            生成
          </ElButton>
          <ElButton
            v-if="canAutoGenerate && hasGeneratedMedia"
            size="small"
            :loading="isCurrentGenerating"
            @click="emit('generate-task', currentTask!.task_id)"
          >
            重新生成
          </ElButton>
          <!-- Upload / Replace (manual-uploadable tasks) -->
          <ElButton
            v-if="canUpload"
            size="small"
            :icon="Upload"
            :loading="isCurrentUploading"
            @click="triggerFileUpload"
          >
            {{ hasGeneratedMedia ? '替换' : '上传' }}
          </ElButton>
          <!-- Status tag when no action available -->
          <ElTag
            v-if="!canAutoGenerate && !canUpload && currentExecution"
            size="small"
            :type="currentExecution.status === 'failed' ? 'danger' : 'info'"
          >
            {{ statusLabel ?? currentExecution.status }}
          </ElTag>
          <ElTag
            v-if="!canAutoGenerate && !canUpload && !currentExecution"
            size="small"
            type="info"
          >待生成</ElTag>
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
    <!-- Full-size preview overlay -->
    <Teleport to="body">
      <div v-if="showPreview && hasGeneratedMedia" class="preview-overlay" @click="closePreview">
        <div class="preview-container" @click.stop>
          <button class="preview-close" @click="closePreview" aria-label="关闭预览">✕</button>
          <button
            v-if="activeTasks.length > 1"
            class="preview-nav preview-nav--prev"
            @click="previewPrev"
            aria-label="上一张"
          >‹</button>
          <img
            v-if="currentArtifact?.artifact_type === 'image'"
            :src="artifactUrl(currentArtifact!.artifact_id)"
            class="preview-image"
          />
          <video
            v-else-if="currentArtifact?.artifact_type === 'video'"
            :src="artifactUrl(currentArtifact!.artifact_id)"
            class="preview-video"
            controls
            autoplay
          />
          <button
            v-if="activeTasks.length > 1"
            class="preview-nav preview-nav--next"
            @click="previewNext"
            aria-label="下一张"
          >›</button>
          <div class="preview-info">
            <span>#{{ segmentIndex + 1 }} · {{ currentArtifact?.artifact_type === 'image' ? '分镜图' : '视频' }}</span>
            <span v-if="activeTasks.length > 1">（{{ activeMediaIndex + 1 }}/{{ activeTasks.length }}）</span>
            <span v-if="currentArtifact?.metadata?.model">模型: {{ currentArtifact.metadata.model }}</span>
            <span v-if="currentArtifact?.metadata?.width">尺寸: {{ currentArtifact.metadata.width }}×{{ currentArtifact.metadata.height }}</span>
          </div>
        </div>
      </div>
    </Teleport>
    <!-- Edit prompt dialog -->
    <ElDialog
      v-model="showEditDialog"
      title="编辑提示词"
      width="560px"
      :close-on-click-modal="false"
    >
      <div class="edit-prompt-body">
        <div v-if="artRisks.length > 0" class="edit-prompt-risks">
          <p class="edit-prompt-risks-title">画面质量建议</p>
          <ul class="edit-prompt-risks-list">
            <li v-for="hint in artRisks" :key="hint.code">
              <strong>{{ hint.label }}</strong>：{{ hint.suggestion }}
            </li>
          </ul>
        </div>
        <ElInput
          v-model="editDraft"
          type="textarea"
          :rows="8"
          placeholder="输入提示词..."
        />
      </div>
      <template #footer>
        <ElButton @click="showEditDialog = false">取消</ElButton>
        <ElButton type="primary" @click="handleSaveEdit">保存</ElButton>
      </template>
    </ElDialog>
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
  aspect-ratio: 9 / 16;
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

.segment-info-prompt-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  flex-shrink: 0;
}

/* ---- Prompt text ---- */
.segment-info-prompt-text {
  margin: 0;
  font-size: 0.84rem;
  line-height: 1.6;
  color: var(--text-secondary);
  max-height: 16em;
  overflow-y: auto;
  word-break: break-word;
}
.edit-prompt-body {
  display: grid;
  gap: var(--space-md);
}

.edit-prompt-risks-title {
  margin: 0 0 var(--space-xs);
  font-size: 0.84rem;
  font-weight: 500;
  color: var(--text-heading);
}

.edit-prompt-risks-list {
  margin: 0;
  padding-left: 1.2rem;
  font-size: 0.8rem;
  color: var(--text-secondary);
  display: grid;
  gap: 2px;
}

.segment-media-preview {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.segment-media-image {
  width: 100%;
  aspect-ratio: 9 / 16;
  object-fit: cover;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: opacity 0.15s, filter 0.15s;
}

.segment-media-image:hover {
  opacity: 0.85;
  filter: brightness(1.1);
}

.segment-media-video {
  width: 100%;
  aspect-ratio: 9 / 16;
  border-radius: var(--radius-sm);
}

.segment-media-frame {
  aspect-ratio: 9 / 16;
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

.preview-overlay {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(4px);
}

.preview-container {
  position: relative;
  max-width: 90vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.preview-close {
  position: absolute;
  top: -40px;
  right: 0;
  background: none;
  border: none;
  color: #fff;
  font-size: 24px;
  cursor: pointer;
  opacity: 0.8;
  transition: opacity 0.15s;
}

.preview-close:hover { opacity: 1; }

.preview-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(255, 255, 255, 0.15);
  border: none;
  color: #fff;
  font-size: 36px;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.15s, background 0.15s;
  z-index: 1;
}

.preview-nav:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.25);
}

.preview-nav--prev {
  left: -60px;
}

.preview-nav--next {
  right: -60px;
}

@media (max-width: 768px) {
  .preview-nav--prev { left: 8px; }
  .preview-nav--next { right: 8px; }
}

.preview-image {
  max-width: 90vw;
  max-height: 85vh;
  object-fit: contain;
  border-radius: 4px;
}

.preview-video {
  max-width: 90vw;
  max-height: 85vh;
  border-radius: 4px;
}

.preview-info {
  display: flex;
  gap: 16px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.85rem;
}
</style>
