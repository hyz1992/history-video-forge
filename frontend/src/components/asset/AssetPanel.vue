<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";

import { useStoryboardStore } from "../../stores/storyboard";
import { useAssetPlanningStore } from "../../stores/asset-planning";
import { useAssetsStore } from "../../stores/assets";
import { useProjectStore } from "../../stores/project";
import { useWorkspaceStore } from "../../stores/workspace";
import { PIPELINE_STEPS } from "../../stores/workspace";

import SegmentAssetCard from "./SegmentAssetCard.vue";

const storyboardStore = useStoryboardStore();
const assetPlanningStore = useAssetPlanningStore();
const assetsStore = useAssetsStore();
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

const manifest = computed(() => assetsStore.state.snapshot?.active_assets?.manifest ?? null);
const readiness = computed(() => manifest.value?.readiness ?? null);
const executions = computed(() => manifest.value?.executions ?? []);
const artifacts = computed(() => manifest.value?.artifacts ?? []);
const segmentRoutes = computed(() => manifest.value?.segment_routes ?? []);

const hasManifest = computed(() => !!manifest.value);

const projectId = computed(() => projectStore.state.projectId ?? "");

const COMPOSE_STEP_INDEX = PIPELINE_STEPS.findIndex(
  (s) => s.key === "compose",
);
const router = useRouter();

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
/*  Manifest lookups for SegmentAssetCard                                     */
/* -------------------------------------------------------------------------- */

const executionsByTaskId = computed(() => {
  const map = new Map<string, { task_id: string; status: string; output_artifact_ids: string[] }>();
  for (const exec of executions.value) {
    map.set(exec.task_id, exec);
  }
  return map;
});

const artifactsById = computed(() => {
  const map = new Map<string, { artifact_id: string; artifact_type: string; file_uri: string; metadata: Record<string, unknown> }>();
  for (const art of artifacts.value) {
    map.set(art.artifact_id, art);
  }
  return map;
});

/* -------------------------------------------------------------------------- */
/*  Execution stats                                                           */
/* -------------------------------------------------------------------------- */

const executionStats = computed(() => {
  const stats = { completed: 0, waiting: 0, running: 0, failed: 0, total: 0 };
  for (const exec of executions.value) {
    stats.total++;
    if (exec.status === "completed" || exec.status === "accepted") stats.completed++;
    else if (exec.status === "waiting_manual_upload") stats.waiting++;
    else if (exec.status === "running") stats.running++;
    else if (exec.status === "failed") stats.failed++;
  }
  return stats;
});

/* -------------------------------------------------------------------------- */
/*  Lifecycle                                                                 */
/* -------------------------------------------------------------------------- */

onMounted(async () => {
  await storyboardStore.loadActiveStoryboardSnapshot();
  await assetPlanningStore.loadActiveAssetPlanSnapshot();
  await assetsStore.loadProject();
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

async function handleGenerateSemiAuto() {
  await assetsStore.generateAssets({ enabledProviderTypes: ["tts", "sfx", "bgm"] });
  if (!assetsStore.state.loadError) {
    ElMessage.success("资产生成完成（图片/视频需手动上传）");
  }
}

async function handleGenerateFull() {
  if (hasManifest.value) {
    try {
      await ElMessageBox.confirm(
        "重新生成将覆盖所有已有产物（包括已上传的文件），确定继续？",
        "确认重新生成",
        { confirmButtonText: "确定重建", cancelButtonText: "取消", type: "warning" },
      );
    } catch {
      return;
    }
  }
  await assetsStore.generateAssets({});
  if (!assetsStore.state.loadError) {
    ElMessage.success("全部资产生成完成");
  }
}

function handleUploadFile(taskId: string, file: File) {
  assetsStore.uploadArtifact(taskId, file);
}

function handleRetry() {
  assetPlanningStore.retryLoad();
  assetsStore.loadProject();
}

function handleConfirm() {
  if (readiness.value !== "ready_for_compose") {
    ElMessage.warning("资产尚未全部就绪");
    return;
  }
  ElMessage.success("资产确认完成，进入合成阶段");
  workspaceStore.setCurrentStep(COMPOSE_STEP_INDEX);
  const pid = projectStore.state.projectId; if (pid) router.push(`/projects/${pid}/compose`);
}
</script>

<template>
  <div class="asset-panel">
    <!-- Error -->
    <div v-if="assetsStore.state.loadError" class="asset-error-card">
      <el-alert
        :title="'加载失败：' + assetsStore.state.loadError"
        type="error"
        show-icon
        :closable="false"
      />
      <el-button
        type="primary"
        :loading="assetsStore.state.isLoading"
        @click="handleRetry"
      >
        重试
      </el-button>
    </div>

    <!-- Loading skeleton -->
    <el-skeleton
      v-else-if="assetsStore.state.isLoading && !hasManifest"
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

    <!-- Stage 1: no plan → generate plan -->
    <div
      v-else-if="!activeAssetPlan && !hasManifest"
      class="asset-empty"
    >
      <p>暂无资产规划数据</p>
      <el-button
        type="primary"
        :loading="assetPlanningStore.state.isGenerating"
        @click="handleGeneratePlan"
      >
        {{ assetPlanningStore.state.isGenerating ? "生成中..." : "开始生成资产规划" }}
      </el-button>
    </div>

    <!-- Stage 2/3: has plan → generate buttons + task list -->
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

      <!-- Generate action bar -->
      <div class="asset-generate-bar">
        <div class="asset-generate-actions">
          <el-button
            v-if="!hasManifest"
            type="primary"
            :loading="assetsStore.state.isGenerating"
            @click="handleGenerateSemiAuto"
          >
            {{ assetsStore.state.isGenerating ? "生成中..." : "生成资产（手动上传图片/视频）" }}
          </el-button>
          <el-button
            v-if="!hasManifest"
            :loading="assetsStore.state.isGenerating"
            @click="handleGenerateFull"
          >
            {{ assetsStore.state.isGenerating ? "生成中..." : "全部自动生成" }}
          </el-button>
          <el-popconfirm
            v-if="hasManifest"
            title="重新生成将覆盖所有已有产物，确定继续？"
            @confirm="handleGenerateFull"
          >
            <template #reference>
              <el-button :loading="assetsStore.state.isGenerating">
                {{ assetsStore.state.isGenerating ? "生成中..." : "重新生成" }}
              </el-button>
            </template>
          </el-popconfirm>
        </div>

        <!-- Execution stats -->
        <div v-if="hasManifest" class="asset-stats">
          <el-tag type="success" size="small">完成 {{ executionStats.completed }}</el-tag>
          <el-tag v-if="executionStats.waiting > 0" type="warning" size="small">待上传 {{ executionStats.waiting }}</el-tag>
          <el-tag v-if="executionStats.running > 0" type="info" size="small">生成中 {{ executionStats.running }}</el-tag>
          <el-tag v-if="executionStats.failed > 0" type="danger" size="small">失败 {{ executionStats.failed }}</el-tag>
        </div>
      </div>

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
          :executions-by-task-id="executionsByTaskId"
          :artifacts-by-id="artifactsById"
          :uploading-task-id="assetsStore.state.isUploading"
          :project-id="projectId"
          @upload-file="handleUploadFile"
        />
      </div>

      <!-- Confirm next step -->
      <div class="asset-actions-card">
        <el-button
          type="primary"
          :disabled="readiness !== 'ready_for_compose'"
          @click="handleConfirm"
        >
          确认并进入合成
        </el-button>
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

/* ---- Generate bar ---- */
.asset-generate-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--bg-card);
  flex-wrap: wrap;
  gap: var(--space-sm);
}

.asset-generate-actions {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

.asset-stats {
  display: flex;
  gap: var(--space-xs);
  align-items: center;
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

/* ---- Responsive ---- */
@media (max-width: 599px) {
  .asset-global-grid {
    grid-template-columns: 1fr;
  }

  .asset-generate-bar {
    flex-direction: column;
    align-items: stretch;
  }

  .asset-actions-card {
    flex-direction: column;
    gap: var(--space-sm);
    align-items: stretch;
  }

  .asset-generate-actions {
    flex-direction: column;
  }
}
</style>
