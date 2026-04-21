<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import ScriptDraftPanel from "../components/script/ScriptDraftPanel.vue";
import ScriptHistoryPanel from "../components/script/ScriptHistoryPanel.vue";
import ScriptReviewPanel from "../components/script/ScriptReviewPanel.vue";
import ScriptStatusPanel from "../components/script/ScriptStatusPanel.vue";
import ScriptTracePanel from "../components/script/ScriptTracePanel.vue";
import { useProjectStore } from "../stores/project";
import { useScriptStore } from "../stores/script";

const projectStore = useProjectStore();
const scriptStore = useScriptStore();
const route = useRoute();
const router = useRouter();
const isReturnTopicConfirmationVisible = ref(false);

const selectedHistoryEntry = computed(() =>
  scriptStore.state.history.find(
    (entry) => entry.entry_id === scriptStore.state.selectedHistoryEntryId,
  ) ?? null,
);

const visibleScript = computed(
  () =>
    selectedHistoryEntry.value?.script ??
    scriptStore.state.snapshot?.active_script ??
    ((scriptStore.state.snapshot?.current_status === "script_reviewing" ||
      scriptStore.state.snapshot?.current_status === "script_failed")
      ? scriptStore.state.history[0]?.script ?? null
      : null),
);

const isInitialGenerationPending = computed(() =>
  !visibleScript.value &&
  scriptStore.state.snapshot?.current_status === "script_generating",
);

const isInitialGenerationFailed = computed(() =>
  !visibleScript.value &&
  scriptStore.state.snapshot?.current_status === "script_failed",
);

onMounted(async () => {
  const projectId = route.params.projectId;
  if (typeof projectId === "string" && projectId && projectStore.state.projectId !== projectId) {
    projectStore.syncProject({
      project_id: projectId,
      current_status: "script_ready",
    });
  }

  await scriptStore.loadActiveScriptSnapshot();

  if (
    !scriptStore.state.snapshot?.active_script &&
    scriptStore.state.snapshot?.current_status === "script_ready"
  ) {
    await scriptStore.generateInitialScript();
  }
});

function requestReturnToTopic() {
  isReturnTopicConfirmationVisible.value = true;
}

async function confirmReturnToTopic() {
  const projectId = projectStore.state.projectId;
  if (!projectId) {
    return;
  }

  isReturnTopicConfirmationVisible.value = false;
  await router.push(`/projects/${projectId}/topic`);
}
</script>

<template>
  <section class="script-page">
    <header>
      <h1>脚本页最小闭环</h1>
    </header>

    <ScriptStatusPanel
      :current-status="projectStore.state.currentStatus"
      :is-loading="scriptStore.state.isLoading"
      :execution-state="visibleScript?.execution_state ?? null"
    />

    <section
      v-if="scriptStore.state.loadError"
      class="script-load-error"
      data-testid="script-load-error"
    >
      <p>加载失败：{{ scriptStore.state.loadError }}</p>
      <button
        type="button"
        data-testid="retry-load"
        :disabled="scriptStore.state.isLoading"
        @click="scriptStore.retryLoadActiveScriptSnapshot"
      >
        {{ scriptStore.state.isLoading ? "正在重试..." : "重试加载" }}
      </button>
    </section>

    <div v-if="visibleScript" class="script-page-body">
      <section class="script-actions">
        <button
          type="button"
          data-testid="return-topic"
          @click="requestReturnToTopic"
        >
          返回选题
        </button>
        <button
          v-if="isReturnTopicConfirmationVisible"
          type="button"
          data-testid="confirm-return-topic"
          @click="confirmReturnToTopic"
        >
          确认返回选题
        </button>
      </section>
      <ScriptDraftPanel :active-script="visibleScript" />
      <ScriptReviewPanel
        :active-script="visibleScript"
        :is-running-action="scriptStore.state.isRunningAction"
        @patch-once="scriptStore.runPatchOnce"
        @regen-once="scriptStore.runRegenOnce"
      />
      <ScriptTracePanel
        :graph-trace-summary="visibleScript.graph_trace_summary ?? null"
        :runtime-diagnostics="visibleScript.runtime_diagnostics ?? null"
      />
      <ScriptHistoryPanel
        :entries="
          scriptStore.state.history.map((entry) => ({
            entry_id: entry.entry_id,
            label: entry.label,
          }))
        "
        :selected-entry-id="scriptStore.state.selectedHistoryEntryId"
        @restore-history="scriptStore.selectHistoryEntry"
      />
    </div>
    <section
      v-else-if="isInitialGenerationPending"
      data-testid="script-running-state"
      class="script-running-state"
    >
      <p>正在生成文案，请稍候。</p>
    </section>

    <section
      v-else-if="isInitialGenerationFailed"
      data-testid="script-failed-state"
      class="script-failed-state"
    >
      <p>生成失败，请重试或返回选题重新确认。</p>
    </section>

    <p
      v-else-if="!scriptStore.state.isLoading && !scriptStore.state.loadError"
      data-testid="script-empty"
    >
      暂无 active script snapshot
    </p>
  </section>
</template>
