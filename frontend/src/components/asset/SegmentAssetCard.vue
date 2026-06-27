<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from "vue";
import { ElTooltip, ElTag, ElButton, ElIcon, ElMessage, ElMessageBox, ElDialog, ElInput } from "element-plus";
import { Upload, CopyDocument } from "@element-plus/icons-vue";

import { checkPromptQuality } from "../../utils/prompt-quality";

import { checkArtRisks } from "../../utils/asset-art-quality";

import StageLoadingBar from "../workspace/StageLoadingBar.vue";

import type { StoryboardSegment } from "../../stores/storyboard";
import type { AssetTask } from "../../stores/asset-planning";
import { useAssetsStore } from "../../stores/assets";
import { useAssetPlanningStore } from "../../stores/asset-planning";

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
  generatingTaskIds: Set<string>;
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
const assetPlanningStore = useAssetPlanningStore();

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

const NARRATIVE_ROLE_LABELS: Record<string, string> = {
  setup: "铺垫",
  turn: "转折",
  peak: "高潮",
  resolution: "收尾",
  intro: "开场",
  outro: "结尾",
  background: "背景",
  conclusion: "总结",
  hook: "钩子",
  transition: "过渡",
  climax: "高潮",
  epilogue: "尾声",
  prologue: "序言",
};
const narrativeRoleLabel = computed(
  () => NARRATIVE_ROLE_LABELS[props.segment.narrative_role] ?? props.segment.narrative_role,
);
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

/** True when the current task is being generated (single-task or batch). */
const isTaskLocked = computed(() => {
  const task = currentTask.value;
  if (!task) return false;
  return props.generatingTaskIds.has(task.task_id);
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
  if (activeTab.value !== "image" && activeTab.value !== "video") return false;
  if (!!currentExecution.value && (
    currentExecution.value.status === "waiting_manual_upload" ||
    currentExecution.value.status === "completed" ||
    currentExecution.value.status === "accepted"
  )) return true;
  const task = currentTask.value;
  if (task && !currentExecution.value) {
    return task.manual_upload_policy?.allowed === true
      || task.task_type === "image_still"
      || task.task_type === "video_clip";
  }
  return false;
});

/** canUpload but gated on the global generation lock. */
const canUploadNow = computed(() => canUpload.value && !isTaskLocked.value);

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
const promptTextRef = ref<HTMLElement | null>(null);
const promptEditRef = ref<HTMLTextAreaElement | null>(null);
const isEditingPrompt = ref(false);
const highlightPrompt = ref(false);
const previousPrompt = ref<string | null>(null);
const showUndo = ref(false);
let undoTimer: ReturnType<typeof setTimeout> | null = null;

function handleStartInlineEdit() {
  editDraft.value = activePromptText.value;
  isEditingPrompt.value = true;
  setTimeout(() => promptEditRef.value?.focus(), 0);
}

async function handleSaveInlineEdit() {
  isEditingPrompt.value = false;
  const task = currentTask.value;
  if (!task || editDraft.value === activePromptText.value) return;
  const old = task.prompt_draft ?? "";
  await savePromptDraft(task.task_id, editDraft.value);
  previousPrompt.value = old;
  showUndo.value = true;
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { showUndo.value = false; }, 30000);
  ElMessage.success("提示词已保存");
}

function handleUndoEdit() {
  const task = currentTask.value;
  if (!task || !previousPrompt.value) return;
  savePromptDraft(task.task_id, previousPrompt.value);
  previousPrompt.value = null;
  showUndo.value = false;
  if (undoTimer) clearTimeout(undoTimer);
  ElMessage.success("已撤销");
}

async function handleQuickOptimize() {
  const task = currentTask.value;
  if (!task?.prompt_draft) return;
  optimizing.value = true;
  try {
    const res = await fetch(`/api/projects/${props.projectId}/assets/tasks/${task.task_id}/prompt/optimize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        current_prompt: task.prompt_draft,
        task_type: activeTab.value === "video" ? "video_clip" : "image_still",
        segment_id: props.segment.segment_id,
      }),
    });
    const data = await res.json() as { optimized_prompt: string };
    const old = task.prompt_draft ?? "";
    await savePromptDraft(task.task_id, data.optimized_prompt);
    await assetPlanningStore.loadActiveAssetPlanSnapshot();
    previousPrompt.value = old;
    showUndo.value = true;
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = setTimeout(() => { showUndo.value = false; }, 30000);
    highlightPrompt.value = true;
    setTimeout(() => { highlightPrompt.value = false; }, 2000);
    ElMessage.success("提示词已优化");
  } catch (e) {
    ElMessage.error("快速优化失败：" + (e instanceof Error ? e.message : "未知错误"));
  } finally {
    optimizing.value = false;
  }
}

function getArtifactForTask(taskId: string) {
  const exec = props.executionsByTaskId.get(taskId);
  if (!exec || exec.output_artifact_ids.length === 0) return null;
  return props.artifactsById.get(exec.output_artifact_ids[0]) ?? null;
}

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
/*  Prompt optimize (LLM) / edit                                              */
/* -------------------------------------------------------------------------- */

const optimizing = ref(false);
const showOptimizeDialog = ref(false);
const showEditDialog = ref(false);
const editDraft = ref("");
const userFeedback = ref("");
const optimizedPreview = ref<string | null>(null);
const changeSummary = ref<string[]>([]);
const remainingRisks = ref<string[]>([]);

async function handleOpenOptimize() {
  const task = currentTask.value;
  if (!task?.prompt_draft) return;
  userFeedback.value = "";
  optimizedPreview.value = null;
  changeSummary.value = [];
  remainingRisks.value = [];
  showOptimizeDialog.value = true;
}

async function handleGenerateOptimized() {
  const task = currentTask.value;
  if (!task) return;
  optimizing.value = true;
  try {
    const res = await fetch(`/api/projects/${props.projectId}/assets/tasks/${task.task_id}/prompt/optimize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        current_prompt: task.prompt_draft,
        user_feedback: userFeedback.value.trim(),
        task_type: activeTab.value === "video" ? "video_clip" : "image_still",
        segment_id: props.segment.segment_id,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as Record<string, unknown>).error as string ?? `status ${res.status}`);
    }
    const data = await res.json() as { optimized_prompt: string; change_summary: string[]; remaining_risks?: string[] };
    optimizedPreview.value = data.optimized_prompt;
    changeSummary.value = data.change_summary;
    remainingRisks.value = data.remaining_risks ?? [];
  } catch (e) {
    ElMessage.error("生成优化失败：" + (e instanceof Error ? e.message : "未知错误"));
  } finally {
    optimizing.value = false;
  }
}

async function handleApplyOptimized() {
  const task = currentTask.value;
  if (!task || !optimizedPreview.value) return;
  try {
    await savePromptDraft(task.task_id, optimizedPreview.value);
    await assetPlanningStore.loadActiveAssetPlanSnapshot();
    showOptimizeDialog.value = false;
    // Recalculate risks for the toast
    const newRisks = checkArtRisks(optimizedPreview.value, activeTab.value === "video" ? "video_clip" : "image_still");
    const newTriggered = newRisks.filter(r => r.triggered);
    if (newTriggered.length > 0) {
      ElMessage.success(`提示词已应用，仍有 ${newTriggered.length} 项建议可进一步优化`);
    } else {
      ElMessage.success("提示词已应用，当前画面建议已全部解决");
    }
  } catch (e) {
    ElMessage.error("保存失败：" + (e instanceof Error ? e.message : "未知错误"));
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
  <StageLoadingBar
    :visible="isTaskLocked"
    text="资产生成中…"
  />
  <article class="segment-asset-card">
    <!-- Full-width header -->
    <div class="segment-header">
      <div class="segment-header-row">
        <span class="segment-header-number">#{{ segmentIndex + 1 }}</span>
        <span class="segment-header-time">
          {{ formatSeconds(segment.start_hint_sec) }} - {{ formatSeconds(segment.end_hint_sec) }}
        </span>
        <ElTag size="small" type="info">{{ narrativeRoleLabel }}</ElTag>
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
            视频（Remotion）
          </button>
        </ElTooltip>
        <button
          v-else
          class="segment-media-tab"
          :class="{ active: activeTab === 'video' }"
          @click="activeTab = 'video'"
        >
          视频（API）
        </button>
      </div>

      <!-- No tasks of this type -->
      <div v-if="activeTasks.length === 0 && activeTab !== 'video'" class="segment-media-placeholder">
        <ElTag size="small" type="info">无需生成</ElTag>
        <span class="segment-media-placeholder-text">无画面任务</span>
      </div>
      <div v-else-if="activeTasks.length === 0 && activeTab === 'video'" class="segment-video-empty">
        <p class="segment-video-empty-title">暂无 API 视频</p>
        <p class="segment-video-empty-desc">
          当前使用「图片 + {{ segment.motion_hint ? (MOTION_LABELS[segment.motion_hint] ?? segment.motion_hint) : '运镜' }}」
          在合成阶段由 Remotion 生成视频片段
        </p>
        <ElTooltip
          v-if="isTaskLocked"
          content="资产生成进行中，请等待完成后再操作"
          placement="top"
        >
          <span>
            <el-button size="small" type="primary" plain disabled>
              升级为 API 视频
            </el-button>
          </span>
        </ElTooltip>
        <el-button
          v-else
          size="small"
          type="primary"
          plain
          :loading="false"
          @click="emit('upgrade-video', segment.segment_id)"
        >
          升级为 API 视频
        </el-button>
      </div>

      <!-- Preview area: no artifact yet -->
      <template v-else-if="!hasGeneratedMedia">
        <div class="segment-media-placeholder-wrapper">
          <div
            class="segment-media-placeholder"
            :class="{ clickable: canUploadNow && !isTaskLocked }"
            @click="canUploadNow && !isTaskLocked && triggerFileUpload()"
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
              {{ canUploadNow ? '点击此处上传文件' : (statusLabel ? '' : '暂无') }}
            </span>
          </div>
          <div v-if="isTaskLocked" class="segment-media-loading-overlay">
            <span class="segment-media-loading-spinner" />
          </div>
        </div>
      </template>

      <!-- Preview area: artifact exists -->
      <template v-else>
        <div class="segment-media-preview-wrapper">
          <div class="segment-media-preview">
            <div v-if="hasGeneratedMedia && currentArtifact?.artifact_type === 'image' && videoTasks.length === 0"
                 class="segment-media-upgrade-badge"
                 @click="emit('upgrade-video', segment.segment_id)">
              🎬 升级视频
            </div>
            <img
              v-if="currentArtifact?.artifact_type === 'image'"
              :src="artifactUrl(currentArtifact.artifact_id)"
              class="segment-media-image"
              :class="{ loading: isTaskLocked }"
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
              <button class="segment-media-arrow" :disabled="activeMediaIndex === 0 || isTaskLocked" @click="prevMedia">
                ‹
              </button>
              <div class="segment-media-dots">
                <span
                  v-for="(_, i) in activeTasks"
                  :key="i"
                  class="segment-media-dot"
                  :class="{ active: i === activeMediaIndex }"
                  @click="!isTaskLocked && (activeMediaIndex = i)"
                />
              </div>
              <button class="segment-media-arrow" :disabled="activeMediaIndex === activeTasks.length - 1 || isTaskLocked" @click="nextMedia">
                ›
              </button>
            </div>
          </div>
          <div v-if="isTaskLocked" class="segment-media-loading-overlay">
            <span class="segment-media-loading-spinner" />
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
              v-if="currentTask?.prompt_draft"
              size="small"
              text
              type="warning"
              :loading="optimizing"
              @click="handleQuickOptimize"
            >
              ⚡ 快速优化
            </ElButton>
            <ElButton
              v-if="currentTask?.prompt_draft"
              size="small"
              text
              type="primary"
              @click="handleOpenOptimize"
            >
              精细优化
            </ElButton>
            <ElButton
              v-if="currentTask?.prompt_draft"
              size="small"
              text
              @click="handleStartInlineEdit"
            >
              编辑
            </ElButton>
            <ElButton
              v-if="showUndo && currentTask?.prompt_draft"
              size="small"
              text
              type="danger"
              @click="handleUndoEdit"
            >
              撤销
            </ElButton>
            <ElTooltip :content="copyFeedback ? '已复制' : '复制提示词'" placement="top">
              <button class="prompt-copy-btn" aria-label="复制提示词" @click="copyPrompt">
                <ElIcon :size="12"><CopyDocument /></ElIcon>
              </button>
            </ElTooltip>
          </div>
        </div>
        <textarea
          v-if="isEditingPrompt"
          ref="promptEditRef"
          v-model="editDraft"
          class="segment-prompt-textarea"
          rows="10"
          @keydown.ctrl.enter="handleSaveInlineEdit"
          @blur="handleSaveInlineEdit"
        />
        <p v-else ref="promptTextRef" class="segment-info-prompt-text"
           :class="{ 'segment-info-prompt-text--highlight': highlightPrompt }"
           @dblclick="handleStartInlineEdit"
           title="双击编辑提示词">
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
          <ElTooltip
            v-if="canAutoGenerate && !hasGeneratedMedia && isTaskLocked"
            content="资产生成进行中，请等待完成后再操作"
            placement="top"
          >
            <span><ElButton size="small" disabled>生成</ElButton></span>
          </ElTooltip>
          <ElButton
            v-else-if="canAutoGenerate && !hasGeneratedMedia"
            size="small"
            :loading="isTaskLocked"
            @click="emit('generate-task', currentTask!.task_id)"
          >
            生成
          </ElButton>
          <ElTooltip
            v-if="canAutoGenerate && hasGeneratedMedia && isTaskLocked"
            content="资产生成进行中，请等待完成后再操作"
            placement="top"
          >
            <span><ElButton size="small" disabled>重新生成</ElButton></span>
          </ElTooltip>
          <ElButton
            v-else-if="canAutoGenerate && hasGeneratedMedia"
            size="small"
            :loading="isTaskLocked"
            @click="emit('generate-task', currentTask!.task_id)"
          >
            重新生成
          </ElButton>
          <!-- Upload / Replace (manual-uploadable tasks) -->
          <ElTooltip
            v-if="canUpload && isTaskLocked"
            content="资产生成进行中，请等待完成后再操作"
            placement="top"
          >
            <span>
              <ElButton size="small" :icon="Upload" disabled>
                {{ hasGeneratedMedia ? '替换' : '上传' }}
              </ElButton>
            </span>
          </ElTooltip>
          <ElButton
            v-else-if="canUploadNow"
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
    <!-- Optimize prompt dialog (LLM) -->
    <ElDialog
      v-model="showOptimizeDialog"
      title="智能优化提示词"
      width="620px"
      :close-on-click-modal="false"
    >
      <div class="optimize-dialog-body">
        <!-- Current prompt preview -->
        <details class="optimize-current">
          <summary>当前提示词</summary>
          <p class="optimize-current-text">{{ currentTask?.prompt_draft }}</p>
        </details>

        <!-- Art risks summary -->
        <div v-if="artRisks.length > 0" class="optimize-risks">
          <span class="optimize-risks-label">画面建议（{{ artRisks.length }} 项）：</span>
          <span>{{ artRisks.map(h => h.label).join('、') }}</span>
        </div>

        <!-- User feedback input -->
        <div v-if="!optimizedPreview" class="optimize-feedback">
          <p class="optimize-feedback-label">描述你对画面的期待或反馈（可选）</p>
          <ElInput
            v-model="userFeedback"
            type="textarea"
            :rows="3"
            placeholder="例如：更像电影剧照、人物更苍老、降低血腥感、突出江南书房氛围、增加压迫感"
          />
          <p class="optimize-feedback-hint">
            {{ userFeedback.trim() ? '将根据你的反馈优化提示词' : '将根据画面建议自动优化，不改变历史事实和角色身份' }}
          </p>
        </div>

        <!-- Optimized preview -->
        <div v-if="optimizedPreview" class="optimize-preview">
          <h4 class="optimize-preview-title">优化结果</h4>
          <div v-if="changeSummary.length > 0" class="optimize-changes">
            <p class="optimize-changes-label">改动摘要：</p>
            <ul>
              <li v-for="(item, i) in changeSummary" :key="i">{{ item }}</li>
            </ul>
          </div>
          <div class="optimize-compare">
            <div class="optimize-compare-col">
              <span class="optimize-compare-label">优化前</span>
              <p class="optimize-compare-text optimize-compare-text--old">{{ currentTask?.prompt_draft }}</p>
            </div>
            <div class="optimize-compare-col">
              <span class="optimize-compare-label">优化后</span>
              <p class="optimize-compare-text">{{ optimizedPreview }}</p>
            </div>
          </div>
          <p v-if="remainingRisks.length > 0" class="optimize-remaining">
            注意：优化后仍存在 {{ remainingRisks.length }} 项建议，可再次优化或手动编辑。
          </p>
        </div>
      </div>
      <template #footer>
        <ElButton @click="showOptimizeDialog = false">取消</ElButton>
        <ElButton
          v-if="!optimizedPreview"
          type="primary"
          :loading="optimizing"
          @click="handleGenerateOptimized"
        >
          生成优化版
        </ElButton>
        <template v-else>
          <ElButton :loading="optimizing" @click="handleGenerateOptimized">重新生成</ElButton>
          <ElButton type="primary" @click="handleApplyOptimized">应用优化</ElButton>
        </template>
      </template>
    </ElDialog>

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
  grid-template-columns: 260px 1fr;
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

/* Video tab empty state */
.segment-video-empty {
  aspect-ratio: 9 / 16;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  text-align: center;
  padding: var(--space-md);
  border-radius: var(--radius-sm);
  background: var(--bg-panel);
  border: 1px solid var(--border-default);
}

.segment-video-empty-title {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--text-body);
}

.segment-video-empty-desc {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-muted);
  line-height: 1.5;
  max-width: 180px;
}

.segment-info-action-hint {
  font-size: 0.82rem;
  color: var(--text-muted);
}

.segment-media-placeholder-wrapper,
.segment-media-preview-wrapper {
  position: relative;
}

.segment-media-loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(12, 10, 8, 0.55);
  backdrop-filter: blur(2px);
  border-radius: var(--radius-sm);
  z-index: 5;
}

.segment-media-loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(201, 162, 39, 0.18);
  border-top-color: #c9a227;
  border-radius: 50%;
  animation: segment-media-spin 0.7s linear infinite;
}

@keyframes segment-media-spin {
  to { transform: rotate(360deg); }
}

.segment-media-image.loading {
  filter: brightness(0.5) blur(1px);
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
  color: var(--text-inverse);
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
  cursor: text;
}

.segment-info-prompt-text--highlight {
  animation: prompt-flash 0.4s ease 3;
}

@keyframes prompt-flash {
  0%, 100% { background: transparent; }
  50% { background: color-mix(in srgb, var(--accent-primary) 15%, transparent); }
}

.segment-prompt-textarea {
  width: 100%;
  margin: 0;
  padding: var(--space-xs);
  font-size: 0.84rem;
  line-height: 1.6;
  color: var(--text-body);
  background: var(--bg-panel);
  border: 1px solid var(--accent-primary);
  border-radius: var(--radius-sm);
  resize: vertical;
  font-family: inherit;
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

.segment-media-upgrade-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 1;
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  background: rgba(0, 0, 0, 0.6);
  color: var(--accent-primary-light);
  font-size: 0.75rem;
  cursor: pointer;
  backdrop-filter: blur(2px);
  transition: background 0.15s;
}
.segment-media-upgrade-badge:hover {
  background: rgba(0, 0, 0, 0.8);
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
  width: 10px;
  height: 10px;
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

/* ---- Optimize dialog ---- */
.optimize-dialog-body {
  display: grid;
  gap: var(--space-md);
}

.optimize-current {
  font-size: 0.82rem;
}

.optimize-current-text {
  margin: var(--space-xs) 0 0;
  font-size: 0.8rem;
  color: var(--text-muted);
  max-height: 8em;
  overflow-y: auto;
  white-space: pre-wrap;
}

.optimize-risks {
  font-size: 0.82rem;
  color: var(--text-secondary);
}

.optimize-risks-label {
  font-weight: 500;
  color: var(--color-warning);
}

.optimize-feedback-label {
  margin: 0 0 var(--space-xs);
  font-size: 0.84rem;
  color: var(--text-body);
}

.optimize-feedback-hint {
  margin: var(--space-xs) 0 0;
  font-size: 0.78rem;
  color: var(--text-muted);
}

.optimize-preview-title {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 500;
}

.optimize-changes {
  font-size: 0.82rem;
  color: var(--text-secondary);
}

.optimize-changes-label {
  font-weight: 500;
}

.optimize-changes ul {
  margin: 2px 0 0;
  padding-left: 1.2rem;
}

.optimize-compare {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-md);
}

.optimize-compare-label {
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--text-muted);
  display: block;
  margin-bottom: 2px;
}

.optimize-compare-text {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.5;
  color: var(--text-body);
  max-height: 12em;
  overflow-y: auto;
  white-space: pre-wrap;
}

.optimize-compare-text--old {
  color: var(--text-muted);
}

.optimize-remaining {
  font-size: 0.8rem;
  color: var(--color-warning);
  margin: 0;
}
</style>
