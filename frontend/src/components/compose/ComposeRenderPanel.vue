<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";

import { notifyUnauthorized } from "../../utils/api";
import { deriveMissingAssetItems } from "../../utils/missing-asset-items";

import { useComposeStore } from "../../stores/compose";
import { useRenderStore } from "../../stores/render";
import { useProjectStore } from "../../stores/project";
import { useWorkspaceStore, PIPELINE_STEPS } from "../../stores/workspace";
import StageGenerating from "../workspace/StageGenerating.vue";

const composeStore = useComposeStore();
const renderStore = useRenderStore();
const workspaceStore = useWorkspaceStore();
const router = useRouter();
const projectStore = useProjectStore();

const ASSET_STEP_INDEX = PIPELINE_STEPS.findIndex((s) => s.key === "asset");
const PUBLISH_STEP_INDEX = PIPELINE_STEPS.findIndex((s) => s.key === "publish");
const videoRef = ref<HTMLVideoElement | null>(null);

/* -------------------------------------------------------------------------- */
/*  Compose: computed data                                                    */
/* -------------------------------------------------------------------------- */

const composeSnapshot = computed(() => composeStore.state.snapshot);
const composeCurrentStatus = computed(() => composeSnapshot.value?.current_status ?? "");

const activeCompose = computed(() => composeSnapshot.value?.active_compose ?? null);
const validation = computed(() => activeCompose.value?.local_validation ?? null);
const hasCompose = computed(() => !!activeCompose.value);

const validationDecision = computed(() => {
  if (!validation.value) return "unknown";
  return validation.value.decision;
});

const canEnterRender = computed(() => {
  const d = validationDecision.value;
  return d === "ready_for_render" || d === "partial";
});

const composeIsGenerating = computed(
  () =>
    composeStore.state.isGenerating ||
    composeStore.state.snapshot?.active_compose?.execution_state?.generating === true,
);

const isTooEarlyForCompose = computed(() => {
  if (!composeCurrentStatus.value || hasCompose.value || renderAutoTriggered.value) return false;
  const s = composeCurrentStatus.value;
  return !s.startsWith("compos") && !s.startsWith("assets") && !s.startsWith("render");
});

const isAssetsBlocked = computed(() => composeCurrentStatus.value === "assets_blocked");

const missingAssetItems = computed(() => {
  const manifest = composeStore.state.snapshot?.active_assets?.manifest;
  if (!manifest) return [];
  return deriveMissingAssetItems(manifest);
});

const VALIDATION_CODE_ZH: Record<string, string> = {
  compose_asset_manifest_not_ready: "资产未就绪",
  compose_asset_manifest_partial: "部分可选素材未完成（不阻塞渲染）",
  compose_narration_missing: "缺少口播音频",
  compose_narration_duration_missing: "口播音频时长无效",
  compose_subtitle_missing: "缺少字幕",
  compose_timeline_duration_invalid: "时间线时长无效",
  compose_segment_visual_missing: "某分镜缺少视觉素材",
  compose_artifact_missing: "合成引用素材缺失",
  compose_artifact_file_missing: "素材文件丢失",
  compose_bgm_missing_optional: "可选配乐未生成（不阻塞渲染）",
};

function toZhMessage(code: string): string {
  return VALIDATION_CODE_ZH[code] ?? code;
}

const blockReason = computed(() => {
  if (canEnterRender.value) return "";
  const msgs: string[] = [];
  if (validation.value?.errors?.length) {
    msgs.push(...validation.value.errors.map(toZhMessage));
  }
  if (!msgs.length) msgs.push("校验未通过");
  return msgs.join("；");
});

/* -------------------------------------------------------------------------- */
/*  Render: computed data                                                     */
/* -------------------------------------------------------------------------- */

const renderSnapshot = computed(() => renderStore.state.snapshot);
const activeRender = computed(() => renderSnapshot.value?.active_render ?? null);
const hasRender = computed(() => !!activeRender.value);
const outputArtifact = computed(() => activeRender.value?.output_artifact ?? null);
const renderStatus = computed(() => activeRender.value?.status ?? "");
const renderValidationResult = computed(() => activeRender.value?.validation_result ?? null);

const isRenderCompleted = computed(() => renderStatus.value === "completed" || renderStatus.value === "ready");
const isRenderFailed = computed(() => renderStatus.value === "failed" || renderStatus.value === "stale_source");

const renderIsGenerating = computed(
  () =>
    renderStore.state.isGenerating ||
    renderStore.state.snapshot?.active_render?.execution_state?.generating === true ||
    renderPollingActive.value ||
    renderStatus.value === "rendering" ||
    renderStatus.value === "queued",
);

const rendererType = computed<string>(() => {
  const meta = outputArtifact.value?.metadata as Record<string, unknown> | undefined;
  return (meta?.renderer as string) ?? "";
});

const isRealVideo = computed(() => isRenderCompleted.value && rendererType.value === "remotion");
const isFakePlaceholder = computed(() => isRenderCompleted.value && rendererType.value === "fake");

const renderInfo = computed(() => {
  const duration = outputArtifact.value?.duration_sec
    ? `${outputArtifact.value.duration_sec.toFixed(1)}s`
    : "—";
  const profile = activeRender.value?.profile;
  const resolution = outputArtifact.value
    ? `${outputArtifact.value.width}x${outputArtifact.value.height}`
    : profile
      ? `${profile.width}x${profile.height}`
      : "—";
  const fps = outputArtifact.value?.fps ?? profile?.fps ?? "—";
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

const displayFilename = computed(() => {
  const projectName = (renderSnapshot.value as Record<string, unknown> | undefined)?.project_name as string
    ?? projectStore.state.projects.find(p => p.project_id === projectStore.state.projectId)?.display_name
    ?? "未命名项目";
  return `${projectName}.mp4`;
});

const isDownloading = ref(false);

async function handleDownload() {
  isDownloading.value = true;
  try {
    const res = await fetch(downloadUrl.value);
    if (res.status === 401) {
      notifyUnauthorized();
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as Record<string, unknown>).error as string ?? `下载失败 (${res.status})`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = displayFilename.value;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    ElMessage.error("下载失败：" + (e instanceof Error ? e.message : "未知错误"));
  } finally {
    isDownloading.value = false;
  }
}

function toZhRenderError(msg: string): string {
  if (msg.startsWith("render_artifact_file_missing:")) {
    const parts = msg.split(":");
    const artId = parts[1] ?? "?";
    const artType = parts[2] ?? "?";
    return `素材文件缺失（${artId}/${artType}），请返回资产页重新生成或替换`;
  }
  const map: Record<string, string> = {
    active_compose_missing: "合成记录缺失，请重新生成合成时间线",
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
/*  Auto pipeline state                                                       */
/* -------------------------------------------------------------------------- */

const renderAutoTriggered = ref(false);
const renderPollingActive = ref(false);
const autoPhaseTitle = ref("正在合成时间线，请稍候...");
const autoPhaseHint = ref("正在编排素材、对齐时间轴、准备音频和字幕轨道。");

let renderPollTimer: ReturnType<typeof setInterval> | null = null;

function stopRenderPolling() {
  renderPollingActive.value = false;
  if (renderPollTimer) {
    clearInterval(renderPollTimer);
    renderPollTimer = null;
  }
}

function startRenderPolling() {
  stopRenderPolling();

  const ar = renderStore.state.snapshot?.active_render;
  if (ar && (ar.status === "completed" || ar.status === "ready" ||
             ar.status === "failed" || ar.status === "stale_source" ||
             ar.status === "blocked")) {
    renderPollingActive.value = false;
    return;
  }

  renderPollingActive.value = true;
  renderPollTimer = setInterval(async () => {
    try {
      await renderStore.loadProject();
      const snap = renderStore.state.snapshot;
      if (!snap) return;
      const ar2 = snap.active_render;
      if (!ar2 || ar2.execution_state?.generating === true) return;
      if (ar2.status === "completed" || ar2.status === "ready" || ar2.status === "failed" || ar2.status === "stale_source" || ar2.status === "blocked") {
        stopRenderPolling();
      }
    } catch {
      // ignore polling errors
    }
  }, 5000);
}

onUnmounted(() => stopRenderPolling());

async function triggerAutoRender() {
  if (renderAutoTriggered.value) return;

  await renderStore.loadProject();
  const snap = renderStore.state.snapshot;
  const existingRender = snap?.active_render;

  if (existingRender) {
    renderAutoTriggered.value = true;
    const s = existingRender.status;
    if (s === "rendering" || s === "queued" || existingRender.execution_state?.generating === true) {
      autoPhaseTitle.value = "正在渲染视频，可能需要几分钟...";
      autoPhaseHint.value = "正在调用渲染引擎逐帧输出视频，请耐心等待。";
      startRenderPolling();
    }
    return;
  }

  renderAutoTriggered.value = true;
  autoPhaseTitle.value = "正在渲染视频，可能需要几分钟...";
  autoPhaseHint.value = "正在调用渲染引擎逐帧输出视频，请耐心等待。";

  try {
    if (renderStore.state.loadError) throw new Error(renderStore.state.loadError);
    await renderStore.generateRender();
    if (renderStore.state.loadError) throw new Error(renderStore.state.loadError);
    startRenderPolling();
  } catch {
    renderAutoTriggered.value = false;
  }
}

watch(activeCompose, (compose) => {
  if (!compose || renderAutoTriggered.value) return;
  if (canEnterRender.value) {
    triggerAutoRender();
  }
});

/* -------------------------------------------------------------------------- */
/*  Auto compose auto-generation                                              */
/* -------------------------------------------------------------------------- */

let composeAutoGenerated = false;

async function triggerAutoCompose() {
  if (composeAutoGenerated) return;
  const s = composeStore.state.snapshot;
  if (s?.active_compose) {
    composeAutoGenerated = true;
    return;
  }
  if (
    s &&
    !s.active_compose &&
    (s.current_status === "assets_ready" ||
      s.current_status === "assets_partial") &&
    !composeStore.state.isLoading &&
    !composeStore.state.loadError
  ) {
    composeAutoGenerated = true;
    autoPhaseTitle.value = "正在合成时间线，请稍候...";
    autoPhaseHint.value = "正在编排素材、对齐时间轴、准备音频和字幕轨道。";
    try {
      await composeStore.generateCompose();
    } catch { /* handled below */ }
  }
}

watch(() => composeStore.state.snapshot, async (snapshot) => {
  if (snapshot && !snapshot.active_compose && !composeAutoGenerated) {
    await triggerAutoCompose();
  }
});

onMounted(async () => {
  await composeStore.loadProject();
  if (composeStore.state.snapshot?.active_compose) {
    const c = composeStore.state.snapshot.active_compose;
    const d = c.local_validation?.decision;
    if (d === "ready_for_render" || d === "partial") {
      await renderStore.loadProject();
      const existingRender = renderStore.state.snapshot?.active_render;
      if (!existingRender) {
        await triggerAutoRender();
      }
    }
    return;
  }
  await triggerAutoCompose();
});

/* -------------------------------------------------------------------------- */
/*  Manual actions                                                            */
/* -------------------------------------------------------------------------- */

async function handleGenerateCompose() {
  composeAutoGenerated = true;
  autoPhaseTitle.value = "正在合成时间线，请稍候...";
  autoPhaseHint.value = "正在编排素材、对齐时间轴、准备音频和字幕轨道。";
  try {
    await composeStore.generateCompose();
  } catch { /* ignore */ }
}

async function handleStartRender() {
  await renderStore.loadProject();
  if (renderStore.state.loadError) return;
  await renderStore.generateRender();
  if (!renderStore.state.loadError) startRenderPolling();
}

async function handleRecompose() {
  try {
    await ElMessageBox.confirm(
      "重新合成将重新编排时间线并重新渲染视频，已有结果将被覆盖。确认继续？",
      "确认重新合成渲染",
      { confirmButtonText: "确定重新合成", cancelButtonText: "取消", type: "warning" },
    );
  } catch { return; }

  composeAutoGenerated = false;
  renderAutoTriggered.value = false;
  stopRenderPolling();
  autoPhaseTitle.value = "正在合成时间线，请稍候...";
  autoPhaseHint.value = "正在编排素材、对齐时间轴、准备音频和字幕轨道。";
  try {
    await composeStore.generateCompose();
  } catch { /* ignore */ }
  if (!composeStore.state.loadError) {
    triggerAutoRender();
  }
}

function handleFullscreen() {
  if (!videoRef.value) return;
  videoRef.value.requestFullscreen().catch(() => {});
}

function goToAssets() {
  workspaceStore.setCurrentStep(ASSET_STEP_INDEX);
  const pid = projectStore.state.projectId; if (pid) router.push(`/projects/${pid}/asset`);
}

function goToPublish() {
  workspaceStore.setCurrentStep(PUBLISH_STEP_INDEX);
  const pid = projectStore.state.projectId; if (pid) router.push(`/projects/${pid}/publish?auto=true`);
}

/* -------------------------------------------------------------------------- */
/*  Generating-phase label: compose or render?                                */
/* -------------------------------------------------------------------------- */

const generatingTitle = computed(() => {
  if (composeIsGenerating.value || (!hasCompose.value && !composeAutoGenerated)) return "正在合成时间线，请稍候...";
  return autoPhaseTitle.value;
});

const generatingHint = computed(() => {
  if (composeIsGenerating.value || (!hasCompose.value && !composeAutoGenerated)) return "正在编排素材、对齐时间轴、准备音频和字幕轨道。";
  return autoPhaseHint.value;
});

/* -------------------------------------------------------------------------- */
/*  State: is the whole pipeline still in progress?                           */
/* -------------------------------------------------------------------------- */

const isPipelineInProgress = computed(() => {
  if (composeStore.state.loadError) return false;
  if (!hasCompose.value && (isTooEarlyForCompose.value || isAssetsBlocked.value)) return false;
  if (!hasCompose.value) return true;
  if (!canEnterRender.value) return false;
  if (!hasRender.value) return true;
  if (renderIsGenerating.value) return true;
  return false;
});
</script>

<template>
  <div class="compose-render-panel">
    <!-- ============================================================ -->
    <!--  Loading skeleton                                             -->
    <!-- ============================================================ -->
    <el-skeleton
      v-if="composeStore.state.isLoading && !hasCompose && !composeStore.state.loadError && !composeAutoGenerated"
      :rows="5"
      animated
      class="render-skeleton"
    />

    <!-- ============================================================ -->
    <!--  Compose error                                                -->
    <!-- ============================================================ -->
    <div v-else-if="composeStore.state.loadError && !hasCompose" class="card-error">
      <el-alert
        :title="'加载失败：' + composeStore.state.loadError"
        type="error"
        show-icon
        :closable="false"
      />
      <el-button
        type="primary"
        :loading="composeStore.state.isLoading"
        @click="composeStore.loadProject()"
      >
        重试
      </el-button>
    </div>

    <!-- ============================================================ -->
    <!--  Too early                                                    -->
    <!-- ============================================================ -->
    <div v-else-if="isTooEarlyForCompose" class="card-error">
      <el-alert
        title="当前项目未到达合成渲染阶段"
        type="info"
        show-icon
        :closable="false"
        description="项目尚未完成前置阶段，无法进入合成渲染。请从项目列表进入当前可用阶段继续。"
      />
      <div class="card-error-actions">
        <el-button @click="router.push('/projects')">返回项目列表</el-button>
        <el-button @click="composeStore.loadProject()">刷新状态</el-button>
      </div>
    </div>

    <!-- ============================================================ -->
    <!--  Assets blocked                                               -->
    <!-- ============================================================ -->
    <div v-else-if="isAssetsBlocked && !hasCompose" class="card-error">
      <el-alert
        title="资产尚未完整，暂不能生成合成时间线"
        type="warning"
        show-icon
        :closable="false"
      >
        <template #default>
          <p v-if="missingAssetItems.length > 0">缺失项：</p>
          <ul v-if="missingAssetItems.length > 0" style="padding-left: 20px; line-height: 1.8;">
            <li v-for="(item, i) in missingAssetItems" :key="i">{{ item }}</li>
          </ul>
          <p v-else>请返回资产页检查各分镜的素材状态。</p>
        </template>
      </el-alert>
      <div class="card-error-actions">
        <el-button type="primary" @click="goToAssets">返回资产页处理</el-button>
      </div>
    </div>

    <!-- ============================================================ -->
    <!--  Pipeline in progress: StageGenerating                        -->
    <!-- ============================================================ -->
    <StageGenerating
      v-else-if="isPipelineInProgress"
      :title="generatingTitle"
      :hint="generatingHint"
      secondary-hint="请耐心等待，无需重复点击。"
    />

    <!-- ============================================================ -->
    <!--  Compose blocked (validation failed)                          -->
    <!-- ============================================================ -->
    <div v-else-if="hasCompose && !canEnterRender" class="card-error">
      <el-alert
        :title="'合成校验未通过：' + blockReason"
        type="warning"
        show-icon
        :closable="false"
      >
        <template #default>
          <ul v-if="validation?.errors?.length" style="padding-left: 20px; line-height: 1.8; margin: 0;">
            <li v-for="(err, i) in validation!.errors" :key="'e' + i">{{ toZhMessage(err) }}</li>
          </ul>
        </template>
      </el-alert>
      <div class="card-error-actions">
        <el-button type="primary" @click="goToAssets">返回资产页处理</el-button>
        <el-button @click="handleGenerateCompose" :loading="composeStore.state.isGenerating">重新合成</el-button>
      </div>
    </div>

    <!-- ============================================================ -->
    <!--  Render error                                                 -->
    <!-- ============================================================ -->
    <div v-else-if="renderStore.state.loadError && !hasRender" class="card-error">
      <el-alert
        :title="'渲染状态加载失败：' + toZhRenderError(renderStore.state.loadError)"
        type="error"
        show-icon
        :closable="false"
      />
      <el-button
        type="primary"
        @click="handleStartRender"
        :loading="renderStore.state.isGenerating"
      >
        重试渲染
      </el-button>
    </div>

    <!-- ============================================================ -->
    <!--  Render failed                                                -->
    <!-- ============================================================ -->
    <div v-else-if="isRenderFailed && !isRenderCompleted" class="card-blocked">
      <el-alert
        title="渲染失败"
        type="error"
        show-icon
        :closable="false"
      >
        <template #default>
          <p>渲染过程中发生错误，请检查上游数据后重试。</p>
          <p v-if="renderValidationResult?.errors?.length" class="render-error-detail">
            错误详情：{{ (renderValidationResult.errors as string[]).join("；") }}
          </p>
        </template>
      </el-alert>
      <div class="card-blocked-actions">
        <el-button type="primary" :loading="renderStore.state.isGenerating" @click="handleRetryRender">重试渲染</el-button>
        <el-button @click="composeStore.loadProject(); handleGenerateCompose()">重新合成</el-button>
      </div>
    </div>

    <!-- ============================================================ -->
    <!--  Done: video ready                                            -->
    <!-- ============================================================ -->
    <template v-else-if="isRenderCompleted">
      <div class="render-status-bar">
        <el-tag v-if="isFakePlaceholder" type="info" size="large">占位渲染完成（非真实视频）</el-tag>
        <el-tag v-else-if="isRealVideo" type="success" size="large">渲染完成</el-tag>
        <el-tag v-else type="success" size="large">渲染完成</el-tag>
      </div>

      <div class="render-preview-wrapper">
        <div class="render-preview-container">
          <video
            v-if="isRealVideo"
            ref="videoRef"
            :src="previewUrl"
            controls
            playsinline
            class="render-preview-video"
          />
          <div v-else-if="isFakePlaceholder" class="render-preview-placeholder">
            <span class="render-preview-icon">&#128250;</span>
            <p class="render-preview-placeholder-text">当前为开发占位渲染<br/>未生成真实可预览视频</p>
          </div>
          <div v-else class="render-preview-placeholder">
            <span class="render-preview-icon">&#9654;</span>
          </div>
        </div>
        <button
          v-if="isRealVideo"
          class="btn-fullscreen"
          @click="handleFullscreen"
          title="全屏播放"
        >
          <svg viewBox="0 0 24 24"><polygon points="3 3 8 3 8 5 5 5 5 8 3 8 3 3"/><polygon points="21 3 16 3 16 5 19 5 19 8 21 8 21 3"/><polygon points="21 21 16 21 16 19 19 19 19 16 21 16 21 21"/><polygon points="3 21 8 21 8 19 5 19 5 16 3 16 3 21"/></svg>
        </button>
      </div>

      <div class="card-info">
        <div class="card-info-row">
          <span class="card-info-label">文件名</span>
          <span class="card-info-value">{{ displayFilename }}</span>
        </div>
        <div class="card-info-row">
          <span class="card-info-label">文件大小</span>
          <span class="card-info-value">{{ renderInfo.fileSize }}</span>
        </div>
        <div class="card-info-row">
          <span class="card-info-label">时长</span>
          <span class="card-info-value">{{ renderInfo.duration }}</span>
        </div>
        <div class="card-info-row">
          <span class="card-info-label">分辨率</span>
          <span class="card-info-value">{{ renderInfo.resolution }}</span>
        </div>
        <div class="card-info-row">
          <span class="card-info-label">帧率</span>
          <span class="card-info-value">{{ renderInfo.fps }}</span>
        </div>
        <div class="card-info-row">
          <span class="card-info-label">校验结果</span>
          <span class="card-info-value">
            <template v-if="renderValidationResult">
              <el-tag v-if="renderValidationResult.decision === 'pass'" type="success" size="small">通过</el-tag>
              <el-tag v-else-if="renderValidationResult.decision === 'warn'" type="warning" size="small">警告</el-tag>
              <el-tag v-else type="danger" size="small">{{ renderValidationResult.decision }}</el-tag>
            </template>
            <template v-else>—</template>
          </span>
        </div>
      </div>

      <div class="card-actions">
        <el-button
          type="success"
          :loading="isDownloading"
          @click="handleDownload"
        >
          下载视频
        </el-button>
        <el-button type="primary" @click="goToPublish">
          进入发布交付 &rarr;
        </el-button>
        <el-button
          :loading="isPipelineInProgress"
          @click="handleRecompose"
        >
          重新合成渲染
        </el-button>
      </div>
    </template>

    <!-- ============================================================ -->
    <!--  Fallback: no render yet, but compose is ready                -->
    <!-- ============================================================ -->
    <div v-else-if="hasCompose && canEnterRender && !hasRender" class="section-empty">
      <p>尚未开始渲染</p>
      <el-button
        type="primary"
        :loading="renderStore.state.isGenerating"
        @click="handleStartRender"
      >
        开始渲染
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.compose-render-panel {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-lg);
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
}

.render-skeleton {
  padding: var(--space-md);
}

/* ---- Common cards ---- */
.card-error {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-md);
  border-radius: var(--radius-card);
  background: var(--bg-card);
}

.card-error-actions {
  display: flex;
  gap: var(--space-sm);
}

.card-blocked {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-md);
  border-radius: var(--radius-card);
  background: var(--bg-card);
}

.card-blocked-actions {
  display: flex;
  gap: var(--space-sm);
  justify-content: center;
}

.card-info {
  display: grid;
  gap: var(--space-sm);
  padding: var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--bg-card);
}

.card-info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-md);
}

.card-info-label {
  font-size: 0.84rem;
  color: var(--text-muted);
  flex-shrink: 0;
}

.card-info-value {
  font-size: 0.88rem;
  color: var(--text-body);
  text-align: right;
  word-break: break-all;
}

.card-actions {
  display: flex;
  gap: var(--space-sm);
  justify-content: center;
  padding: var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--bg-card);
}

.section-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  padding: var(--space-xl) var(--space-md);
  color: var(--text-secondary);
  text-align: center;
}

/* ---- Render status bar ---- */
.render-status-bar {
  display: flex;
  align-items: center;
}

.render-error-detail {
  font-size: 0.84rem;
  color: var(--text-body);
  margin: var(--space-xs) 0 0;
}

/* ---- Render preview ---- */
.render-preview-wrapper {
  display: flex;
  justify-content: center;
  position: relative;
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
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-xs);
  padding: var(--space-sm);
}

.render-preview-icon {
  font-size: 2.5rem;
  color: #444;
  user-select: none;
}

.btn-fullscreen {
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(0, 0, 0, 0.55);
  cursor: pointer;
  display: grid;
  place-items: center;
  opacity: 0;
  transition: opacity 180ms ease;
}

.render-preview-wrapper:hover .btn-fullscreen {
  opacity: 1;
}

.btn-fullscreen svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: #fff;
  stroke-width: 2;
}

.render-preview-placeholder-text {
  font-size: 0.8rem;
  color: var(--text-muted);
  text-align: center;
  line-height: 1.5;
}

/* ---- Responsive ---- */
@media (max-width: 599px) {
  .card-actions {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
