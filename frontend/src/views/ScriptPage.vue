<script setup lang="ts">
import { onMounted } from "vue";

import ScriptDraftPanel from "../components/script/ScriptDraftPanel.vue";
import ScriptReviewPanel from "../components/script/ScriptReviewPanel.vue";
import ScriptStatusPanel from "../components/script/ScriptStatusPanel.vue";
import { useProjectStore } from "../stores/project";
import { useScriptStore } from "../stores/script";

const projectStore = useProjectStore();
const scriptStore = useScriptStore();

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
      :execution-state="scriptStore.state.snapshot?.active_script?.execution_state ?? null"
    />

    <div v-if="scriptStore.state.snapshot?.active_script" class="script-page-body">
      <ScriptDraftPanel :active-script="scriptStore.state.snapshot.active_script" />
      <ScriptReviewPanel
        :active-script="scriptStore.state.snapshot.active_script"
        :is-running-action="scriptStore.state.isRunningAction"
        @patch-once="scriptStore.runPatchOnce"
        @regen-once="scriptStore.runRegenOnce"
      />
    </div>
    <p v-else data-testid="script-empty">暂无 active script snapshot</p>
  </section>
</template>
