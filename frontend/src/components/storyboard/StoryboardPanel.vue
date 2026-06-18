<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";

import { useStoryboardStore } from "../../stores/storyboard";
import { useProjectStore } from "../../stores/project";
import { useWorkspaceStore } from "../../stores/workspace";
import { PIPELINE_STEPS } from "../../stores/workspace";

const storyboardStore = useStoryboardStore();
const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();

/* -------------------------------------------------------------------------- */
/*  Computed data from store                                                  */
/* -------------------------------------------------------------------------- */

const activeStoryboard = computed(
  () => storyboardStore.state.snapshot?.active_storyboard ?? null,
);

const segments = computed(
  () => activeStoryboard.value?.plan?.segments ?? [],
);

const validationResult = computed(
  () => activeStoryboard.value?.validation_result ?? null,
);

const hasErrors = computed(
  () => (validationResult.value?.errors?.length ?? 0) > 0,
);

const hasWarnings = computed(
  () => (validationResult.value?.warnings?.length ?? 0) > 0,
);

const validationPassed = computed(
  () => validationResult.value?.decision === "pass",
);

const currentStatus = computed(
  () => storyboardStore.state.snapshot?.current_status ?? null,
);

const isStoryboardReady = computed(
  () => currentStatus.value === "storyboard_ready" ||
    currentStatus.value?.startsWith("asset_plan") ||
    currentStatus.value?.startsWith("assets") ||
    currentStatus.value?.startsWith("compos") ||
    currentStatus.value?.startsWith("render"),
);

const isGenerating = computed(
  () =>
    currentStatus.value === "storyboard_generating" ||
    activeStoryboard.value?.execution_state?.generating === true,
);

/* -------------------------------------------------------------------------- */
/*  Collapse / expand                                                         */
/* -------------------------------------------------------------------------- */

const COLLAPSE_THRESHOLD = 8;
const isExpanded = ref(false);

const visibleSegments = computed(() => {
  if (isExpanded.value || segments.value.length <= COLLAPSE_THRESHOLD) {
    return segments.value;
  }
  return segments.value.slice(0, COLLAPSE_THRESHOLD);
});

const hasMoreSegments = computed(
  () => segments.value.length > COLLAPSE_THRESHOLD,
);

const hiddenCount = computed(
  () => segments.value.length - COLLAPSE_THRESHOLD,
);

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function formatSeconds(seconds: number): string {
  const rounded = Math.round(seconds * 10) / 10;
  return `${rounded}s`;
}

const decisionLabels: Record<string, string> = {
  pass: "通过",
  fail: "未通过",
  pending: "待验证",
};

const validationDecisionLabel = computed(
  () =>
    decisionLabels[validationResult.value?.decision ?? ""] ??
    validationResult.value?.decision ??
    "",
);

const STORYBOARD_STEP_INDEX = PIPELINE_STEPS.findIndex(
  (s) => s.key === "storyboard",
);

const ASSET_STEP_INDEX = PIPELINE_STEPS.findIndex(
  (s) => s.key === "asset",
);
const router = useRouter();

/* -------------------------------------------------------------------------- */
/*  Lifecycle                                                                 */
/* -------------------------------------------------------------------------- */

onMounted(async () => {
  await storyboardStore.loadActiveStoryboardSnapshot();
  // Auto-generate when arriving from script confirmation
  const s = storyboardStore.state.snapshot;
  if (
    s &&
    !s.active_storyboard &&
    (s.current_status === "storyboard_ready" ||
      s.current_status === "script_ready")
  ) {
    await storyboardStore.generateStoryboard();
    if (!storyboardStore.state.loadError) {
      ElMessage.success("分镜规划生成完成");
    }
  }
});

/* -------------------------------------------------------------------------- */
/*  Actions                                                                   */
/* -------------------------------------------------------------------------- */

async function handleGenerate() {
  await storyboardStore.generateStoryboard();
  if (!storyboardStore.state.loadError) {
    ElMessage.success("分镜规划生成完成");
  }
}

function handleRetry() {
  storyboardStore.retryLoad();
}

function handleConfirm() {
  ElMessage.success("分镜已确认，进入资产阶段");
  workspaceStore.setCurrentStep(ASSET_STEP_INDEX);
  const pid = projectStore.state.projectId; if (pid) router.push(`/projects/${pid}/asset`);
}
</script>

<template>
  <div class="storyboard-panel">
    <!-- Error state -->
    <div v-if="storyboardStore.state.loadError" class="storyboard-error-card">
      <el-alert
        :title="'加载失败：' + storyboardStore.state.loadError"
        type="error"
        show-icon
        :closable="false"
      />
      <el-button
        type="primary"
        :loading="storyboardStore.state.isLoading"
        @click="handleRetry"
      >
        重试
      </el-button>
    </div>

    <!-- Generating state (must be before loading skeleton — survives refresh) -->
    <div
      v-else-if="isGenerating"
      class="storyboard-generating"
    >
      <p class="storyboard-generating-title">正在生成分镜规划</p>
      <p class="storyboard-generating-hint">正在调用大模型分析文案并规划分镜，可能需要 1-2 分钟。</p>
      <p class="storyboard-generating-hint">页面会自动刷新，也可手动刷新状态。</p>
      <el-button @click="storyboardStore.retryLoad()">刷新状态</el-button>
    </div>

    <!-- Loading skeleton (only when loading without active generation) -->
    <el-skeleton
      v-else-if="storyboardStore.state.isLoading && !activeStoryboard"
      :rows="6"
      animated
      class="storyboard-skeleton"
    />

    <!-- Empty state - no storyboard generated yet -->
    <div
      v-else-if="
        !activeStoryboard &&
        !storyboardStore.state.isLoading &&
        !storyboardStore.state.loadError
      "
      class="storyboard-empty"
    >
      <p>分镜尚未生成</p>
      <p class="storyboard-empty-hint">确认文案后将自动生成分镜。如果已确认文案但未自动生成，请手动点击下方按钮。</p>
      <el-button
        type="primary"
        :loading="storyboardStore.state.isGenerating"
        :disabled="storyboardStore.state.isGenerating"
        @click="handleGenerate"
      >
        {{ storyboardStore.state.isGenerating ? "生成中..." : "开始生成分镜" }}
      </el-button>
    </div>

    <!-- Main content -->
    <template v-else>
      <!-- Validation results card -->
      <div v-if="validationResult" class="storyboard-validation-card">
        <h3 class="storyboard-card-heading">验证结果</h3>

        <div class="storyboard-validation-row">
          <div class="storyboard-validation-field">
            <span class="storyboard-validation-label">判断</span>
            <el-tag
              :type="validationPassed ? 'success' : 'danger'"
              size="small"
            >
              {{ validationDecisionLabel }}
            </el-tag>
          </div>
          <div v-if="validationResult.stage" class="storyboard-validation-field">
            <span class="storyboard-validation-label">阶段</span>
            <span class="storyboard-validation-value">
              {{ validationResult.stage }}
            </span>
          </div>
        </div>

        <!-- Errors -->
        <div v-if="hasErrors" class="storyboard-validation-block">
          <h4 class="storyboard-validation-block-heading">错误</h4>
          <ul class="storyboard-validation-list storyboard-validation-list--errors">
            <li
              v-for="(error, index) in validationResult.errors"
              :key="index"
            >
              {{ error }}
            </li>
          </ul>
        </div>

        <!-- Warnings -->
        <div v-if="hasWarnings" class="storyboard-validation-block">
          <h4 class="storyboard-validation-block-heading">警告</h4>
          <ul class="storyboard-validation-list storyboard-validation-list--warnings">
            <li
              v-for="(warning, index) in validationResult.warnings"
              :key="index"
            >
              {{ warning }}
            </li>
          </ul>
        </div>

        <!-- Metrics (collapsible) -->
        <details v-if="validationResult.metrics && Object.keys(validationResult.metrics).length > 0">
          <summary class="storyboard-metrics-toggle">查看指标</summary>
          <pre class="storyboard-pre">{{ JSON.stringify(validationResult.metrics, null, 2) }}</pre>
        </details>
      </div>

      <!-- Segment cards -->
      <div v-if="segments.length > 0" class="storyboard-segments-section">
        <div class="storyboard-segments-header">
          <h3 class="storyboard-card-heading">分镜段落</h3>
          <span class="storyboard-segments-count">
            共 {{ segments.length }} 个段落
          </span>
        </div>

        <div class="storyboard-segment-list">
          <article
            v-for="(segment, index) in visibleSegments"
            :key="segment.segment_id"
            class="storyboard-segment-card"
          >
            <!-- Left column: number + time range -->
            <div class="storyboard-segment-left">
              <span class="storyboard-segment-number">#{{ index + 1 }}</span>
              <span class="storyboard-segment-time">
                {{ formatSeconds(segment.start_hint_sec) }}
                ~
                {{ formatSeconds(segment.end_hint_sec) }}
              </span>
              <el-tag
                size="small"
                type="info"
                class="storyboard-segment-role"
              >
                {{ segment.narrative_role }}
              </el-tag>
            </div>

            <!-- Middle column: script excerpt -->
            <div class="storyboard-segment-middle">
              <p class="storyboard-segment-excerpt">{{ segment.script_excerpt }}</p>
            </div>

            <!-- Right column: visual intent + tags -->
            <div class="storyboard-segment-right">
              <p class="storyboard-segment-visual">{{ segment.visual_intent }}</p>
              <div class="storyboard-segment-tags">
                <el-tag
                  v-if="segment.framing_hint"
                  size="small"
                  class="storyboard-segment-tag"
                >
                  构图: {{ segment.framing_hint }}
                </el-tag>
                <el-tag
                  v-if="segment.motion_hint"
                  size="small"
                  type="warning"
                  class="storyboard-segment-tag"
                >
                  运动: {{ segment.motion_hint }}
                </el-tag>
              </div>
            </div>
          </article>
        </div>

        <!-- Collapse / expand toggle -->
        <div v-if="hasMoreSegments" class="storyboard-collapse-toggle">
          <el-button
            text
            @click="isExpanded = !isExpanded"
          >
            {{ isExpanded ? "收起" : `展开全部（还有 ${hiddenCount} 个段落）` }}
          </el-button>
        </div>
      </div>

      <!-- Action buttons -->
      <div class="storyboard-actions-card">
        <div class="storyboard-actions-left">
          <el-button
            type="primary"
            :disabled="storyboardStore.state.isGenerating || !isStoryboardReady"
            @click="handleConfirm"
          >
            确认分镜
          </el-button>

          <el-popconfirm
            title="确定要重新生成分镜规划吗？"
            confirm-button-text="确定"
            cancel-button-text="取消"
            :disabled="storyboardStore.state.isGenerating"
            @confirm="handleGenerate"
          >
            <template #reference>
              <el-button
                :loading="storyboardStore.state.isGenerating"
                :disabled="storyboardStore.state.isGenerating"
              >
                {{ storyboardStore.state.isGenerating ? "生成中..." : "重新生成" }}
              </el-button>
            </template>
          </el-popconfirm>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.storyboard-panel {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-lg);
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
}

/* ---- Error card ---- */
.storyboard-error-card {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-md);
  border-radius: var(--radius-card);
  background: var(--bg-card);
}

/* ---- Skeleton ---- */
.storyboard-skeleton {
  padding: var(--space-md);
}

/* ---- Generating / Empty ---- */
.storyboard-generating,
.storyboard-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  padding: var(--space-xl) var(--space-md);
  color: var(--text-secondary);
  text-align: center;
}

/* ---- Validation card ---- */
.storyboard-validation-card {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-lg);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--bg-card);
}

.storyboard-card-heading {
  margin: 0;
  font-size: 1.1rem;
  font-weight: var(--font-subheading);
  color: var(--text-heading);
}

.storyboard-validation-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-lg);
}

.storyboard-validation-field {
  display: grid;
  gap: var(--space-xs);
}

.storyboard-validation-label {
  font-size: 0.85rem;
  color: var(--text-muted);
}

.storyboard-validation-value {
  font-size: 0.92rem;
  color: var(--text-body);
}

.storyboard-validation-block {
  display: grid;
  gap: var(--space-xs);
}

.storyboard-validation-block-heading {
  margin: 0;
  font-size: 0.9rem;
  font-weight: var(--font-subheading);
  color: var(--text-secondary);
}

.storyboard-validation-list {
  margin: 0;
  padding-left: 1.25rem;
}

.storyboard-validation-list--errors li {
  color: var(--color-danger);
  line-height: 1.65;
}

.storyboard-validation-list--warnings li {
  color: var(--color-warning);
  line-height: 1.65;
}

.storyboard-metrics-toggle {
  cursor: pointer;
  color: var(--text-muted);
  font-size: 0.9rem;
  font-weight: 500;
  list-style: none;
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.storyboard-metrics-toggle::before {
  content: "▸";
  font-size: 0.8rem;
  transition: transform 150ms ease;
}

details[open] > .storyboard-metrics-toggle::before {
  transform: rotate(90deg);
}

.storyboard-pre {
  margin: var(--space-sm) 0 0;
  padding: var(--space-sm);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-panel);
  color: var(--text-muted);
  font-size: 0.85rem;
  line-height: 1.55;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ---- Segments section ---- */
.storyboard-segments-section {
  display: grid;
  gap: var(--space-md);
}

.storyboard-segments-header {
  display: flex;
  align-items: baseline;
  gap: var(--space-sm);
}

.storyboard-segments-count {
  font-size: 0.88rem;
  color: var(--text-muted);
}

.storyboard-segment-list {
  display: grid;
  gap: var(--space-sm);
}

/* ---- Segment card (three-column grid) ---- */
.storyboard-segment-card {
  display: grid;
  grid-template-columns: 140px 1fr 1fr;
  gap: var(--space-md);
  padding: var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--bg-card);
  align-items: start;
  transition: border-color 160ms ease;
}

.storyboard-segment-card:hover {
  border-color: var(--border-hover);
}

/* Left column */
.storyboard-segment-left {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.storyboard-segment-number {
  font-weight: var(--font-subheading);
  font-size: 1rem;
  color: var(--accent-primary);
}

.storyboard-segment-time {
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
  color: var(--accent-text);
}

.storyboard-segment-role {
  width: fit-content;
  margin-top: var(--space-xs);
}

/* Middle column */
.storyboard-segment-middle {
  min-width: 0;
}

.storyboard-segment-excerpt {
  margin: 0;
  font-size: 0.94rem;
  line-height: 1.7;
  color: var(--text-body);
}

/* Right column */
.storyboard-segment-right {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  min-width: 0;
}

.storyboard-segment-visual {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.65;
  color: var(--text-secondary);
}

.storyboard-segment-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}

.storyboard-segment-tag {
  font-size: 0.8rem;
}

/* ---- Collapse toggle ---- */
.storyboard-collapse-toggle {
  display: flex;
  justify-content: center;
  padding-top: var(--space-xs);
}

/* ---- Action buttons ---- */
.storyboard-actions-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--bg-card);
}

.storyboard-actions-left {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

/* ---- Responsive ---- */
@media (max-width: 819px) {
  .storyboard-segment-card {
    grid-template-columns: 1fr;
    gap: var(--space-sm);
  }

  .storyboard-segment-left {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-sm);
  }

  .storyboard-segment-role {
    margin-top: 0;
  }

  .storyboard-actions-card {
    flex-direction: column;
    gap: var(--space-sm);
    align-items: stretch;
  }

  .storyboard-actions-left {
    flex-direction: column;
  }
}
</style>
