<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import TopicCandidateDrawer from "../components/topic/TopicCandidateDrawer.vue";
import TopicCandidateList from "../components/topic/TopicCandidateList.vue";
import TopicTabs from "../components/topic/TopicTabs.vue";
import { useProjectStore } from "../stores/project";
import { useTopicStore, type TopicRecommendationFilters } from "../stores/topic";

const projectStore = useProjectStore();
const topicStore = useTopicStore();
const route = useRoute();
const router = useRouter();

const eraFilter = ref<TopicRecommendationFilters["era"]>("ancient");
const tensionFilter = ref<TopicRecommendationFilters["tension"]>("high");

const currentCandidates = computed(() =>
  topicStore.state.currentRound?.candidates ?? topicStore.state.candidates,
);

const currentRoundLabel = computed(() => topicStore.state.currentRound?.label ?? "当前推荐");

onMounted(() => {
  const projectId = route.params.projectId;
  if (typeof projectId !== "string" || !projectId) {
    return;
  }

  if (projectStore.state.projectId === projectId) {
    return;
  }

  projectStore.syncProject({
    project_id: projectId,
    current_status: projectStore.state.currentStatus,
  });
});

watch(
  () => [projectStore.state.projectId, projectStore.state.currentStatus] as const,
  async ([projectId, currentStatus]) => {
    if (!projectId) {
      return;
    }

    if (currentStatus === "script_ready") {
      const nextPath = projectStore.resolveProjectWorkspacePath(projectId, currentStatus);
      if (router.currentRoute.value.path !== nextPath) {
        await router.push(nextPath);
      }
    }
  },
);

watch(
  () => [projectStore.state.projectId, topicStore.state.confirmedTopicPackageId] as const,
  async ([projectId, confirmedTopicPackageId]) => {
    if (!projectId || !confirmedTopicPackageId) {
      return;
    }

    const nextPath = projectStore.resolveProjectWorkspacePath(projectId, "script_ready");
    if (router.currentRoute.value.path !== nextPath) {
      await router.push(nextPath);
    }
  },
);

function openCurrentCandidate(candidate: (typeof currentCandidates.value)[number]) {
  topicStore.openCandidate(candidate, topicStore.state.currentRound?.round_id);
}

function generateRecommendations() {
  return topicStore.generateSystemRecommendations({
    era: eraFilter.value,
    tension: tensionFilter.value,
  });
}
</script>

<template>
  <section class="topic-page workspace-shell workspace-shell--topic">
    <div data-testid="topic-workspace" class="topic-workspace">
      <TopicTabs
        :active-tab="topicStore.state.activeTab"
        @update:active-tab="topicStore.selectTab"
      />

      <div
        v-if="topicStore.state.activeTab === 'system'"
        data-testid="panel-system"
        class="topic-system-shell"
      >
        <section data-testid="topic-toolbar" class="topic-toolbar">
          <div class="topic-filter-row">
            <label data-testid="topic-filter-era" class="topic-filter-field">
              <span>历史时期</span>
              <select v-model="eraFilter">
                <option value="ancient">先秦至两汉</option>
                <option value="medieval">魏晋至唐宋</option>
                <option value="late-imperial">元明清</option>
              </select>
            </label>

            <label data-testid="topic-filter-tension" class="topic-filter-field">
              <span>叙事张力</span>
              <select v-model="tensionFilter">
                <option value="high">高张力</option>
                <option value="balanced">均衡叙事</option>
                <option value="hook-first">传播切口优先</option>
              </select>
            </label>
          </div>

          <button
            data-testid="system-generate"
            type="button"
            class="btn btn-primary topic-generate-button"
            :disabled="topicStore.state.isGenerating"
            @click="generateRecommendations"
          >
            {{ topicStore.state.isGenerating ? "生成中..." : "开始生成选题" }}
          </button>

          <p
            v-if="topicStore.state.loadError"
            data-testid="topic-error"
            class="topic-error"
          >
            生成失败：{{ topicStore.state.loadError }}
          </p>
        </section>

        <section
          data-testid="topic-results-shell"
          class="topic-results-shell"
        >
          <div class="topic-section-copy">
            <div class="topic-section-heading">
              <h2>{{ currentRoundLabel }}</h2>
              <p>系统会优先呈现可直接进入文案阶段的候选主题。</p>
            </div>
          </div>

          <TopicCandidateList
            v-if="currentCandidates.length > 0"
            data-testid="current-topic-round"
            :candidates="currentCandidates"
            :selected-candidate-id="topicStore.state.selectedCandidate?.candidate_id ?? null"
            @select="openCurrentCandidate"
          />

          <p
            v-else
            data-testid="topic-results-empty"
            class="topic-results-empty"
          >
            点击右侧按钮生成第一组选题建议。
          </p>
        </section>

        <section
          data-testid="topic-history-shell"
          class="topic-history-shell"
        >
          <div class="topic-section-heading">
            <h2>候选历史</h2>
            <p>之前轮次会保留在这里，方便回看或直接确认。</p>
          </div>

          <div
            v-if="topicStore.state.historyRounds.length > 0"
            data-testid="topic-history"
            class="topic-history-rounds"
          >
            <article
              v-for="round in topicStore.state.historyRounds"
              :key="round.round_id"
              class="topic-history-round"
            >
              <header class="topic-history-round-header">
                <h3>{{ round.label ?? `第 ${round.round_index ?? '-'} 轮` }}</h3>
              </header>

              <TopicCandidateList
                compact
                :candidates="round.candidates"
                :selected-candidate-id="topicStore.state.selectedCandidate?.candidate_id ?? null"
                @select="(candidate) => topicStore.openCandidate(candidate, round.round_id)"
              />
            </article>
          </div>

          <p
            v-else
            data-testid="topic-history-empty"
            class="topic-history-empty"
          >
            暂无历史轮次，生成新一轮后会在这里保留历史候选。
          </p>
        </section>
      </div>

      <section
        v-else-if="topicStore.state.activeTab === 'library'"
        data-testid="panel-library"
        class="topic-alt-panel workspace-panel"
      >
        <h2>事件库</h2>
        <p>事件库入口将在下一轮接入，当前先保持统一视觉外壳。</p>
      </section>

      <section
        v-else
        data-testid="panel-custom"
        class="topic-alt-panel workspace-panel"
      >
        <h2>自定义主题</h2>
        <p>自定义主题入口将在后续接入，当前先保留同层级占位。</p>
      </section>
    </div>

    <TopicCandidateDrawer
      v-if="topicStore.state.selectedCandidate"
      :candidate="topicStore.state.selectedCandidate"
      :is-confirming="topicStore.state.isConfirming"
      @close="topicStore.closeCandidate"
      @confirm="topicStore.confirmSelectedCandidate"
    />
  </section>
</template>

<style scoped>
.topic-page {
  justify-items: center;
  align-content: start;
}

.topic-workspace {
  position: relative;
  width: min(100%, 1000px);
  margin: 0 auto;
  display: grid;
  gap: 1.5rem;
  background: transparent;
}

.topic-system-shell {
  display: grid;
  gap: 1.5rem;
}

.topic-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 1rem;
  align-items: end;
}

.topic-filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.topic-filter-field {
  min-width: 0;
  display: grid;
  gap: 0.5rem;
}

.topic-filter-field span,
.topic-section-heading p {
  color: var(--workspace-text-muted);
}

.topic-filter-field span {
  font-size: 0.95rem;
}

.topic-filter-field select {
  min-width: 11rem;
  min-height: 2.5rem;
  padding: 0.6rem 0.9rem;
  border: 1px solid var(--workspace-border);
  border-radius: 8px;
  background: rgba(15, 21, 34, 0.86);
  color: var(--workspace-text);
}

.topic-generate-button {
  min-width: 11rem;
  min-height: 2.5rem;
  justify-self: end;
  align-self: end;
  border-radius: 8px;
}

.topic-results-shell,
.topic-history-shell,
.topic-alt-panel {
  display: grid;
  gap: 1rem;
}

.topic-section-copy,
.topic-section-heading,
.topic-history-round,
.topic-alt-panel {
  display: grid;
  gap: 0.5rem;
}

.topic-section-heading h2,
.topic-history-round-header h3,
.topic-alt-panel h2 {
  margin: 0;
}

.topic-section-heading h2 {
  font-size: 1.2rem;
}

.topic-section-heading p,
.topic-results-empty,
.topic-history-empty,
.topic-alt-panel p {
  margin: 0;
  line-height: 1.75;
}

.topic-results-empty,
.topic-history-empty,
.topic-alt-panel p {
  color: var(--workspace-text-muted);
}

.topic-history-shell {
  padding-top: 0.5rem;
  border-top: 1px solid rgba(212, 163, 95, 0.12);
}

.topic-history-rounds {
  display: grid;
  gap: 1rem;
}

.topic-history-round {
  padding-top: 0.75rem;
  border-top: 1px solid rgba(212, 163, 95, 0.08);
}

.topic-alt-panel {
  padding: 1.25rem;
}

@media (max-width: 819px) {
  .topic-toolbar {
    grid-template-columns: 1fr;
  }

  .topic-generate-button {
    justify-self: start;
  }
}

@media (max-width: 639px) {
  .topic-filter-row {
    display: grid;
    grid-template-columns: 1fr;
  }

  .topic-filter-field select {
    min-width: 0;
    width: 100%;
  }
}

.topic-error {
  margin-top: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-left: 3px solid var(--workspace-accent, #c0392b);
  background: rgba(192, 57, 43, 0.08);
  color: var(--workspace-text, #e0d6c8);
  font-size: 0.9rem;
}
</style>
