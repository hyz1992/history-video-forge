<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";

import { useStoryboardStore } from "../../stores/storyboard";
import { type StoryboardSegment } from "../../stores/storyboard";
import { useProjectStore } from "../../stores/project";
import { useWorkspaceStore } from "../../stores/workspace";
import { PIPELINE_STEPS } from "../../stores/workspace";
import { useStagePolling } from "../../composables/useStagePolling";
import StageGenerating from "../workspace/StageGenerating.vue";
import StageLoadingBar from "../workspace/StageLoadingBar.vue";
import StoryboardSegmentRegenModal from "./StoryboardSegmentRegenModal.vue";

const narrativeRoleLabels: Record<string, string> = {
  opening: "开篇",
  setup: "铺垫",
  pressure: "加压",
  turn: "转折",
  peak: "高潮",
  ending: "结尾",
  bridge: "过渡",
};

const contentTypeLabels: Record<string, string> = {
  live_action: "实拍",
  text_card: "文字卡",
  map: "地图",
  illustration: "插画",
};

const editingHintLabels: Record<string, string> = {
  single: "单镜",
  cutaway: "切出",
  montage: "蒙太奇",
};

const framingHintLabels: Record<string, string> = {
  wide: "广角",
  medium: "中景",
  close: "特写",
  detail: "细节",
  symbolic: "象征",
};

interface RoleStyle {
  borderColor: string;
  tagType: "primary" | "success" | "warning" | "danger" | "info" | "";
}

const roleStyleMap: Record<string, RoleStyle> = {
  opening: { borderColor: "#c9a227", tagType: "" },
  setup: { borderColor: "#7a8ea0", tagType: "info" },
  pressure: { borderColor: "#d4a574", tagType: "warning" },
  turn: { borderColor: "#828cd2", tagType: "" },
  peak: { borderColor: "#d4713a", tagType: "danger" },
  ending: { borderColor: "#8a7530", tagType: "" },
  bridge: { borderColor: "#6e9678", tagType: "info" },
};

const storyboardStore = useStoryboardStore();
const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();

const { startPolling } = useStagePolling({
  loadSnapshot: () => storyboardStore.loadActiveStoryboardSnapshot(),
  isGenerating: (snapshot) =>
    snapshot.current_status === "storyboard_generating" ||
    snapshot.active_storyboard?.execution_state?.generating === true,
  isTerminal: (snapshot) => {
    if (!snapshot.active_storyboard) return false;
    // generating 占位记录不算终态
    if (snapshot.active_storyboard.execution_state?.generating) return false;
    // 有真实分镜数据
    return (snapshot.active_storyboard.plan?.segments?.length ?? 0) > 0;
  },
});

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

const estimatedTotalDuration = computed(
  () => activeStoryboard.value?.plan?.estimated_total_duration_sec ?? null,
);

const globalVisualNotes = computed(
  () => activeStoryboard.value?.plan?.global_visual_notes ?? [],
);

const isInitialStoryboardSnapshotLoading = ref(true);
const isRefreshingStoryboardStatus = ref(false);
const shouldShowStoryboardSkeleton = computed(
  () =>
    isInitialStoryboardSnapshotLoading.value ||
    (storyboardStore.state.isLoading && !activeStoryboard.value),
);

/* -------------------------------------------------------------------------- */
/*  Collapse / expand                                                         */
/* -------------------------------------------------------------------------- */

const expandedSegments = ref(new Set<string>());

function initDefaultExpanded() {
  const list = segments.value;
  if (list.length === 0) return;
  const ids = new Set<string>();
  for (let i = 0; i < list.length; i++) {
    if (i < 3 || i >= list.length - 1 || list[i].narrative_role === "peak") {
      ids.add(list[i].segment_id);
    }
  }
  expandedSegments.value = ids;
}

function toggleSegment(segmentId: string) {
  const next = new Set(expandedSegments.value);
  if (next.has(segmentId)) {
    next.delete(segmentId);
  } else {
    next.add(segmentId);
  }
  expandedSegments.value = next;
}

function isSegmentExpanded(segmentId: string): boolean {
  return expandedSegments.value.has(segmentId);
}

const isAllExpanded = computed(
  () => expandedSegments.value.size >= segments.value.length,
);

function toggleAll() {
  if (isAllExpanded.value) {
    expandedSegments.value = new Set();
  } else {
    expandedSegments.value = new Set(segments.value.map((s) => s.segment_id));
  }
}

function excerptFirstLine(text: string): string {
  const idx = text.search(/[。！？!?；;]/u);
  if (idx === -1) return text.slice(0, 40) + (text.length > 40 ? "…" : "");
  return text.slice(0, idx + 1);
}

watch(segments, () => {
  initDefaultExpanded();
});

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function formatSeconds(seconds: number): string {
  const rounded = Math.round(seconds * 10) / 10;
  return `${rounded}s`;
}

function roleBorderStyle(role: string): Record<string, string> {
  const style = roleStyleMap[role];
  if (style) return { borderLeftColor: style.borderColor, borderLeftWidth: "3px" };
  return {};
}

function roleTagType(role: string): "primary" | "success" | "warning" | "danger" | "info" | "" {
  return roleStyleMap[role]?.tagType ?? "";
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
  isInitialStoryboardSnapshotLoading.value = true;
  await storyboardStore.loadActiveStoryboardSnapshot();
  // F5 恢复：如果 snapshot 显示 generating，启动轮询
  const s = storyboardStore.state.snapshot;
  if (
    s?.current_status === "storyboard_generating" ||
    s?.active_storyboard?.execution_state?.generating
  ) {
    startPolling();
    isInitialStoryboardSnapshotLoading.value = false;
    return;
  }
  // Auto-generate when arriving from script confirmation
  if (
    s &&
    !s.active_storyboard &&
    (s.current_status === "storyboard_ready" ||
      s.current_status === "script_ready")
  ) {
    startPolling();
    const generation = storyboardStore.generateStoryboard();
    isInitialStoryboardSnapshotLoading.value = false;
    await generation;
    if (!storyboardStore.state.loadError) {
      ElMessage.success("分镜规划生成完成");
    }
    return;
  }
  isInitialStoryboardSnapshotLoading.value = false;
});

/* -------------------------------------------------------------------------- */
/*  Actions                                                                   */
/* -------------------------------------------------------------------------- */

async function handleGenerate() {
  startPolling();
  await storyboardStore.generateStoryboard();
  if (!storyboardStore.state.loadError) {
    ElMessage.success("分镜规划生成完成");
  }
}

function handleRetry() {
  storyboardStore.retryLoad();
}

async function handleRefreshGeneratingStatus() {
  if (isRefreshingStoryboardStatus.value) return;

  isRefreshingStoryboardStatus.value = true;
  try {
    await storyboardStore.retryLoad();
  } finally {
    isRefreshingStoryboardStatus.value = false;
  }
}

function handleConfirm() {
  ElMessage.success("分镜已确认，进入资产阶段");
  workspaceStore.setCurrentStep(ASSET_STEP_INDEX);
  const pid = projectStore.state.projectId; if (pid) router.push(`/projects/${pid}/asset`);
}

/* -------------------------------------------------------------------------- */
/*  Segment regen modal                                                       */
/* -------------------------------------------------------------------------- */

const showSegmentRegenModal = ref(false);
const segmentRegenTarget = ref<StoryboardSegment | null>(null);
const segmentRegenIndex = ref(0);
const isRegeneratingSegment = ref(false);

function openSegmentRegenModal(segment: StoryboardSegment, index: number) {
  segmentRegenTarget.value = segment;
  segmentRegenIndex.value = index;
  showSegmentRegenModal.value = true;
}

async function handleSegmentRegenSubmit(userFeedback: string) {
  if (!segmentRegenTarget.value) return;
  isRegeneratingSegment.value = true;
  try {
    const ok = await storyboardStore.regenerateSegment(
      segmentRegenTarget.value.segment_id,
      userFeedback,
    );
    if (!ok) {
      ElMessage.error("分镜片段重新生成失败");
      return;
    }
    showSegmentRegenModal.value = false;
    ElMessage.success("分镜片段重新生成完成");
  } finally {
    isRegeneratingSegment.value = false;
  }
}

/* -------------------------------------------------------------------------- */
/*  Visual strategy toggle                                                    */
/* -------------------------------------------------------------------------- */

const strategyLabels: Record<string, { label: string; icon: string; class: string }> = {
  remotion_motion: { label: "Remotion 运镜", icon: "🎬", class: "strategy-remotion" },
  api_video: { label: "AI 视频生成", icon: "🤖", class: "strategy-api-video" },
};

function strategyKey(segment: StoryboardSegment): string {
  return segment.visual_strategy_preference ?? "remotion_motion";
}

function strategyBadgeClass(segment: StoryboardSegment) {
  return strategyLabels[strategyKey(segment)]?.class ?? "strategy-remotion";
}

function strategyBadgeTitle(segment: StoryboardSegment) {
  const v = segment.visual_strategy_preference;
  if (v === "api_video") return "点击切换为 Remotion 运镜";
  return "点击升级为 AI 视频生成";
}

function strategyBadgeIcon(segment: StoryboardSegment) {
  return strategyLabels[strategyKey(segment)]?.icon ?? "🎬";
}

function strategyBadgeLabel(segment: StoryboardSegment) {
  return strategyLabels[strategyKey(segment)]?.label ?? "Remotion 运镜";
}

const isSwitchingStrategy = ref(false);
const switchingSegmentId = ref<string | null>(null);

async function handleToggleStrategy(segment: StoryboardSegment) {
  const next =
    segment.visual_strategy_preference === "api_video"
      ? ("remotion_motion" as const)
      : ("api_video" as const);

  isSwitchingStrategy.value = true;
  switchingSegmentId.value = segment.segment_id;
  try {
    await storyboardStore.updateSegmentStrategyPreference(segment.segment_id, next);
  } finally {
    isSwitchingStrategy.value = false;
    switchingSegmentId.value = null;
  }
}

/* -------------------------------------------------------------------------- */
/*  Back to top                                                               */
/* -------------------------------------------------------------------------- */

const headerCardRef = ref<HTMLElement | null>(null);
const showBackToTop = ref(false);
let observer: IntersectionObserver | null = null;

function setUpBackToTopObserver() {
  if (observer) {
    observer.disconnect();
  }
  observer = new IntersectionObserver(
    ([entry]) => {
      showBackToTop.value = !entry.isIntersecting;
    },
    { threshold: 0 },
  );
  if (headerCardRef.value) {
    observer.observe(headerCardRef.value);
  }
}

watch(
  () => headerCardRef.value,
  (el) => {
    if (el) setUpBackToTopObserver();
  },
);

onUnmounted(() => {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
});

function scrollToTop() {
  const container = document.querySelector(".workspace-content");
  if (!container) return;

  const startTop = container.scrollTop;
  if (startTop === 0) return;

  const duration = 400;
  const startTime = performance.now();

  function tick(now: number) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    container!.scrollTop = startTop * (1 - eased);

    if (progress < 1) {
      requestAnimationFrame(tick);
    }
  }

  requestAnimationFrame(tick);
}
</script>

<template>
  <div class="storyboard-panel">
    <!-- Generating state (must be before loading skeleton — survives refresh) -->
    <StageGenerating
      v-if="isGenerating"
      title="正在生成分镜"
      hint="正在调用大模型分析文案并规划分镜，可能需要 1-2 分钟。"
      secondary-hint="页面会自动刷新，也可手动刷新状态。"
    >
      <template #action>
        <el-button
          :loading="isRefreshingStoryboardStatus"
          @click="handleRefreshGeneratingStatus"
        >
          刷新状态
        </el-button>
      </template>
    </StageGenerating>

    <!-- Loading skeleton (only when loading without active generation) -->
    <el-skeleton
      v-else-if="shouldShowStoryboardSkeleton"
      :rows="6"
      animated
      class="storyboard-skeleton"
    />

    <!-- Error state -->
    <div v-else-if="storyboardStore.state.loadError" class="storyboard-error-card">
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
        :loading="isGenerating || storyboardStore.state.isGenerating"
        :disabled="isGenerating"
        @click="handleGenerate"
      >
        {{ isGenerating || storyboardStore.state.isGenerating ? "生成中..." : "开始生成分镜" }}
      </el-button>
    </div>

    <!-- Main content -->
    <template v-else>
      <!-- Page title -->
      <h1 class="storyboard-page-title">请审阅您的<em>分镜规划</em></h1>

      <!-- Top row: notes + action buttons -->
      <div v-if="globalVisualNotes.length > 0 && segments.length > 0" class="storyboard-top-row">
        <div class="storyboard-notes-card">
          <h4 class="storyboard-notes-heading">全局视觉风格</h4>
          <ul class="storyboard-notes-list">
            <li v-for="(note, index) in globalVisualNotes" :key="index">
              {{ note }}
            </li>
          </ul>
        </div>
        <div class="storyboard-action-card">
          <button
            class="storyboard-confirm-btn"
            :disabled="storyboardStore.state.isGenerating || !isStoryboardReady || isSwitchingStrategy || isRegeneratingSegment"
            @click="handleConfirm"
          >
            确认分镜，进入资产规划
          </button>
        </div>
      </div>

      <!-- Notes only (no segments yet) -->
      <div v-else-if="globalVisualNotes.length > 0" class="storyboard-notes-card">
        <h4 class="storyboard-notes-heading">全局视觉风格</h4>
        <ul class="storyboard-notes-list">
          <li v-for="(note, index) in globalVisualNotes" :key="index">
            {{ note }}
          </li>
        </ul>
      </div>

      <!-- Stats bar -->
      <div v-if="segments.length > 0" ref="headerCardRef" class="storyboard-stats-bar">
        <div class="storyboard-stats-info">
          <span class="storyboard-stats-count">
            共 {{ segments.length }} 个段落
            <template v-if="estimatedTotalDuration">
              · 预计总时长约 {{ Math.round(estimatedTotalDuration) }} 秒
            </template>
          </span>
        </div>
        <el-button
          text
          @click="toggleAll"
        >
          {{ isAllExpanded ? "收起全部" : "展开全部" }}
        </el-button>
      </div>

      <!-- Segment cards -->
      <div v-if="segments.length > 0" class="storyboard-segments-section">
          <article
            v-for="(segment, index) in segments"
            :key="segment.segment_id"
            class="storyboard-segment-card"
            :class="{ 'is-expanded': isSegmentExpanded(segment.segment_id) }"
            :style="roleBorderStyle(segment.narrative_role)"
          >
            <!-- Summary row (always visible) -->
            <div
              class="storyboard-segment-summary"
              @click="toggleSegment(segment.segment_id)"
            >
              <div class="storyboard-segment-summary-row">
                <span class="storyboard-segment-number">#{{ index + 1 }}</span>
                <el-tag
                  size="small"
                  :type="roleTagType(segment.narrative_role)"
                  class="storyboard-segment-role"
                  :class="`storyboard-role--${segment.narrative_role}`"
                >
                  {{ narrativeRoleLabels[segment.narrative_role] ?? segment.narrative_role }}
                </el-tag>
                <span class="storyboard-segment-time">
                  {{ formatSeconds(segment.start_hint_sec) }}s ~ {{ formatSeconds(segment.end_hint_sec) }}s
                </span>
                <button
                  class="storyboard-strategy-badge"
                  :class="strategyBadgeClass(segment)"
                  :title="strategyBadgeTitle(segment)"
                  :disabled="isSwitchingStrategy || isRegeneratingSegment"
                  @click.stop.prevent="handleToggleStrategy(segment)"
                >
                  <template v-if="isSwitchingStrategy && switchingSegmentId === segment.segment_id">
                    切换中...
                  </template>
                  <template v-else>
                    {{ strategyBadgeIcon(segment) }}
                    {{ strategyBadgeLabel(segment) }}
                  </template>
                </button>
                <button
                  class="storyboard-segment-regen-btn"
                  title="重新生成此分镜"
                  :disabled="isSwitchingStrategy || isRegeneratingSegment"
                  @click.stop.prevent="openSegmentRegenModal(segment, index + 1)"
                >
                  ↻
                </button>
              </div>
              <p class="storyboard-segment-summary-excerpt">
                {{ excerptFirstLine(segment.script_excerpt) }}
              </p>
              <div class="storyboard-segment-summary-toggle">
                <span v-if="isSegmentExpanded(segment.segment_id)" class="storyboard-toggle-icon">收起 ▴</span>
                <span v-else class="storyboard-toggle-icon">展开详情 ▾</span>
              </div>
            </div>

            <!-- Detail area (collapsible) -->
            <div
              class="storyboard-segment-details"
              :class="{ 'is-visible': isSegmentExpanded(segment.segment_id) }"
            >
              <div class="storyboard-segment-detail-block">
                <h4 class="storyboard-segment-detail-heading">口播原文</h4>
                <p class="storyboard-segment-detail-text">{{ segment.script_excerpt }}</p>
              </div>

              <div class="storyboard-segment-detail-block">
                <h4 class="storyboard-segment-detail-heading">视觉意图</h4>
                <p class="storyboard-segment-detail-text">{{ segment.visual_intent }}</p>
              </div>

              <div class="storyboard-segment-detail-block">
                <h4 class="storyboard-segment-detail-heading">场面描述</h4>
                <p class="storyboard-segment-detail-text">{{ segment.scene_description }}</p>
              </div>

              <div v-if="segment.visual_elements?.length" class="storyboard-segment-detail-tags">
                <span class="storyboard-segment-detail-label">视觉元素</span>
                <div class="storyboard-segment-tags">
                  <el-tag
                    v-for="el in segment.visual_elements"
                    :key="el"
                    size="small"
                    type="info"
                    class="storyboard-segment-tag"
                  >
                    {{ el }}
                  </el-tag>
                </div>
              </div>

              <div class="storyboard-segment-detail-tags">
                <span class="storyboard-segment-detail-label">技术</span>
                <div class="storyboard-segment-tags">
                  <el-tag
                    v-if="segment.framing_hint"
                    size="small"
                    class="storyboard-segment-tag"
                  >
                    {{ framingHintLabels[segment.framing_hint] ?? segment.framing_hint }}
                  </el-tag>
                  <el-tag
                    v-if="segment.motion_hint"
                    size="small"
                    type="warning"
                    class="storyboard-segment-tag"
                  >
                    {{ segment.motion_hint }}
                  </el-tag>
                  <el-tag
                    v-if="segment.content_type"
                    size="small"
                    class="storyboard-segment-tag"
                  >
                    {{ contentTypeLabels[segment.content_type] ?? segment.content_type }}
                  </el-tag>
                  <el-tag
                    v-if="segment.editing_hint"
                    size="small"
                    type="info"
                    class="storyboard-segment-tag"
                  >
                    {{ editingHintLabels[segment.editing_hint] ?? segment.editing_hint }}
                  </el-tag>
                  <el-tag
                    v-if="segment.on_screen_text?.length"
                    size="small"
                    type="success"
                    class="storyboard-segment-tag"
                  >
                    文字: {{ segment.on_screen_text.join(" · ") }}
                  </el-tag>
                </div>
              </div>

              <div
                v-if="segment.risk_notes?.length"
                class="storyboard-segment-risk"
              >
                <span class="storyboard-segment-risk-icon">⚠</span>
                <span class="storyboard-segment-risk-text">
                  {{ segment.risk_notes.join("；") }}
                </span>
              </div>
            </div>
          </article>
      </div>

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

        <details v-if="validationResult.metrics && Object.keys(validationResult.metrics).length > 0">
          <summary class="storyboard-metrics-toggle">查看指标</summary>
          <pre class="storyboard-pre">{{ JSON.stringify(validationResult.metrics, null, 2) }}</pre>
        </details>
      </div>
    </template>

    <!-- Back to top -->
    <button
      v-if="showBackToTop"
      class="storyboard-back-to-top"
      @click="scrollToTop"
      title="回到顶部"
    >
      <svg viewBox="0 0 24 24"><path d="m18 15-6-6-6 6"/></svg>
    </button>

    <StageLoadingBar
      :visible="isSwitchingStrategy || isRegeneratingSegment"
      :text="isRegeneratingSegment ? '正在重新生成分镜片段...' : '正在更新视觉策略...'"
    />

    <StoryboardSegmentRegenModal
      v-model:visible="showSegmentRegenModal"
      :segment="segmentRegenTarget"
      :segment-index="segmentRegenIndex"
      :submitting="isRegeneratingSegment"
      @submit="handleSegmentRegenSubmit"
    />
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

/* ---- Page title ---- */
.storyboard-page-title {
  margin: 0 0 2px;
  color: #f5f0e8;
  font-family: "Noto Serif SC", "Songti SC", Georgia, serif;
  font-size: 28px;
  line-height: 1.25;
  letter-spacing: -0.02em;
  font-weight: 700;
}

.storyboard-page-title em {
  color: #e4c26f;
  font-style: normal;
}

/* ---- Error card ---- */
.storyboard-error-card {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-lg);
  border-radius: var(--radius-panel);
  border: 1px solid rgba(192, 100, 84, 0.22);
  background:
    linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,.008)),
    var(--bg-card);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
}

/* ---- Skeleton ---- */
.storyboard-skeleton {
  padding: var(--space-lg);
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
  border: 1px solid rgba(201, 162, 39, 0.16);
  border-radius: var(--radius-panel);
  background:
    linear-gradient(180deg, rgba(255,255,255,.032), rgba(255,255,255,.008)),
    var(--bg-card);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.22);
}

.storyboard-card-heading {
  margin: 0;
  font-size: 1.2rem;
  font-weight: var(--font-heading);
  color: var(--text-heading);
  letter-spacing: -0.01em;
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

/* ---- Top row: notes + action buttons ---- */
.storyboard-top-row {
  display: flex;
  gap: var(--space-md);
  align-items: stretch;
}

.storyboard-top-row > .storyboard-notes-card {
  flex: 1;
  min-width: 0;
}

.storyboard-action-card {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--space-sm);
  min-width: 180px;
}

.storyboard-action-card .storyboard-confirm-btn {
  white-space: nowrap;
}

/* ---- Global notes card ---- */
.storyboard-notes-card {
  display: grid;
  gap: var(--space-sm);
  padding: var(--space-md) var(--space-lg);
  border: 1px solid rgba(201, 162, 39, 0.16);
  border-radius: var(--radius-panel);
  background:
    radial-gradient(circle at 86% 0%, rgba(201, 162, 39, 0.06), transparent 48%),
    linear-gradient(180deg, rgba(255,255,255,.02), rgba(255,255,255,.004)),
    var(--bg-card);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.14);
}

.storyboard-notes-heading {
  margin: 0;
  font-size: 0.9rem;
  font-weight: var(--font-subheading);
  color: #e4c26f;
}

.storyboard-notes-list {
  margin: 0;
  padding-left: 1.25rem;
  display: grid;
  gap: var(--space-xs);
}

.storyboard-notes-list li {
  font-size: 0.85rem;
  line-height: 1.65;
  color: var(--text-secondary);
}

/* ---- Stats bar ---- */
.storyboard-stats-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-sm) var(--space-md);
  border: 1px solid rgba(201, 162, 39, 0.13);
  border-radius: var(--radius-panel);
  background:
    linear-gradient(180deg, rgba(255,255,255,.02), rgba(255,255,255,.005)),
    var(--bg-card);
}

.storyboard-stats-info {
  display: flex;
  align-items: center;
}

.storyboard-stats-count {
  font-size: 0.88rem;
  color: var(--text-secondary);
}

.storyboard-confirm-btn {
  height: 46px;
  padding: 0 28px;
  border-radius: 13px;
  border: none;
  color: #100c08;
  font-family: inherit;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  background: linear-gradient(135deg, #e4c26f, #b87333);
  box-shadow: 0 8px 22px rgba(184, 115, 51, 0.28);
  transition: transform 180ms ease, box-shadow 180ms ease, filter 180ms ease;
}

.storyboard-confirm-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 12px 30px rgba(201, 162, 39, 0.32);
  filter: brightness(1.05);
}

.storyboard-confirm-btn:active:not(:disabled) {
  transform: translateY(0);
}

.storyboard-confirm-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ---- Segments section ---- */
.storyboard-segments-section {
  display: grid;
  gap: var(--space-sm);
}

/* ---- Segment card (vertical foldable layout) ---- */
.storyboard-segment-card {
  border: 1px solid rgba(201, 162, 39, 0.13);
  border-left-width: 3px;
  border-left-color: rgba(201, 162, 39, 0.18);
  border-radius: var(--radius-panel);
  background:
    linear-gradient(180deg, rgba(255,255,255,.028), rgba(255,255,255,.006)),
    var(--bg-card);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
  transition:
    border-color 160ms ease,
    border-left-color 160ms ease,
    box-shadow 200ms ease,
    transform 200ms ease;
  overflow: hidden;
}

.storyboard-segment-card:hover {
  border-color: rgba(201, 162, 39, 0.25);
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.26);
  transform: translateY(-1px);
}

/* ---- Summary row ---- */
.storyboard-segment-summary {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: var(--space-md);
  cursor: pointer;
  user-select: none;
  transition: background 120ms ease;
}

.storyboard-segment-summary:hover {
  background: rgba(201, 162, 39, 0.04);
}

.storyboard-segment-summary-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

.storyboard-segment-number {
  font-weight: var(--font-heading);
  font-size: 1rem;
  color: var(--accent-primary);
  background: rgba(201, 162, 39, 0.08);
  padding: 2px 8px;
  border-radius: var(--radius-sm);
}

.storyboard-segment-role {
  width: fit-content;
}

.storyboard-strategy-badge {
  width: fit-content;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  font-size: 0.78rem;
  font-weight: 600;
  font-family: inherit;
  border-radius: 100px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease, color 160ms ease;
  white-space: nowrap;
  margin-left: auto;
  flex-shrink: 0;
}

.storyboard-strategy-badge:disabled {
  opacity: 0.55;
  cursor: wait;
}

.strategy-remotion {
  background: rgba(201, 162, 39, 0.08);
  border-color: rgba(201, 162, 39, 0.16);
  color: #d4a35f;
}

.strategy-remotion:hover {
  background: rgba(201, 162, 39, 0.14);
  border-color: rgba(201, 162, 39, 0.28);
}

.strategy-api-video {
  background: rgba(121, 158, 203, 0.09);
  border-color: rgba(121, 158, 203, 0.18);
  color: #8bb4e6;
}

.strategy-api-video:hover {
  background: rgba(121, 158, 203, 0.16);
  border-color: rgba(121, 158, 203, 0.32);
}

.storyboard-segment-regen-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  font-size: 0.9rem;
  font-family: inherit;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  color: rgba(255, 255, 255, 0.3);
  cursor: pointer;
  transition: all 160ms ease;
  line-height: 1;
  flex-shrink: 0;
}

.storyboard-segment-regen-btn:hover:not(:disabled) {
  background: rgba(201, 162, 39, 0.1);
  border-color: rgba(201, 162, 39, 0.28);
  color: #c9a227;
}

.storyboard-segment-regen-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.storyboard-role--opening {
  --el-tag-bg-color: rgba(201, 162, 39, 0.13);
  --el-tag-border-color: rgba(201, 162, 39, 0.28);
  --el-tag-text-color: #e4c26f;
}

.storyboard-role--turn {
  --el-tag-bg-color: rgba(130, 140, 210, 0.12);
  --el-tag-border-color: rgba(130, 140, 210, 0.28);
  --el-tag-text-color: #a4aee6;
}

.storyboard-role--ending {
  --el-tag-bg-color: rgba(138, 117, 48, 0.12);
  --el-tag-border-color: rgba(138, 117, 48, 0.28);
  --el-tag-text-color: #b8a560;
}

.storyboard-segment-time {
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
  color: var(--accent-text);
}

.storyboard-segment-summary-excerpt {
  margin: 0;
  font-size: 0.94rem;
  line-height: 1.7;
  color: var(--text-body);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.storyboard-segment-summary-toggle {
  display: flex;
  justify-content: flex-end;
}

.storyboard-toggle-icon {
  font-size: 0.85rem;
  color: var(--text-muted);
  transition: color 140ms ease;
}

.storyboard-segment-summary:hover .storyboard-toggle-icon {
  color: #c9a227;
}

/* ---- Detail area ---- */
.storyboard-segment-details {
  max-height: 0;
  overflow: hidden;
  opacity: 0;
  transition:
    max-height 320ms ease,
    opacity 260ms ease,
    padding 260ms ease;
  border-top: 1px solid transparent;
  display: grid;
  gap: var(--space-md);
  padding: 0 var(--space-md);
  background: rgba(0, 0, 0, 0.12);
}

.storyboard-segment-details.is-visible {
  max-height: 2000px;
  opacity: 1;
  padding: var(--space-md);
  border-top-color: rgba(201, 162, 39, 0.14);
}

.storyboard-segment-detail-block {
  display: grid;
  gap: var(--space-xs);
}

.storyboard-segment-detail-heading {
  margin: 0;
  font-size: 0.78rem;
  font-weight: var(--font-subheading);
  color: #c9a227;
  letter-spacing: 0.05em;
}

.storyboard-segment-detail-text {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.8;
  color: var(--text-body);
}

.storyboard-segment-detail-tags {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
}

.storyboard-segment-detail-label {
  flex-shrink: 0;
  font-size: 0.8rem;
  font-weight: var(--font-subheading);
  color: var(--text-muted);
  padding-top: 1px;
  min-width: 56px;
}

.storyboard-segment-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}

.storyboard-segment-tag {
  font-size: 0.8rem;
}

.storyboard-segment-risk {
  display: flex;
  align-items: flex-start;
  gap: var(--space-xs);
  padding: var(--space-sm);
  border-radius: var(--radius-sm);
  background: rgba(255, 167, 38, 0.06);
  border: 1px solid rgba(255, 167, 38, 0.16);
  font-size: 0.82rem;
  line-height: 1.6;
  color: #d4a574;
}

.storyboard-segment-risk-icon {
  flex-shrink: 0;
  margin-top: 1px;
}

.storyboard-segment-risk-text {
  min-width: 0;
}

/* ---- Responsive ---- */
@media (max-width: 819px) {
  .storyboard-stats-bar {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-sm);
  }

  .storyboard-top-row {
    flex-direction: column;
  }

  .storyboard-notes-card {
    flex-direction: column;
  }

  .storyboard-action-card {
    min-width: 0;
  }

  .storyboard-segment-summary {
    padding: var(--space-sm);
  }

  .storyboard-segment-details.is-visible {
    padding: var(--space-sm);
  }

  .storyboard-segment-detail-tags {
    flex-direction: column;
    gap: var(--space-xs);
  }
}

/* ---- Back to top ---- */
.storyboard-back-to-top {
  position: fixed;
  right: 28px;
  bottom: 32px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid rgba(201, 162, 39, 0.22);
  background:
    radial-gradient(circle at 50% 40%, rgba(201, 162, 39, 0.14), rgba(201, 162, 39, 0.04) 70%),
    var(--bg-card);
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.3);
  cursor: pointer;
  display: grid;
  place-items: center;
  z-index: 20;
  transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
  animation: backToTopIn 220ms ease;
}

.storyboard-back-to-top:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.38);
  border-color: rgba(201, 162, 39, 0.35);
}

.storyboard-back-to-top svg {
  width: 18px;
  height: 18px;
  stroke: #e4c26f;
  fill: none;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

@keyframes backToTopIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
