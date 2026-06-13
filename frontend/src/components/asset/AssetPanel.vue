<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";

import { useStoryboardStore } from "../../stores/storyboard";
import { useAssetPlanningStore } from "../../stores/asset-planning";
import { useAssetsStore } from "../../stores/assets";
import { useProjectStore } from "../../stores/project";
import { useWorkspaceStore } from "../../stores/workspace";
import { PIPELINE_STEPS } from "../../stores/workspace";

import SegmentAssetCard from "./SegmentAssetCard.vue";
import { computeCostBreakdown, normalizeVideoDurationForPricing } from "../../utils/pricing";

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

/* Partial readiness (warnings only, e.g. optional BGM missing)
 *  should still allow composing.  Only blocked (errors) prevents it. */
const canCompose = computed(() => {
  const r = readiness.value;
  return r === "ready_for_compose" || r === "partial";
});

/** Pre-generation cost estimate from the asset plan. */
const estimatedCost = computed(() => {
  let images = 0;
  const videoSpecs: Array<{ dur: number; height: number }> = [];
  let ttsChars = 0;

  for (const task of assetTasks.value) {
    if (task.task_type === "image_still") images++;
    if (task.task_type === "video_clip") {
      const params = (task.parameters as Record<string, unknown> | undefined);
      const dur = normalizeVideoDurationForPricing(
        (typeof params?.duration_sec === "number" && params.duration_sec > 0)
          ? params.duration_sec : 5,
      );
      const res = (typeof params?.resolution === "string" ? params.resolution : "") || "720P";
      const height = res.includes("1080") ? 1080 : 720;
      videoSpecs.push({ dur, height });
    }
    if (task.task_type === "tts_audio") {
      const plan = activeAssetPlan.value?.plan;
      const ttsPlan = plan as unknown as { tts_plan?: { chunks?: Array<{ script_excerpt?: string }> } } | null;
      ttsChars = ttsPlan?.tts_plan?.chunks?.reduce((s, c) => s + (c.script_excerpt?.length ?? 0), 0) ?? 0;
    }
  }

  if (images === 0 && videoSpecs.length === 0 && ttsChars === 0) return null;

  // Build synthetic artifacts for pricing — one per second for video to match per-second pricing
  const syntheticArtifacts: Array<{ artifact_type: string; metadata: Record<string, unknown> }> = [
    ...Array.from({ length: images }, () => ({ artifact_type: "image", metadata: {} })),
  ];
  for (const vs of videoSpecs) {
    for (let s = 0; s < Math.ceil(vs.dur); s++) {
      syntheticArtifacts.push({ artifact_type: "video", metadata: { duration_sec: 1, height: vs.height } });
    }
  }

  const videoTotalSec = videoSpecs.reduce((sum, vs) => sum + vs.dur, 0);
  const has1080p = videoSpecs.some(vs => vs.height >= 1080);

  const pricing = computeCostBreakdown(syntheticArtifacts, ttsChars);

  return {
    images, videoTotalSec, ttsChars, has1080p,
    total: pricing.total, imgCost: pricing.image.total, vidCost: pricing.video.total, ttsCost: pricing.tts.total,
  };
});

/** Post-generation cost from actual artifacts. */
const costBreakdown = computed(() => {
  const arts = artifacts.value;
  const ttsPlan = activeAssetPlan.value?.plan as unknown as { tts_plan?: { chunks?: Array<{ script_excerpt?: string }> } } | null;
  const ttsChars = ttsPlan?.tts_plan?.chunks?.reduce((s, c) => s + (c.script_excerpt?.length ?? 0), 0) ?? 0;
  return computeCostBreakdown(
    arts.map(a => ({ artifact_type: a.artifact_type, metadata: a.metadata })),
    ttsChars,
  );
});

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

/** Task-type breakdown from the plan (available before manifest). */
const planSummary = computed(() => {
  const map = new Map<string, number>();
  for (const task of assetTasks.value) {
    const label = TASK_TYPE_LABELS[task.task_type] ?? task.task_type;
    map.set(label, (map.get(label) ?? 0) + 1);
  }
  return [...map.entries()].map(([label, count]) => ({ label, count }));
});

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
  const stats = { completed: 0, waiting: 0, running: 0, failed: 0, planned: 0, total: 0 };
  const executedIds = new Set(executions.value.map(e => e.task_id));

  // Count executions
  for (const exec of executions.value) {
    stats.total++;
    if (exec.status === "completed" || exec.status === "accepted") stats.completed++;
    else if (exec.status === "waiting_manual_upload") stats.waiting++;
    else if (exec.status === "running") stats.running++;
    else if (exec.status === "failed") stats.failed++;
  }

  // Count planned but not yet executed tasks (blocked)
  for (const task of assetTasks.value) {
    if (!executedIds.has(task.task_id)) {
      stats.planned++;
    }
  }

  return stats;
});

/** Per-type breakdown for the overview card. */
const taskTypeBreakdown = computed(() => {
  const map = new Map<string, { total: number; completed: number; planned: number; failed: number }>();
  const execByTaskId = executionsByTaskId.value;

  for (const task of assetTasks.value) {
    const label = TASK_TYPE_LABELS[task.task_type] ?? task.task_type;
    let entry = map.get(label);
    if (!entry) {
      entry = { total: 0, completed: 0, planned: 0, failed: 0 };
      map.set(label, entry);
    }
    entry.total++;
    const exec = execByTaskId.get(task.task_id);
    if (!exec) {
      entry.planned++;
    } else if (exec.status === "completed" || exec.status === "accepted") {
      entry.completed++;
    } else if (exec.status === "failed") {
      entry.failed++;
    } else {
      entry.planned++;
    }
  }

  return [...map.entries()].map(([label, counts]) => ({ label, ...counts }));
});

const TASK_TYPE_LABELS: Record<string, string> = {
  image_still: "分镜图",
  video_clip: "分镜视频",
  tts_audio: "口播音频",
  subtitle_track: "字幕",
  sfx_cue: "音效",
  bgm_cue: "配乐",
  render_motion_cue: "运镜",
};

/** Blocked tasks preventing compose — anything not completed/accepted. */
const blockedItems = computed(() => {
  const execByTaskId = executionsByTaskId.value;
  const items: Array<{ taskId: string; type: string; segmentId: string; reason: string; taskIndex: number }> = [];

  // Count same-segment same-type tasks for suffix numbering
  const segmentTypeCounts = new Map<string, number>();
  for (const task of assetTasks.value) {
    const key = `${task.source_segment_id}:${task.task_type}`;
    segmentTypeCounts.set(key, (segmentTypeCounts.get(key) ?? 0) + 1);
  }
  const segmentTypeIndex = new Map<string, number>();

  for (const task of assetTasks.value) {
    const exec = execByTaskId.get(task.task_id);
    const done = exec && (exec.status === "completed" || exec.status === "accepted");
    if (done) continue;

    const typeLabel = TASK_TYPE_LABELS[task.task_type] ?? task.task_type;
    const sid = task.source_segment_id;
    const segIndex = sid ? segments.value.findIndex(s => s.segment_id === sid) : -1;
    const key = `${sid}:${task.task_type}`;
    const totalForType = segmentTypeCounts.get(key) ?? 1;
    const idxForType = (segmentTypeIndex.get(key) ?? 0) + 1;
    segmentTypeIndex.set(key, idxForType);

    const segRef = segIndex >= 0
      ? (totalForType > 1 ? `#${segIndex + 1}-${idxForType}` : `#${segIndex + 1}`)
      : (sid ?? task.task_id);
    const reason = !exec
      ? "暂未生成"
      : exec.status === "waiting_manual_upload"
        ? "待上传"
        : exec.status === "failed"
          ? "生成失败"
          : exec.status === "running"
            ? "生成中"
            : "待处理";

    items.push({ taskId: task.task_id, type: typeLabel, segmentId: segRef, reason, taskIndex: idxForType - 1 });
  }

  return items;
});

const showAllBlocked = ref(false);
const focusTaskId = ref<string | null>(null);

const visibleBlockedItems = computed(() =>
  showAllBlocked.value ? blockedItems.value : blockedItems.value.slice(0, 10),
);

/** Full breakdown including types with 0 tasks (so nothing is hidden). */
const ALL_TASK_TYPES = [
  "口播音频", "字幕", "分镜图", "分镜视频", "运镜", "音效", "配乐",
];

const allTypeBreakdown = computed(() => {
  const byLabel = new Map(taskTypeBreakdown.value.map(t => [t.label, t]));
  return ALL_TASK_TYPES.map(label => {
    const entry = byLabel.get(label);
    return entry ?? { label, total: 0, completed: 0, planned: 0, failed: 0 };
  });
});

/** Clear status message during generation (backend doesn't stream progress). */
const generationProgress = computed(() => {
  if (!assetsStore.state.isGenerating) return "";
  if (!hasManifest.value) return "正在初始化资产生成，可能需要 1-5 分钟...";
  return `生成请求已提交，处理中... 当前 ${executionStats.value.completed}/${assetTasks.value.length} 已完成`;
});
const blockedItemsAreUploadOnly = computed(() =>
  blockedItems.value.length > 0 &&
  blockedItems.value.every(i => i.reason === "待上传"),
);

/** Scroll to a specific task's segment card, then focus its task tab. */
function scrollToTask(taskId: string) {
  const task = assetTasks.value.find(t => t.task_id === taskId);
  if (!task) return;
  const segId = task.source_segment_id;
  if (!segId) return;
  const idx = segments.value.findIndex(s => s.segment_id === segId);
  if (idx < 0) return;
  const cards = document.querySelectorAll(".segment-asset-card");
  const card = cards[idx] as HTMLElement | undefined;
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  card.style.transition = "box-shadow 0.3s";
  card.style.boxShadow = "0 0 0 3px var(--accent-primary)";
  setTimeout(() => { card.style.boxShadow = ""; }, 2000);
  // Trigger the child component to switch to the correct task
  focusTaskId.value = null; // reset to force re-trigger
  requestAnimationFrame(() => { focusTaskId.value = taskId; });
}
const blockedReasonText = computed(() => {
  if (canCompose.value) return "";
  const items = blockedItems.value;
  if (items.length === 0) return "资产尚未就绪";
  // Show first 5 specific items, then summary
  const head = items.slice(0, 5);
  const lines = head.map(i => `${i.segmentId} ${i.type}${i.reason}`);
  if (items.length > 5) lines.push(`...等 ${items.length} 项`);
  return `无法进入合成：${lines.join("；")}`;
});

/* -------------------------------------------------------------------------- */
/*  Lifecycle                                                                 */
/* -------------------------------------------------------------------------- */

onMounted(async () => {
  await storyboardStore.loadActiveStoryboardSnapshot();
  await assetPlanningStore.loadActiveAssetPlanSnapshot();
  // Auto-generate asset plan when arriving from storyboard confirmation
  const s = assetPlanningStore.state.snapshot;
  if (
    s &&
    !s.active_asset_plan &&
    (s.current_status === "storyboard_ready" ||
      s.current_status === "asset_plan_ready")
  ) {
    await assetPlanningStore.generateAssetPlan();
    if (!assetPlanningStore.state.loadError) {
      ElMessage.success("资产规划生成完成");
    }
  }
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
  try {
    await ElMessageBox.confirm(
      "将生成口播音频、音效和配乐（不含图片/视频）。\n口播约 ¥0.80/万字。\n确定继续？",
      "确认半自动生成",
      { confirmButtonText: "确定生成", cancelButtonText: "取消", type: "info" },
    );
  } catch { return; }
  await assetsStore.generateAssets({ enabledProviderTypes: ["tts", "sfx", "bgm"] });
  if (!assetsStore.state.loadError) {
    ElMessage.success("资产生成完成（图片/视频需手动上传）");
  }
}

async function handleGenerateMissing() {
  const count = blockedItems.value.length;
  const types = [...new Set(blockedItems.value.map(i => i.type))].join("、");
  const costText = estimatedCost.value
    ? `\n预估费用约 ¥${estimatedCost.value.total.toFixed(2)}（含图片/视频/口播）`
    : "";
  try {
    await ElMessageBox.confirm(
      `将生成 ${count} 个未完成任务（${types}），已完成的不会被覆盖。${costText}\n确定继续？`,
      "确认批量生成剩余",
      { confirmButtonText: "确定生成", cancelButtonText: "取消", type: "info" },
    );
  } catch { return; }
  await assetsStore.generateAssets({ mode: "missing_only" });
  if (!assetsStore.state.loadError) {
    ElMessage.success("剩余资产生成完成");
  }
}

async function handleGenerateFull() {
  const costText = estimatedCost.value
    ? `\n预估费用约 ¥${estimatedCost.value.total.toFixed(2)}（${estimatedCost.value.images} 张图 + ${estimatedCost.value.videoTotalSec.toFixed(0)}s 视频 + ${estimatedCost.value.ttsChars} 字口播）`
    : "";
  if (hasManifest.value) {
    try {
      await ElMessageBox.confirm(
        `重新生成将覆盖所有已有产物（包括已上传的文件），确定继续？${costText}`,
        "确认重新生成",
        { confirmButtonText: "确定重建", cancelButtonText: "取消", type: "warning" },
      );
    } catch { return; }
  } else {
    try {
      await ElMessageBox.confirm(
        `将调用 AI 服务生成全部资产（图片/视频/口播/音效/配乐）。${costText}\n\n确定继续？`,
        "确认全部自动生成",
        { confirmButtonText: "确定生成", cancelButtonText: "取消", type: "info" },
      );
    } catch { return; }
  }
  await assetsStore.generateAssets({});
  if (!assetsStore.state.loadError) {
    ElMessage.success("全部资产生成完成");
  }
}

function handleUploadFile(taskId: string, file: File) {
  assetsStore.uploadArtifact(taskId, file);
}

async function handleGenerateTask(taskId: string) {
  try {
    await assetsStore.generateSingleTask(taskId);
    // Reload to check actual execution status
    await assetsStore.loadProject();
    const exec = executions.value.find(e => e.task_id === taskId);
    if (exec?.status === "completed" || exec?.status === "accepted") {
      ElMessage.success("生成完成");
    } else if (exec?.status === "failed") {
      ElMessage.error("生成失败：" + (exec.notes?.join("; ") || "未知错误"));
    } else {
      ElMessage.warning("任务已提交，状态：" + (exec?.status ?? "未知"));
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "生成失败";
    ElMessage.error("单任务生成失败：" + msg);
  }
}

async function handleUpgradeVideo(segmentId: string) {
  const seg = segments.value.find(s => s.segment_id === segmentId);
  const segLabel = seg ? `#${segments.value.indexOf(seg) + 1}` : segmentId;
  // Default upgrade creates 720P at 5s — use those values, not global estimate
  const rate = "约 ¥0.60/秒 (720P)";
  try {
    await ElMessageBox.confirm(
      `将为分镜 ${segLabel} 新增可选 API 视频任务（默认 720P / 5 秒，不影响图片+运镜路线）。\n费用：${rate}，预估 ¥${(5 * 0.60).toFixed(2)}。\n确定继续？`,
      "升级为 API 视频",
      { confirmButtonText: "确定升级", cancelButtonText: "取消", type: "info" },
    );
  } catch { return; }
  try {
    await assetsStore.upgradeSegmentToVideo(segmentId);
    await assetsStore.loadProject();
    // Check if the video task actually completed
    const videoTasks = assetTasks.value.filter(t => t.task_type === "video_clip" && t.source_segment_id === segmentId);
    const lastVideo = videoTasks[videoTasks.length - 1];
    if (lastVideo) {
      const exec = executions.value.find(e => e.task_id === lastVideo.task_id);
      if (exec?.status === "completed" || exec?.status === "accepted") {
        ElMessage.success("API 视频生成完成");
      } else if (exec?.status === "failed") {
        ElMessage.error("视频生成失败：" + (exec.notes?.join("; ") || "未知错误"));
      } else {
        ElMessage.warning("视频任务已提交，状态：" + (exec?.status ?? "处理中"));
      }
    } else {
      ElMessage.warning("视频任务已创建，请稍后查看生成结果");
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "升级失败";
    ElMessage.error("视频升级失败：" + msg);
  }
}

function handleRetry() {
  assetPlanningStore.retryLoad();
  assetsStore.loadProject();
}

function handleConfirm() {
  if (!canCompose.value) {
    ElMessage.warning(blockedReasonText.value || "资产尚未全部就绪");
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
      <p class="asset-generating-title">正在生成资产规划</p>
      <p class="asset-generating-hint">正在调用大模型分析分镜并规划素材，可能需要 1-5 分钟。</p>
      <p class="asset-generating-hint">系统每 5 秒自动检查生成状态，也可手动刷新：</p>
      <el-button
        @click="assetPlanningStore.retryLoad()"
      >
        立即刷新状态
      </el-button>
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

    <!-- Plan exists but no manifest yet: show plan overview before generating -->
    <div v-else-if="!hasManifest && planSummary.length > 0" class="asset-plan-overview">
      <h3 class="asset-overview-title">资产规划概览</h3>
      <div class="asset-overview-types">
        <div v-for="item in planSummary" :key="item.label" class="asset-overview-type-row">
          <span class="asset-overview-type-label">{{ item.label }}</span>
          <el-tag size="small" type="info">{{ item.count }} 项</el-tag>
        </div>
      </div>
      <p class="asset-plan-overview-hint">
        口播、字幕、音效、配乐将自动生成；分镜图和视频需通过 AI 生成或手动上传。
        <span v-if="estimatedCost" class="asset-plan-cost-estimate">
          <br/>「全部自动生成」预估 ¥{{ estimatedCost.total.toFixed(2) }}
          （{{ estimatedCost.images }} 图 · {{ estimatedCost.videoTotalSec.toFixed(0) }}s{{ estimatedCost.has1080p ? ' 1080P' : '' }} 视频 · {{ estimatedCost.ttsChars }} 字口播）
          <br/>「手动上传」仅生成口播/字幕/音效/配乐，预估 ¥{{ (estimatedCost.ttsCost).toFixed(2) }}
        </span>
      </p>
      <div class="asset-plan-overview-actions">
        <el-button
          type="primary"
          :loading="assetsStore.state.isGenerating"
          @click="handleGenerateFull"
        >
          {{ assetsStore.state.isGenerating ? "生成中..." : "全部自动生成" }}
        </el-button>
        <el-button
          :loading="assetsStore.state.isGenerating"
          @click="handleGenerateSemiAuto"
        >
          {{ assetsStore.state.isGenerating ? "生成中..." : "生成资产（手动上传图片/视频）" }}
        </el-button>
      </div>
      <p v-if="assetsStore.state.isGenerating" class="asset-generating-progress">
        {{ generationProgress }}
      </p>
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

      <!-- Asset generation overview -->
      <div v-if="hasManifest" class="asset-overview-card">
        <h3 class="asset-overview-title">资产生成概览</h3>

        <!-- Progress bar -->
        <div class="asset-overview-progress">
          <span class="asset-overview-count">
            已完成 {{ executionStats.completed }} / {{ assetTasks.length }}
          </span>
          <el-progress
            :percentage="assetTasks.length > 0 ? Math.round(executionStats.completed / assetTasks.length * 100) : 0"
            :status="canCompose ? 'success' : undefined"
            :stroke-width="10"
          />
        </div>

        <!-- Per-type breakdown: compact 2-col grid pills -->
        <div class="asset-overview-types-v2">
          <div
            v-for="item in allTypeBreakdown"
            :key="item.label"
            class="asset-type-pill"
            :class="{
              'asset-type-pill--done': item.completed === item.total && item.total > 0,
              'asset-type-pill--blocked': item.total > 0 && item.completed < item.total,
              'asset-type-pill--none': item.total === 0,
            }"
          >
            <span class="asset-type-pill-label">{{ item.label }}</span>
            <span class="asset-type-pill-count">
              {{ item.total === 0 ? '无需' : item.completed + '/' + item.total }}
            </span>
          </div>
        </div>

        <!-- Blocked items: compact chip grid -->
        <div v-if="blockedItems.length > 0" class="asset-overview-blocked">
          <h4 class="asset-overview-blocked-title">
            待处理项（{{ blockedItems.length }}）
          </h4>
          <div class="asset-blocked-chips">
            <button
              v-for="item in visibleBlockedItems"
              :key="item.taskId"
              class="asset-blocked-chip"
              @click="scrollToTask(item.taskId)"
            >
              <span class="asset-blocked-chip-seg">{{ item.segmentId }}</span>
              <span class="asset-blocked-chip-type">{{ item.type }}</span>
              <el-tag :type="item.reason === '生成失败' ? 'danger' : 'warning'" size="small">
                {{ item.reason }}
              </el-tag>
            </button>
          </div>
          <button
            v-if="blockedItems.length > 10"
            class="asset-blocked-expand"
            @click="showAllBlocked = !showAllBlocked"
          >
            {{ showAllBlocked ? '收起' : '展开全部（' + blockedItems.length + '）' }}
          </button>
        </div>

        <!-- Cost summary -->
        <div v-if="hasManifest" class="asset-overview-cost">
          <h4 class="asset-overview-cost-title">
            {{ hasManifest ? '已生成成本估算' : '预估成本' }}
          </h4>
          <div class="asset-overview-cost-items">
            <span v-if="costBreakdown.image.count > 0">
              🖼 图片 {{ costBreakdown.image.count }} 张 · ¥{{ costBreakdown.image.total.toFixed(2) }}
            </span>
            <span v-if="costBreakdown.video.durationSec > 0">
              🎬 视频 {{ costBreakdown.video.durationSec.toFixed(1) }}s · ¥{{ costBreakdown.video.total.toFixed(2) }}
            </span>
            <span v-if="costBreakdown.tts.charCount > 0">
              🔊 口播 {{ costBreakdown.tts.charCount }} 字 · ¥{{ costBreakdown.tts.total.toFixed(2) }}
            </span>
          </div>
          <div class="asset-overview-cost-total">
            合计 <strong>¥{{ costBreakdown.total.toFixed(2) }}</strong>
            <span class="asset-overview-cost-note">（按当前配置估算）</span>
          </div>
        </div>

        <!-- Actions -->
        <div class="asset-overview-actions">
          <el-button
            v-if="blockedItems.length > 0"
            type="primary"
            :loading="assetsStore.state.isGenerating"
            @click="handleGenerateMissing"
          >
            {{ assetsStore.state.isGenerating ? "生成中..." : "批量生成剩余资产" }}
          </el-button>
          <el-button
            type="danger"
            plain
            size="small"
            :loading="assetsStore.state.isGenerating"
            @click="handleGenerateFull"
          >
            重新生成全部资产
          </el-button>
          <span v-if="blockedItems.length > 0" class="asset-overview-hint">
            也可在下方的分镜卡片中逐项上传或替换
          </span>
          <p v-if="assetsStore.state.isGenerating && generationProgress" class="asset-generating-progress">
            {{ generationProgress }}
          </p>
        </div>
      </div>

      <!-- Generate action bar (no manifest yet) -->
      <div v-if="!hasManifest" class="asset-generate-bar">
        <div class="asset-generate-actions">
          <el-button
            type="primary"
            :loading="assetsStore.state.isGenerating"
            @click="handleGenerateFull"
          >
            {{ assetsStore.state.isGenerating ? "生成中..." : "全部自动生成" }}
          </el-button>
          <el-button
            :loading="assetsStore.state.isGenerating"
            @click="handleGenerateSemiAuto"
          >
            {{ assetsStore.state.isGenerating ? "生成中..." : "生成资产（手动上传图片/视频）" }}
          </el-button>
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
          :focus-task-id="focusTaskId"
          @upload-file="handleUploadFile"
          @generate-task="handleGenerateTask"
          @upgrade-video="handleUpgradeVideo"
        />
      </div>

      <!-- Sticky bottom bar -->
      <div v-if="hasManifest" class="asset-bottom-bar">
        <div class="asset-bottom-progress">
          <span class="asset-bottom-count">
            {{ executionStats.completed }} / {{ assetTasks.length }} 已完成
          </span>
          <span v-if="blockedItems.length > 0" class="asset-bottom-next">
            下一项：{{ blockedItems[0].segmentId }} {{ blockedItems[0].type }}
          </span>
        </div>
        <div class="asset-bottom-actions">
          <el-button
            v-if="blockedItems.length > 0"
            size="small"
            @click="scrollToTask(blockedItems[0].taskId)"
          >
            跳到下一项
          </el-button>
          <el-tooltip
            v-if="!canCompose"
            :content="blockedReasonText"
            placement="top"
          >
            <span>
              <el-button
                type="primary"
                size="small"
                disabled
              >
                确认并进入合成
              </el-button>
            </span>
          </el-tooltip>
          <el-button
            v-else
            type="primary"
            size="small"
            @click="handleConfirm"
          >
            确认并进入合成
          </el-button>
        </div>
        <p v-if="!canCompose" class="asset-bottom-reason">
          {{ blockedReasonText }}
        </p>
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

.asset-generating-title {
  font-size: 1.1rem;
  font-weight: var(--font-subheading);
  color: var(--text-heading);
  margin: 0;
}

.asset-generating-hint {
  font-size: 0.88rem;
  max-width: 400px;
  line-height: 1.6;
  margin: 0;
}

/* ---- Plan overview (before manifest) ---- */
.asset-plan-overview {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-lg);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--bg-card);
}

.asset-plan-overview-hint {
  font-size: 0.85rem;
  color: var(--text-muted);
  line-height: 1.6;
  margin: 0;
}

.asset-plan-overview-actions {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
  padding-top: var(--space-sm);
  border-top: 1px solid var(--border-default);
}

/* ---- Sticky bottom bar ---- */
.asset-bottom-bar {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-md) var(--space-lg);
  background: var(--bg-panel);
  border-top: 2px solid var(--border-default);
  z-index: 10;
  margin-top: auto;
}

.asset-bottom-progress {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.asset-bottom-count {
  font-weight: var(--font-subheading);
  font-size: 0.92rem;
  color: var(--text-heading);
}

.asset-bottom-next {
  font-size: 0.82rem;
  color: var(--text-muted);
}

.asset-bottom-actions {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
}

.asset-bottom-reason {
  margin: 4px 0 0;
  font-size: 0.82rem;
  color: var(--color-warning);
  line-height: 1.5;
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

/* ---- Overview card ---- */
.asset-overview-card {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-lg);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--bg-card);
}

.asset-overview-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: var(--font-subheading);
  color: var(--text-heading);
}

.asset-overview-progress {
  display: grid;
  gap: var(--space-sm);
}

.asset-overview-count {
  font-size: 0.95rem;
  color: var(--text-secondary);
}

/* ---- Compact type chip row ---- */
.asset-overview-types-v2 {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 8px;
}

.asset-type-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: var(--radius-card);
  background: var(--bg-panel);
  border: 1px solid var(--border-default);
  font-size: 0.82rem;
}

.asset-type-pill--done {
  border-color: var(--color-success);
}

.asset-type-pill--blocked {
  border-color: var(--color-warning);
}

.asset-type-pill--none {
  opacity: 0.45;
}

.asset-type-pill-label {
  color: var(--text-secondary);
}

.asset-type-pill-count {
  font-weight: var(--font-subheading);
  color: var(--text-heading);
  font-variant-numeric: tabular-nums;
}

.asset-type-pill--done .asset-type-pill-label {
  color: var(--color-success);
}

.asset-overview-blocked {
  display: grid;
  gap: var(--space-xs);
  padding-top: var(--space-sm);
  border-top: 1px solid var(--border-default);
}

.asset-overview-blocked-title {
  margin: 0;
  font-size: 0.92rem;
  font-weight: var(--font-subheading);
  color: var(--color-warning);
}

.asset-blocked-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.asset-blocked-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--bg-panel);
  cursor: pointer;
  font-size: 0.82rem;
  transition: border-color 0.15s;
}

.asset-blocked-chip:hover {
  border-color: var(--accent-primary);
}

.asset-blocked-chip-seg {
  font-weight: var(--font-subheading);
  color: var(--text-heading);
}

.asset-blocked-chip-type {
  color: var(--text-secondary);
}

.asset-blocked-expand {
  background: none;
  border: none;
  color: var(--accent-primary);
  cursor: pointer;
  font-size: 0.82rem;
  padding: 2px 0;
}

.asset-blocked-expand:hover {
  text-decoration: underline;
}

.asset-overview-actions {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
  align-items: center;
  padding-top: var(--space-sm);
  border-top: 1px solid var(--border-default);
}

/* ---- Cost summary ---- */
.asset-overview-cost {
  display: grid;
  gap: var(--space-xs);
  padding-top: var(--space-sm);
  border-top: 1px solid var(--border-default);
}

.asset-overview-cost-title {
  margin: 0;
  font-size: 0.9rem;
  font-weight: var(--font-subheading);
  color: var(--text-heading);
}

.asset-overview-cost-items {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.asset-overview-cost-total {
  font-size: 0.88rem;
  color: var(--text-heading);
}

.asset-overview-cost-note {
  font-size: 0.78rem;
  color: var(--text-muted);
}

.asset-overview-hint {
  font-size: 0.82rem;
  color: var(--text-muted);
}

.asset-generating-progress {
  margin: 4px 0 0;
  font-size: 0.85rem;
  color: var(--accent-primary);
  width: 100%;
}

/* ---- Blocked reason ---- */
.asset-blocked-reason {
  margin: var(--space-sm) 0 0;
  font-size: 0.88rem;
  color: var(--color-warning);
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
