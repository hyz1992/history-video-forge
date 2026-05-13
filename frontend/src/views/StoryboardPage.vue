<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import StoryboardSegmentList from "../components/storyboard/StoryboardSegmentList.vue";
import { useProjectStore } from "../stores/project";
import { useStoryboardStore } from "../stores/storyboard";

const projectStore = useProjectStore();
const storyboardStore = useStoryboardStore();
const route = useRoute();
const router = useRouter();

const currentStatus = computed(
  () => storyboardStore.state.snapshot?.current_status ?? null,
);

const activeStoryboard = computed(
  () => storyboardStore.state.snapshot?.active_storyboard ?? null,
);

const segments = computed(
  () => activeStoryboard.value?.plan?.segments ?? [],
);

const validationResult = computed(
  () => activeStoryboard.value?.validation_result ?? null,
);

const executionState = computed(
  () => activeStoryboard.value?.execution_state ?? null,
);

const graphTraceSummary = computed(
  () => activeStoryboard.value?.graph_trace_summary ?? null,
);

const runtimeDiagnostics = computed(
  () => activeStoryboard.value?.runtime_diagnostics ?? null,
);

const hasErrors = computed(
  () => validationResult.value?.errors?.length > 0,
);

const hasWarnings = computed(
  () => validationResult.value?.warnings?.length > 0,
);

onMounted(async () => {
  const projectId = route.params.projectId;
  if (typeof projectId !== "string" || !projectId) {
    return;
  }

  if (projectStore.state.projectId !== projectId) {
    projectStore.syncProject({
      project_id: projectId,
      current_status: "storyboard_ready",
    });
  }

  await storyboardStore.loadActiveStoryboardSnapshot();
});

watch(
  () =>
    [projectStore.state.projectId, projectStore.state.currentStatus] as const,
  async ([projectId, currentStatus]) => {
    if (!projectId) {
      return;
    }

    if (currentStatus === "asset_plan_ready") {
      const nextPath = `/projects/${projectId}/asset-plan`;
      if (router.currentRoute.value.path !== nextPath) {
        await router.push(nextPath);
      }
    }
  },
);

function goBackToScript() {
  const projectId = projectStore.state.projectId;
  if (!projectId) {
    return;
  }
  router.push(`/projects/${projectId}/script`);
}
</script>

<template>
  <section class="storyboard-page workspace-shell workspace-shell--storyboard">
    <div class="storyboard-workspace">
      <header class="storyboard-page-header">
        <div>
          <p class="storyboard-kicker">Project Workspace</p>
          <h1 data-testid="storyboard-page-header">分镜规划工作区</h1>
          <p class="storyboard-page-summary">
            基于文案生成分镜规划，查看验证结果与分段详情。
          </p>
        </div>

        <button
          type="button"
          data-testid="return-script"
          class="btn btn-secondary"
          @click="goBackToScript"
        >
          返回文案
        </button>
      </header>

      <section
        data-testid="storyboard-status-panel"
        class="storyboard-panel"
      >
        <h2>状态</h2>
        <div class="storyboard-status-row">
          <span
            v-if="currentStatus"
            class="workspace-badge"
            data-testid="storyboard-current-status"
          >
            {{ currentStatus }}
          </span>
          <span
            v-if="storyboardStore.state.isLoading"
            class="storyboard-loading-hint"
            data-testid="storyboard-loading"
          >
            加载中...
          </span>
        </div>
      </section>

      <section
        v-if="storyboardStore.state.loadError"
        data-testid="storyboard-load-error"
        class="storyboard-panel storyboard-error-panel"
      >
        <p>加载失败：{{ storyboardStore.state.loadError }}</p>
        <button
          type="button"
          data-testid="retry-load"
          class="btn btn-secondary"
          :disabled="storyboardStore.state.isLoading"
          @click="storyboardStore.retryLoad"
        >
          {{ storyboardStore.state.isLoading ? "正在重试..." : "重试加载" }}
        </button>
      </section>

      <section
        v-if="!activeStoryboard && !storyboardStore.state.isLoading"
        data-testid="storyboard-generate-panel"
        class="storyboard-panel"
      >
        <div>
          <h2>生成分镜规划</h2>
          <p>基于当前文案自动生成包含分段、视觉意图和场景描述的分镜规划。</p>
        </div>
        <button
          type="button"
          data-testid="generate-storyboard"
          class="btn btn-primary storyboard-generate-button"
          :disabled="storyboardStore.state.isGenerating"
          @click="storyboardStore.generateStoryboard"
        >
          {{ storyboardStore.state.isGenerating ? "生成中..." : "开始生成分镜" }}
        </button>
      </section>

      <section
        v-if="storyboardStore.state.isGenerating"
        data-testid="storyboard-generating"
        class="storyboard-panel storyboard-generating-panel"
      >
        <p>正在生成分镜规划，请稍候...</p>
      </section>

      <template v-if="activeStoryboard">
        <section
          v-if="validationResult"
          data-testid="storyboard-validation"
          class="storyboard-panel"
        >
          <h2>验证结果</h2>
          <div class="storyboard-validation-grid">
            <div class="storyboard-validation-field">
              <span class="storyboard-validation-label">判断</span>
              <span
                class="workspace-badge"
                :class="{
                  'badge--pass': validationResult.decision === 'pass',
                  'badge--fail': validationResult.decision !== 'pass',
                }"
              >
                {{ validationResult.decision }}
              </span>
            </div>
            <div class="storyboard-validation-field">
              <span class="storyboard-validation-label">阶段</span>
              <span>{{ validationResult.stage }}</span>
            </div>
          </div>

          <div v-if="hasErrors" class="storyboard-validation-errors">
            <h3>错误</h3>
            <ul>
              <li
                v-for="(error, index) in validationResult.errors"
                :key="index"
              >
                {{ error }}
              </li>
            </ul>
          </div>

          <div v-if="hasWarnings" class="storyboard-validation-warnings">
            <h3>警告</h3>
            <ul>
              <li
                v-for="(warning, index) in validationResult.warnings"
                :key="index"
              >
                {{ warning }}
              </li>
            </ul>
          </div>

          <div v-if="validationResult.metrics" class="storyboard-validation-metrics">
            <h3>指标</h3>
            <pre class="storyboard-pre">{{ JSON.stringify(validationResult.metrics, null, 2) }}</pre>
          </div>
        </section>

        <section
          v-if="segments.length > 0"
          data-testid="storyboard-segments"
          class="storyboard-panel"
        >
          <div>
            <h2>分镜段落</h2>
            <p>共 {{ segments.length }} 个段落。</p>
          </div>
          <StoryboardSegmentList :segments="segments" />
        </section>

        <section
          v-if="executionState"
          data-testid="storyboard-execution-state"
          class="storyboard-panel"
        >
          <h2>执行状态</h2>
          <pre class="storyboard-pre">{{ JSON.stringify(executionState, null, 2) }}</pre>
        </section>

        <section
          v-if="graphTraceSummary || runtimeDiagnostics"
          data-testid="storyboard-trace"
          class="storyboard-panel"
        >
          <h2>运行追踪</h2>
          <div v-if="graphTraceSummary" class="storyboard-trace-section">
            <h3>Graph Trace</h3>
            <pre class="storyboard-pre">{{ JSON.stringify(graphTraceSummary, null, 2) }}</pre>
          </div>
          <div v-if="runtimeDiagnostics" class="storyboard-trace-section">
            <h3>Runtime Diagnostics</h3>
            <pre class="storyboard-pre">{{ JSON.stringify(runtimeDiagnostics, null, 2) }}</pre>
          </div>
        </section>

        <section class="storyboard-panel storyboard-regenerate-panel">
          <div>
            <h2>重新生成</h2>
            <p>如需重新生成当前分镜规划，可再次执行。</p>
          </div>
          <button
            type="button"
            data-testid="regenerate-storyboard"
            class="btn btn-primary"
            :disabled="storyboardStore.state.isGenerating"
            @click="storyboardStore.generateStoryboard"
          >
            {{ storyboardStore.state.isGenerating ? "生成中..." : "重新生成分镜" }}
          </button>
        </section>
      </template>

      <p
        v-else-if="
          !storyboardStore.state.isGenerating &&
          !storyboardStore.state.isLoading &&
          !storyboardStore.state.loadError
        "
        data-testid="storyboard-empty"
        class="storyboard-empty-hint"
      >
        暂无分镜规划数据。
      </p>
    </div>
  </section>
</template>

<style scoped>
.storyboard-page {
  justify-items: center;
  align-content: start;
}

.storyboard-workspace {
  position: relative;
  width: min(100%, 1000px);
  margin: 0 auto;
  display: grid;
  gap: 1.5rem;
  background: transparent;
}

.storyboard-page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.storyboard-kicker,
.storyboard-page-summary {
  margin: 0;
}

.storyboard-kicker {
  color: #8d6e63;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.storyboard-page-summary {
  color: var(--workspace-text-muted);
  line-height: 1.75;
}

.storyboard-panel {
  display: grid;
  gap: 0.75rem;
  padding: 1.25rem;
  border: 1px solid var(--workspace-border);
  border-radius: var(--workspace-radius-md);
  background: rgba(15, 21, 34, 0.86);
}

.storyboard-panel h2 {
  margin: 0;
  font-size: 1.15rem;
  color: var(--workspace-text);
}

.storyboard-panel h3 {
  margin: 0;
  font-size: 0.95rem;
  color: var(--workspace-text-muted);
}

.storyboard-panel p {
  margin: 0;
  line-height: 1.75;
  color: var(--workspace-text-muted);
}

.storyboard-status-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.storyboard-loading-hint {
  color: var(--workspace-text-soft);
  font-size: 0.9rem;
}

.storyboard-error-panel {
  border-color: rgba(192, 57, 43, 0.4);
}

.storyboard-error-panel p {
  color: #e57373;
}

.storyboard-generate-button {
  min-width: 11rem;
  min-height: 2.5rem;
  justify-self: start;
  border-radius: 8px;
}

.storyboard-generating-panel p {
  color: var(--workspace-accent);
}

.storyboard-validation-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 1.25rem;
}

.storyboard-validation-field {
  display: grid;
  gap: 0.3rem;
}

.storyboard-validation-label {
  font-size: 0.85rem;
  color: var(--workspace-text-muted);
}

.badge--pass {
  border-color: rgba(76, 175, 80, 0.36);
  color: #81c784;
}

.badge--fail {
  border-color: rgba(239, 83, 80, 0.36);
  color: #e57373;
}

.storyboard-validation-errors,
.storyboard-validation-warnings,
.storyboard-validation-metrics {
  display: grid;
  gap: 0.4rem;
}

.storyboard-validation-errors ul,
.storyboard-validation-warnings ul {
  margin: 0;
  padding-left: 1.25rem;
}

.storyboard-validation-errors li {
  color: #e57373;
  line-height: 1.65;
}

.storyboard-validation-warnings li {
  color: #ffb74d;
  line-height: 1.65;
}

.storyboard-pre {
  margin: 0;
  padding: 0.75rem;
  border: 1px solid var(--workspace-border);
  border-radius: var(--workspace-radius-sm);
  background: rgba(10, 15, 24, 0.7);
  color: var(--workspace-text-muted);
  font-size: 0.85rem;
  line-height: 1.55;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.storyboard-trace-section {
  display: grid;
  gap: 0.4rem;
}

.storyboard-regenerate-panel {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.storyboard-empty-hint {
  margin: 0;
  color: var(--workspace-text-muted);
  line-height: 1.75;
}

@media (max-width: 819px) {
  .storyboard-page-header {
    flex-direction: column;
  }

  .storyboard-regenerate-panel {
    grid-template-columns: 1fr;
  }
}
</style>
