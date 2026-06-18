<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";

import { useComposeStore } from "../../stores/compose";
import { useProjectStore } from "../../stores/project";
import { useWorkspaceStore, PIPELINE_STEPS } from "../../stores/workspace";

const composeStore = useComposeStore();
const workspaceStore = useWorkspaceStore();

/* -------------------------------------------------------------------------- */
/*  Computed data from store                                                  */
/* -------------------------------------------------------------------------- */

const snapshot = computed(() => composeStore.state.snapshot);
const currentStatus = computed(() => snapshot.value?.current_status ?? "");

const activeCompose = computed(() => snapshot.value?.active_compose ?? null);

const timeline = computed(() => activeCompose.value?.timeline ?? null);

const validation = computed(
  () => activeCompose.value?.local_validation ?? null,
);

const hasCompose = computed(() => !!activeCompose.value);

const RENDER_STEP_INDEX = PIPELINE_STEPS.findIndex((s) => s.key === "render");
const ASSET_STEP_INDEX = PIPELINE_STEPS.findIndex((s) => s.key === "asset");
const router = useRouter();
const projectStore = useProjectStore();

/* -------------------------------------------------------------------------- */
/*  Track summary                                                             */
/* -------------------------------------------------------------------------- */

const TRACK_TYPE_LABELS: Record<string, string> = {
  visual: "视觉",
  narration: "语音",
  subtitle: "字幕",
  bgm: "BGM",
  sfx: "音效",
};

const TRACK_TYPE_COLORS: Record<string, string> = {
  visual: "#409eff",
  narration: "#67c23a",
  subtitle: "#e6a23c",
  bgm: "#909399",
  sfx: "#f56c6c",
};

const trackSummary = computed(() => {
  const tracks = timeline.value?.tracks ?? [];
  return tracks.map((track) => ({
    trackId: track.track_id,
    trackType: track.track_type,
    label: TRACK_TYPE_LABELS[track.track_type] ?? track.track_type,
    color: TRACK_TYPE_COLORS[track.track_type] ?? "#909399",
    clipCount: track.clips?.length ?? 0,
  }));
});

/* -------------------------------------------------------------------------- */
/*  Validation decision                                                       */
/* -------------------------------------------------------------------------- */

const validationDecision = computed(() => {
  if (!validation.value) return "unknown";
  return validation.value.decision;
});

/** Map internal error/warning codes to human-readable Chinese messages. */
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

const canEnterRender = computed(() => {
  const d = validationDecision.value;
  return d === "ready_for_render" || d === "partial";
});

/** True when project status is too early for compose (requires assets stage). */
const isTooEarlyForCompose = computed(() => {
  if (!currentStatus.value || hasCompose.value) return false;
  const s = currentStatus.value;
  return !s.startsWith("compos") && !s.startsWith("assets") && !s.startsWith("render");
});

const isGenerating = computed(
  () =>
    composeStore.state.isGenerating ||
    composeStore.state.snapshot?.active_compose?.execution_state?.generating === true,
);

const isAssetsBlocked = computed(() => currentStatus.value === "assets_blocked");

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
/*  Lifecycle                                                                 */
/* -------------------------------------------------------------------------- */

onMounted(async () => {
  await composeStore.loadProject();
  // Auto-generate compose timeline when arriving from asset confirmation.
  // Only trigger for ready/partial — NOT for blocked.
  const s = composeStore.state.snapshot;
  if (
    s &&
    !s.active_compose &&
    (s.current_status === "assets_ready" ||
      s.current_status === "assets_partial")
  ) {
    await composeStore.generateCompose();
    if (!composeStore.state.loadError) {
      ElMessage.success("合成时间线生成完成");
    }
  }
});

/* -------------------------------------------------------------------------- */
/*  Actions                                                                   */
/* -------------------------------------------------------------------------- */

async function handleGenerate() {
  await composeStore.generateCompose();
  if (!composeStore.state.loadError) {
    ElMessage.success("合成时间线生成完成");
  }
}

function handleGoToRender() {
  workspaceStore.setCurrentStep(RENDER_STEP_INDEX);
  const pid = projectStore.state.projectId; if (pid) router.push(`/projects/${pid}/render`);
}

function goToAssets() {
  workspaceStore.setCurrentStep(ASSET_STEP_INDEX);
  const pid = projectStore.state.projectId; if (pid) router.push(`/projects/${pid}/asset`);
}

function handleRetry() {
  composeStore.loadProject();
}
</script>

<template>
  <div class="compose-panel">
    <!-- Error state -->
    <div v-if="composeStore.state.loadError" class="compose-error-card">
      <el-alert
        :title="'加载失败：' + composeStore.state.loadError"
        type="error"
        show-icon
        :closable="false"
      />
      <el-button
        type="primary"
        :loading="composeStore.state.isLoading"
        @click="handleRetry"
      >
        重试
      </el-button>
    </div>

    <!-- Loading skeleton -->
    <el-skeleton
      v-else-if="composeStore.state.isLoading && !hasCompose"
      :rows="6"
      animated
      class="compose-skeleton"
    />

    <!-- Generating state (snapshot-based, survives refresh) -->
    <div
      v-else-if="isGenerating"
      class="compose-generating"
    >
      <p>正在生成合成时间线，请稍候...</p>
    </div>

    <!-- Assets blocked: cannot compose yet -->
    <div v-else-if="isAssetsBlocked && !hasCompose" class="compose-error-card">
      <el-alert
        title="资产尚未完整，暂不能生成合成时间线"
        type="warning"
        show-icon
        :closable="false"
      >
        <template #default>
          <p>以下可能原因：</p>
          <ul style="padding-left: 20px; line-height: 1.8;">
            <li>分镜图未生成或未上传</li>
            <li>分镜视频（图生视频）缺失</li>
            <li>口播音频（TTS）未生成</li>
            <li>字幕文件缺失</li>
          </ul>
          <p>请返回资产页，在分镜卡片中逐一检查并补全缺失的素材。</p>
        </template>
      </el-alert>
      <div class="compose-error-actions">
        <el-button type="primary" @click="goToAssets">返回资产页处理</el-button>
      </div>
    </div>

    <!-- Too early for compose: project status is below assets -->
    <div v-else-if="isTooEarlyForCompose" class="compose-error-card">
      <el-alert
        title="当前项目未到达合成阶段"
        type="info"
        show-icon
        :closable="false"
        description="项目尚未完成前置阶段，无法进入合成。请从项目列表进入当前可用阶段继续。"
      />
      <div class="compose-error-card-actions">
        <el-button @click="router.push('/projects')">返回项目列表</el-button>
        <el-button @click="handleRetry">刷新状态</el-button>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="!hasCompose" class="compose-empty">
      <p>暂无合成数据</p>
      <el-button
        type="primary"
        :loading="composeStore.state.isGenerating"
        @click="handleGenerate"
      >
        {{ composeStore.state.isGenerating ? "生成中..." : "生成合成时间线" }}
      </el-button>
    </div>

    <!-- Main content -->
    <template v-else>
      <!-- Validation bar -->
      <div
        class="compose-validation"
        :class="{
          'compose-validation--ready': validationDecision === 'ready_for_render',
          'compose-validation--blocked': validationDecision === 'blocked',
          'compose-validation--partial': validationDecision === 'partial',
        }"
      >
        <div class="compose-validation-header">
          <span class="compose-validation-icon">
            <template v-if="validationDecision === 'ready_for_render'">&#10003;</template>
            <template v-else-if="validationDecision === 'blocked'">&#10007;</template>
            <template v-else>&#9888;</template>
          </span>
          <span class="compose-validation-label">
            <template v-if="validationDecision === 'ready_for_render'">校验通过，可进入渲染</template>
            <template v-else-if="validationDecision === 'blocked'">校验未通过：{{ blockReason }}</template>
            <template v-else-if="validationDecision === 'partial'">部分校验通过（仅警告），可进入渲染</template>
            <template v-else>校验状态未知</template>
          </span>
        </div>
        <ul
          v-if="validation?.errors?.length"
          class="compose-validation-list compose-validation-list--error"
        >
          <li v-for="(err, i) in validation.errors" :key="'e' + i">{{ toZhMessage(err) }}</li>
        </ul>
        <ul
          v-if="validation?.warnings?.length"
          class="compose-validation-list compose-validation-list--warn"
        >
          <li v-for="(warn, i) in validation.warnings" :key="'w' + i">{{ toZhMessage(warn) }}</li>
        </ul>
      </div>

      <!-- Timeline track summary -->
      <div class="compose-tracks-card">
        <div class="compose-tracks-title">时间线轨道</div>
        <div v-if="trackSummary.length" class="compose-tracks-list">
          <div
            v-for="track in trackSummary"
            :key="track.trackId"
            class="compose-track-row"
          >
            <span
              class="compose-track-label"
              :style="{ borderLeftColor: track.color }"
            >
              {{ track.label }}
            </span>
            <span
              class="compose-track-bar"
              :style="{ backgroundColor: track.color, width: Math.min(track.clipCount * 20, 100) + '%' }"
            />
            <span class="compose-track-count">{{ track.clipCount }} 个片段</span>
          </div>
        </div>
        <div v-else class="compose-tracks-empty">暂无轨道数据</div>
      </div>

      <!-- Action buttons -->
      <div class="compose-actions">
        <el-button @click="handleGenerate" :loading="composeStore.state.isGenerating">
          {{ composeStore.state.isGenerating ? "生成中..." : "重新合成" }}
        </el-button>
        <el-tooltip
          v-if="!canEnterRender"
          :content="blockReason"
          placement="top"
        >
          <span>
            <el-button
              type="primary"
              disabled
            >
              进入渲染 &rarr;
            </el-button>
          </span>
        </el-tooltip>
        <el-button
          v-else
          type="primary"
          @click="handleGoToRender"
        >
          进入渲染 &rarr;
        </el-button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.compose-panel {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-lg);
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
}

/* ---- Error / Loading / Empty ---- */
.compose-error-card {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-md);
  border-radius: var(--radius-card);
  background: var(--bg-card);
}

.compose-error-card-actions {
  display: flex;
  gap: var(--space-sm);
}

.compose-skeleton {
  padding: var(--space-md);
}

.compose-generating,
.compose-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  padding: var(--space-xl) var(--space-md);
  color: var(--text-secondary);
  text-align: center;
}

/* ---- Validation bar ---- */
.compose-validation {
  display: grid;
  gap: var(--space-sm);
  padding: var(--space-md);
  border-radius: var(--radius-card);
  background: var(--bg-card);
  border-left: 4px solid var(--border-default);
}

.compose-validation--ready {
  border-left-color: #67c23a;
  background: color-mix(in srgb, #67c23a 8%, var(--bg-card));
}

.compose-validation--blocked {
  border-left-color: #f56c6c;
  background: color-mix(in srgb, #f56c6c 8%, var(--bg-card));
}

.compose-validation--partial {
  border-left-color: #e6a23c;
  background: color-mix(in srgb, #e6a23c 8%, var(--bg-card));
}

.compose-validation-header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.compose-validation-icon {
  font-size: 1.1rem;
  font-weight: bold;
}

.compose-validation--ready .compose-validation-icon {
  color: #67c23a;
}

.compose-validation--blocked .compose-validation-icon {
  color: #f56c6c;
}

.compose-validation--partial .compose-validation-icon {
  color: #e6a23c;
}

.compose-validation-label {
  font-size: 0.92rem;
  font-weight: var(--font-subheading);
  color: var(--text-heading);
}

.compose-validation-list {
  margin: 0;
  padding-left: 1.4rem;
  font-size: 0.84rem;
  line-height: 1.6;
}

.compose-validation-list--error {
  color: #f56c6c;
}

.compose-validation-list--warn {
  color: #e6a23c;
}

/* ---- Track summary ---- */
.compose-tracks-card {
  padding: var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--bg-card);
  display: grid;
  gap: var(--space-md);
}

.compose-tracks-title {
  font-size: 0.92rem;
  font-weight: var(--font-subheading);
  color: var(--text-heading);
}

.compose-tracks-list {
  display: grid;
  gap: var(--space-sm);
}

.compose-track-row {
  display: grid;
  grid-template-columns: 80px 1fr auto;
  align-items: center;
  gap: var(--space-sm);
}

.compose-track-label {
  font-size: 0.84rem;
  color: var(--text-body);
  padding-left: 8px;
  border-left: 3px solid transparent;
}

.compose-track-bar {
  height: 8px;
  border-radius: 4px;
  min-width: 4px;
  opacity: 0.7;
  transition: width 300ms ease;
}

.compose-track-count {
  font-size: 0.78rem;
  color: var(--text-muted);
  white-space: nowrap;
}

.compose-tracks-empty {
  font-size: 0.84rem;
  color: var(--text-muted);
  text-align: center;
  padding: var(--space-sm) 0;
}

/* ---- Action buttons ---- */
.compose-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--bg-card);
}

/* ---- Responsive ---- */
@media (max-width: 599px) {
  .compose-track-row {
    grid-template-columns: 64px 1fr auto;
  }

  .compose-actions {
    flex-direction: column;
    gap: var(--space-sm);
    align-items: stretch;
  }
}
</style>
