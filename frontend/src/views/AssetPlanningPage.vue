<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";

import AssetPlanSummary from "../components/asset-planning/AssetPlanSummary.vue";
import AssetTaskList from "../components/asset-planning/AssetTaskList.vue";
import { useProjectStore } from "../stores/project";
import { useAssetPlanningStore } from "../stores/asset-planning";

const projectStore = useProjectStore();
const assetPlanningStore = useAssetPlanningStore();
const route = useRoute();
const router = useRouter();

const snapshot = computed(() => assetPlanningStore.state.snapshot);

const activePlan = computed(() => snapshot.value?.active_asset_plan?.plan ?? null);

const validationResult = computed(
  () => snapshot.value?.active_asset_plan?.validation_result ?? null,
);

const executionState = computed(
  () => snapshot.value?.active_asset_plan?.execution_state ?? null,
);

const graphTraceSummary = computed(
  () => snapshot.value?.active_asset_plan?.graph_trace_summary ?? null,
);

const runtimeDiagnostics = computed(
  () => snapshot.value?.active_asset_plan?.runtime_diagnostics ?? null,
);

const tasks = computed(() => activePlan.value?.tasks ?? []);

const dependencies = computed(() => activePlan.value?.dependencies ?? []);

const segmentIds = computed(() => {
  const ids = new Set<string>();
  for (const task of tasks.value) {
    if (task.source_segment_id) {
      ids.add(task.source_segment_id);
    }
  }
  return ids;
});

const isGeneratingStatus = computed(
  () => snapshot.value?.current_status === "asset_plan_generating",
);

const isFailedStatus = computed(
  () => snapshot.value?.current_status === "asset_plan_failed",
);

const isReadyStatus = computed(
  () => snapshot.value?.current_status === "asset_plan_ready",
);

onMounted(async () => {
  const projectId = route.params.projectId;
  if (typeof projectId === "string" && projectId && projectStore.state.projectId !== projectId) {
    projectStore.syncProject({
      project_id: projectId,
      current_status: projectStore.state.currentStatus,
    });
  }

  await assetPlanningStore.loadActiveAssetPlanSnapshot();
});

function navigateToStoryboard() {
  const projectId = projectStore.state.projectId;
  if (!projectId) return;
  router.push(`/projects/${projectId}/script`);
}
</script>

<template>
  <section class="asset-planning-page workspace-shell workspace-shell--asset-planning">
    <div class="ap-workspace">
      <!-- Header -->
      <header class="ap-header">
        <div>
          <p class="ap-kicker">Project Workspace</p>
          <h1 data-testid="ap-page-header">资产规划工作区</h1>
          <p class="ap-summary">
            基于 active storyboard 生成 asset plan，包含 art bible、任务列表、依赖关系与成本估算。
          </p>
        </div>

        <button
          type="button"
          data-testid="ap-return-storyboard"
          class="btn btn-secondary"
          @click="navigateToStoryboard"
        >
          返回分镜
        </button>
      </header>

      <!-- Status panel -->
      <section data-testid="ap-status-panel" class="ap-status-panel">
        <div class="ap-status-row">
          <span class="ap-status-label">当前状态</span>
          <span class="ap-status-value" :class="{ 'ap-status-value--ready': isReadyStatus, 'ap-status-value--failed': isFailedStatus, 'ap-status-value--generating': isGeneratingStatus }">
            {{ snapshot?.current_status ?? "unknown" }}
          </span>
        </div>
        <div v-if="assetPlanningStore.state.isLoading" class="ap-status-row">
          <span class="ap-status-label">加载中</span>
          <span class="ap-status-value">...</span>
        </div>
      </section>

      <!-- Load error -->
      <section
        v-if="assetPlanningStore.state.loadError"
        data-testid="ap-load-error"
        class="ap-load-error"
      >
        <p>加载失败：{{ assetPlanningStore.state.loadError }}</p>
        <button
          type="button"
          data-testid="ap-retry-load"
          :disabled="assetPlanningStore.state.isLoading"
          @click="assetPlanningStore.retryLoad"
        >
          {{ assetPlanningStore.state.isLoading ? "正在重试..." : "重试加载" }}
        </button>
      </section>

      <!-- Generate button -->
      <section v-if="!isReadyStatus" data-testid="ap-generate-panel" class="ap-generate-panel">
        <div class="ap-generate-info">
          <h2>生成资产规划</h2>
          <p>基于当前 active storyboard 生成完整的 asset plan。</p>
        </div>
        <button
          type="button"
          data-testid="ap-generate-btn"
          class="btn btn-primary"
          :disabled="assetPlanningStore.state.isGenerating || assetPlanningStore.state.isLoading"
          @click="assetPlanningStore.generateAssetPlan"
        >
          {{ assetPlanningStore.state.isGenerating ? "生成中..." : "开始生成" }}
        </button>
      </section>

      <!-- Generating state -->
      <section
        v-if="isGeneratingStatus && !activePlan"
        data-testid="ap-generating-state"
        class="ap-generating-state"
      >
        <p>正在生成资产规划，请稍候...</p>
      </section>

      <!-- Plan content -->
      <template v-if="activePlan">
        <!-- Art Bible + Summary Cards -->
        <AssetPlanSummary
          :art-bible="activePlan.art_bible"
          :visual-budget="activePlan.visual_budget"
          :downgrade-policy="activePlan.downgrade_policy"
          :global-audio-strategy="activePlan.global_audio_strategy"
          :cost-summary="activePlan.cost_summary"
        />

        <!-- Validation result -->
        <section
          v-if="validationResult"
          data-testid="ap-validation"
          class="ap-validation-panel"
        >
          <h2>校验结果</h2>
          <dl class="ap-validation-dl">
            <div class="ap-validation-row">
              <dt>stage</dt>
              <dd>{{ validationResult.stage }}</dd>
            </div>
            <div class="ap-validation-row">
              <dt>decision</dt>
              <dd :class="{ 'ap-decision--pass': validationResult.decision === 'pass', 'ap-decision--fail': validationResult.decision !== 'pass' }">
                {{ validationResult.decision }}
              </dd>
            </div>
          </dl>

          <div v-if="validationResult.errors && validationResult.errors.length > 0" class="ap-validation-errors">
            <h3>错误</h3>
            <ul>
              <li v-for="(err, idx) in validationResult.errors" :key="idx">{{ err }}</li>
            </ul>
          </div>

          <div v-if="validationResult.warnings && validationResult.warnings.length > 0" class="ap-validation-warnings">
            <h3>警告</h3>
            <ul>
              <li v-for="(warn, idx) in validationResult.warnings" :key="idx">{{ warn }}</li>
            </ul>
          </div>

          <div v-if="validationResult.metrics" class="ap-validation-metrics">
            <h3>指标</h3>
            <dl class="ap-validation-dl">
              <div v-for="(value, key) in validationResult.metrics" :key="key" class="ap-validation-row">
                <dt>{{ key }}</dt>
                <dd>{{ typeof value === "object" ? JSON.stringify(value) : value }}</dd>
              </div>
            </dl>
          </div>
        </section>

        <!-- TTS Plan -->
        <section v-if="activePlan.tts_plan" data-testid="ap-tts-plan" class="ap-tts-panel">
          <h2>TTS 计划</h2>
          <p v-if="activePlan.tts_plan.chunks && activePlan.tts_plan.chunks.length > 0">
            共 {{ activePlan.tts_plan.chunks.length }} 个语音片段
          </p>
          <div v-if="activePlan.tts_plan.chunks && activePlan.tts_plan.chunks.length > 0" class="ap-tts-chunks">
            <div
              v-for="chunk in activePlan.tts_plan.chunks"
              :key="chunk.chunk_id ?? ''"
              class="ap-tts-chunk"
            >
              <span v-if="chunk.chunk_id" class="ap-tts-chunk-id">{{ chunk.chunk_id }}</span>
              <span v-if="chunk.voice_id" class="ap-tts-chunk-voice">voice: {{ chunk.voice_id }}</span>
              <p v-if="chunk.text">{{ chunk.text }}</p>
            </div>
          </div>
          <p v-else class="ap-empty-note">暂无 TTS 片段数据</p>
        </section>

        <!-- Task List -->
        <AssetTaskList
          :tasks="tasks"
          :dependencies="dependencies"
          :segment-ids="segmentIds"
        />

        <!-- Dependencies flat view -->
        <section v-if="dependencies.length > 0" data-testid="ap-dependencies" class="ap-deps-panel">
          <h2>依赖关系</h2>
          <ul class="ap-deps-list">
            <li v-for="dep in dependencies" :key="dep.dependency_id" class="ap-deps-item">
              <span class="ap-deps-task">{{ dep.task_id }}</span>
              <span class="ap-deps-arrow">depends on</span>
              <span class="ap-deps-dep">{{ dep.depends_on_task_id }}</span>
              <span class="ap-deps-type">({{ dep.dependency_type }})</span>
            </li>
          </ul>
        </section>

        <!-- Execution state -->
        <section v-if="executionState" data-testid="ap-exec-state" class="ap-exec-panel">
          <h2>执行状态</h2>
          <dl class="ap-exec-dl">
            <div v-for="(value, key) in executionState" :key="key" class="ap-exec-row">
              <dt>{{ key }}</dt>
              <dd>{{ typeof value === "object" ? JSON.stringify(value) : value }}</dd>
            </div>
          </dl>
        </section>

        <!-- Graph trace summary -->
        <section v-if="graphTraceSummary" data-testid="ap-graph-trace" class="ap-trace-panel">
          <h2>Graph Trace</h2>
          <pre class="ap-trace-pre">{{ JSON.stringify(graphTraceSummary, null, 2) }}</pre>
        </section>

        <!-- Runtime diagnostics -->
        <section v-if="runtimeDiagnostics" data-testid="ap-runtime-diag" class="ap-diag-panel">
          <h2>Runtime Diagnostics</h2>
          <pre class="ap-trace-pre">{{ JSON.stringify(runtimeDiagnostics, null, 2) }}</pre>
        </section>

        <!-- Global production notes -->
        <section
          v-if="activePlan.global_production_notes && activePlan.global_production_notes.length > 0"
          data-testid="ap-production-notes"
          class="ap-notes-panel"
        >
          <h2>全局制作备注</h2>
          <ul class="ap-notes-list">
            <li v-for="(note, idx) in activePlan.global_production_notes" :key="idx">
              {{ note }}
            </li>
          </ul>
        </section>
      </template>

      <!-- Empty state -->
      <p
        v-else-if="!assetPlanningStore.state.isLoading && !assetPlanningStore.state.loadError && !assetPlanningStore.state.isGenerating"
        data-testid="ap-empty"
        class="ap-empty"
      >
        暂无 active asset plan
      </p>
    </div>
  </section>
</template>

<style scoped>
.asset-planning-page {
  justify-items: center;
  align-content: start;
}

.ap-workspace {
  position: relative;
  width: min(100%, 1000px);
  margin: 0 auto;
  display: grid;
  gap: 1.5rem;
  background: transparent;
}

/* Header */
.ap-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.ap-kicker,
.ap-summary {
  margin: 0;
}

.ap-kicker {
  color: #8d6e63;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

/* Status panel */
.ap-status-panel {
  padding: 0.85rem 1rem;
  border: 1px solid var(--workspace-border);
  border-radius: var(--workspace-radius-sm);
  background: rgba(15, 21, 34, 0.86);
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
}

.ap-status-row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.6rem;
  align-items: baseline;
}

.ap-status-label {
  color: var(--workspace-text-muted);
  font-size: 0.9rem;
}

.ap-status-value {
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--workspace-text);
}

.ap-status-value--ready {
  color: #4caf50;
}

.ap-status-value--failed {
  color: var(--workspace-accent-strong);
}

.ap-status-value--generating {
  color: var(--workspace-accent);
}

/* Load error */
.ap-load-error {
  padding: 1rem;
  border: 1px solid rgba(197, 107, 71, 0.3);
  border-radius: var(--workspace-radius-sm);
  background: rgba(197, 107, 71, 0.08);
  display: grid;
  gap: 0.5rem;
}

.ap-load-error p {
  margin: 0;
  color: var(--workspace-accent-strong);
}

/* Generate panel */
.ap-generate-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 1rem;
  align-items: center;
  padding: 1rem;
  border: 1px solid var(--workspace-border);
  border-radius: var(--workspace-radius-sm);
  background: rgba(15, 21, 34, 0.86);
}

.ap-generate-info h2,
.ap-generate-info p {
  margin: 0;
}

.ap-generate-info h2 {
  font-size: 1.1rem;
}

.ap-generate-info p {
  color: var(--workspace-text-muted);
  font-size: 0.92rem;
}

/* Generating state */
.ap-generating-state {
  padding: 1.5rem;
  border: 1px solid var(--workspace-border);
  border-radius: var(--workspace-radius-sm);
  background: rgba(15, 21, 34, 0.86);
  text-align: center;
}

.ap-generating-state p {
  margin: 0;
  color: var(--workspace-accent);
}

/* Validation panel */
.ap-validation-panel {
  padding: 1rem;
  border: 1px solid var(--workspace-border);
  border-radius: var(--workspace-radius-sm);
  background: rgba(15, 21, 34, 0.86);
  display: grid;
  gap: 0.75rem;
}

.ap-validation-panel h2 {
  margin: 0;
  font-size: 1.2rem;
}

.ap-validation-panel h3 {
  margin: 0;
  font-size: 0.95rem;
  color: var(--workspace-text-muted);
}

.ap-validation-dl {
  display: grid;
  gap: 0.35rem;
  margin: 0;
}

.ap-validation-row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.6rem;
  align-items: baseline;
}

.ap-validation-row dt {
  color: var(--workspace-text-muted);
  font-size: 0.88rem;
}

.ap-validation-row dd {
  margin: 0;
  font-size: 0.92rem;
}

.ap-decision--pass {
  color: #4caf50;
}

.ap-decision--fail {
  color: var(--workspace-accent-strong);
}

.ap-validation-errors ul,
.ap-validation-warnings ul {
  margin: 0.25rem 0 0 0;
  padding-left: 1.2rem;
  line-height: 1.65;
  font-size: 0.9rem;
}

.ap-validation-errors li {
  color: var(--workspace-accent-strong);
}

.ap-validation-warnings li {
  color: var(--workspace-accent);
}

.ap-validation-metrics {
  padding-top: 0.5rem;
  border-top: 1px solid rgba(212, 163, 95, 0.08);
}

/* TTS panel */
.ap-tts-panel {
  padding: 1rem;
  border: 1px solid var(--workspace-border);
  border-radius: var(--workspace-radius-sm);
  background: rgba(15, 21, 34, 0.86);
  display: grid;
  gap: 0.75rem;
}

.ap-tts-panel h2 {
  margin: 0;
  font-size: 1.2rem;
}

.ap-tts-panel > p {
  margin: 0;
  color: var(--workspace-text-muted);
  font-size: 0.9rem;
}

.ap-tts-chunks {
  display: grid;
  gap: 0.5rem;
}

.ap-tts-chunk {
  padding: 0.6rem 0.75rem;
  border: 1px solid rgba(212, 163, 95, 0.1);
  border-radius: 6px;
  background: rgba(15, 21, 34, 0.5);
  display: grid;
  gap: 0.3rem;
}

.ap-tts-chunk p {
  margin: 0;
  font-size: 0.9rem;
  color: var(--workspace-text);
  line-height: 1.55;
}

.ap-tts-chunk-id,
.ap-tts-chunk-voice {
  font-size: 0.82rem;
  color: var(--workspace-text-muted);
}

.ap-tts-chunk-id {
  font-weight: 600;
}

.ap-empty-note {
  margin: 0;
  color: var(--workspace-text-muted);
  font-size: 0.9rem;
}

/* Dependencies panel */
.ap-deps-panel {
  padding: 1rem;
  border: 1px solid var(--workspace-border);
  border-radius: var(--workspace-radius-sm);
  background: rgba(15, 21, 34, 0.86);
  display: grid;
  gap: 0.75rem;
}

.ap-deps-panel h2 {
  margin: 0;
  font-size: 1.2rem;
}

.ap-deps-list {
  margin: 0;
  padding-left: 0;
  list-style: none;
  display: grid;
  gap: 0.35rem;
}

.ap-deps-item {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.4rem;
  font-size: 0.9rem;
  line-height: 1.5;
}

.ap-deps-task {
  font-weight: 600;
  color: var(--workspace-text);
}

.ap-deps-arrow {
  color: var(--workspace-text-muted);
}

.ap-deps-dep {
  color: var(--workspace-accent);
}

.ap-deps-type {
  color: var(--workspace-text-muted);
  font-size: 0.84rem;
}

/* Execution state */
.ap-exec-panel {
  padding: 1rem;
  border: 1px solid var(--workspace-border);
  border-radius: var(--workspace-radius-sm);
  background: rgba(15, 21, 34, 0.86);
  display: grid;
  gap: 0.75rem;
}

.ap-exec-panel h2 {
  margin: 0;
  font-size: 1.2rem;
}

.ap-exec-dl {
  display: grid;
  gap: 0.35rem;
  margin: 0;
}

.ap-exec-row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.6rem;
  align-items: baseline;
}

.ap-exec-row dt {
  color: var(--workspace-text-muted);
  font-size: 0.88rem;
}

.ap-exec-row dd {
  margin: 0;
  font-size: 0.92rem;
  word-break: break-word;
}

/* Trace / diagnostics */
.ap-trace-panel,
.ap-diag-panel {
  padding: 1rem;
  border: 1px solid var(--workspace-border);
  border-radius: var(--workspace-radius-sm);
  background: rgba(15, 21, 34, 0.86);
  display: grid;
  gap: 0.5rem;
}

.ap-trace-panel h2,
.ap-diag-panel h2 {
  margin: 0;
  font-size: 1.2rem;
}

.ap-trace-pre {
  margin: 0;
  padding: 0.75rem;
  border-radius: 6px;
  background: rgba(10, 15, 24, 0.8);
  color: var(--workspace-text-muted);
  font-size: 0.82rem;
  line-height: 1.55;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

/* Production notes */
.ap-notes-panel {
  padding: 1rem;
  border: 1px solid var(--workspace-border);
  border-radius: var(--workspace-radius-sm);
  background: rgba(15, 21, 34, 0.86);
  display: grid;
  gap: 0.75rem;
}

.ap-notes-panel h2 {
  margin: 0;
  font-size: 1.2rem;
}

.ap-notes-list {
  margin: 0;
  padding-left: 1.2rem;
  line-height: 1.7;
  font-size: 0.92rem;
  color: var(--workspace-text);
}

/* Empty state */
.ap-empty {
  margin: 0;
  color: var(--workspace-text-muted);
  text-align: center;
  padding: 2rem 0;
}

/* Responsive */
@media (max-width: 819px) {
  .ap-header {
    flex-direction: column;
    gap: 0.75rem;
  }

  .ap-generate-panel {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 639px) {
  .ap-status-panel {
    flex-direction: column;
    gap: 0.75rem;
  }
}
</style>
