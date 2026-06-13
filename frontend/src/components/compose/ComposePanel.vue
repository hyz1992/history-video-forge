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

const activeCompose = computed(() => snapshot.value?.active_compose ?? null);

const timeline = computed(() => activeCompose.value?.timeline ?? null);

const validation = computed(
  () => activeCompose.value?.local_validation ?? null,
);

const hasCompose = computed(() => !!activeCompose.value);

const RENDER_STEP_INDEX = PIPELINE_STEPS.findIndex((s) => s.key === "render");
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

/* -------------------------------------------------------------------------- */
/*  Lifecycle                                                                 */
/* -------------------------------------------------------------------------- */

onMounted(async () => {
  await composeStore.loadProject();
  // Auto-generate compose timeline when arriving from asset confirmation
  const s = composeStore.state.snapshot;
  if (
    s &&
    !s.active_compose &&
    (s.current_status === "assets_ready" ||
      s.current_status === "assets_blocked" ||
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

    <!-- Generating state -->
    <div
      v-else-if="composeStore.state.isGenerating && !hasCompose"
      class="compose-generating"
    >
      <p>正在生成合成时间线，请稍候...</p>
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
            <template v-else-if="validationDecision === 'blocked'">校验未通过，存在阻断问题</template>
            <template v-else>部分校验通过，存在警告</template>
          </span>
        </div>
        <ul
          v-if="validation?.errors?.length"
          class="compose-validation-list compose-validation-list--error"
        >
          <li v-for="(err, i) in validation.errors" :key="'e' + i">{{ err }}</li>
        </ul>
        <ul
          v-if="validation?.warnings?.length"
          class="compose-validation-list compose-validation-list--warn"
        >
          <li v-for="(warn, i) in validation.warnings" :key="'w' + i">{{ warn }}</li>
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
        <el-button
          type="primary"
          :disabled="validationDecision !== 'ready_for_render'"
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
