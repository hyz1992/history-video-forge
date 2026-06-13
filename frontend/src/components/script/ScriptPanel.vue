<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";

import { useScriptStore } from "../../stores/script";
import { useProjectStore } from "../../stores/project";
import { useWorkspaceStore, PIPELINE_STEPS } from "../../stores/workspace";

const scriptStore = useScriptStore();
const workspaceStore = useWorkspaceStore();

const STORYBOARD_STEP_INDEX = PIPELINE_STEPS.findIndex((s) => s.key === "storyboard");
const router = useRouter();
const projectStore = useProjectStore();


onMounted(async () => {
  await scriptStore.loadActiveScriptSnapshot();
  // Auto-start generation when arriving from topic confirmation
  const s = scriptStore.state.snapshot;
  if (
    s &&
    !s.active_script &&
    (s.current_status === "script_pending" || s.current_status === "script_ready")
  ) {
    await scriptStore.generateInitialScript();
    if (!scriptStore.state.loadError) {
      ElMessage.success("文案已生成");
    }
  }
  // If script is still missing and no error, show the CTA
  if (!scriptStore.state.snapshot?.active_script && !scriptStore.state.loadError && !scriptStore.state.isLoading) {
    // Leave empty state visible with the "start generate" button
  }
});

/** Resolve the visible script: selected history entry > active snapshot > fallback from history. */
const visibleScript = computed(() => {
  const selected = scriptStore.state.history.find(
    (entry) => entry.entry_id === scriptStore.state.selectedHistoryEntryId,
  );
  if (selected) return selected.script;

  if (scriptStore.state.snapshot?.active_script) {
    return scriptStore.state.snapshot.active_script;
  }

  if (
    scriptStore.state.snapshot?.current_status === "script_reviewing" ||
    scriptStore.state.snapshot?.current_status === "script_failed"
  ) {
    return scriptStore.state.history[0]?.script ?? null;
  }

  return null;
});

const isGenerating = computed(
  () =>
    !visibleScript.value &&
    scriptStore.state.snapshot?.current_status === "script_generating",
);

const isGenerationFailed = computed(
  () =>
    !visibleScript.value &&
    scriptStore.state.snapshot?.current_status === "script_failed",
);

/** Build a structured list of review checks for display. */
const reviewChecks = computed(() => {
  const s = visibleScript.value;
  if (!s) return [];

  const checks: Array<{ name: string; status: "pass" | "suggest" }> = [];

  if (s.local_validation) {
    checks.push({
      name: "本地校验",
      status: s.local_validation.decision === "pass" ? "pass" : "suggest",
    });
  }

  if (s.semantic_review) {
    checks.push({
      name: "语义审校",
      status: s.semantic_review.decision === "pass" ? "pass" : "suggest",
    });
  }

  return checks;
});

const patchRemaining = computed(() => {
  if (!visibleScript.value) return 0;
  return visibleScript.value.execution_state.patch_used ? 0 : 1;
});

const regenRemaining = computed(() => {
  if (!visibleScript.value) return 0;
  return visibleScript.value.execution_state.regenerate_used ? 0 : 1;
});

const isViewingHistory = computed(() => {
  const entries = scriptStore.state.history;
  if (entries.length === 0) return false;
  return scriptStore.state.selectedHistoryEntryId !== entries[0]?.entry_id;
});

const historyEntries = computed(() =>
  scriptStore.state.history.map((entry) => ({
    entry_id: entry.entry_id,
    label: entry.label,
  })),
);

async function handlePatch() {
  await scriptStore.runPatchOnce();
  if (!scriptStore.state.loadError) {
    ElMessage.success("文案修订完成");
  }
}

async function handleGenerate() {
  await scriptStore.generateInitialScript();
  if (!scriptStore.state.loadError) {
    ElMessage.success("文案已生成");
  }
}

async function handleRegen() {
  await scriptStore.runRegenOnce();
  if (!scriptStore.state.loadError) {
    ElMessage.success("文案重新生成完成");
  }
}

function handleRetry() {
  scriptStore.retryLoadActiveScriptSnapshot();
}

function handleSelectHistory(entryId: string) {
  scriptStore.selectHistoryEntry(entryId);
}

function handleConfirm() {
  ElMessage.success("文案已确认，进入分镜规划");
  workspaceStore.setCurrentStep(STORYBOARD_STEP_INDEX);
  const pid = projectStore.state.projectId; if (pid) router.push(`/projects/${pid}/storyboard`);
}
</script>

<template>
  <div class="script-panel">
    <header class="script-page-header" data-testid="script-page-header">文案工作区</header>
    <div class="script-run-trace" data-testid="script-trace-entry">查看运行详情</div>
    <!-- Error state -->
    <div v-if="scriptStore.state.loadError" class="script-error-card">
      <el-alert
        :title="'加载失败：' + scriptStore.state.loadError"
        type="error"
        show-icon
        :closable="false"
      />
      <el-button
        type="primary"
        :loading="scriptStore.state.isLoading"
        @click="handleRetry"
      >
        重试
      </el-button>
    </div>

    <!-- Loading skeleton -->
    <el-skeleton
      v-else-if="scriptStore.state.isLoading && !visibleScript"
      :rows="6"
      animated
      class="script-skeleton"
    />

    <!-- Generating state -->
    <div v-else-if="isGenerating" class="script-generating">
      <p class="script-generating-title">正在生成文案</p>
      <p class="script-generating-hint">正在调用大模型撰写口播文案，可能需要 1-3 分钟。</p>
      <p class="script-generating-hint">页面会自动刷新，也可手动刷新状态。</p>
      <el-button @click="scriptStore.retryLoadActiveScriptSnapshot()">刷新状态</el-button>
    </div>

    <!-- Generation failed state -->
    <div v-else-if="isGenerationFailed" class="script-failed">
      <p>文案生成失败，请重试或返回选题重新确认。</p>
      <el-button type="primary" @click="handleRetry">重试</el-button>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="
        !visibleScript &&
        !scriptStore.state.isLoading &&
        !scriptStore.state.loadError
      "
      class="script-empty"
    >
      <p>文案尚未生成</p>
      <p class="script-empty-hint">确认选题后将自动生成文案。如果已确认选题但未自动生成，请手动点击下方按钮。</p>
      <el-button
        type="primary"
        :loading="scriptStore.state.isLoading"
        @click="handleGenerate"
      >
        开始生成文案
      </el-button>
    </div>

    <!-- Main two-column layout -->
    <template v-else>
      <div class="script-columns">
        <!-- Left column: Script text display -->
        <div class="script-left-col">
          <div class="script-text-card">
            <div class="script-text-header">
              <h2 class="script-col-heading">文案内容</h2>
              <el-tag
                v-if="isViewingHistory"
                size="small"
                type="warning"
              >
                查看历史版本
              </el-tag>
            </div>

            <!-- Opening section -->
            <div class="script-section">
              <span class="script-section-label">开头</span>
              <p class="script-section-text">{{ visibleScript!.opening_span }}</p>
            </div>

            <!-- Body section -->
            <div class="script-section script-section--body">
              <span class="script-section-label">正文</span>
              <article class="script-section-text script-body-text">
                {{ visibleScript!.script_text }}
              </article>
            </div>

            <!-- Ending section -->
            <div class="script-section">
              <span class="script-section-label">结尾</span>
              <p class="script-section-text">{{ visibleScript!.ending_span }}</p>
            </div>
          </div>

          <!-- History versions -->
          <div v-if="historyEntries.length > 0" class="script-history">
            <h3 class="script-history-heading">历史版本</h3>
            <div class="script-history-list">
              <div
                v-for="entry in historyEntries"
                :key="entry.entry_id"
                class="script-history-item"
                :class="{
                  'script-history-item--active':
                    scriptStore.state.selectedHistoryEntryId === entry.entry_id,
                }"
                @click="handleSelectHistory(entry.entry_id)"
              >
                <span class="script-history-label">{{ entry.label }}</span>
                <el-tag
                  v-if="
                    scriptStore.state.selectedHistoryEntryId === entry.entry_id
                  "
                  size="small"
                  type="info"
                >
                  当前
                </el-tag>
              </div>
            </div>
          </div>
        </div>

        <!-- Right column: Review & Actions -->
        <div class="script-right-col">
          <!-- Review results -->
          <div class="script-review-card">
            <h3 class="script-review-heading">审校结果</h3>
            <div v-if="reviewChecks.length === 0" class="script-review-empty">
              暂无审校数据
            </div>
            <ul v-else class="script-review-list">
              <li
                v-for="check in reviewChecks"
                :key="check.name"
                class="script-review-item"
              >
                <span
                  class="script-review-dot"
                  :class="{
                    'script-review-dot--pass': check.status === 'pass',
                    'script-review-dot--suggest': check.status === 'suggest',
                  }"
                />
                <span class="script-review-name">{{ check.name }}</span>
                <el-tag
                  :type="check.status === 'pass' ? 'success' : 'warning'"
                  size="small"
                >
                  {{ check.status === "pass" ? "通过" : "建议修改" }}
                </el-tag>
              </li>
            </ul>
          </div>

          <!-- Action buttons -->
          <div class="script-actions-card">
            <h3 class="script-actions-heading">操作</h3>
            <div class="script-actions-buttons">
              <el-button
                type="primary"
                :loading="scriptStore.state.isRunningAction"
                :disabled="
                  scriptStore.state.isRunningAction || isViewingHistory
                "
                @click="handlePatch"
              >
                {{ scriptStore.state.isRunningAction ? "处理中..." : "修补一次" }}
              </el-button>

              <el-popconfirm
                title="确定要重新生成文案吗？当前文案将保留在历史版本中。"
                confirm-button-text="确定"
                cancel-button-text="取消"
                :disabled="scriptStore.state.isRunningAction || isViewingHistory"
                @confirm="handleRegen"
              >
                <template #reference>
                  <el-button
                    :loading="scriptStore.state.isRunningAction"
                    :disabled="
                      scriptStore.state.isRunningAction || isViewingHistory
                    "
                  >
                    {{
                      scriptStore.state.isRunningAction
                        ? "处理中..."
                        : "重新生成"
                    }}
                  </el-button>
                </template>
              </el-popconfirm>
            </div>

            <!-- Confirm button -->
            <el-button
              v-if="visibleScript && !isViewingHistory"
              type="primary"
              :disabled="scriptStore.state.isRunningAction"
              @click="handleConfirm"
            >
              确认文案，进入分镜规划
            </el-button>

            <!-- Remaining counts -->
            <div class="script-remaining">
              <el-tag size="small" :type="patchRemaining > 0 ? 'info' : 'danger'">
                剩余修补次数：{{ patchRemaining }}
              </el-tag>
              <el-tag size="small" :type="regenRemaining > 0 ? 'info' : 'danger'">
                剩余重写次数：{{ regenRemaining }}
              </el-tag>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.script-panel {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-lg);
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
}

/* Error card */
.script-error-card {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-md);
  border-radius: var(--radius-card);
  background: var(--bg-card);
}

/* Skeleton */
.script-skeleton {
  padding: var(--space-md);
}

/* Generating / failed / empty */
.script-generating,
.script-failed,
.script-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  padding: var(--space-xl) var(--space-md);
  color: var(--text-secondary);
  text-align: center;
}

/* Two-column layout */
.script-columns {
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: var(--space-lg);
  align-items: start;
}

/* Left column */
.script-left-col {
  display: grid;
  gap: var(--space-md);
}

/* Script text card */
.script-text-card {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-lg);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--bg-card);
}

.script-text-header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.script-col-heading {
  margin: 0;
  font-size: 1.1rem;
  font-weight: var(--font-subheading);
  color: var(--text-heading);
}

/* Sections */
.script-section {
  display: grid;
  gap: var(--space-xs);
  padding-top: var(--space-md);
  border-top: 1px solid var(--border-default);
}

.script-section:first-of-type {
  padding-top: 0;
  border-top: none;
}

.script-section-label {
  font-size: 0.85rem;
  font-weight: var(--font-subheading);
  color: var(--accent-primary);
  letter-spacing: 0.06em;
}

.script-section-text {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.94rem;
  line-height: 1.75;
}

.script-body-text {
  white-space: pre-wrap;
  color: var(--text-body);
  font-size: 0.96rem;
  line-height: 1.85;
}

/* History */
.script-history {
  display: grid;
  gap: var(--space-sm);
  padding: var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--bg-card);
}

.script-history-heading {
  margin: 0;
  font-size: 0.95rem;
  font-weight: var(--font-subheading);
  color: var(--text-heading);
}

.script-history-list {
  display: grid;
  gap: var(--space-xs);
}

.script-history-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--bg-panel);
  cursor: pointer;
  transition:
    border-color 160ms ease,
    background-color 160ms ease;
}

.script-history-item:hover {
  border-color: var(--border-hover);
  background: var(--bg-hover);
}

.script-history-item--active {
  border-color: var(--accent-primary);
  background: var(--bg-hover);
  box-shadow: 0 0 0 1px var(--accent-primary);
}

.script-history-label {
  font-size: 0.88rem;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

/* Right column */
.script-right-col {
  display: grid;
  gap: var(--space-md);
  position: sticky;
  top: var(--space-md);
}

/* Review card */
.script-review-card {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-lg);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--bg-card);
}

.script-review-heading {
  margin: 0;
  font-size: 1.1rem;
  font-weight: var(--font-subheading);
  color: var(--text-heading);
}

.script-review-empty {
  color: var(--text-muted);
  font-size: 0.9rem;
}

.script-review-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-sm);
}

.script-review-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.script-review-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.script-review-dot--pass {
  background: var(--color-success);
}

.script-review-dot--suggest {
  background: var(--color-warning);
}

.script-review-name {
  flex: 1;
  font-size: 0.92rem;
  color: var(--text-body);
}

/* Actions card */
.script-actions-card {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-lg);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--bg-card);
}

.script-actions-heading {
  margin: 0;
  font-size: 1.1rem;
  font-weight: var(--font-subheading);
  color: var(--text-heading);
}

.script-actions-buttons {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

.script-remaining {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
  padding-top: var(--space-sm);
  border-top: 1px solid var(--border-default);
}

/* Responsive */
@media (max-width: 819px) {
  .script-columns {
    grid-template-columns: 1fr;
  }

  .script-right-col {
    position: static;
  }
}
</style>
