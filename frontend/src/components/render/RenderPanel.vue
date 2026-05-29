<script setup lang="ts">
import { computed, onMounted } from "vue";
import { ElMessage } from "element-plus";

import { useRenderStore } from "../../stores/render";

const renderStore = useRenderStore();

/* -------------------------------------------------------------------------- */
/*  Computed state                                                            */
/* -------------------------------------------------------------------------- */

const snapshot = computed(() => renderStore.state.snapshot);
const activeRender = computed(() => snapshot.value?.active_render ?? null);
const hasRender = computed(() => !!activeRender.value);
const outputArtifact = computed(() => activeRender.value?.output_artifact ?? null);
const profile = computed(() => activeRender.value?.profile ?? null);
const validationResult = computed(() => activeRender.value?.validation_result ?? null);
const status = computed(() => activeRender.value?.status ?? "");

const isCompleted = computed(() => status.value === "completed" || status.value === "ready");
const isFailed = computed(() => status.value === "failed");
const isBlocked = computed(() => status.value === "blocked");

const renderInfo = computed(() => {
  const duration = outputArtifact.value?.duration_sec
    ? `${outputArtifact.value.duration_sec.toFixed(1)}s`
    : "—";
  const resolution = outputArtifact.value
    ? `${outputArtifact.value.width}x${outputArtifact.value.height}`
    : profile.value
      ? `${profile.value.width}x${profile.value.height}`
      : "—";
  const fps = outputArtifact.value?.fps ?? profile.value?.fps ?? "—";
  const rawFileSize = (outputArtifact.value?.metadata as Record<string, unknown> | undefined)?.file_size_bytes;
  const fileSize = typeof rawFileSize === "number" ? formatFileSize(rawFileSize) : "—";
  return { duration, resolution, fps, fileSize };
});

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const previewUrl = computed(() => renderStore.getPreviewUrl());
const downloadUrl = computed(() => renderStore.getDownloadUrl());

/* -------------------------------------------------------------------------- */
/*  Lifecycle                                                                 */
/* -------------------------------------------------------------------------- */

onMounted(() => {
  renderStore.loadProject();
});

/* -------------------------------------------------------------------------- */
/*  Actions                                                                   */
/* -------------------------------------------------------------------------- */

async function handleGenerate() {
  await renderStore.generateRender();
  if (!renderStore.state.loadError) {
    ElMessage.success("渲染任务已提交");
  }
}

function handleDownload() {
  globalThis.open(downloadUrl.value, "_blank");
}
</script>

<template>
  <div class="render-panel">
    <!-- Error state -->
    <div v-if="renderStore.state.loadError" class="render-error-card">
      <el-alert
        :title="'加载失败：' + renderStore.state.loadError"
        type="error"
        show-icon
        :closable="false"
      />
      <el-button
        type="primary"
        :loading="renderStore.state.isLoading"
        @click="renderStore.loadProject()"
      >
        重试
      </el-button>
    </div>

    <!-- Loading skeleton -->
    <el-skeleton
      v-else-if="renderStore.state.isLoading && !hasRender"
      :rows="5"
      animated
      class="render-skeleton"
    />

    <!-- Generating state -->
    <div
      v-else-if="renderStore.state.isGenerating"
      class="render-generating"
    >
      <p>正在渲染视频，可能需要几分钟...</p>
    </div>

    <!-- Empty state -->
    <div v-else-if="!hasRender" class="render-empty">
      <p>尚未开始渲染</p>
      <el-button
        type="primary"
        :loading="renderStore.state.isGenerating"
        @click="handleGenerate"
      >
        开始渲染
      </el-button>
    </div>

    <!-- Main content -->
    <template v-else>
      <!-- Status bar -->
      <div class="render-status-bar">
        <el-tag v-if="isCompleted" type="success" size="large">渲染完成</el-tag>
        <el-tag v-else-if="isFailed" type="danger" size="large">渲染失败</el-tag>
        <el-tag v-else-if="isBlocked" type="warning" size="large">渲染阻塞</el-tag>
        <el-tag v-else type="info" size="large">{{ status }}</el-tag>
      </div>

      <!-- Video preview area -->
      <div class="render-preview-wrapper">
        <div class="render-preview-container">
          <video
            v-if="isCompleted"
            :src="previewUrl"
            controls
            class="render-preview-video"
          />
          <div v-else class="render-preview-placeholder">
            <span class="render-preview-icon">&#9654;</span>
          </div>
        </div>
      </div>

      <!-- Render info card -->
      <div class="render-info-card">
        <div class="render-info-row">
          <span class="render-info-label">文件名</span>
          <span class="render-info-value">{{ outputArtifact?.file_uri ?? '—' }}</span>
        </div>
        <div class="render-info-row">
          <span class="render-info-label">文件大小</span>
          <span class="render-info-value">{{ renderInfo.fileSize }}</span>
        </div>
        <div class="render-info-row">
          <span class="render-info-label">时长</span>
          <span class="render-info-value">{{ renderInfo.duration }}</span>
        </div>
        <div class="render-info-row">
          <span class="render-info-label">分辨率</span>
          <span class="render-info-value">{{ renderInfo.resolution }}</span>
        </div>
        <div class="render-info-row">
          <span class="render-info-label">帧率</span>
          <span class="render-info-value">{{ renderInfo.fps }}</span>
        </div>
        <div class="render-info-row">
          <span class="render-info-label">校验结果</span>
          <span class="render-info-value">
            <template v-if="validationResult">
              <el-tag v-if="validationResult.decision === 'pass'" type="success" size="small">通过</el-tag>
              <el-tag v-else-if="validationResult.decision === 'warn'" type="warning" size="small">警告</el-tag>
              <el-tag v-else type="danger" size="small">{{ validationResult.decision }}</el-tag>
            </template>
            <template v-else>—</template>
          </span>
        </div>
      </div>

      <!-- Action buttons -->
      <div class="render-actions">
        <el-button
          :loading="renderStore.state.isGenerating"
          @click="handleGenerate"
        >
          重新渲染
        </el-button>
        <el-button
          v-if="isCompleted"
          type="success"
          @click="handleDownload"
        >
          下载视频
        </el-button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.render-panel {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-lg);
  max-width: 720px;
  margin: 0 auto;
  width: 100%;
}

/* ---- Error / Loading / Generating / Empty ---- */

.render-error-card {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-md);
  border-radius: var(--radius-card);
  background: var(--bg-card);
}

.render-skeleton {
  padding: var(--space-md);
}

.render-generating,
.render-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  padding: var(--space-xl) var(--space-md);
  color: var(--text-secondary);
  text-align: center;
}

/* ---- Status bar ---- */

.render-status-bar {
  display: flex;
  align-items: center;
}

/* ---- Preview area ---- */

.render-preview-wrapper {
  display: flex;
  justify-content: center;
}

.render-preview-container {
  width: 240px;
  aspect-ratio: 9 / 16;
  background: #000;
  border-radius: var(--radius-card);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.render-preview-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.render-preview-placeholder {
  width: 100%;
  height: 100%;
  background: #1a1a1a;
  display: flex;
  align-items: center;
  justify-content: center;
}

.render-preview-icon {
  font-size: 2.5rem;
  color: #444;
  user-select: none;
}

/* ---- Info card ---- */

.render-info-card {
  display: grid;
  gap: var(--space-sm);
  padding: var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--bg-card);
}

.render-info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-md);
}

.render-info-label {
  font-size: 0.84rem;
  color: var(--text-muted);
  flex-shrink: 0;
}

.render-info-value {
  font-size: 0.88rem;
  color: var(--text-body);
  text-align: right;
  word-break: break-all;
}

/* ---- Actions ---- */

.render-actions {
  display: flex;
  gap: var(--space-sm);
  justify-content: center;
}
</style>
