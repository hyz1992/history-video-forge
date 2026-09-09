<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";

import { useStoryboardStore } from "../../stores/storyboard";
import { type StoryboardSegment, storyboardTimingView } from "../../stores/storyboard";
import { useProjectStore } from "../../stores/project";
import { useWorkspaceStore } from "../../stores/workspace";
import { PIPELINE_STEPS } from "../../stores/workspace";
import { useGenerationCostStore } from "../../stores/generation-cost";
import { useStagePolling } from "../../composables/useStagePolling";
import { resolvePipelineStagePhase } from "../../composables/usePipelineStagePhase";
import StageGenerating from "../workspace/StageGenerating.vue";
import StageLoadingBar from "../workspace/StageLoadingBar.vue";
import StoryboardSegmentRegenModal from "./StoryboardSegmentRegenModal.vue";
import NarrationModeUpgradeEntry from "./NarrationModeUpgradeEntry.vue";
import { useCompetitionGuard } from "../../composables/useCompetitionGuard";

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

const roleTagTypeMap: Record<string, "primary" | "success" | "warning" | "danger" | "info" | ""> = {
  opening: "",
  setup: "info",
  pressure: "warning",
  turn: "",
  peak: "danger",
  ending: "",
  bridge: "info",
};

const storyboardStore = useStoryboardStore();
const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();
const costStore = useGenerationCostStore();
const initialLoadDone = ref(false);

let currentStoryboardAction: "generate" | "segment_regen" = "generate";
let pendingSegmentId: string | undefined;
let pendingSegmentFeedback: string | undefined;
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
    pendingAutoGenerate.value ||
    currentStatus.value === "storyboard_generating" ||
    activeStoryboard.value?.execution_state?.generating === true,
);

const storyboardPhase = computed(() =>
  resolvePipelineStagePhase({
    isGenerating: isGenerating.value,
    isLoading: !initialLoadDone.value && !isGenerating.value,
    hasContent: segments.value.length > 0,
    loadError: storyboardStore.state.loadError,
  }),
);

// 任务11B：v2 以口播实测为权威时长；v1 估算仅作旧项目展示并标注非权威。
const timingView = computed(() => storyboardTimingView((activeStoryboard.value?.plan as Record<string, unknown> | null | undefined) ?? null));

const globalVisualNotes = computed(
  () => activeStoryboard.value?.plan?.global_visual_notes ?? [],
);

const isRefreshingStoryboardStatus = ref(false);

/* -------------------------------------------------------------------------- */
/*  Auto-generate                                                             */
/* -------------------------------------------------------------------------- */

let autoGenerated = false;

/** 桥接 loadActiveStoryboardSnapshot() 完成到 startGeneration 乐观更新之间的空白间隙 */
const pendingAutoGenerate = ref(false);

async function triggerAutoGenerate() {
  if (autoGenerated) return;
  const s = storyboardStore.state.snapshot;
  if (
    s &&
    !s.active_storyboard &&
    (s.current_status === "storyboard_ready" ||
      s.current_status === "script_ready") &&
    !storyboardStore.state.isLoading &&
    !storyboardStore.state.loadError
  ) {
    autoGenerated = true;
    pendingAutoGenerate.value = true;
    startPolling();
    try {
      currentStoryboardAction = "generate";
      await storyboardStore.generateStoryboard();
      if (!storyboardStore.state.loadError) {
        ElMessage.success("分镜规划生成完成");
      }
    } finally {
      pendingAutoGenerate.value = false;
    }
    return;
  }
  pendingAutoGenerate.value = false;
}

watch(() => storyboardStore.state.snapshot, async (snapshot) => {
  if (snapshot && !snapshot.active_storyboard && !autoGenerated) {
    await triggerAutoGenerate();
  }
});

/* -------------------------------------------------------------------------- */
/*  Collapse / expand                                                         */
/* -------------------------------------------------------------------------- */

const expandedSegments = ref(new Set<string>());
let manuallyToggled = false;

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
  manuallyToggled = true;
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
  manuallyToggled = true;
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
  if (manuallyToggled) return;
  initDefaultExpanded();
});

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function formatSeconds(seconds: number): string {
  const rounded = Math.round(seconds * 10) / 10;
  return `${rounded}s`;
}

function roleTagType(role: string): "primary" | "success" | "warning" | "danger" | "info" | "" {
  return roleTagTypeMap[role] ?? "";
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

// 任务11B：升级成功后刷新快照并回文案页准备口播。
async function onNarrationModeUpgraded() {
  await storyboardStore.loadActiveStoryboardSnapshot();
  const pid = projectStore.state.projectId;
  if (pid) router.push(`/projects/${pid}/script`);
}
const { checkStageRollback } = useCompetitionGuard();

/* -------------------------------------------------------------------------- */
/*  Lifecycle                                                                 */
/* -------------------------------------------------------------------------- */

onMounted(async () => {
  const pid = projectStore.state.projectId;
  if (pid) {
    await projectStore.loadProject(pid);
  }
  initialLoadDone.value = false;
  await storyboardStore.loadActiveStoryboardSnapshot();
  initialLoadDone.value = true;
  // F5 恢复：如果 snapshot 显示 generating，启动轮询
  const s = storyboardStore.state.snapshot;
  if (
    s?.current_status === "storyboard_generating" ||
    s?.active_storyboard?.execution_state?.generating
  ) {
    startPolling();
    return;
  }
  // Auto-generate when arriving from script confirmation
  await triggerAutoGenerate();
});

/* -------------------------------------------------------------------------- */
/*  Actions                                                                   */
/* -------------------------------------------------------------------------- */

async function handleGenerate() {
  if (!checkStageRollback("storyboard")) return;
  autoGenerated = true;
  pendingAutoGenerate.value = true;
  startPolling();
  try {
    currentStoryboardAction = "generate";
    await storyboardStore.generateStoryboard();
    if (!storyboardStore.state.loadError) {
      ElMessage.success("分镜规划生成完成");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "分镜规划生成失败";
    ElMessage.warning(message);
  } finally {
    pendingAutoGenerate.value = false;
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
  if (!checkStageRollback("storyboard")) return;
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
  if (!checkStageRollback("storyboard")) return;
  segmentRegenTarget.value = segment;
  segmentRegenIndex.value = index;
  showSegmentRegenModal.value = true;
}

async function handleSegmentRegenSubmit(userFeedback: string) {
  if (!segmentRegenTarget.value) return;
  isRegeneratingSegment.value = true;
  try {
    currentStoryboardAction = "segment_regen";
    pendingSegmentId = segmentRegenTarget.value.segment_id;
    pendingSegmentFeedback = userFeedback;
    await storyboardStore.regenerateSegment(pendingSegmentId, pendingSegmentFeedback);
    if (storyboardStore.state.loadError) {
      ElMessage.error("分镜片段重新生成失败：" + storyboardStore.state.loadError);
      return;
    }
    showSegmentRegenModal.value = false;
    ElMessage.success("分镜片段重新生成完成");
  } catch (error) {
    const message = error instanceof Error ? error.message : "分镜片段重新生成失败";
    ElMessage.warning(message);
  } finally {
    isRegeneratingSegment.value = false;
  }
}

/** S2-2D：报价弹窗确认 → 携带 quote 提交；过期自动重新报价；冲突提示重新报价。 */


/* -------------------------------------------------------------------------- */
/*  Visual strategy toggle                                                    */
/* -------------------------------------------------------------------------- */

/* S2-2A 任务 4：四档适配度展示 + 用户覆盖 toggle */

const suitabilityLabels: Record<string, { label: string; icon: string; class: string; title: string }> = {
  remotion_only: { label: "仅 Remotion", icon: "🎬", class: "strategy-remotion", title: "适配度：静态图+运镜足够，几乎不需要连续动作" },
  remotion_sufficient: { label: "Remotion 足够", icon: "🎬", class: "strategy-remotion", title: "适配度：静态图+Remotion 足够表达" },
  api_video_beneficial: { label: "视频更佳", icon: "🤖", class: "strategy-api-video", title: "适配度：动态画面更生动，静态图仍可成立" },
  api_video_strongly_recommended: { label: "强烈建议视频", icon: "🤖", class: "strategy-api-video", title: "适配度：连续动作是叙事核心，强烈建议 AI 视频" },
};

function suitabilityInfo(segment: StoryboardSegment) {
  const key = segment.api_video_suitability ?? "remotion_sufficient";
  const entry = suitabilityLabels[key] ?? suitabilityLabels.remotion_sufficient;
  return {
    class: entry.class,
    icon: entry.icon,
    label: entry.label,
    title: entry.title,
  };
}

/**
 * S2-2A：从快照投影读取分镜策略全量信息（适配度/覆盖/路线/原因）。
 * 投影缺失时给出保守默认值。
 */
function strategyProjection(segment: StoryboardSegment) {
  const projection = activeStoryboard.value?.segment_strategies?.find(
    (s) => s.segment_id === segment.segment_id,
  );
  return {
    strategy_override: projection?.strategy_override ?? null,
    resolved_route: projection?.resolved_route ?? "remotion",
    reason_code: projection?.reason_code ?? "strategy_matrix_remotion",
    unavailable_reason: projection?.unavailable_reason ?? null,
  };
}

const isSwitchingStrategy = ref(false);
const switchingSegmentId = ref<string | null>(null);

async function handleSetOverride(
  segment: StoryboardSegment,
  override: "api_video" | "remotion_motion" | null,
) {
  isSwitchingStrategy.value = true;
  switchingSegmentId.value = segment.segment_id;
  try {
    await storyboardStore.updateSegmentStrategyPreference(segment.segment_id, override);
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
  if (typeof IntersectionObserver === "undefined") {
    return;
  }
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
    <!-- 任务11B：legacy 项目显式升级入口（升级后回文案页准备口播） -->
    <NarrationModeUpgradeEntry
      :project-id="projectStore.state.projectId"
      :snapshot-narration-mode="storyboardStore.state.snapshot?.narration_timing_mode ?? null"
      @upgraded="onNarrationModeUpgraded"
    />
    <!-- Generating state (must be before loading skeleton — survives refresh) -->
    <StageGenerating
      v-if="storyboardPhase.kind === 'generating'"
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

    <!-- Loading state: server snapshot query only, not generation -->
    <div
      v-else-if="storyboardPhase.kind === 'loading'"
      class="storyboard-loading storyboard-skeleton"
      aria-live="polite"
    >
      <div class="storyboard-loading-card">
        <h2>正在加载分镜状态</h2>
        <p>正在查询服务器已有结果，请稍候。</p>
      </div>
    </div>

    <!-- Error state -->
    <div v-else-if="storyboardPhase.kind === 'error'" class="storyboard-error-card">
      <el-alert
        :title="'加载失败：' + storyboardPhase.message"
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
      v-else-if="storyboardPhase.kind === 'empty'"
      class="storyboard-empty"
    >
      <div class="storyboard-empty-card">
        <div class="storyboard-empty-icon">🎬</div>
        <h2 class="storyboard-empty-title">分镜尚未生成</h2>
        <p class="storyboard-empty-hint">确认文案后将自动生成分镜。如果已确认文案但未自动生成，请手动点击下方按钮。</p>
        <div class="storyboard-empty-line"></div>
        <el-button
          type="primary"
          :loading="isGenerating || storyboardStore.state.isGenerating"
          :disabled="isGenerating"
          @click="handleGenerate"
        >
          {{ isGenerating || storyboardStore.state.isGenerating ? "生成中..." : "开始生成分镜" }}
        </el-button>
      </div>
    </div>

    <!-- Main content -->
    <template v-else>
      <!-- Page title -->
      <h1 class="storyboard-page-title">请审阅您的<em>分镜规划</em></h1>

      <!-- Global notes -->
      <div v-if="globalVisualNotes.length > 0" class="storyboard-notes-card">
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
            <template v-if="timingView.kind === 'actual'">
              · 实际总时长 {{ Math.round(timingView.totalSec) }} 秒（口播实测）
            </template>
            <template v-else-if="timingView.kind === 'estimated' && timingView.totalSec !== null">
              · 预计总时长约 {{ Math.round(timingView.totalSec) }} 秒（估算，非权威）
            </template>
            <template v-else-if="timingView.kind === 'missing_actual'">
              · 口播真实时间缺失，不按估算展示
            </template>
          </span>
        </div>
        <div class="storyboard-stats-actions">
          <el-button text @click="toggleAll">
            {{ isAllExpanded ? "收起全部" : "展开全部" }}
          </el-button>
          <button
            class="storyboard-confirm-btn"
            :disabled="storyboardStore.state.isGenerating || !isStoryboardReady || isSwitchingStrategy || isRegeneratingSegment"
            @click="handleConfirm"
          >
            确认分镜，进入资产规划
          </button>
        </div>
      </div>

      <!-- Segment cards -->
      <div v-if="segments.length > 0" class="storyboard-segments-section">
          <div
            v-if="storyboardStore.state.strategyError"
            class="storyboard-strategy-error"
            role="alert"
          >
            {{ storyboardStore.state.strategyError }}
          </div>
          <article
            v-for="(segment, index) in segments"
            :key="segment.segment_id"
            class="storyboard-segment-card"
            :class="{ 'is-expanded': isSegmentExpanded(segment.segment_id) }"
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
                  {{ timingView.kind === 'actual' ? '画面 ' : '' }}{{ formatSeconds(segment.start_hint_sec) }} – {{ formatSeconds(segment.end_hint_sec) }}
                </span>
                <!-- S2-2A：四层信息同时展示：AI 适配度 / 用户覆盖 / 解析路线 / 原因 -->
                <span
                  class="storyboard-strategy-badge"
                  :class="suitabilityInfo(segment).class"
                  :title="suitabilityInfo(segment).title"
                >
                  {{ suitabilityInfo(segment).icon }}
                  {{ suitabilityInfo(segment).label }}
                </span>
                <span
                  class="storyboard-route-badge"
                  :class="strategyProjection(segment).resolved_route === 'api_video' ? 'strategy-api-video' : 'strategy-remotion'"
                >
                  路线：{{ strategyProjection(segment).resolved_route === "api_video" ? "AI 视频" : "Remotion" }}
                </span>
                <span
                  v-if="strategyProjection(segment).unavailable_reason"
                  class="storyboard-unavailable-reason"
                  :title="strategyProjection(segment).unavailable_reason"
                >
                  ⚠ {{ strategyProjection(segment).unavailable_reason }}
                </span>
                <!-- 三态选择：API 视频 / Remotion / 继承 -->
                <span class="storyboard-override-select">
                  <button
                    :class="{ active: strategyProjection(segment).strategy_override === 'api_video' }"
                    :disabled="isSwitchingStrategy || isRegeneratingSegment"
                    @click.stop.prevent="handleSetOverride(segment, 'api_video')"
                  >AI 视频</button>
                  <button
                    :class="{ active: strategyProjection(segment).strategy_override === 'remotion_motion' }"
                    :disabled="isSwitchingStrategy || isRegeneratingSegment"
                    @click.stop.prevent="handleSetOverride(segment, 'remotion_motion')"
                  >Remotion</button>
                  <button
                    :class="{ active: strategyProjection(segment).strategy_override === null }"
                    :disabled="isSwitchingStrategy || isRegeneratingSegment"
                    @click.stop.prevent="handleSetOverride(segment, null)"
                  >继承</button>
                </span>
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

    <!-- S2-2D：真实付费部署的报价确认弹窗（stub/fake 部署不出现） -->
  </div>
</template>

<style scoped>
.storyboard-panel {
  position: relative;
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
.storyboard-loading {
  min-height: 360px;
  display: grid;
  place-items: center;
  padding: var(--space-xl);
}

.storyboard-loading-card {
  display: grid;
  gap: var(--space-xs);
  text-align: center;
  color: var(--text-secondary);
}

.storyboard-loading-card h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: 20px;
}

.storyboard-loading-card p {
  margin: 0;
  color: var(--text-muted);
}

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

/* ---- Empty ---- */
.storyboard-empty {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 44px 28px 64px;
}

.storyboard-empty-card {
  width: min(480px, 100%);
  text-align: center;
  padding: var(--space-xl) var(--space-lg);
  border: 1px solid rgba(201, 162, 39, 0.13);
  border-radius: var(--radius-panel);
  background:
    radial-gradient(ellipse at 50% 0%, rgba(201, 162, 39, 0.06), transparent 55%),
    linear-gradient(180deg, rgba(255,255,255,.02), rgba(255,255,255,.005)),
    var(--bg-card);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.22);
}

.storyboard-empty-icon {
  width: 72px;
  height: 72px;
  margin: 0 auto 22px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 28px;
  background:
    radial-gradient(circle at 50% 40%, rgba(201,162,39,.16), rgba(201,162,39,.05) 62%, rgba(201,162,39,.02) 100%);
  border: 1px solid rgba(201,162,39,.18);
  box-shadow:
    0 0 28px rgba(201,162,39,.06),
    inset 0 1px 0 rgba(255,255,255,.04);
}

.storyboard-empty-title {
  margin: 0 0 8px;
  color: #f5f0e8;
  font-family: "Noto Serif SC", "Songti SC", Georgia, serif;
  font-size: 22px;
  line-height: 1.3;
  letter-spacing: -0.02em;
  font-weight: 700;
}

.storyboard-empty-hint {
  max-width: 400px;
  margin: 0 auto;
  color: #a89f94;
  font-size: 14px;
  line-height: 1.8;
}

.storyboard-empty-line {
  width: 120px;
  height: 1px;
  margin: 22px auto 0;
  background: linear-gradient(90deg, transparent, rgba(201,162,39,.18), transparent);
}

.storyboard-empty-card .el-button {
  margin-top: 26px;
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

.storyboard-stats-actions {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.storyboard-stats-count {
  font-size: 0.88rem;
  color: var(--text-secondary);
}

.storyboard-confirm-btn {
  height: 38px;
  padding: 0 22px;
  border-radius: 10px;
  border: none;
  color: #100c08;
  font-family: inherit;
  font-size: 14px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
  background: linear-gradient(135deg, #e4c26f, #b87333);
  box-shadow: 0 4px 14px rgba(184, 115, 51, 0.22);
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
  border-radius: var(--radius-panel);
  background:
    linear-gradient(180deg, rgba(255,255,255,.028), rgba(255,255,255,.006)),
    var(--bg-card);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
  transition:
    border-color 160ms ease,
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

.storyboard-route-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  font-size: 0.72rem;
  border-radius: 6px;
  border: 1px solid rgba(128, 128, 128, 0.25);
  color: rgba(220, 220, 220, 0.85);
  white-space: nowrap;
  flex-shrink: 0;
}

.storyboard-unavailable-reason {
  font-size: 0.72rem;
  color: #e6a23c;
  white-space: nowrap;
  flex-shrink: 0;
}

.storyboard-override-select {
  display: inline-flex;
  gap: 2px;
  flex-shrink: 0;
}

.storyboard-override-select button {
  font-size: 0.7rem;
  padding: 2px 8px;
  border: 1px solid rgba(128, 128, 128, 0.3);
  border-radius: 6px;
  background: transparent;
  color: rgba(200, 200, 200, 0.7);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}

.storyboard-override-select button:hover:not(:disabled) {
  color: #fff;
  border-color: rgba(200, 200, 200, 0.6);
}

.storyboard-override-select button.active {
  background: rgba(93, 150, 255, 0.18);
  border-color: rgba(93, 150, 255, 0.55);
  color: #9cc0ff;
}

.storyboard-override-select button:disabled {
  opacity: 0.55;
  cursor: wait;
}

.storyboard-strategy-error {
  margin: 8px 0;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(230, 162, 60, 0.1);
  border: 1px solid rgba(230, 162, 60, 0.4);
  color: #e6a23c;
  font-size: 0.8rem;
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

  .storyboard-stats-actions {
    justify-content: flex-end;
  }

  .storyboard-notes-card {
    flex-direction: column;
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
  bottom: 28px;
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
