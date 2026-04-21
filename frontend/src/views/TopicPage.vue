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

      <TopicCandidateList
        :candidates="topicStore.state.candidates"
        @select="topicStore.openCandidate"
      />
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
