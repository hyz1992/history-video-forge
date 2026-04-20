<script setup lang="ts">
import { computed, onMounted } from "vue";

import ScriptDraftPanel from "../components/script/ScriptDraftPanel.vue";
import ScriptHistoryPanel from "../components/script/ScriptHistoryPanel.vue";
import ScriptReviewPanel from "../components/script/ScriptReviewPanel.vue";
import ScriptStatusPanel from "../components/script/ScriptStatusPanel.vue";
import ScriptTracePanel from "../components/script/ScriptTracePanel.vue";
import { useProjectStore } from "../stores/project";
import { useScriptStore } from "../stores/script";

const projectStore = useProjectStore();
const scriptStore = useScriptStore();

const selectedHistoryEntry = computed(() =>
  scriptStore.state.history.find(
    (entry) => entry.entry_id === scriptStore.state.selectedHistoryEntryId,
  ) ?? null,
);

const visibleScript = computed(
  () => selectedHistoryEntry.value?.script ?? scriptStore.state.snapshot?.active_script ?? null,
);

onMounted(async () => {
  await scriptStore.loadActiveScriptSnapshot();
});
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
    <p
      v-else-if="!scriptStore.state.isLoading && !scriptStore.state.loadError"
      data-testid="script-empty"
    >
      暂无 active script snapshot
    </p>
  </section>
</template>
