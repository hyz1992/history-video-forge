<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { useRoute, useRouter } from "vue-router";

import { useTopicStore } from "../../stores/topic";
import { useProjectStore } from "../../stores/project";
import { useWorkspaceStore, PIPELINE_STEPS } from "../../stores/workspace";
import { useStagePolling } from "../../composables/useStagePolling";
import StageGenerating from "../workspace/StageGenerating.vue";
import StageLoadingBar from "../workspace/StageLoadingBar.vue";

const topicStore = useTopicStore();
const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();
const route = useRoute();
const router = useRouter();

const SCRIPT_STEP_INDEX = PIPELINE_STEPS.findIndex((s) => s.key === "script");

const isRefreshing = ref(false);

const { startPolling, isPolling } = useStagePolling({
  loadSnapshot: async () =>
    (await topicStore.loadSnapshot()) ?? {
      active_topic_package: null,
      current_status: "topic_pending",
      topic_candidates: null,
    },
  isGenerating: (snapshot) => snapshot.current_status === "topic_generating",
  isTerminal: (snapshot) =>
    snapshot.current_status !== "topic_generating" && snapshot.current_status !== "topic_pending",
  onComplete: () => {
    topicStore.loadExistingTopic();
  },
});

const isSnapshotGenerating = computed(
  () => topicStore.state.snapshot?.current_status === "topic_generating",
);

onMounted(async () => {
  if (topicStore.state.isGenerating) {
    startPolling();
    return;
  }
  await topicStore.loadExistingTopic();
  if (isSnapshotGenerating.value) {
    startPolling();
  }
});

const isRefreshingTopicStatus = ref(false);
const historyOpen = ref(false);

function readFilters() {
  return {
    era: (sessionStorage.getItem("topic-era-filter") ?? "ancient") as "ancient" | "medieval" | "late-imperial",
    tension: (sessionStorage.getItem("topic-tension-filter") ?? "high") as "high" | "balanced" | "hook-first",
  };
}

const currentCandidates = computed(
  () => topicStore.state.currentRound?.candidates ?? topicStore.state.candidates,
);

const selectedCandidate = computed(() => topicStore.state.selectedCandidate);

const selectedCandidateId = computed(
  () => topicStore.state.selectedCandidate?.candidate_id ?? null,
);

const hasCandidates = computed(() => currentCandidates.value.length > 0);

const hasLoadError = computed(() => !!topicStore.state.loadError);

const isGeneratingState = computed(
  () => !hasCandidates.value && (topicStore.state.isGenerating || isSnapshotGenerating.value || isPolling.value),
);

const mustCoverPreview = computed(() => {
  const c = selectedCandidate.value;
  if (!c) return [];
  return c.must_cover_preview ?? [];
});

const coreConflict = computed(() => {
  const c = selectedCandidate.value;
  if (!c) return "";
  return c.core_conflict ?? "";
});

const viralRubric = computed(() => {
  const c = selectedCandidate.value;
  if (!c) return {};
  return c.viral_rubric ?? {};
});

const sourceHint = computed(() => {
  const c = selectedCandidate.value;
  if (!c) return "";
  return c.source_hint ?? "";
});

const rubricLabels: Record<string, string> = {
  hook_power: "开篇吸力",
  novelty_gap: "新颖程度",
  emotion_gap: "情绪张力",
  share_impulse: "分享冲动",
  visual_promise: "视觉潜力",
};

const rubricLevelLabel: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
};

function selectCandidate(candidate: (typeof currentCandidates.value)[number]) {
  topicStore.openCandidate(candidate, topicStore.state.currentRound?.round_id);
}

function selectHistoryCandidate(
  candidate: (typeof currentCandidates.value)[number],
  roundId: string,
) {
  topicStore.openCandidate(candidate, roundId);
}

function toggleHistory() {
  historyOpen.value = !historyOpen.value;
}

async function handleRefreshBatch() {
  if (topicStore.state.isGenerating || isRefreshing.value) return;
  isRefreshing.value = true;
  await nextTick();
  try {
    const filters = readFilters();
    const generation = topicStore.generateSystemRecommendations(filters);
    startPolling();
    await generation;
    if (topicStore.state.loadError) {
      isRefreshing.value = false;
      ElMessage.warning("刷新失败：" + topicStore.state.loadError);
    } else {
      setTimeout(() => {
        isRefreshing.value = false;
      }, 400);
    }
  } catch {
    isRefreshing.value = false;
  }
}

async function handleRegenerate() {
  const filters = readFilters();
  const generation = topicStore.generateSystemRecommendations(filters);
  startPolling();
  await generation;
  if (!topicStore.state.loadError) {
    ElMessage.success("已重新生成选题");
  }
}

async function handleRefreshGeneratingStatus() {
  if (isRefreshingTopicStatus.value) return;
  isRefreshingTopicStatus.value = true;
  try {
    const snapshot = await topicStore.loadSnapshot();
    if (snapshot?.current_status !== "topic_generating") {
      await topicStore.loadExistingTopic();
    }
  } finally {
    isRefreshingTopicStatus.value = false;
  }
}

async function confirmCandidate() {
  await topicStore.confirmSelectedCandidate();
  if (topicStore.state.confirmedTopicPackageId) {
    ElMessage.success("选题已确认，自动进入文案阶段");
    workspaceStore.setCurrentStep(SCRIPT_STEP_INDEX);
    const projectId = route.params.projectId;
    if (projectId) {
      await router.push(`/projects/${projectId}/script`);
    }
  }
}

function roundLabel(round: { label?: string; round_index?: number }) {
  return round.label ?? `第 ${round.round_index ?? "-"} 轮`;
}
</script>

<template>
  <div class="topic-panel">
    <template v-if="!hasCandidates && !isRefreshing && (topicStore.state.isGenerating || isSnapshotGenerating || isPolling)">
      <StageGenerating
        title="正在生成选题"
        hint="正在调用大模型生成选题推荐，可能需要 1-3 分钟。"
        secondary-hint="生成完成后结果会自动出现，无需手动刷新。"
      >
        <template #action>
          <button class="btn btn-ghost" :disabled="isRefreshingTopicStatus" @click="handleRefreshGeneratingStatus">
            {{ isRefreshingTopicStatus ? '刷新中…' : '刷新状态' }}
          </button>
        </template>
      </StageGenerating>
    </template>

    <template v-else-if="hasLoadError">
      <div class="center-state">
        <div class="center-state-inner">
          <div class="center-error-icon">!</div>
          <h2 class="center-state-title">选题生成失败</h2>
          <p class="center-state-desc">{{ topicStore.state.loadError }}</p>
          <div class="center-state-line"></div>
          <div class="center-state-actions">
            <button class="btn btn-ghost" @click="router.push('/projects')">返回项目列表</button>
            <button class="btn btn-primary" @click="handleRegenerate">重新生成</button>
          </div>
        </div>
      </div>
    </template>

    <template v-else-if="hasCandidates">
      <h1 class="topic-page-title">请选择您喜欢的<em>选题</em></h1>

      <div class="topic-columns">
        <section class="topic-left-col panel-card">
          <div class="candidate-list">
            <div
              v-for="candidate in currentCandidates"
              :key="candidate.candidate_id"
              :data-testid="`candidate-item-${candidate.candidate_id}`"
              class="candidate-card"
              :class="{ active: selectedCandidateId === candidate.candidate_id }"
              @click="selectCandidate(candidate)"
            >
              <div class="candidate-body">
                <div class="candidate-title">{{ candidate.title }}</div>
                <div class="candidate-angle">{{ candidate.one_line_angle }}</div>
                <div class="candidate-tags">
                  <span class="candidate-tag">{{ candidate.family_label }}</span>
                  <span class="candidate-tag">{{ candidate.scope_label }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="history-block">
            <div class="history-top">
              <button class="history-toggle" @click="toggleHistory">
                <span class="toggle-arrow" :class="{ open: historyOpen }">▶</span>
                候选历史
              </button>
              <button class="action-btn" :disabled="isRefreshing" @click="handleRefreshBatch">↺ 换一批</button>
            </div>
            <div v-if="historyOpen && topicStore.state.historyRounds.length > 0" class="history-rounds">
              <template v-for="round in topicStore.state.historyRounds" :key="round.round_id">
                <div class="history-label">{{ roundLabel(round) }}</div>
                <div class="history-round">
                  <div
                    v-for="candidate in round.candidates"
                    :key="candidate.candidate_id"
                    :data-testid="`candidate-item-${candidate.candidate_id}`"
                    class="candidate-card"
                    :class="{ active: selectedCandidateId === candidate.candidate_id }"
                    @click="selectHistoryCandidate(candidate, round.round_id)"
                  >
                    <div class="candidate-body">
                      <div class="candidate-title">{{ candidate.title }}</div>
                      <div class="candidate-angle">{{ candidate.one_line_angle }}</div>
                      <div class="candidate-tags">
                        <span class="candidate-tag">{{ candidate.family_label }}</span>
                        <span class="candidate-tag">{{ candidate.scope_label }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </div>
            <div v-else-if="historyOpen" class="history-empty">暂无候选历史</div>
          </div>
        </section>

        <aside class="topic-right-col">
          <div v-if="selectedCandidate" class="detail-card">
            <div class="detail-header">
              <h2 class="detail-title">{{ selectedCandidate.title }}</h2>
              <p class="detail-angle">{{ selectedCandidate.one_line_angle }}</p>
            </div>
            <div class="detail-tags">
              <span class="detail-tag">{{ selectedCandidate.family_label }}</span>
              <span class="detail-tag">{{ selectedCandidate.scope_label }}</span>
              <span v-if="sourceHint" class="detail-tag detail-tag-source">{{ sourceHint }}</span>
            </div>
            <div class="detail-sections">
              <section class="detail-section">
                <div class="detail-section-label">叙事节拍</div>
                <ol class="beat-list">
                  <li class="beat-item" v-for="(beat, i) in mustCoverPreview" :key="i">{{ beat }}</li>
                </ol>
              </section>
              <section class="detail-section">
                <div class="detail-section-label">核心冲突</div>
                <div class="detail-section-text">{{ coreConflict || '暂无冲突分析。' }}</div>
              </section>
              <section class="detail-section">
                <div class="detail-section-label">传播潜力</div>
                <div class="rubric-grid" v-if="Object.keys(viralRubric).length">
                  <div
                    class="rubric-item"
                    v-for="(level, key) in viralRubric"
                    :key="key"
                    :class="'rubric-' + level"
                  >
                    <span class="rubric-label">{{ rubricLabels[key] ?? key }}</span>
                    <span class="rubric-bar">
                      <span class="rubric-fill" :class="'rubric-fill-' + level"></span>
                    </span>
                    <span class="rubric-level">{{ rubricLevelLabel[level] ?? level }}</span>
                  </div>
                </div>
                <div v-else class="detail-section-text">暂无传播潜力评分。</div>
              </section>
            </div>
            <div class="detail-footer">
              <button
                class="confirm-btn"
                data-testid="confirm-candidate"
                :disabled="topicStore.state.isConfirming || isRefreshing"
                @click="confirmCandidate"
              >
                确认此选题，进入文案阶段
              </button>
            </div>
          </div>
          <div v-else class="panel-card detail-empty">
            点击左侧候选卡片查看选题详情
          </div>
        </aside>
      </div>
    </template>

    <template v-else-if="isRefreshing">
    </template>

    <template v-else-if="!hasCandidates && !hasLoadError && projectStore.state.projectId">
    </template>

    <template v-else-if="topicStore.state.activeTab === 'library'">
      <div class="topic-alt-panel">
        <h2>事件库</h2>
        <p>事件库入口将在下一轮接入，当前先保持统一视觉外壳。</p>
      </div>
    </template>

    <template v-else>
      <div class="topic-alt-panel">
        <h2>自定义主题</h2>
        <p>自定义主题入口将在后续接入，当前先保留同层级占位。</p>
      </div>
    </template>

    <StageLoadingBar
      :visible="isRefreshing"
      text="正在刷新选题…"
    />
  </div>
</template>

<style scoped>
.topic-panel {
  --bg-card: #1f1b18;
  --bg-card-hover: #2a2522;
  --bg-panel: rgba(31, 27, 24, 0.86);
  --bg-panel-soft: rgba(26, 22, 20, 0.72);
  --bg-hover: rgba(201, 162, 39, 0.075);

  --accent-gold: #c9a227;
  --accent-gold-light: #e4c26f;
  --accent-copper: #b87333;
  --accent-bronze: #cd7f32;
  --accent-warm: #d4a574;

  --text-primary: #f5f0e8;
  --text-body: #d8cec0;
  --text-secondary: #a89f94;
  --text-muted: #6b635a;
  --text-dim: #4f4841;
  --text-inverse: #100c08;

  --border-color: #3d3632;
  --border-soft: rgba(201, 162, 39, 0.13);
  --border-active: rgba(201, 162, 39, 0.34);

  --success: #65a77a;
  --success-bg: rgba(101, 167, 122, 0.13);
  --danger: #c06454;
  --danger-bg: rgba(192, 100, 84, 0.13);
  --warning: #c9a227;
  --warning-bg: rgba(201, 162, 39, 0.13);

  --shadow-card: 0 18px 48px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.035);
  --shadow-heavy: 0 28px 76px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.04);

  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 18px;
  --radius-xl: 24px;

  --font-serif: "Noto Serif SC", "Songti SC", Georgia, serif;
  --ease: 180ms ease;
  --ease-smooth: 260ms cubic-bezier(.2,.7,.2,1);

  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: 28px 28px 36px;
}

/* Page title */
.topic-page-title {
  margin: 0 0 18px;
  color: var(--text-primary);
  font-family: var(--font-serif);
  font-size: 28px;
  line-height: 1.25;
  letter-spacing: -.02em;
  font-weight: 700;
}

.topic-page-title em {
  color: var(--accent-gold-light);
  font-style: normal;
}

/* Two-column layout */
.topic-columns {
  display: grid;
  grid-template-columns: 455px minmax(0, 1fr);
  gap: 22px;
  align-items: start;
}

.topic-left-col,
.topic-right-col {
  min-width: 0;
}

.topic-right-col {
  position: sticky;
  top: 18px;
}

/* Panel card */
.panel-card {
  border-radius: var(--radius-xl);
  border: 1px solid rgba(201,162,39,.15);
  background:
    linear-gradient(180deg, rgba(255,255,255,.035), rgba(255,255,255,.008)),
    var(--bg-panel);
  box-shadow: var(--shadow-heavy);
  overflow: hidden;
}

/* Candidate list */
.candidate-list {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.candidate-card {
  position: relative;
  display: block;
  padding: 15px 16px;
  border-radius: var(--radius-lg);
  border: 1px solid rgba(201,162,39,.12);
  background: rgba(255,255,255,.018);
  cursor: pointer;
  transition: transform var(--ease-smooth), background var(--ease), border-color var(--ease), box-shadow var(--ease);
}

.candidate-card:hover {
  transform: translateX(3px);
  border-color: rgba(201,162,39,.25);
  background: rgba(201,162,39,.048);
}

.candidate-card.active {
  border-color: rgba(201,162,39,.46);
  background:
    linear-gradient(135deg, rgba(201,162,39,.12), rgba(184,115,51,.045)),
    rgba(255,255,255,.018);
  box-shadow: inset 0 0 0 1px rgba(201,162,39,.16), 0 14px 30px rgba(0,0,0,.18);
}

.candidate-body {
  min-width: 0;
}

.candidate-title {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 750;
  line-height: 1.42;
  margin-bottom: 6px;
}

.candidate-card.active .candidate-title {
  color: var(--accent-gold-light);
}

.candidate-angle {
  color: var(--text-secondary);
  font-size: 12.5px;
  line-height: 1.55;
  margin-bottom: 9px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.candidate-tags {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.candidate-tag {
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid rgba(201,162,39,.12);
  background: rgba(201,162,39,.045);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 650;
}

.candidate-card.active .candidate-tag {
  border-color: rgba(201,162,39,.22);
  color: var(--accent-warm);
  background: rgba(201,162,39,.08);
}

/* Action button */
.action-btn {
  height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid rgba(201,162,39,.14);
  background: rgba(255,255,255,.018);
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
  transition: all var(--ease);
  font-family: inherit;
}

.action-btn:hover {
  color: var(--text-primary);
  border-color: rgba(201,162,39,.30);
  background: rgba(201,162,39,.07);
  transform: translateY(-1px);
}

.action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  transform: none;
}

/* History block */
.history-block {
  border-top: 1px solid rgba(201,162,39,.11);
  padding: 12px;
}

.history-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.history-toggle {
  height: 34px;
  padding: 0 4px;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
  border: none;
  font-family: inherit;
  transition: color var(--ease);
}

.history-toggle:hover {
  color: var(--text-primary);
}

.toggle-arrow {
  font-size: 11px;
  transition: transform var(--ease-smooth);
}

.toggle-arrow.open {
  transform: rotate(90deg);
}

.history-rounds {
  margin-top: 10px;
  display: grid;
  gap: 8px;
}

.history-label {
  padding: 6px 0 2px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .09em;
  text-transform: uppercase;
}

.history-round .candidate-card {
  padding: 12px 14px;
}

.history-round .candidate-title {
  font-size: 13px;
}

.history-round .candidate-angle {
  font-size: 12px;
  margin-bottom: 7px;
}

.history-empty {
  padding: 20px 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

/* Detail card */
.detail-card {
  border-radius: var(--radius-xl);
  border: 1px solid rgba(201,162,39,.16);
  background:
    radial-gradient(circle at 78% 0%, rgba(201,162,39,.08), transparent 34%),
    linear-gradient(180deg, rgba(255,255,255,.035), rgba(255,255,255,.008)),
    var(--bg-panel);
  box-shadow: var(--shadow-heavy);
  overflow: hidden;
}

.detail-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  color: var(--text-muted);
  font-size: 14px;
}

.detail-header {
  padding: 24px 26px 22px;
  border-bottom: 1px solid rgba(201,162,39,.12);
}

.detail-title {
  margin: 0 0 10px;
  color: var(--text-primary);
  font-family: var(--font-serif);
  font-size: 25px;
  line-height: 1.34;
  letter-spacing: -.02em;
  font-weight: 700;
}

.detail-angle {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.8;
}

.detail-tags {
  padding: 14px 26px;
  border-bottom: 1px solid rgba(201,162,39,.11);
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.detail-tag {
  padding: 5px 12px;
  border-radius: 999px;
  color: var(--accent-warm);
  background: rgba(201,162,39,.075);
  border: 1px solid rgba(201,162,39,.16);
  font-size: 12px;
  font-weight: 700;
}

.detail-tag-source {
  color: #7d90a0;
  background: rgba(125, 144, 160, .08);
  border-color: rgba(125, 144, 160, .16);
  font-style: italic;
}

.detail-sections {
  padding: 6px 0;
}

.detail-section {
  padding: 18px 26px;
  border-bottom: 1px solid rgba(201,162,39,.10);
}

.detail-section:last-child {
  border-bottom: none;
}

.detail-section-label {
  margin: 0 0 6px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 850;
  letter-spacing: .09em;
  text-transform: uppercase;
}

.detail-section-text {
  margin: 0;
  color: var(--text-body);
  font-size: 13.5px;
  line-height: 1.82;
}

.beat-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
  counter-reset: beat-counter;
}

.beat-item {
  position: relative;
  padding-left: 22px;
  color: var(--text-body);
  font-size: 13.5px;
  line-height: 1.72;
  counter-increment: beat-counter;
}

.beat-item::before {
  content: counter(beat-counter);
  position: absolute;
  left: 0;
  top: .08em;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(201,162,39,.12);
  color: var(--accent-gold-light);
  font-size: 10px;
  font-weight: 800;
  display: grid;
  place-items: center;
}

.rubric-grid {
  display: grid;
  gap: 8px;
}

.rubric-item {
  display: grid;
  grid-template-columns: 72px 1fr 32px;
  align-items: center;
  gap: 10px;
}

.rubric-label {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 700;
}

.rubric-bar {
  height: 6px;
  border-radius: 3px;
  background: rgba(201,162,39,.08);
  overflow: hidden;
}

.rubric-fill {
  display: block;
  height: 100%;
  border-radius: 3px;
  transition: width 360ms ease;
}

.rubric-fill-low {
  width: 28%;
  background: #5a5040;
}

.rubric-fill-medium {
  width: 60%;
  background: linear-gradient(90deg, #b87333, #c9973e);
}

.rubric-fill-high {
  width: 92%;
  background: linear-gradient(90deg, #c9973e, #e6c36f);
}

.rubric-level {
  font-size: 11px;
  font-weight: 800;
  text-align: right;
  text-transform: uppercase;
  color: var(--text-muted);
}

.detail-footer {
  padding: 18px 26px 22px;
  border-top: 1px solid rgba(201,162,39,.12);
  background: rgba(0,0,0,.15);
}

.confirm-btn {
  width: 100%;
  height: 46px;
  border-radius: 13px;
  color: var(--text-inverse);
  background: linear-gradient(135deg, var(--accent-gold-light), var(--accent-copper));
  box-shadow: 0 12px 30px rgba(184,115,51,.25);
  font-size: 15px;
  font-weight: 850;
  cursor: pointer;
  border: none;
  font-family: inherit;
  transition: transform var(--ease), box-shadow var(--ease), filter var(--ease);
}

.confirm-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 16px 40px rgba(201,162,39,.28);
  filter: brightness(1.04);
}

.confirm-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* Centered page states (error / generating) */
.center-state {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 44px 28px 64px;
}

.center-state-inner {
  width: min(560px, 100%);
  text-align: center;
  transform: translateY(20px);
}

.center-error-icon {
  width: 82px;
  height: 82px;
  margin: 0 auto 28px;
  border-radius: 26px;
  display: grid;
  place-items: center;
  color: var(--danger);
  background:
    radial-gradient(circle at 50% 40%, rgba(192,100,84,.16), rgba(192,100,84,.06) 68%, rgba(192,100,84,.025) 100%);
  border: 1px solid rgba(192,100,84,.26);
  font-size: 34px;
  font-weight: 900;
  box-shadow:
    0 0 42px rgba(192,100,84,.07),
    inset 0 1px 0 rgba(255,255,255,.04);
}

.center-state-title {
  color: var(--text-primary);
  font-family: var(--font-serif);
  font-size: 26px;
  line-height: 1.25;
  letter-spacing: -.02em;
  margin: 0 0 10px;
}

.center-state-desc {
  max-width: 520px;
  margin: 0 auto;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.85;
}

.center-state-line {
  width: 150px;
  height: 1px;
  margin: 24px auto 0;
  background: linear-gradient(90deg, transparent, rgba(201,162,39,.24), transparent);
}

.center-state-actions {
  margin-top: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

/* Generic buttons in centered states */
.btn {
  height: 38px;
  padding: 0 16px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
  border: none;
  font-family: inherit;
  transition: transform var(--ease), background var(--ease), border-color var(--ease), box-shadow var(--ease), color var(--ease);
  white-space: nowrap;
}

.btn:hover:not(:disabled) {
  transform: translateY(-1px);
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.btn-ghost {
  background: rgba(255,255,255,.018);
  border: 1px solid var(--border-soft);
  color: var(--text-secondary);
}

.btn-ghost:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: rgba(201,162,39,.30);
  background: rgba(201,162,39,.065);
}

.btn-primary {
  color: var(--text-inverse);
  background: linear-gradient(135deg, var(--accent-gold-light), var(--accent-copper));
  box-shadow: 0 10px 26px rgba(184,115,51,.24);
}

.btn-primary:hover:not(:disabled) {
  box-shadow: 0 14px 36px rgba(201,162,39,.28);
}

/* Alt panels */
.topic-alt-panel {
  display: grid;
  gap: 8px;
  padding: 40px;
  border: 1px solid rgba(201,162,39,.12);
  border-radius: var(--radius-xl);
  background:
    linear-gradient(180deg, rgba(255,255,255,.02), rgba(255,255,255,.005)),
    var(--bg-panel);
  color: var(--text-muted);
}

.topic-alt-panel h2 {
  margin: 0;
  font-size: 1.15rem;
  color: var(--text-primary);
  font-family: var(--font-serif);
}

.topic-alt-panel p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.75;
}

/* Responsive */
@media (max-width: 819px) {
  .topic-columns {
    grid-template-columns: 1fr;
  }

  .topic-right-col {
    position: static;
  }
}
</style>
