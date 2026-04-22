<script setup lang="ts">
import { onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import TopicCandidateDrawer from "../components/topic/TopicCandidateDrawer.vue";
import TopicCandidateList from "../components/topic/TopicCandidateList.vue";
import TopicTabs from "../components/topic/TopicTabs.vue";
import { useProjectStore } from "../stores/project";
import { useTopicStore } from "../stores/topic";

const projectStore = useProjectStore();
const topicStore = useTopicStore();
const route = useRoute();
const router = useRouter();

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
  async (status) => {
    const [projectId, currentStatus] = status;
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
</script>

<template>
  <section class="topic-page workspace-shell workspace-shell--topic">
    <header class="topic-page-header">
      <div>
        <p class="topic-kicker">Project Workspace</p>
        <h1 data-testid="topic-page-header">选题工作区</h1>
        <p data-testid="topic-status">当前状态：{{ projectStore.state.currentStatus }}</p>
      </div>

      <section data-testid="topic-summary" class="topic-summary-panel">
        <h2>多轮候选</h2>
        <p>当前轮与候选历史拆开展示，支持从任意轮确认主题。</p>
      </section>
    </header>

    <TopicTabs
      :active-tab="topicStore.state.activeTab"
      @update:active-tab="topicStore.selectTab"
    />

    <div v-if="topicStore.state.activeTab === 'system'" data-testid="panel-system">
      <button
        data-testid="system-generate"
        type="button"
        :disabled="topicStore.state.isGenerating"
        @click="topicStore.generateSystemRecommendations"
      >
        {{ topicStore.state.isGenerating ? "生成中..." : "开始生成选题" }}
      </button>

      <section
        v-if="topicStore.state.currentRound"
        data-testid="current-topic-round"
        class="topic-round-panel"
      >
        <h2>当前轮</h2>
        <p class="topic-panel-caption">优先查看本轮结果，必要时再回看历史轮。</p>
        <TopicCandidateList
          :candidates="topicStore.state.currentRound.candidates"
          @select="(candidate) => topicStore.openCandidate(candidate, topicStore.state.currentRound?.round_id)"
        />
      </section>

      <TopicCandidateList
        v-else
        :candidates="topicStore.state.candidates"
        @select="topicStore.openCandidate"
      />

      <section
        data-testid="topic-history"
        class="topic-history-panel"
      >
        <h2>候选历史</h2>
        <p class="topic-panel-caption">保留之前轮次，支持从历史轮直接确认。</p>

        <template v-if="topicStore.state.historyRounds.length > 0">
          <article
            v-for="round in topicStore.state.historyRounds"
            :key="round.round_id"
            class="topic-history-round"
          >
            <h3>第 {{ round.round_index ?? "-" }} 轮</h3>

            <button
              v-for="candidate in round.candidates"
              :key="candidate.candidate_id"
              :data-testid="`history-candidate-${candidate.candidate_id}`"
              type="button"
              class="topic-history-candidate"
              @click="topicStore.openCandidate(candidate, round.round_id)"
            >
              <strong>{{ candidate.title }}</strong>
              <span>{{ candidate.one_line_angle }}</span>
            </button>
          </article>
        </template>

        <p
          v-else
          data-testid="topic-history-empty"
          class="topic-history-empty"
        >
          暂无历史轮次，生成新一轮后会在这里保留历史候选。
        </p>
      </section>
    </div>

    <div v-else-if="topicStore.state.activeTab === 'library'" data-testid="panel-library">
      事件库入口
    </div>

    <div v-else data-testid="panel-custom">自定义主题入口</div>

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
  display: grid;
  gap: 1rem;
}

.topic-page-header {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(16rem, 1fr);
  gap: 1rem;
}

.topic-kicker,
.topic-panel-caption {
  margin: 0;
}

.topic-kicker {
  color: #8d6e63;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.topic-summary-panel,
.topic-round-panel,
.topic-history-panel {
  display: grid;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid #d7ccc8;
  background: #fffaf5;
}

.topic-history-round {
  display: grid;
  gap: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid #efebe9;
}

.topic-history-candidate {
  display: grid;
  gap: 0.25rem;
  text-align: left;
}

.topic-history-empty {
  margin: 0;
}

@media (max-width: 720px) {
  .topic-page-header {
    grid-template-columns: 1fr;
  }
}
</style>
