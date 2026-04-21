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
</script>

<template>
  <section class="topic-page">
    <header>
      <h1>主题页最小闭环</h1>
      <p data-testid="topic-status">当前状态：{{ projectStore.state.currentStatus }}</p>
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
        v-if="topicStore.state.historyRounds.length > 0"
        data-testid="topic-history"
        class="topic-history-panel"
      >
        <h2>候选历史</h2>

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
