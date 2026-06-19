<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { useRoute, useRouter } from "vue-router";

import { useTopicStore, type TopicRecommendationFilters } from "../../stores/topic";
import { useProjectStore } from "../../stores/project";
import { useWorkspaceStore, PIPELINE_STEPS } from "../../stores/workspace";
import { useStagePolling } from "../../composables/useStagePolling";

const topicStore = useTopicStore();
const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();
const route = useRoute();
const router = useRouter();

const SCRIPT_STEP_INDEX = PIPELINE_STEPS.findIndex((s) => s.key === "script");

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
    // 生成完成后刷新候选列表
    topicStore.loadExistingTopic();
  },
});

const isSnapshotGenerating = computed(
  () => topicStore.state.snapshot?.current_status === "topic_generating",
);

onMounted(async () => {
  await topicStore.loadExistingTopic();
  // F5 刷新后恢复轮询
  if (isSnapshotGenerating.value) {
    startPolling();
  }
});

const eraFilter = ref<TopicRecommendationFilters["era"]>(
  (sessionStorage.getItem("topic-era-filter") as TopicRecommendationFilters["era"]) ?? "ancient"
);
const tensionFilter = ref<TopicRecommendationFilters["tension"]>(
  (sessionStorage.getItem("topic-tension-filter") as TopicRecommendationFilters["tension"]) ?? "high"
);

// Persist filter selections
function saveFilters() {
  sessionStorage.setItem("topic-era-filter", eraFilter.value);
  sessionStorage.setItem("topic-tension-filter", tensionFilter.value);
}

const currentCandidates = computed(
  () => topicStore.state.currentRound?.candidates ?? topicStore.state.candidates,
);

const currentRoundLabel = computed(
  () => topicStore.state.currentRound?.label ?? "当前推荐",
);

const selectedCandidate = computed(() => topicStore.state.selectedCandidate);

const selectedCandidateId = computed(
  () => topicStore.state.selectedCandidate?.candidate_id ?? null,
);

const hasCandidates = computed(() => currentCandidates.value.length > 0);

const whyThisNow = computed(() => {
  const c = selectedCandidate.value;
  if (!c) return "";
  return c.why_this_now ?? c.why_now ?? "当前版本未补充额外推荐理由。";
});

const riskHints = computed(() => {
  const c = selectedCandidate.value;
  if (!c) return [];
  return c.risk_hints.length > 0 ? c.risk_hints : ["暂无显式风险提醒。"];
});

function selectCandidate(candidate: (typeof currentCandidates.value)[number]) {
  topicStore.openCandidate(candidate, topicStore.state.currentRound?.round_id);
}

function selectHistoryCandidate(
  candidate: (typeof currentCandidates.value)[number],
  roundId: string,
) {
  topicStore.openCandidate(candidate, roundId);
}

async function generateRecommendations() {
  saveFilters();
  await topicStore.generateSystemRecommendations({
    era: eraFilter.value,
    tension: tensionFilter.value,
  });
  if (!topicStore.state.loadError) {
    ElMessage.success("选题推荐已生成");
  }
}

async function handleRegenerate() {
  await topicStore.generateSystemRecommendations({
    era: eraFilter.value,
    tension: tensionFilter.value,
  });
  if (!topicStore.state.loadError) {
    ElMessage.success("已重新生成选题");
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

function handleRetry() {
  topicStore.generateSystemRecommendations({
    era: eraFilter.value,
    tension: tensionFilter.value,
  });
}
</script>

<template>
  <div class="topic-panel">
    <!-- Top action bar: source tabs + round badge -->
    <div class="topic-action-bar">
      <el-tabs
        :model-value="topicStore.state.activeTab"
        class="topic-source-tabs"
        @tab-change="topicStore.selectTab"
      >
        <el-tab-pane label="系统推荐" name="system" />
        <el-tab-pane label="事件库" name="library" />
        <el-tab-pane label="自定义选题" name="custom" />
      </el-tabs>

      <el-badge
        v-if="topicStore.state.currentRound"
        :value="currentRoundLabel"
        class="topic-round-badge"
        type="info"
      />
    </div>

    <!-- System recommendations panel -->
    <template v-if="topicStore.state.activeTab === 'system'">
      <!-- Error state -->
      <div v-if="topicStore.state.loadError" class="topic-error-card">
        <el-alert
          :title="'生成失败：' + topicStore.state.loadError"
          type="error"
          show-icon
          :closable="false"
        />
        <el-button type="primary" @click="handleRetry">重试</el-button>
      </div>

      <!-- Loading / Generating state (snapshot-based survives refresh) -->
      <div v-else-if="!hasCandidates && (topicStore.state.isGenerating || isSnapshotGenerating || isPolling)" class="topic-generating">
        <el-skeleton :rows="3" animated />
        <p class="topic-generating-text">正在调用大模型生成选题推荐，可能需要 1-3 分钟...</p>
        <p class="topic-generating-hint">生成完成后结果会自动出现，无需手动刷新。</p>
      </div>

      <!-- Empty state -->
      <div v-else-if="!hasCandidates" class="topic-empty-state">
        <div class="topic-empty-inner">
          <p class="topic-empty-text">还没有选题建议，选择筛选条件后开始生成。</p>

          <div class="topic-filters">
            <el-select v-model="eraFilter" placeholder="历史时期" style="width: 160px">
              <el-option label="先秦至两汉" value="ancient" />
              <el-option label="魏晋至唐宋" value="medieval" />
              <el-option label="元明清" value="late-imperial" />
            </el-select>

            <el-select v-model="tensionFilter" placeholder="叙事张力" style="width: 160px">
              <el-option label="高张力" value="high" />
              <el-option label="均衡叙事" value="balanced" />
              <el-option label="传播切口优先" value="hook-first" />
            </el-select>

            <el-button
              type="primary"
              :disabled="isSnapshotGenerating || isPolling"
              :loading="isSnapshotGenerating || isPolling"
              @click="generateRecommendations"
            >
              开始生成选题
            </el-button>
          </div>
        </div>
      </div>

      <!-- Two-column layout: candidates + details -->
      <div v-else class="topic-content">
        <!-- Filters -->
        <div class="topic-filters-bar">
          <el-select v-model="eraFilter" placeholder="历史时期" size="default" style="width: 150px">
            <el-option label="先秦至两汉" value="ancient" />
            <el-option label="魏晋至唐宋" value="medieval" />
            <el-option label="元明清" value="late-imperial" />
          </el-select>

          <el-select v-model="tensionFilter" placeholder="叙事张力" size="default" style="width: 150px">
            <el-option label="高张力" value="high" />
            <el-option label="均衡叙事" value="balanced" />
            <el-option label="传播切口优先" value="hook-first" />
          </el-select>
        </div>

        <!-- Two columns -->
        <div class="topic-columns">
          <!-- Left column: candidate list -->
          <div class="topic-left-col">
            <h3 class="topic-col-heading">{{ currentRoundLabel }}</h3>
            <p class="topic-col-subtitle">系统会优先呈现可直接进入文案阶段的候选主题。</p>

            <div class="topic-candidate-list">
              <div
                v-for="candidate in currentCandidates"
                :key="candidate.candidate_id"
                :data-testid="`candidate-item-${candidate.candidate_id}`"
                class="topic-candidate-card"
                :class="{
                  'topic-candidate-card--active':
                    selectedCandidateId === candidate.candidate_id,
                }"
                @click="selectCandidate(candidate)"
              >
                <div class="topic-candidate-card-body">
                  <div class="topic-candidate-card-copy">
                    <strong class="topic-candidate-title">{{ candidate.title }}</strong>
                    <p class="topic-candidate-angle">{{ candidate.one_line_angle }}</p>
                  </div>
                  <div class="topic-candidate-tags">
                    <el-tag size="small" type="info">{{ candidate.family_label }}</el-tag>
                    <el-tag size="small" type="info">{{ candidate.scope_label }}</el-tag>
                  </div>
                </div>
              </div>
            </div>

            <!-- History rounds -->
            <div v-if="topicStore.state.historyRounds.length > 0" class="topic-history">
              <h4 class="topic-history-heading">候选历史</h4>
              <p class="topic-history-subtitle">之前轮次会保留在这里，方便回看或直接确认。</p>

              <div
                v-for="round in topicStore.state.historyRounds"
                :key="round.round_id"
                class="topic-history-round"
              >
                <h5 class="topic-history-round-title">
                  {{ round.label ?? `第 ${round.round_index ?? '-'} 轮` }}
                </h5>
                <div class="topic-candidate-list topic-candidate-list--compact">
                  <div
                    v-for="candidate in round.candidates"
                    :key="candidate.candidate_id"
                    :data-testid="`candidate-item-${candidate.candidate_id}`"
                    class="topic-candidate-card"
                    :class="{
                      'topic-candidate-card--active':
                        selectedCandidateId === candidate.candidate_id,
                    }"
                    @click="selectHistoryCandidate(candidate, round.round_id)"
                  >
                    <div class="topic-candidate-card-body">
                      <div class="topic-candidate-card-copy">
                        <strong class="topic-candidate-title">{{ candidate.title }}</strong>
                        <p class="topic-candidate-angle">{{ candidate.one_line_angle }}</p>
                      </div>
                      <div class="topic-candidate-tags">
                        <el-tag size="small" type="info">{{ candidate.family_label }}</el-tag>
                        <el-tag size="small" type="info">{{ candidate.scope_label }}</el-tag>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Right column: selected candidate details -->
          <div class="topic-right-col">
            <div v-if="selectedCandidate" class="topic-detail-card">
              <div class="topic-detail-header">
                <span class="topic-detail-kicker">选题详情</span>
                <h2 class="topic-detail-title">{{ selectedCandidate.title }}</h2>
                <p class="topic-detail-angle">{{ selectedCandidate.one_line_angle }}</p>
              </div>

              <div class="topic-detail-tags">
                <el-tag size="small" type="info">{{ selectedCandidate.family_label }}</el-tag>
                <el-tag size="small" type="info">{{ selectedCandidate.scope_label }}</el-tag>
              </div>

              <div class="topic-detail-section">
                <h3 class="topic-detail-section-title">核心冲突</h3>
                <p class="topic-detail-section-text">{{ selectedCandidate.strong_scene }}</p>
              </div>

              <div class="topic-detail-section">
                <h3 class="topic-detail-section-title">传播切口</h3>
                <p class="topic-detail-section-text">{{ whyThisNow }}</p>
              </div>

              <div class="topic-detail-section">
                <h3 class="topic-detail-section-title">叙事张力</h3>
                <p class="topic-detail-section-text">{{ selectedCandidate.one_line_angle }}</p>
              </div>

              <div class="topic-detail-section">
                <h3 class="topic-detail-section-title">风险提示</h3>
                <ul class="topic-detail-risks">
                  <li v-for="risk in riskHints" :key="risk">{{ risk }}</li>
                </ul>
              </div>

              <el-button
                type="primary"
                data-testid="confirm-candidate"
                class="topic-detail-confirm-btn"
                :loading="topicStore.state.isConfirming"
                :disabled="topicStore.state.isConfirming"
                @click="confirmCandidate"
              >
                确认此选题
              </el-button>
            </div>

            <div v-else class="topic-detail-empty">
              <p>点击左侧候选卡片查看选题详情</p>
            </div>
          </div>
        </div>

        <!-- Bottom actions -->
        <div class="topic-bottom-actions">
          <el-popconfirm
            title="确定要重新生成吗？当前候选将保留在历史中。"
            confirm-button-text="确定"
            cancel-button-text="取消"
            @confirm="handleRegenerate"
          >
            <template #reference>
              <el-button :disabled="topicStore.state.isGenerating">
                重新生成
              </el-button>
            </template>
          </el-popconfirm>

          <el-button :disabled="topicStore.state.isGenerating" @click="handleRegenerate">
            换一批
          </el-button>

          <el-button
            type="primary"
            data-testid="confirm-candidate"
            :disabled="!selectedCandidate || topicStore.state.isConfirming"
            :loading="topicStore.state.isConfirming"
            @click="confirmCandidate"
          >
            确认选题
          </el-button>
        </div>
      </div>
    </template>

    <!-- Library placeholder -->
    <div v-else-if="topicStore.state.activeTab === 'library'" class="topic-alt-panel">
      <h2>事件库</h2>
      <p>事件库入口将在下一轮接入，当前先保持统一视觉外壳。</p>
    </div>

    <!-- Custom placeholder -->
    <div v-else class="topic-alt-panel">
      <h2>自定义主题</h2>
      <p>自定义主题入口将在后续接入，当前先保留同层级占位。</p>
    </div>
  </div>
</template>

<style scoped>
.topic-panel {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-lg);
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
}

/* Action bar */
.topic-action-bar {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  flex-wrap: wrap;
}

.topic-source-tabs {
  flex: 1;
  min-width: 0;
}

.topic-round-badge {
  flex-shrink: 0;
}

/* Filters bar */
.topic-filters-bar {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

/* Empty state */
.topic-empty-state {
  display: flex;
  justify-content: center;
  padding: var(--space-xl) var(--space-md);
}

.topic-empty-inner {
  display: grid;
  gap: var(--space-md);
  justify-items: center;
  max-width: 480px;
}

.topic-empty-text {
  color: var(--text-secondary);
  text-align: center;
  line-height: 1.75;
}

.topic-filters {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
  justify-content: center;
}

/* Error card */
.topic-error-card {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-md);
  border-radius: var(--radius-card);
  background: var(--bg-card);
}

.topic-generating {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-xl) var(--space-md);
}

.topic-generating-text {
  color: var(--text-body);
  font-size: 0.95rem;
  text-align: center;
}

.topic-generating-hint {
  color: var(--text-muted);
  font-size: 0.82rem;
  text-align: center;
}

/* Two-column layout */
.topic-content {
  display: grid;
  gap: var(--space-md);
}

.topic-columns {
  display: grid;
  grid-template-columns: 1fr 1.2fr;
  gap: var(--space-lg);
  align-items: start;
}

/* Left column */
.topic-left-col {
  display: grid;
  gap: var(--space-sm);
}

.topic-col-heading,
.topic-history-heading {
  margin: 0;
  font-size: 1.1rem;
  font-weight: var(--font-subheading);
  color: var(--text-heading);
}

.topic-col-subtitle,
.topic-history-subtitle {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.6;
  font-size: 0.92rem;
}

/* Candidate list */
.topic-candidate-list {
  display: grid;
  gap: var(--space-sm);
}

.topic-candidate-list--compact {
  gap: 6px;
}

.topic-candidate-card {
  padding: var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--bg-card);
  cursor: pointer;
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    transform 160ms ease;
}

.topic-candidate-card:hover {
  border-color: var(--border-hover);
  background: var(--bg-hover);
  transform: translateY(-1px);
}

.topic-candidate-card--active {
  border-color: var(--accent-primary);
  background: var(--bg-hover);
  box-shadow: 0 0 0 1px var(--accent-primary);
}

.topic-candidate-card-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-md);
}

.topic-candidate-card-copy {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.topic-candidate-title {
  font-size: 0.98rem;
  line-height: 1.5;
  color: var(--text-heading);
}

.topic-candidate-angle {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.6;
  font-size: 0.9rem;
}

.topic-candidate-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
  justify-content: flex-end;
}

/* History */
.topic-history {
  display: grid;
  gap: var(--space-sm);
  padding-top: var(--space-md);
  border-top: 1px solid var(--border-default);
  margin-top: var(--space-sm);
}

.topic-history-round {
  display: grid;
  gap: 6px;
  padding-top: var(--space-sm);
  border-top: 1px solid var(--border-default);
}

.topic-history-round-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: var(--font-subheading);
  color: var(--text-heading);
}

/* Right column */
.topic-right-col {
  position: sticky;
  top: var(--space-md);
}

.topic-detail-card {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-lg);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--bg-card);
}

.topic-detail-header {
  display: grid;
  gap: var(--space-xs);
}

.topic-detail-kicker {
  color: var(--accent-primary);
  font-size: 0.85rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.topic-detail-title {
  margin: 0;
  font-size: 1.3rem;
  line-height: 1.5;
  color: var(--text-heading);
}

.topic-detail-angle {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.6;
}

.topic-detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}

.topic-detail-section {
  display: grid;
  gap: var(--space-xs);
  padding-top: var(--space-md);
  border-top: 1px solid var(--border-default);
}

.topic-detail-section-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: var(--font-subheading);
  color: var(--text-heading);
}

.topic-detail-section-text {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.75;
  font-size: 0.94rem;
}

.topic-detail-risks {
  margin: 0;
  padding-left: 1.1rem;
  color: var(--text-secondary);
  line-height: 1.75;
  font-size: 0.94rem;
}

.topic-detail-confirm-btn {
  width: 100%;
  margin-top: auto;
}

.topic-detail-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-panel);
  color: var(--text-muted);
}

/* Bottom actions */
.topic-bottom-actions {
  display: flex;
  gap: var(--space-sm);
  padding-top: var(--space-md);
  border-top: 1px solid var(--border-default);
  flex-wrap: wrap;
}

/* Alternate panels */
.topic-alt-panel {
  display: grid;
  gap: var(--space-sm);
  padding: var(--space-lg);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--bg-card);
}

.topic-alt-panel h2 {
  margin: 0;
  font-size: 1.15rem;
  color: var(--text-heading);
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

  .topic-candidate-card-body {
    grid-template-columns: 1fr;
    align-items: start;
  }

  .topic-candidate-tags {
    justify-content: flex-start;
  }
}
</style>
