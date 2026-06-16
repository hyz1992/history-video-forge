<script setup lang="ts">
import { computed, onMounted } from "vue";
import { ElMessage } from "element-plus";

import { useRenderStore } from "../../stores/render";
import { useProjectStore } from "../../stores/project";
import { useWorkspaceStore, PIPELINE_STEPS } from "../../stores/workspace";
import { useRouter } from "vue-router";

const renderStore = useRenderStore();
const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();
const router = useRouter();

const COMPOSE_STEP_INDEX = PIPELINE_STEPS.findIndex((s) => s.key === "compose");

/* -------------------------------------------------------------------------- */
/*  Computed state                                                            */
/* -------------------------------------------------------------------------- */

const snapshot = computed(() => renderStore.state.snapshot);
const currentStatus = computed(() => snapshot.value?.current_status ?? "");
const activeCompose = computed(() => snapshot.value?.active_compose ?? null);
const isRenderBlocked = computed(() => currentStatus.value === "render_blocked" && !activeRender.value);

/** True when the project is past compose but the compose record is lost.
 *  Statuses starting with "compos" or "render" need compose to exist. */
const isComposeMissing = computed(() => {
  if (!currentStatus.value || activeCompose.value || activeRender.value) return false;
  return currentStatus.value.startsWith("compos") || currentStatus.value.startsWith("render");
});

/** True when the project status is too early for render (e.g. recovered shell).
 *  Render page requires at least compose stage. */
const isTooEarlyForRender = computed(() => {
  if (!currentStatus.value || hasRender.value || isComposeMissing.value || isRenderBlocked.value) return false;
  const s = currentStatus.value;
  return !s.startsWith("render") && !s.startsWith("compos");
});
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

/** Map internal render error codes to human-readable Chinese. */
function toZhRenderError(msg: string): string {
  if (msg.startsWith("render_artifact_file_missing:")) {
    const parts = msg.split(":");
    const artId = parts[1] ?? "?";
    const artType = parts[2] ?? "?";
    return `素材文件缺失（${artId}/${artType}），请返回资产页重新生成或替换`;
  }
  const map: Record<string, string> = {
    active_compose_missing: "合成记录缺失，请返回合成页重新生成合成时间线",
    render_active_compose_missing: "合成记录缺失",
    render_compose_record_missing: "合成记录数据缺失",
    render_timeline_not_ready: "合成时间线未就绪",
    render_asset_manifest_missing: "资产清单数据缺失",
    render_asset_manifest_invalid: "资产清单数据格式异常，请重新生成资产",
    render_artifact_missing: "合成引用素材缺失",
    render_narration_missing: "缺少口播音频轨",
    render_subtitle_missing: "缺少字幕轨",
    render_timeline_partial: "合成时间线有可选警告（不阻塞渲染）",
    render_bgm_missing_optional: "可选 BGM 未生成（不阻塞渲染）",
    render_sfx_missing_optional: "可选 SFX 未生成（不阻塞渲染）",
  };
  return map[msg] ?? msg;
}

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

function goToCompose() {
  workspaceStore.setCurrentStep(COMPOSE_STEP_INDEX);
  const pid = projectStore.state.projectId;
  if (pid) router.push(`/projects/${pid}/compose`);
}
</script>

<template>
  <div class="render-panel">
    <!-- Error state -->
    <div v-if="renderStore.state.loadError" class="render-error-card">
      <el-alert
        :title="'加载失败：' + toZhRenderError(renderStore.state.loadError)"
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

    <!-- Compose record missing: project is past compose but compose data lost -->
    <div v-else-if="isComposeMissing" class="render-blocked-card">
      <el-alert
        title="合成记录缺失，无法进入渲染"
        type="warning"
        show-icon
        :closable="false"
        description="当前项目的合成时间线数据已丢失（可能因服务重启），请返回合成页重新生成合成时间线后再进入渲染。"
      />
      <div class="render-blocked-actions">
        <el-button type="primary" @click="goToCompose">返回合成页重新合成</el-button>
      </div>
    </div>

    <!-- Render blocked state: project was previously blocked, need to fix upstream -->
    <div v-else-if="isRenderBlocked" class="render-blocked-card">
      <el-alert
        title="渲染上游校验未通过"
        type="warning"
        show-icon
        :closable="false"
      >
        <template #description>
          <p>合成时间线存在阻断问题，无法进入渲染。</p>
          <ul v-if="snapshot?.active_render?.validation_result?.errors?.length" class="render-blocked-errors">
            <li v-for="(err, i) in snapshot.active_render.validation_result.errors" :key="'e' + i">
              {{ toZhRenderError(err) }}
            </li>
          </ul>
          <p v-else>请返回合成页检查并重新合成。</p>
        </template>
      </el-alert>
      <div class="render-blocked-actions">
        <el-button type="primary" @click="goToCompose">返回合成页检查</el-button>
        <el-button :loading="renderStore.state.isGenerating" @click="handleGenerate">重试渲染</el-button>
      </div>
    </div>

    <!-- Too early for render: project status is below compose/render -->
    <div v-else-if="isTooEarlyForRender" class="render-blocked-card">
      <el-alert
        title="当前项目未到达渲染阶段"
        type="info"
        show-icon
        :closable="false"
        description="项目已回退到较早阶段（可能因服务重启导致下游数据丢失），请从项目列表进入当前可用阶段继续。"
      />
      <div class="render-blocked-actions">
        <el-button @click="router.push('/projects')">返回项目列表</el-button>
      </div>
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

.render-blocked-card {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-md);
  border-radius: var(--radius-card);
  background: var(--bg-card);
}

.render-blocked-actions {
  display: flex;
  gap: var(--space-sm);
  justify-content: center;
}

.render-blocked-errors {
  margin: var(--space-xs) 0 0;
  padding-left: 1.2rem;
  font-size: 0.84rem;
  line-height: 1.6;
  color: var(--text-body);
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
