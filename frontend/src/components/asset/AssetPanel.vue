<script setup lang="ts">
import { computed, onMounted } from "vue";
import { ElMessage } from "element-plus";

import { useStoryboardStore } from "../../stores/storyboard";
import { useAssetPlanningStore } from "../../stores/asset-planning";
import { useProjectStore } from "../../stores/project";
import { useWorkspaceStore } from "../../stores/workspace";
import { PIPELINE_STEPS } from "../../stores/workspace";

import SegmentAssetCard from "./SegmentAssetCard.vue";

const storyboardStore = useStoryboardStore();
const assetPlanningStore = useAssetPlanningStore();
const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();

/* -------------------------------------------------------------------------- */
/*  Computed data from stores                                                 */
/* -------------------------------------------------------------------------- */

const activeStoryboard = computed(
  () => storyboardStore.state.snapshot?.active_storyboard ?? null,
);

const segments = computed(
  () => activeStoryboard.value?.plan?.segments ?? [],
);

const activeAssetPlan = computed(
  () => assetPlanningStore.state.snapshot?.active_asset_plan ?? null,
);

const plan = computed(() => activeAssetPlan.value?.plan ?? null);

const assetTasks = computed(() => plan.value?.tasks ?? []);

const currentStatus = computed(
  () => projectStore.state.currentStatus,
);

const isAssetReady = computed(
  () => currentStatus.value === "asset_plan_ready" ||
    currentStatus.value === "asset_ready" ||
    currentStatus.value?.startsWith("asset"),
);

const COMPOSE_STEP_INDEX = PIPELINE_STEPS.findIndex(
  (s) => s.key === "compose",
);

/* -------------------------------------------------------------------------- */
/*  Global info                                                               */
/* -------------------------------------------------------------------------- */

const voiceProfile = computed(
  () => plan.value?.tts_plan?.voice_profile_id ?? null,
);

const artBible = computed(() => plan.value?.art_bible ?? null);

const bgmPolicy = computed(() => {
  const strategy = plan.value?.global_audio_strategy;
  if (!strategy || typeof strategy !== "object") return null;
  return (strategy as Record<string, unknown>).bgm_cue_policy as string ?? null;
});

const globalNotes = computed(
  () => plan.value?.global_production_notes ?? [],
);

const hasGlobalInfo = computed(
  () => !!(voiceProfile.value || artBible.value?.era_style || bgmPolicy.value || globalNotes.value.length),
);

/* -------------------------------------------------------------------------- */
/*  Group tasks by segment                                                    */
/* -------------------------------------------------------------------------- */

const imageTasksBySegment = computed(() => {
  const map = new Map<string, typeof assetTasks.value>();
  for (const task of assetTasks.value) {
    if (task.task_type === "image_still" && task.source_segment_id) {
      const list = map.get(task.source_segment_id) ?? [];
      list.push(task);
      map.set(task.source_segment_id, list);
    }
  }
  return map;
});

const videoTasksBySegment = computed(() => {
  const map = new Map<string, typeof assetTasks.value>();
  for (const task of assetTasks.value) {
    if (task.task_type === "video_clip" && task.source_segment_id) {
      const list = map.get(task.source_segment_id) ?? [];
      list.push(task);
      map.set(task.source_segment_id, list);
    }
  }
  return map;
});

const segmentCount = computed(() => segments.value.length);

/* -------------------------------------------------------------------------- */
/*  Lifecycle                                                                 */
/* -------------------------------------------------------------------------- */

onMounted(async () => {
  await storyboardStore.loadActiveStoryboardSnapshot();
  await assetPlanningStore.loadActiveAssetPlanSnapshot();
});

/* -------------------------------------------------------------------------- */
/*  Actions                                                                   */
/* -------------------------------------------------------------------------- */

async function handleGeneratePlan() {
  await assetPlanningStore.generateAssetPlan();
  if (!assetPlanningStore.state.loadError) {
    ElMessage.success("资产规划生成完成");
  }
}

function handleRetry() {
  assetPlanningStore.retryLoad();
}

function handleConfirm() {
  workspaceStore.setCurrentStep(COMPOSE_STEP_INDEX);
}

function handleGenerateTask(taskId: string) {
  ElMessage.info(`生成任务 ${taskId}`);
}

function handleRegenerateTask(taskId: string) {
  ElMessage.info(`重新生成任务 ${taskId}`);
}

function handleUploadAsset(taskId: string) {
  ElMessage.info(`上传资产 ${taskId}`);
}
</script>

<template>
  <div class="asset-panel">
    <!-- Error state -->
    <div v-if="assetPlanningStore.state.loadError" class="asset-error-card">
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
      v-else-if="assetPlanningStore.state.isLoading && !activeAssetPlan"
      :rows="6"
      animated
      class="asset-skeleton"
    />

    <!-- Generating state -->
    <div
      v-else-if="assetPlanningStore.state.isGenerating && !activeAssetPlan"
      class="asset-generating"
    >
      <p>正在生成资产规划，请稍候...</p>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="
        !activeAssetPlan &&
        !assetPlanningStore.state.isLoading &&
        !assetPlanningStore.state.loadError
      "
      class="asset-empty"
    >
      <p>暂无资产规划数据</p>
      <el-button
        type="primary"
        :loading="assetPlanningStore.state.isGenerating"
        :disabled="assetPlanningStore.state.isGenerating"
        @click="handleGeneratePlan"
      >
        {{ assetPlanningStore.state.isGenerating ? "生成中..." : "开始生成资产规划" }}
      </el-button>
    </div>

    <!-- Main content -->
    <template v-else>
      <!-- Global settings (collapsible) -->
      <details v-if="hasGlobalInfo" class="asset-global-settings">
        <summary class="asset-global-toggle">全局设置</summary>
        <div class="asset-global-grid">
          <div v-if="voiceProfile" class="asset-global-field">
            <span class="asset-global-label">口播音色</span>
            <span class="asset-global-value">{{ voiceProfile }}</span>
          </div>
          <div v-if="artBible?.era_style" class="asset-global-field">
            <span class="asset-global-label">时代风格</span>
            <span class="asset-global-value">{{ artBible.era_style }}</span>
          </div>
          <div v-if="artBible?.visual_tone" class="asset-global-field">
            <span class="asset-global-label">视觉基调</span>
            <span class="asset-global-value">{{ artBible.visual_tone }}</span>
          </div>
          <div v-if="bgmPolicy" class="asset-global-field">
            <span class="asset-global-label">BGM 策略</span>
            <span class="asset-global-value">{{ bgmPolicy }}</span>
          </div>
          <div v-if="globalNotes.length" class="asset-global-field asset-global-field--full">
            <span class="asset-global-label">制作说明</span>
            <ul class="asset-global-notes">
              <li v-for="(note, i) in globalNotes" :key="i">{{ note }}</li>
            </ul>
          </div>
        </div>
      </details>

      <!-- Segment count -->
      <div class="asset-segments-header">
        <span class="asset-segments-count">共 {{ segmentCount }} 个镜头</span>
      </div>

      <!-- Segment cards -->
      <div v-if="segments.length > 0" class="asset-segments">
        <SegmentAssetCard
          v-for="(segment, index) in segments"
          :key="segment.segment_id"
          :segment="segment"
          :segment-index="index"
          :image-tasks="imageTasksBySegment.get(segment.segment_id) ?? []"
          :video-tasks="videoTasksBySegment.get(segment.segment_id) ?? []"
          @generate-task="handleGenerateTask"
          @regenerate-task="handleRegenerateTask"
          @upload-asset="handleUploadAsset"
        />
      </div>

      <!-- Action buttons -->
      <div class="asset-actions-card">
        <div class="asset-actions-left">
          <el-button
            type="primary"
            :disabled="!isAssetReady"
            @click="handleConfirm"
          >
            确认并下一步
          </el-button>

          <el-popconfirm
            title="确定要重新生成资产规划吗？"
            confirm-button-text="确定"
            cancel-button-text="取消"
            :disabled="assetPlanningStore.state.isGenerating"
            @confirm="handleGeneratePlan"
          >
            <template #reference>
              <el-button
                :loading="assetPlanningStore.state.isGenerating"
                :disabled="assetPlanningStore.state.isGenerating"
              >
                {{ assetPlanningStore.state.isGenerating ? "生成中..." : "重新生成规划" }}
              </el-button>
            </template>
          </el-popconfirm>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.asset-panel {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-lg);
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
}

/* ---- Error / Loading / Empty ---- */
.asset-error-card {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-md);
  border-radius: var(--radius-card);
  background: var(--bg-card);
}

.asset-skeleton {
  padding: var(--space-md);
}

.asset-generating,
.asset-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  padding: var(--space-xl) var(--space-md);
  color: var(--text-secondary);
  text-align: center;
}

/* ---- Global settings (collapsible) ---- */
.asset-global-settings {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--bg-card);
  overflow: hidden;
}

.asset-global-toggle {
  cursor: pointer;
  padding: var(--space-md);
  font-size: 0.92rem;
  font-weight: var(--font-subheading);
  color: var(--text-heading);
  list-style: none;
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  user-select: none;
}

.asset-global-toggle::before {
  content: "▸";
  font-size: 0.8rem;
  transition: transform 150ms ease;
}

details[open] > .asset-global-toggle {
  border-bottom: 1px solid var(--border-default);
}

details[open] > .asset-global-toggle::before {
  transform: rotate(90deg);
}

.asset-global-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-md);
  padding: var(--space-md);
}

.asset-global-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.asset-global-field--full {
  grid-column: 1 / -1;
}

.asset-global-label {
  font-size: 0.78rem;
  color: var(--text-muted);
}

.asset-global-value {
  font-size: 0.88rem;
  color: var(--text-body);
  line-height: 1.5;
}

.asset-global-notes {
  margin: 0;
  padding-left: 1rem;
  font-size: 0.84rem;
  color: var(--text-secondary);
  line-height: 1.6;
}

/* ---- Segments header ---- */
.asset-segments-header {
  display: flex;
  align-items: baseline;
}

.asset-segments-count {
  font-size: 0.88rem;
  color: var(--text-muted);
}

/* ---- Segment cards ---- */
.asset-segments {
  display: grid;
  gap: var(--space-sm);
}

/* ---- Action buttons ---- */
.asset-actions-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--bg-card);
}

.asset-actions-left {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

/* ---- Responsive ---- */
@media (max-width: 599px) {
  .asset-global-grid {
    grid-template-columns: 1fr;
  }

  .asset-actions-card {
    flex-direction: column;
    gap: var(--space-sm);
    align-items: stretch;
  }

  .asset-actions-left {
    flex-direction: column;
  }
}
</style>
