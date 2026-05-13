<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import ScriptDraftPanel from "../components/script/ScriptDraftPanel.vue";
import ScriptHistoryPanel from "../components/script/ScriptHistoryPanel.vue";
import ScriptReviewPanel from "../components/script/ScriptReviewPanel.vue";
import ScriptStatusPanel from "../components/script/ScriptStatusPanel.vue";
import ScriptTracePanel from "../components/script/ScriptTracePanel.vue";
import TopicTabs from "../components/topic/TopicTabs.vue";
import { useProjectStore } from "../stores/project";
import { useScriptStore } from "../stores/script";

const projectStore = useProjectStore();
const scriptStore = useScriptStore();
const route = useRoute();
const router = useRouter();
const isReturnTopicConfirmationVisible = ref(false);

const reviewDecisionLabels: Record<string, string> = {
  pass: "通过",
  patch_once: "需修订",
  regen_once: "需重写",
  return_topic: "需返回选题",
};

const patchIntentLabels: Record<string, string> = {
  fix: "修正问题",
  lift: "提升质量",
};

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

const canNavigateToStoryboard = computed(() =>
  projectStore.state.currentStatus === "script_ready" ||
  projectStore.state.currentStatus === "storyboard_ready" ||
  projectStore.state.currentStatus?.startsWith("asset_plan"),
);

async function navigateToStoryboard() {
  const projectId = projectStore.state.projectId;
  if (!projectId) return;
  await router.push(`/projects/${projectId}/storyboard`);
}

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
    <TopicTabs :show-entry-tabs="false" />

    <header class="script-page-header">
      <div>
        <p class="script-kicker">Project Workspace</p>
        <h1 data-testid="script-page-header">文案工作区</h1>
        <p class="script-page-summary">围绕当前文案、风险判断、可执行动作和运行追踪展开审阅。</p>
      </div>

      <div class="script-header-actions">
        <button
          type="button"
          class="btn btn-secondary"
          data-testid="return-topic"
          @click="requestReturnToTopic"
        >
          返回选题
        </button>
        <button
          v-if="canNavigateToStoryboard"
          type="button"
          class="btn btn-primary"
          data-testid="navigate-storyboard"
          @click="navigateToStoryboard"
        >
          进入分镜规划
        </button>
      </div>
    </header>

    <ScriptStatusPanel
      :current-status="projectStore.state.currentStatus"
      :is-loading="scriptStore.state.isLoading"
      :execution-state="visibleScript?.execution_state ?? null"
    />

    <details data-testid="script-trace-entry" class="script-trace-entry">
      <summary class="script-trace-summary">执行追踪与诊断信息</summary>
      <span>文案生成完成后，执行追踪与诊断信息将在此处补全。</span>
    </details>

    <section
      v-if="scriptStore.state.loadError"
      class="script-load-error"
      data-testid="script-load-error"
    >
      <p>加载失败：{{ scriptStore.state.loadError }}</p>
      <button
        type="button"
        class="btn btn-secondary"
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
          <p>可对当前文案进行修订、重写或返回选题重新选择。</p>
        </div>
        <button
          v-if="isReturnTopicConfirmationVisible"
          type="button"
          class="btn btn-secondary"
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
        <h2>审校结论</h2>
        <p>结论：{{ reviewDecisionLabels[visibleScript.review_decision] ?? visibleScript.review_decision }}</p>
        <p>修订方向：{{ visibleScript.patch_intent ? (patchIntentLabels[visibleScript.patch_intent] ?? visibleScript.patch_intent) : "无" }}</p>
        <p>
          修订状态：{{ visibleScript.execution_state?.patch_used ? "已使用" : "未使用" }}　重写状态：{{ visibleScript.execution_state?.regenerate_used ? "已使用" : "未使用" }}
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

      <details class="script-trace-shell">
        <summary class="script-trace-summary">执行追踪与诊断信息</summary>
        <ScriptTracePanel
          :graph-trace-summary="visibleScript.graph_trace_summary ?? null"
          :runtime-diagnostics="visibleScript.runtime_diagnostics ?? null"
        />
      </details>

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
      暂无文案快照
    </p>
  </section>
</template>

<style scoped>
.script-page {
  display: grid;
  gap: 1.5rem;
}

.script-page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.script-header-actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

.script-kicker,
.script-page-summary {
  margin: 0;
}

.script-kicker {
  color: var(--workspace-text-soft);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.script-page-summary {
  color: var(--workspace-text-muted);
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
  border: 1px solid var(--workspace-border);
  background: var(--workspace-bg-panel);
}

.script-action-panel {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.script-trace-entry {
  padding: 1rem;
  border: 1px solid var(--workspace-border);
  background: var(--workspace-bg-panel);
}

.script-trace-summary {
  cursor: pointer;
  color: var(--workspace-text-muted);
  font-size: 0.95rem;
  font-weight: 500;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.script-trace-summary::before {
  content: "▸";
  font-size: 0.8rem;
  transition: transform 150ms ease;
}

details[open] > .script-trace-summary::before {
  transform: rotate(90deg);
}

.script-trace-shell {
  padding: 1rem;
  border: 1px solid var(--workspace-border);
  background: var(--workspace-bg-panel);
}

.script-trace-shell[open] {
  display: grid;
  gap: 0.75rem;
}

.script-load-error {
  padding: 0.75rem 1rem;
  border-left: 3px solid var(--workspace-accent-strong, #c0392b);
  background: rgba(192, 57, 43, 0.08);
  color: var(--workspace-text);
  display: grid;
  gap: 0.5rem;
}

.script-running-state,
.script-failed-state {
  padding: 1.25rem;
  text-align: center;
  color: var(--workspace-text-muted);
}

@media (max-width: 819px) {
  .script-page-header,
  .script-action-panel {
    grid-template-columns: 1fr;
    display: grid;
  }

  .script-header-actions {
    justify-content: flex-start;
  }
}

@media (max-width: 639px) {
  .script-header-actions {
    flex-direction: column;
    width: 100%;
  }

  .script-header-actions .btn {
    width: 100%;
  }
}
</style>
