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
  <section class="script-page workspace-shell workspace-shell--script">
    <header class="script-page-header">
      <div>
        <p class="script-kicker">Project Workspace</p>
        <h1 data-testid="script-page-header">文案工作区</h1>
        <p class="script-page-summary">围绕当前文案、风险判断、可执行动作和运行追踪展开审阅。</p>
      </div>

      <button
        type="button"
        data-testid="return-topic"
        @click="requestReturnToTopic"
      >
        返回选题
      </button>
    </header>

    <ScriptStatusPanel
      :current-status="projectStore.state.currentStatus"
      :is-loading="scriptStore.state.isLoading"
      :execution-state="visibleScript?.execution_state ?? null"
    />

    <section data-testid="script-trace-entry" class="script-trace-entry">
      <strong>查看运行详情</strong>
      <span>graph trace 与 runtime diagnostics 会在文案生成后继续补全。</span>
    </section>

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
      <section data-testid="script-action-panel" class="script-action-panel">
        <div>
          <h2>可执行动作</h2>
          <p>保留返回选题、patch_once、regen_once 的最小操作闭环。</p>
        </div>
        <button
          v-if="isReturnTopicConfirmationVisible"
          type="button"
          data-testid="confirm-return-topic"
          @click="confirmReturnToTopic"
        >
          确认返回选题
        </button>
      </section>

      <section data-testid="script-main-panel" class="script-main-panel">
        <div>
          <h2>当前文案</h2>
          <p>当前版本优先展示，必要时可切换历史版本查看。</p>
        </div>
        <ScriptDraftPanel :active-script="visibleScript" />
      </section>

      <section data-testid="script-risk-panel" class="script-risk-panel">
        <h2>风险</h2>
        <p>审校结论：{{ visibleScript.review_decision }}</p>
        <p>补丁意图：{{ visibleScript.patch_intent ?? "无" }}</p>
        <p>
          执行状态：
          patch={{ visibleScript.execution_state?.patch_used ? "已使用" : "未使用" }} /
          regen={{ visibleScript.execution_state?.regenerate_used ? "已使用" : "未使用" }}
        </p>
      </section>

      <section class="script-review-panel-shell">
        <ScriptReviewPanel
          :active-script="visibleScript"
          :is-running-action="scriptStore.state.isRunningAction"
          @patch-once="scriptStore.runPatchOnce"
          @regen-once="scriptStore.runRegenOnce"
        />
      </section>

      <section class="script-trace-shell">
        <div class="script-trace-intro">
          <strong>查看运行详情</strong>
          <span>graph trace 与 runtime diagnostics 在下方展开。</span>
        </div>
        <ScriptTracePanel
          :graph-trace-summary="visibleScript.graph_trace_summary ?? null"
          :runtime-diagnostics="visibleScript.runtime_diagnostics ?? null"
        />
      </section>

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

<style scoped>
.script-page {
  display: grid;
  gap: 1rem;
}

.script-page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.script-kicker,
.script-page-summary {
  margin: 0;
}

.script-kicker {
  color: #8d6e63;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.script-page-body,
.script-main-panel,
.script-risk-panel,
.script-action-panel,
.script-review-panel-shell,
.script-trace-shell {
  display: grid;
  gap: 0.75rem;
}

.script-main-panel,
.script-risk-panel,
.script-action-panel,
.script-review-panel-shell,
.script-trace-shell {
  padding: 1rem;
  border: 1px solid #d7ccc8;
  background: #fffaf5;
}

.script-action-panel {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.script-trace-entry {
  display: grid;
  gap: 0.25rem;
  padding: 1rem;
  border: 1px solid #d7ccc8;
  background: #fff8f2;
}

.script-trace-intro {
  display: grid;
  gap: 0.25rem;
}

@media (max-width: 720px) {
  .script-page-header,
  .script-action-panel {
    grid-template-columns: 1fr;
    display: grid;
  }
}
</style>
