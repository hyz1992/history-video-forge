<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";

import { useAssetPlanningStore } from "../../stores/asset-planning";
import { useWorkspaceStore, PIPELINE_STEPS } from "../../stores/workspace";

const assetPlanningStore = useAssetPlanningStore();
const workspaceStore = useWorkspaceStore();

/* -------------------------------------------------------------------------- */
/*  Computed data from store                                                  */
/* -------------------------------------------------------------------------- */

const snapshot = computed(() => assetPlanningStore.state.snapshot);

const activePlan = computed(
  () => snapshot.value?.active_asset_plan?.plan ?? null,
);

const validationResult = computed(
  () => snapshot.value?.active_asset_plan?.validation_result ?? null,
);

const tasks = computed(() => activePlan.value?.tasks ?? []);

const dependencies = computed(() => activePlan.value?.dependencies ?? []);

const costSummary = computed(() => activePlan.value?.cost_summary ?? null);

/* -------------------------------------------------------------------------- */
/*  Summary card metrics                                                      */
/* -------------------------------------------------------------------------- */

const segmentIds = computed(() => {
  const ids = new Set<string>();
  for (const task of tasks.value) {
    if (task.source_segment_id) {
      ids.add(task.source_segment_id);
    }
  }
  return ids;
});

const totalSegments = computed(() => segmentIds.value.size);

const totalTasks = computed(() => tasks.value.length);

const highRiskTasks = computed(
  () =>
    tasks.value.filter(
      (t) => t.risk_notes && t.risk_notes.length > 0,
    ).length,
);

const estimatedDuration = computed(() => {
  const calls = costSummary.value?.estimated_provider_calls;
  return calls != null ? `~${calls} 次调用` : "-";
});

/* -------------------------------------------------------------------------- */
/*  Validation helpers                                                        */
/* -------------------------------------------------------------------------- */

const hasErrors = computed(
  () => (validationResult.value?.errors?.length ?? 0) > 0,
);

const hasWarnings = computed(
  () => (validationResult.value?.warnings?.length ?? 0) > 0,
);

const validationPassed = computed(
  () => validationResult.value?.decision === "pass",
);

const decisionLabels: Record<string, string> = {
  pass: "通过",
  fail: "未通过",
  pending: "待验证",
};

const validationDecisionLabel = computed(
  () =>
    decisionLabels[validationResult.value?.decision ?? ""] ??
    validationResult.value?.decision ??
    "",
);

/* -------------------------------------------------------------------------- */
/*  Task type / risk level helpers                                            */
/* -------------------------------------------------------------------------- */

const taskTypeLabels: Record<string, string> = {
  image_gen: "图片生成",
  voice_synth: "语音合成",
  bgm: "背景音乐",
  tts: "语音合成",
  sfx: "音效",
};

const taskTypeTagType: Record<string, string> = {
  image_gen: "",
  voice_synth: "warning",
  bgm: "success",
  tts: "warning",
  sfx: "info",
};

function getTaskTypeLabel(taskType: string): string {
  return taskTypeLabels[taskType] ?? taskType;
}

function getTaskTypeTagType(taskType: string): string {
  return taskTypeTagType[taskType] ?? "info";
}

function getRiskLevel(
  task: (typeof tasks.value)[number],
): "high" | "medium" | "none" {
  if (task.risk_notes && task.risk_notes.length >= 2) return "high";
  if (task.risk_notes && task.risk_notes.length === 1) return "medium";
  return "none";
}

const riskLevelLabels: Record<string, string> = {
  high: "高风险",
  medium: "中风险",
  none: "正常",
};

const riskLevelTagType: Record<string, string> = {
  high: "danger",
  medium: "warning",
  none: "success",
};

/* -------------------------------------------------------------------------- */
/*  Dependency map                                                            */
/* -------------------------------------------------------------------------- */

const depMap = computed(() => {
  const map = new Map<string, string[]>();
  for (const dep of dependencies.value) {
    const list = map.get(dep.task_id) ?? [];
    list.push(dep.depends_on_task_id);
    map.set(dep.task_id, list);
  }
  return map;
});

/* -------------------------------------------------------------------------- */
/*  Collapse / expand task rows                                               */
/* -------------------------------------------------------------------------- */

const expandedTasks = ref<Set<string>>(new Set());

function toggleTaskExpand(taskId: string) {
  const next = new Set(expandedTasks.value);
  if (next.has(taskId)) {
    next.delete(taskId);
  } else {
    next.add(taskId);
  }
  expandedTasks.value = next;
}

function isTaskExpanded(taskId: string): boolean {
  return expandedTasks.value.has(taskId);
}

/* -------------------------------------------------------------------------- */
/*  Pipeline step indices for navigation                                      */
/* -------------------------------------------------------------------------- */

const ASSET_STEP_INDEX = PIPELINE_STEPS.findIndex((s) => s.key === "asset");

/* -------------------------------------------------------------------------- */
/*  Lifecycle                                                                 */
/* -------------------------------------------------------------------------- */

onMounted(async () => {
  await assetPlanningStore.loadActiveAssetPlanSnapshot();
});

/* -------------------------------------------------------------------------- */
/*  Actions                                                                   */
/* -------------------------------------------------------------------------- */

async function handleGenerate() {
  await assetPlanningStore.generateAssetPlan();
  if (!assetPlanningStore.state.loadError) {
    ElMessage.success("资产规划生成完成");
  }
}

function handleRetry() {
  assetPlanningStore.retryLoad();
}

function handleConfirm() {
  workspaceStore.setCurrentStep(ASSET_STEP_INDEX);
}
</script>

<template>
  <div class="ap-panel">
    <!-- Error state -->
    <div v-if="assetPlanningStore.state.loadError" class="ap-error-card">
      <el-alert
        :title="'加载失败：' + assetPlanningStore.state.loadError"
        type="error"
        show-icon
        :closable="false"
      />
      <el-button
        type="primary"
        :loading="assetPlanningStore.state.isLoading"
        @click="handleRetry"
      >
        重试
      </el-button>
    </div>

    <!-- Loading skeleton -->
    <el-skeleton
      v-else-if="assetPlanningStore.state.isLoading && !activePlan"
      :rows="8"
      animated
      class="ap-skeleton"
    />

    <!-- Generating state -->
    <div
      v-else-if="assetPlanningStore.state.isGenerating && !activePlan"
      class="ap-generating"
    >
      <p>正在生成资产规划，请稍候...</p>
    </div>

    <!-- Empty state - no plan generated yet -->
    <div
      v-else-if="
        !activePlan &&
        !assetPlanningStore.state.isLoading &&
        !assetPlanningStore.state.loadError
      "
      class="ap-empty"
    >
      <p>暂无资产规划数据</p>
      <el-button
        type="primary"
        :loading="assetPlanningStore.state.isGenerating"
        :disabled="assetPlanningStore.state.isGenerating"
        @click="handleGenerate"
      >
        {{
          assetPlanningStore.state.isGenerating ? "生成中..." : "开始生成规划"
        }}
      </el-button>
    </div>

    <!-- Main content -->
    <template v-else>
      <!-- Summary cards (4-column grid) -->
      <div class="ap-summary-grid">
        <div class="ap-stat-card">
          <span class="ap-stat-value">{{ totalSegments }}</span>
          <span class="ap-stat-label">段落数</span>
        </div>
        <div class="ap-stat-card">
          <span class="ap-stat-value">{{ totalTasks }}</span>
          <span class="ap-stat-label">任务总数</span>
        </div>
        <div class="ap-stat-card">
          <span class="ap-stat-value ap-stat-value--risk">
            {{ highRiskTasks }}
          </span>
          <span class="ap-stat-label">高风险项</span>
        </div>
        <div class="ap-stat-card">
          <span class="ap-stat-value">{{ estimatedDuration }}</span>
          <span class="ap-stat-label">预估工作量</span>
        </div>
      </div>

      <!-- Validation results card -->
      <div v-if="validationResult" class="ap-validation-card">
        <h3 class="ap-card-heading">验证结果</h3>

        <div class="ap-validation-row">
          <div class="ap-validation-field">
            <span class="ap-validation-label">判断</span>
            <el-tag
              :type="validationPassed ? 'success' : 'danger'"
              size="small"
            >
              {{ validationDecisionLabel }}
            </el-tag>
          </div>
          <div
            v-if="validationResult.stage"
            class="ap-validation-field"
          >
            <span class="ap-validation-label">阶段</span>
            <span class="ap-validation-value">
              {{ validationResult.stage }}
            </span>
          </div>
        </div>

        <!-- Errors -->
        <div v-if="hasErrors" class="ap-validation-block">
          <h4 class="ap-validation-block-heading">错误</h4>
          <ul class="ap-validation-list ap-validation-list--errors">
            <li
              v-for="(error, index) in validationResult.errors"
              :key="index"
            >
              {{ error }}
            </li>
          </ul>
        </div>

        <!-- Warnings -->
        <div v-if="hasWarnings" class="ap-validation-block">
          <h4 class="ap-validation-block-heading">警告</h4>
          <ul class="ap-validation-list ap-validation-list--warnings">
            <li
              v-for="(warning, index) in validationResult.warnings"
              :key="index"
            >
              {{ warning }}
            </li>
          </ul>
        </div>

        <!-- Metrics (collapsible) -->
        <details
          v-if="
            validationResult.metrics &&
            Object.keys(validationResult.metrics).length > 0
          "
        >
          <summary class="ap-metrics-toggle">查看指标</summary>
          <pre class="ap-pre">{{
            JSON.stringify(validationResult.metrics, null, 2)
          }}</pre>
        </details>
      </div>

      <!-- Task list -->
      <div v-if="tasks.length > 0" class="ap-tasks-section">
        <div class="ap-tasks-header">
          <h3 class="ap-card-heading">任务列表</h3>
          <span class="ap-tasks-count">共 {{ tasks.length }} 个任务</span>
        </div>

        <div class="ap-task-list">
          <article
            v-for="task in tasks"
            :key="task.task_id"
            class="ap-task-card"
          >
            <!-- Task row: segment | description | type | risk -->
            <div class="ap-task-row" @click="toggleTaskExpand(task.task_id)">
              <!-- Source segment -->
              <div class="ap-task-segment">
                <span class="ap-task-segment-label">段落</span>
                <span class="ap-task-segment-id">
                  {{ task.source_segment_id || "-" }}
                </span>
              </div>

              <!-- Task description -->
              <div class="ap-task-desc">
                <span class="ap-task-id">{{ task.task_id }}</span>
                <span class="ap-task-intent">
                  {{ task.production_intent || "-" }}
                </span>
              </div>

              <!-- Task type -->
              <div class="ap-task-type-cell">
                <el-tag
                  :type="getTaskTypeTagType(task.task_type)"
                  size="small"
                >
                  {{ getTaskTypeLabel(task.task_type) }}
                </el-tag>
              </div>

              <!-- Risk level -->
              <div class="ap-task-risk-cell">
                <el-tag
                  :type="riskLevelTagType[getRiskLevel(task)]"
                  size="small"
                >
                  {{ riskLevelLabels[getRiskLevel(task)] }}
                </el-tag>
              </div>

              <!-- Expand indicator -->
              <span class="ap-task-expand-icon">
                {{ isTaskExpanded(task.task_id) ? "▾" : "▸" }}
              </span>
            </div>

            <!-- Expanded detail -->
            <div
              v-if="isTaskExpanded(task.task_id)"
              class="ap-task-detail"
            >
              <!-- Prompt draft -->
              <div
                v-if="task.prompt_draft"
                class="ap-task-detail-block"
              >
                <h4 class="ap-task-detail-heading">Prompt 草稿</h4>
                <p class="ap-task-detail-text">{{ task.prompt_draft }}</p>
              </div>

              <!-- Parameters -->
              <div
                v-if="
                  task.parameters &&
                  Object.keys(task.parameters).length > 0
                "
                class="ap-task-detail-block"
              >
                <h4 class="ap-task-detail-heading">参数</h4>
                <div class="ap-task-detail-params">
                  <el-tag
                    v-for="(value, key) in task.parameters"
                    :key="key"
                    size="small"
                    type="info"
                    class="ap-param-tag"
                  >
                    {{ key }}:
                    {{
                      typeof value === "object"
                        ? JSON.stringify(value)
                        : value
                    }}
                  </el-tag>
                </div>
              </div>

              <!-- Risk notes -->
              <div
                v-if="task.risk_notes && task.risk_notes.length > 0"
                class="ap-task-detail-block"
              >
                <h4 class="ap-task-detail-heading">风险备注</h4>
                <ul class="ap-task-risk-notes">
                  <li
                    v-for="(note, idx) in task.risk_notes"
                    :key="idx"
                  >
                    {{ note }}
                  </li>
                </ul>
              </div>

              <!-- Dependencies -->
              <div
                v-if="depMap.get(task.task_id)?.length"
                class="ap-task-detail-block"
              >
                <h4 class="ap-task-detail-heading">依赖</h4>
                <div class="ap-task-deps">
                  <el-tag
                    v-for="depId in depMap.get(task.task_id)"
                    :key="depId"
                    size="small"
                    type="warning"
                    class="ap-dep-tag"
                  >
                    {{ depId }}
                  </el-tag>
                </div>
              </div>

              <!-- Extra fields -->
              <div
                v-if="task.recommended_mode || task.cost_tier"
                class="ap-task-detail-block"
              >
                <div class="ap-task-meta-row">
                  <span
                    v-if="task.recommended_mode"
                    class="ap-task-meta-item"
                  >
                    <span class="ap-task-meta-label">推荐模式</span>
                    <span>{{ task.recommended_mode }}</span>
                  </span>
                  <span v-if="task.cost_tier" class="ap-task-meta-item">
                    <span class="ap-task-meta-label">成本档位</span>
                    <el-tag size="small">{{ task.cost_tier }}</el-tag>
                  </span>
                </div>
              </div>
            </div>
          </article>
        </div>
      </div>

      <!-- Action buttons -->
      <div class="ap-actions-card">
        <div class="ap-actions-left">
          <el-button
            type="primary"
            :disabled="assetPlanningStore.state.isGenerating"
            @click="handleConfirm"
          >
            确认规划
          </el-button>

          <el-popconfirm
            title="确定要重新生成资产规划吗？"
            confirm-button-text="确定"
            cancel-button-text="取消"
            :disabled="assetPlanningStore.state.isGenerating"
            @confirm="handleGenerate"
          >
            <template #reference>
              <el-button
                :loading="assetPlanningStore.state.isGenerating"
                :disabled="assetPlanningStore.state.isGenerating"
              >
                {{
                  assetPlanningStore.state.isGenerating
                    ? "生成中..."
                    : "重新生成"
                }}
              </el-button>
            </template>
          </el-popconfirm>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ap-panel {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-lg);
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
}

/* ---- Error card ---- */
.ap-error-card {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-md);
  border-radius: var(--radius-card);
  background: var(--bg-card);
}

/* ---- Skeleton ---- */
.ap-skeleton {
  padding: var(--space-md);
}

/* ---- Generating / Empty ---- */
.ap-generating,
.ap-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  padding: var(--space-xl) var(--space-md);
  color: var(--text-secondary);
  text-align: center;
}

/* ---- Summary stat cards ---- */
.ap-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-md);
}

.ap-stat-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: var(--space-md) var(--space-lg);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--bg-card);
  align-items: center;
  justify-content: center;
}

.ap-stat-value {
  font-size: 1.5rem;
  font-weight: var(--font-heading);
  color: var(--text-heading);
  font-variant-numeric: tabular-nums;
}

.ap-stat-value--risk {
  color: var(--color-danger);
}

.ap-stat-label {
  font-size: 0.85rem;
  color: var(--text-muted);
}

/* ---- Validation card ---- */
.ap-validation-card {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-lg);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--bg-card);
}

.ap-card-heading {
  margin: 0;
  font-size: 1.1rem;
  font-weight: var(--font-subheading);
  color: var(--text-heading);
}

.ap-validation-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-lg);
}

.ap-validation-field {
  display: grid;
  gap: var(--space-xs);
}

.ap-validation-label {
  font-size: 0.85rem;
  color: var(--text-muted);
}

.ap-validation-value {
  font-size: 0.92rem;
  color: var(--text-body);
}

.ap-validation-block {
  display: grid;
  gap: var(--space-xs);
}

.ap-validation-block-heading {
  margin: 0;
  font-size: 0.9rem;
  font-weight: var(--font-subheading);
  color: var(--text-secondary);
}

.ap-validation-list {
  margin: 0;
  padding-left: 1.25rem;
}

.ap-validation-list--errors li {
  color: var(--color-danger);
  line-height: 1.65;
}

.ap-validation-list--warnings li {
  color: var(--color-warning);
  line-height: 1.65;
}

.ap-metrics-toggle {
  cursor: pointer;
  color: var(--text-muted);
  font-size: 0.9rem;
  font-weight: 500;
  list-style: none;
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.ap-metrics-toggle::before {
  content: "\25b8";
  font-size: 0.8rem;
  transition: transform 150ms ease;
}

details[open] > .ap-metrics-toggle::before {
  transform: rotate(90deg);
}

.ap-pre {
  margin: var(--space-sm) 0 0;
  padding: var(--space-sm);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-panel);
  color: var(--text-muted);
  font-size: 0.85rem;
  line-height: 1.55;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ---- Task list section ---- */
.ap-tasks-section {
  display: grid;
  gap: var(--space-md);
}

.ap-tasks-header {
  display: flex;
  align-items: baseline;
  gap: var(--space-sm);
}

.ap-tasks-count {
  font-size: 0.88rem;
  color: var(--text-muted);
}

.ap-task-list {
  display: grid;
  gap: var(--space-sm);
}

/* ---- Task card ---- */
.ap-task-card {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--bg-card);
  overflow: hidden;
  transition: border-color 160ms ease;
}

.ap-task-card:hover {
  border-color: var(--border-hover);
}

.ap-task-row {
  display: grid;
  grid-template-columns: 140px 1fr 120px 100px 32px;
  gap: var(--space-md);
  padding: var(--space-md);
  align-items: center;
  cursor: pointer;
  user-select: none;
}

.ap-task-segment {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ap-task-segment-label {
  font-size: 0.78rem;
  color: var(--text-muted);
}

.ap-task-segment-id {
  font-size: 0.88rem;
  color: var(--accent-text);
  font-weight: var(--font-subheading);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ap-task-desc {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ap-task-id {
  font-size: 0.88rem;
  font-weight: var(--font-subheading);
  color: var(--text-heading);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ap-task-intent {
  font-size: 0.84rem;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ap-task-type-cell,
.ap-task-risk-cell {
  display: flex;
  justify-content: center;
}

.ap-task-expand-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 0.85rem;
}

/* ---- Task expanded detail ---- */
.ap-task-detail {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-md);
  padding-top: 0;
  border-top: 1px solid var(--border-default);
  margin: 0 var(--space-md) var(--space-md);
}

.ap-task-detail-block {
  display: grid;
  gap: var(--space-xs);
}

.ap-task-detail-heading {
  margin: 0;
  font-size: 0.84rem;
  font-weight: var(--font-subheading);
  color: var(--text-muted);
}

.ap-task-detail-text {
  margin: 0;
  font-size: 0.9rem;
  color: var(--text-body);
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.ap-task-detail-params {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}

.ap-param-tag {
  font-size: 0.78rem;
}

.ap-task-risk-notes {
  margin: 0;
  padding-left: 1.1rem;
  list-style: disc;
  color: var(--color-danger);
  font-size: 0.88rem;
  line-height: 1.6;
}

.ap-task-deps {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}

.ap-dep-tag {
  font-size: 0.78rem;
}

.ap-task-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-lg);
}

.ap-task-meta-item {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: 0.88rem;
  color: var(--text-body);
}

.ap-task-meta-label {
  color: var(--text-muted);
  font-size: 0.84rem;
}

/* ---- Action buttons ---- */
.ap-actions-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--bg-card);
}

.ap-actions-left {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

/* ---- Responsive ---- */
@media (max-width: 819px) {
  .ap-summary-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .ap-task-row {
    grid-template-columns: 1fr;
    gap: var(--space-sm);
  }

  .ap-task-type-cell,
  .ap-task-risk-cell {
    justify-content: flex-start;
  }

  .ap-task-expand-icon {
    display: none;
  }

  .ap-actions-card {
    flex-direction: column;
    gap: var(--space-sm);
    align-items: stretch;
  }

  .ap-actions-left {
    flex-direction: column;
  }
}

@media (max-width: 480px) {
  .ap-summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>
