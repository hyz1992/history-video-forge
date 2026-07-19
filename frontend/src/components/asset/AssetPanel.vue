<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";

import { useStoryboardStore } from "../../stores/storyboard";
import { useAssetPlanningStore } from "../../stores/asset-planning";
import { useAssetsStore } from "../../stores/assets";
import { useScriptStore } from "../../stores/script";
import { useProjectStore } from "../../stores/project";
import { useStagePolling } from "../../composables/useStagePolling";
import { useAssetTabPhase } from "../../composables/useAssetTabPhase";
import { useWorkspaceStore } from "../../stores/workspace";
import { PIPELINE_STEPS } from "../../stores/workspace";
import { useDemoMode } from "../../composables/useDemoMode";
import { useCompetitionGuard } from "../../composables/useCompetitionGuard";
import StageGenerating from "../workspace/StageGenerating.vue";
import StageLoadingBar from "../workspace/StageLoadingBar.vue";

import SegmentAssetCard from "./SegmentAssetCard.vue";
import { computeCostBreakdown, estimatePlanCost, getTaskCostHint, getVideoUpgradeCostHint, estimateBlockedItemsCost, PRICING, type PlanTaskLike } from "../../utils/pricing";
import { getAssetGeneratingView, type AssetGenerationProgress } from "../../utils/asset-generating-view";

const storyboardStore = useStoryboardStore();
const assetPlanningStore = useAssetPlanningStore();
const assetsStore = useAssetsStore();
const scriptStore = useScriptStore();
const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();
const assetSnapshotLoaded = ref(false);
const demoMode = useDemoMode();
const { checkStageRollback } = useCompetitionGuard();

/* -------------------------------------------------------------------------- */
/*  Demo mode: block image/video generation                                    */
/* -------------------------------------------------------------------------- */

const DEMO_MODE_MESSAGE = "比赛演示期间，图片和视频生成功能已关闭，以防 API 成本消耗。\n\n请前往项目列表，查看已有示例项目体验完整生成效果。";

function showDemoModeBlock() {
  ElMessageBox.alert(
    DEMO_MODE_MESSAGE,
    "演示模式",
    {
      confirmButtonText: "我知道了",
      type: "warning",
    },
  );
}

const DEMO_VISUAL_BLOCKED_ERROR = "demo_mode_visual_blocked";

function isDemoVisualBlockedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message === DEMO_VISUAL_BLOCKED_ERROR || error.message.includes(DEMO_VISUAL_BLOCKED_ERROR);
}

function checkDemoVisualBlock(): boolean {
  if (demoMode.value) {
    showDemoModeBlock();
    return true;
  }
  return false;
}

async function handleDemoGeneratingError(): Promise<boolean> {
  const err = assetsStore.state.loadError;
  if (err && (err === DEMO_VISUAL_BLOCKED_ERROR || err.includes(DEMO_VISUAL_BLOCKED_ERROR))) {
    showDemoModeBlock();
    await assetsStore.loadProject();
    return true;
  }
  return false;
}

// 通用轮询：asset plan + assets 两个阶段的 generating 状态
/** 先 load asset plan，再 load assets，顺序保证依赖关系 */
async function loadAssetSnapshot() {
  await assetPlanningStore.retryLoad();
  await assetsStore.loadProject();
  assetSnapshotLoaded.value = true;
  const assetStatus = assetsStore.state.snapshot?.current_status ?? "";
  const planStatus = assetPlanningStore.state.snapshot?.current_status ?? "";
  return {
    current_status:
      assetsStore.state.snapshot?.active_assets || assetStatus.startsWith("assets")
        ? assetStatus
        : planStatus,
    active_asset_plan: assetPlanningStore.state.snapshot?.active_asset_plan ?? null,
    active_assets: assetsStore.state.snapshot?.active_assets ?? null,
  };
}

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

const currentStatus = computed(
  () => {
    const assetStatus = assetsStore.state.snapshot?.current_status ?? "";
    if (assetsStore.state.snapshot?.active_assets || assetStatus.startsWith("assets")) {
      return assetStatus;
    }
    return assetPlanningStore.state.snapshot?.current_status ?? assetStatus;
  },
);
const initialLoadDone = ref(false);
const { phase } = useAssetTabPhase({
  assetPlanningStore,
  assetsStore,
  initialLoadDone: computed(() => initialLoadDone.value),
});

// 通用轮询：规划生成或资产生成中持续刷新快照
const { startPolling: startAssetPolling, isPolling: isAssetPolling } = useStagePolling({
  loadSnapshot: () => loadAssetSnapshot(),
  isGenerating: (snapshot) =>
    snapshot.current_status === "asset_plan_generating" ||
    snapshot.current_status === "assets_generating" ||
    snapshot.active_asset_plan?.execution_state?.generating === true ||
    snapshot.active_assets?.execution_state?.generating === true,
  isTerminal: (snapshot) =>
    (!!snapshot.active_asset_plan && snapshot.current_status !== "asset_plan_generating" && !!snapshot.active_assets) ||
    snapshot.current_status?.startsWith("compos"),
});

// Snapshot-based generating checks (survive page refresh)
const isPlanGenerating = computed(
  () =>
    pendingAutoGenerate.value ||
    assetPlanningStore.state.isGenerating ||
    currentStatus.value === "asset_plan_generating" ||
    activeAssetPlan.value?.execution_state?.generating === true,
);
const isAssetsGenerating = computed(
  () =>
    currentStatus.value === "assets_generating" ||
    assetsStore.state.snapshot?.active_assets?.execution_state?.generating === true,
);

const isStartingBasicAssets = ref(false);
const isAssetsBusy = computed(
  () => isStartingBasicAssets.value || assetsStore.state.isGenerating || isAssetsGenerating.value,
);
const assetLoadingBarText = computed(() =>
  hasManifest.value ? "正在生成资产..." : "正在生成基础资产...",
);

const planProgress = computed<AssetGenerationProgress | null>(() => {
  const es = activeAssetPlan.value?.execution_state;
  if (!es) return null;
  if (typeof es.progress_phase !== "string") return null;
  return {
    phase: es.progress_phase as string,
    completed_chunks: Number(es.progress_completed_chunks) || 0,
    total_chunks: Number(es.progress_total_chunks) || 0,
    total_segments: Number(es.progress_total_segments) || 0,
  };
});

const generatingView = computed(() =>
  getAssetGeneratingView({
    hasAssetPlan: !!activeAssetPlan.value,
    hasManifest: hasManifest.value,
    isPlanGenerating: isPlanGenerating.value,
    isAssetsGenerating: isAssetsGenerating.value || assetsStore.state.isGenerating,
    isPolling: isAssetPolling.value,
    planProgress: planProgress.value,
  }),
);

/* Partial readiness (warnings only, e.g. optional BGM missing)
 *  should still allow composing.  Only blocked (errors) prevents it. */
const canCompose = computed(() => {
  const r = readiness.value;
  return r === "ready_for_compose" || r === "partial";
});

/** Pre-generation cost estimate from the asset plan. */
const estimatedCost = computed(() => {
  const ttsPlan = activeAssetPlan.value?.plan as unknown as { tts_plan?: { chunks?: Array<{ script_excerpt?: string }> } } | null;
  const ttsChars = ttsPlan?.tts_plan?.chunks?.reduce((s, c) => s + (c.script_excerpt?.length ?? 0), 0) ?? 0;
  return estimatePlanCost(assetTasks.value as PlanTaskLike[], ttsChars);
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

/** Global narration (TTS) artifact — displayed once above all segment cards. */
const narrationArtifactId = computed(() => {
  const summary = manifest.value?.audio_summary as Record<string, unknown> | undefined;
  return (summary?.tts_merged_artifact_id as string) ?? null;
});
const narrationArtifact = computed(() => {
  const id = narrationArtifactId.value;
  if (!id) return null;
  return artifactsById.value.get(id) ?? null;
});
const narrationAudioUrl = computed(() => {
  const art = narrationArtifact.value;
  if (!art) return null;
  return `/api/projects/${projectId.value}/artifacts/${art.artifact_id}/file`;
});
const narrationDuration = computed(() => {
  const meta = narrationArtifact.value?.metadata;
  const dur = meta?.duration_sec as number | undefined;
  return typeof dur === "number" ? dur : null;
});

/** Full script text from the active script record. */
const fullScriptText = computed(() => {
  return scriptStore.state.snapshot?.active_script?.script_text ?? null;
});

const narrationScriptExpanded = ref(false);
const SCRIPT_PREVIEW_LINES = 6;
const narrationScriptLong = computed(() => {
  const text = fullScriptText.value;
  if (!text) return false;
  return text.split("\n").length > SCRIPT_PREVIEW_LINES || text.length > 400;
});

const COMPOSE_STEP_INDEX = PIPELINE_STEPS.findIndex(
  (s) => s.key === "compose-render",
);
const router = useRouter();

/* -------------------------------------------------------------------------- */
/*  Global info                                                               */
/* -------------------------------------------------------------------------- */

const voiceProfile = computed(() => {
  const fromPlan = plan.value?.tts_plan?.voice_profile_id ?? null;
  if (fromPlan && fromPlan !== "voice_default_male_storyteller") return fromPlan;
  const fromManifest = (manifest.value?.audio_summary as Record<string, unknown> | undefined)?.voice_profile_id as string | undefined;
  return fromManifest ?? fromPlan;
});

const VOICE_LABELS: Record<string, string> = {
  voice_preset_cold_authority: "冷峻权谋型",
  voice_preset_steady_documentary: "纪实沉稳型",
  voice_preset_crisp_storyteller: "清朗讲述型",
  voice_preset_eerie_suspense: "幽冷悬疑型",
  voice_system_ethan: "Ethan",
};
const voiceLabel = computed(() =>
  voiceProfile.value ? (VOICE_LABELS[voiceProfile.value] ?? voiceProfile.value) : null,
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

const upgradableSegments = computed(() =>
  segments.value.filter(seg => {
    const imgTasks = imageTasksBySegment.value.get(seg.segment_id) ?? [];
    const vidTasks = videoTasksBySegment.value.get(seg.segment_id) ?? [];
    if (vidTasks.length > 0) return false;
    if (imgTasks.length === 0) return false;
    const allImgDone = imgTasks.every(t => {
      const exec = executionsByTaskId.value.get(t.task_id);
      return exec?.status === "completed" || exec?.status === "accepted";
    });
    if (!allImgDone) return false;
    return seg.narrative_role === "turn" || seg.narrative_role === "peak";
  }),
);

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
const selectedBlockedIds = ref<string[]>([]);
const focusTaskId = ref<string | null>(null);

const showBackToTop = ref(false);
let backToTopObserver: IntersectionObserver | null = null;

function scrollToTop() {
  const container = document.querySelector(".workspace-content");
  if (!container) return;

  const startTop = container.scrollTop;
  if (startTop === 0) return;

  const duration = 400;
  const startTime = performance.now();

  function tick(now: number) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    container!.scrollTop = startTop * (1 - eased);

    if (progress < 1) {
      requestAnimationFrame(tick);
    }
  }

  requestAnimationFrame(tick);
}

function setUpBackToTopObserver() {
  if (backToTopObserver) {
    backToTopObserver.disconnect();
  }
  const sentinel = document.querySelector(".asset-overview-details");
  if (!sentinel) return;
  backToTopObserver = new IntersectionObserver(
    ([entry]) => {
      showBackToTop.value = !entry.isIntersecting;
    },
    { threshold: 0 },
  );
  backToTopObserver.observe(sentinel);
}

const missingImageCount = computed(() =>
  blockedItems.value.filter(i => i.type === "分镜图").length,
);
const missingVideoCount = computed(() =>
  blockedItems.value.filter(i => i.type === "分镜视频").length,
);

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

const visibleTypeBreakdown = computed(() =>
  allTypeBreakdown.value.filter(item => item.total > 0),
);

/** Clear status message during generation (backend doesn't stream progress). */
const generationProgress = computed(() => {
  if (!isAssetsBusy.value) return "";
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
  return `无法进入合成渲染：${lines.join("；")}`;
});

/* -------------------------------------------------------------------------- */
/*  Lifecycle                                                                 */
/* -------------------------------------------------------------------------- */

let autoGenerated = false;

/** 桥接快照加载完成到 generateAssetPlan 乐观更新之间的空白间隙 */
const pendingAutoGenerate = ref(false);

async function triggerAutoGenerate() {
  if (autoGenerated) return;
  const planSnap = assetPlanningStore.state.snapshot;
  if (
    planSnap &&
    !planSnap.active_asset_plan &&
    (planSnap.current_status === "storyboard_ready" ||
      planSnap.current_status === "asset_plan_ready") &&
    !assetPlanningStore.state.isLoading &&
    !assetPlanningStore.state.loadError
  ) {
    autoGenerated = true;
    pendingAutoGenerate.value = true;
    startAssetPolling();
    try {
      await assetPlanningStore.generateAssetPlan();
      if (!assetPlanningStore.state.loadError) {
        ElMessage.success("资产规划生成完成");
      }
    } finally {
      pendingAutoGenerate.value = false;
    }
    startAssetPolling();
  }
}

watch(() => assetPlanningStore.state.snapshot, async (snapshot) => {
  if (snapshot && !snapshot.active_asset_plan && !autoGenerated) {
    await triggerAutoGenerate();
  }
});

onMounted(async () => {
  initialLoadDone.value = false;
  try {
    await storyboardStore.loadActiveStoryboardSnapshot();
    await assetPlanningStore.loadActiveAssetPlanSnapshot();
    scriptStore.loadActiveScriptSnapshot();

    const planSnap = assetPlanningStore.state.snapshot;

    // 规划生成中 → 启动轮询，等待完成
    if (
      planSnap?.current_status === "asset_plan_generating" ||
      planSnap?.active_asset_plan?.execution_state?.generating
    ) {
      pendingAutoGenerate.value = false;
      startAssetPolling();
      return;
    }

    // 从 storyboard 确认后进入 → 自动开始规划生成
    await triggerAutoGenerate();
    if (autoGenerated) return;

    // 规划就绪 → 加载 assets 快照
    await assetsStore.loadProject();
    assetSnapshotLoaded.value = true;
    const assetsGen =
      assetsStore.state.snapshot?.active_assets?.execution_state?.generating;
    if (assetsGen) {
      startAssetPolling();
      return;
    }
  } finally {
    initialLoadDone.value = true;
    if (!autoGenerated) {
      pendingAutoGenerate.value = false;
    }
    setupBackToTopObserver();
  }
});

function setupBackToTopObserver() {
  // defer until DOM settled
  setTimeout(() => {
    setUpBackToTopObserver();
  }, 600);
}

/* -------------------------------------------------------------------------- */
/*  Actions                                                                   */
/* -------------------------------------------------------------------------- */

async function handleGeneratePlan() {
  autoGenerated = true;
  pendingAutoGenerate.value = true;
  startAssetPolling();
  try {
    await assetPlanningStore.generateAssetPlan();
  } finally {
    pendingAutoGenerate.value = false;
  }
  if (!assetPlanningStore.state.loadError) {
    ElMessage.success("资产规划生成完成");
  }
}

async function handleGenerateBasic() {
  if (isAssetsBusy.value) return;
  isStartingBasicAssets.value = true;
  startAssetPolling();
  try {
    await assetsStore.generateAssets({ enabledProviderTypes: ["tts", "sfx", "bgm"] });
  } finally {
    isStartingBasicAssets.value = false;
    startAssetPolling();
  }
}

async function handleGenerateMissing() {
  if (isAssetsBusy.value) return;
  if (checkDemoVisualBlock()) return;
  const count = blockedItems.value.length;
  const types = [...new Set(blockedItems.value.map(i => i.type))].join("、");
  const { imgCount, vidSec, estCost } = estimateBlockedItemsCost(blockedItems.value);
  const costText = imgCount + vidSec > 0
    ? `\n预估费用约 ¥${estCost.toFixed(2)}（${imgCount} 张图 + ${vidSec}s 视频）`
    : "\n口播/字幕/音效费用较低，约 ¥1 以内";
  try {
    await ElMessageBox.confirm(
      `将生成 ${count} 个未完成任务（${types}），已完成的不会被覆盖。${costText}\n确定继续？`,
      "确认批量生成剩余",
      { confirmButtonText: "确定生成", cancelButtonText: "取消", type: "info" },
    );
  } catch { return; }
  await assetsStore.generateAssets({ mode: "missing_only" });
  if (await handleDemoGeneratingError()) return;
  if (!assetsStore.state.loadError) {
    ElMessage.success("剩余资产生成完成");
  }
}

async function handleGenerateByType(taskType: string, typeLabel: string) {
  if (isAssetsBusy.value) return;
  if (checkDemoVisualBlock()) return;
  const taskIds = blockedItems.value
    .filter(i => (taskType === "image_still" && i.type === "分镜图") || (taskType === "video_clip" && i.type === "分镜视频"))
    .map(i => i.taskId);
  if (taskIds.length === 0) return;
  const { imgCount, vidSec, estCost } = estimateBlockedItemsCost(
    blockedItems.value.filter(i => taskIds.includes(i.taskId)),
  );
  try {
    await ElMessageBox.confirm(
      `将生成 ${taskIds.length} 个${typeLabel}，预估 ¥${estCost.toFixed(2)}。\n确定继续？`,
      `生成全部${typeLabel}`,
      { confirmButtonText: "确定生成", cancelButtonText: "取消", type: "info" },
    );
  } catch { return; }
  await assetsStore.generateAssets({ mode: "selected", taskIds });
  await handleDemoGeneratingError();
}

async function handleGenerateSelected() {
  if (isAssetsBusy.value) return;
  if (checkDemoVisualBlock()) return;
  const ids = selectedBlockedIds.value;
  if (ids.length === 0) return;
  const items = blockedItems.value.filter(i => ids.includes(i.taskId));
  const { estCost } = estimateBlockedItemsCost(items);
  try {
    await ElMessageBox.confirm(
      `将生成选中的 ${ids.length} 项，预估 ¥${estCost.toFixed(2)}。\n确定继续？`,
      "生成选中项",
      { confirmButtonText: "确定生成", cancelButtonText: "取消", type: "info" },
    );
  } catch { return; }
  await assetsStore.generateAssets({ mode: "selected", taskIds: ids });
  if (await handleDemoGeneratingError()) { selectedBlockedIds.value = []; return; }
  selectedBlockedIds.value = [];
}

function toggleBlockedItem(taskId: string) {
  const idx = selectedBlockedIds.value.indexOf(taskId);
  if (idx >= 0) {
    selectedBlockedIds.value = selectedBlockedIds.value.filter(id => id !== taskId);
  } else {
    selectedBlockedIds.value = [...selectedBlockedIds.value, taskId];
  }
}

async function handleBatchUpgrade() {
  if (isAssetsBusy.value) return;
  if (checkDemoVisualBlock()) return;
  const count = upgradableSegments.value.length;
  const { rate, estimatedTotal } = getVideoUpgradeCostHint();
  try {
    await ElMessageBox.confirm(
      `将为 ${count} 个关键分镜(turn/peak)升级为 API 视频。\n费用：${rate}，预估 ¥${estimatedTotal.toFixed(2)} × ${count}。\n确定继续？`,
      "批量升级为 API 视频",
      { confirmButtonText: "确定升级", cancelButtonText: "取消", type: "info" },
    );
  } catch { return; }
  for (const seg of upgradableSegments.value) {
    try { await assetsStore.upgradeSegmentToVideo(seg.segment_id); } catch { /* continue */ }
  }
  await assetsStore.loadProject();
  ElMessage.success("API 视频任务已创建");
}

function handleUploadFile(taskId: string, file: File) {
  assetsStore.uploadArtifact(taskId, file);
}

async function handleGenerateTask(taskId: string) {
  // Demo mode: block image/video task types
  const task = assetTasks.value.find(t => t.task_id === taskId);
  if (task && (task.task_type === "image_still" || task.task_type === "video_clip") && checkDemoVisualBlock()) return;
  // Show cost hint for paid task types
  const taskLabel = task ? (TASK_TYPE_LABELS[task.task_type] ?? task.task_type) : taskId;
  const costHint = task ? getTaskCostHint(task.task_type) : "";
  try {
    if (costHint) {
      await ElMessageBox.confirm(
        `将为「${taskLabel}」触发生成（${costHint}），仅影响当前任务。确定继续？`,
        "确认单任务生成",
        { confirmButtonText: "确定生成", cancelButtonText: "取消", type: "info" },
      );
    }
  } catch { return; }
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
    if (isDemoVisualBlockedError(error)) {
      showDemoModeBlock();
      return;
    }
    const msg = error instanceof Error ? error.message : "生成失败";
    ElMessage.error("单任务生成失败：" + msg);
  }
}

async function handleUpgradeVideo(segmentId: string) {
  if (checkDemoVisualBlock()) return;
  const seg = segments.value.find(s => s.segment_id === segmentId);
  const segLabel = seg ? `#${segments.value.indexOf(seg) + 1}` : segmentId;
  const { rate, estimatedTotal } = getVideoUpgradeCostHint();
  try {
    await ElMessageBox.confirm(
      `将为分镜 ${segLabel} 新增 API 视频任务（默认 720P / 5 秒，不影响图片+运镜路线）。\n费用：${rate}，预估 ¥${estimatedTotal.toFixed(2)}。\n切换后可在分镜卡片中手动生成或上传视频。`,
      "升级为 API 视频",
      { confirmButtonText: "确定升级", cancelButtonText: "取消", type: "info" },
    );
  } catch { return; }
  try {
    await assetsStore.upgradeSegmentToVideo(segmentId);
    await assetsStore.loadProject();
    ElMessage.success("已切换为 API 视频模式，可手动生成或上传视频");
  } catch (error) {
    if (isDemoVisualBlockedError(error)) {
      showDemoModeBlock();
      return;
    }
    const msg = error instanceof Error ? error.message : "升级失败";
    ElMessage.error("视频升级失败：" + msg);
  }
}

function handleRetry() {
  assetPlanningStore.retryLoad();
  assetsStore.loadProject();
}

async function handleRefreshGeneratingStatus() {
  await loadAssetSnapshot();
}

function handleConfirm() {
  if (!checkStageRollback("asset")) return;
  if (!canCompose.value) {
    ElMessage.warning(blockedReasonText.value || "资产尚未全部就绪");
    return;
  }
  ElMessage.success("资产确认完成，进入合成渲染阶段");
  workspaceStore.setCurrentStep(COMPOSE_STEP_INDEX);
  const pid = projectStore.state.projectId; if (pid) router.push(`/projects/${pid}/compose-render`);
}
</script>

<template>
  <div class="asset-panel">
    <!-- Demo mode banner -->
    <el-alert
      v-if="demoMode"
      title="演示模式"
      description="比赛演示期间，图片和视频生成功能已关闭。您可以浏览已有的示例项目体验完整效果，口播音频、字幕、音效、配乐等非视觉资产生成不受影响。"
      type="warning"
      show-icon
      :closable="false"
      class="asset-demo-banner"
    />

    <!-- 自动生成中（组件级桥接，覆盖 initialLoadDone=false 期间的空白） -->
    <StageGenerating
      v-if="pendingAutoGenerate"
      title="正在生成资产规划"
      hint="正在调用大模型分析分镜并规划资产，可能需要 1-2 分钟。"
      secondary-hint="系统每 5 秒自动检查生成状态，无需手动刷新。"
    >
      <template #action>
        <el-button
          :loading="assetPlanningStore.state.isLoading || assetsStore.state.isLoading"
          @click="handleRefreshGeneratingStatus"
        >
          刷新状态
        </el-button>
      </template>
    </StageGenerating>

    <!-- 查询服务器已有快照时的加载态，不代表正在生成新资产规划 -->
    <div
      v-else-if="phase.kind === 'loading'"
      class="asset-loading asset-skeleton"
      aria-live="polite"
    >
      <div class="asset-loading-card">
        <h2>正在加载资产状态</h2>
        <p>正在查询服务器已有结果，请稍候。</p>
      </div>
    </div>

    <!-- 规划生成中：全屏阻塞 -->
    <StageGenerating
      v-else-if="phase.kind === 'plan_generating' && generatingView"
      :title="generatingView.title"
      :hint="generatingView.hint"
      :progress="generatingView.progress"
      secondary-hint="系统每 5 秒自动检查生成状态，无需手动刷新。"
    >
      <template #action>
        <el-button
          :loading="assetPlanningStore.state.isLoading || assetsStore.state.isLoading"
          @click="handleRefreshGeneratingStatus"
        >
          刷新状态
        </el-button>
      </template>
    </StageGenerating>

    <!-- 错误 -->
    <div v-else-if="phase.kind === 'error'" class="asset-error-card">
      <el-alert
        :title="'加载失败：' + phase.message"
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

    <!-- 无规划 -->
    <div
      v-else-if="phase.kind === 'no_plan'"
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

    <!-- 规划就绪但无 manifest：规划概览卡片 -->
    <div v-else-if="phase.kind === 'plan_ready_no_manifest'" class="asset-plan-overview-wrapper">
      <div class="asset-plan-overview">
        <h3 class="asset-overview-title">资产规划概览</h3>
        <div class="asset-overview-types">
          <div v-for="item in planSummary" :key="item.label" class="asset-overview-type-row">
            <span class="asset-overview-type-label">{{ item.label }}</span>
            <el-tag size="small" type="info">{{ item.count }} 项</el-tag>
          </div>
        </div>
        <p class="asset-plan-overview-hint">
          基础资产（口播音频、字幕、运镜、音效、配乐）需手动触发生成；分镜图和视频后续可在卡片中逐项生成、上传，或通过概览区批量生成。
          <span v-if="estimatedCost" class="asset-plan-cost-estimate">
            <br/>基础资产生成费用约 ¥{{ (estimatedCost.ttsCost).toFixed(2) }}（口播 {{ estimatedCost.ttsChars }} 字）。
            <br/>剩余视觉资产（{{ estimatedCost.images }} 张图{{ estimatedCost.videoTotalSec > 0 ? ' + ' + estimatedCost.videoTotalSec.toFixed(0) + 's 视频' : '' }}）可后续按需生成，预估 ¥{{ (estimatedCost.total - estimatedCost.ttsCost).toFixed(2) }}。
          </span>
        </p>
        <div class="asset-plan-overview-actions">
          <el-button
            type="primary"
            :loading="false"
            @click="handleGenerateBasic"
          >
            生成基础资产
          </el-button>
        </div>
      </div>

      <!-- 分镜卡片骨架 -->
      <div v-if="segments.length > 0" class="asset-segments-count">
        <span class="asset-segments-count-text">共 {{ segmentCount }} 个镜头</span>
      </div>
      <div v-if="segments.length > 0" class="asset-segments">
        <div v-for="(segment, index) in segments" :key="segment.segment_id" class="segment-card-skeleton">
          <div class="skeleton-header">
            <span class="skeleton-badge">#{{ index + 1 }}</span>
            <span class="skeleton-text-short"></span>
          </div>
          <div class="skeleton-body">
            <div class="skeleton-media"></div>
            <div class="skeleton-info">
              <div class="skeleton-line"></div>
              <div class="skeleton-line skeleton-line--short"></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 基础资产生成中：规划概览 + 内联进度 -->
    <div v-else-if="phase.kind === 'basic_assets_generating'" class="asset-plan-overview-wrapper">
      <div class="asset-plan-overview">
        <h3 class="asset-overview-title">资产规划概览</h3>
        <div class="asset-overview-types">
          <div v-for="item in planSummary" :key="item.label" class="asset-overview-type-row">
            <span class="asset-overview-type-label">{{ item.label }}</span>
            <el-tag size="small" type="info">{{ item.count }} 项</el-tag>
          </div>
        </div>
        <div class="asset-inline-progress">
          <el-alert
            title="正在生成基础资产（口播、字幕、音效、配乐）"
            type="info"
            :closable="false"
          />
          <p class="asset-generating-progress">{{ generationProgress }}</p>
        </div>
        <div class="asset-plan-overview-actions">
          <el-button type="primary" loading disabled>
            生成基础资产（处理中...）
          </el-button>
        </div>
      </div>

      <!-- 分镜卡片骨架 -->
      <div v-if="segments.length > 0" class="asset-segments-count">
        <span class="asset-segments-count-text">共 {{ segmentCount }} 个镜头</span>
      </div>
      <div v-if="segments.length > 0" class="asset-segments">
        <div v-for="(segment, index) in segments" :key="segment.segment_id" class="segment-card-skeleton">
          <div class="skeleton-header">
            <span class="skeleton-badge">#{{ index + 1 }}</span>
            <span class="skeleton-text-short"></span>
          </div>
          <div class="skeleton-body">
            <div class="skeleton-media"></div>
            <div class="skeleton-info">
              <div class="skeleton-line"></div>
              <div class="skeleton-line skeleton-line--short"></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 基础资产失败 -->
    <div v-else-if="phase.kind === 'basic_assets_failed'" class="asset-plan-overview-wrapper">
      <div class="asset-plan-overview">
        <h3 class="asset-overview-title">资产规划概览</h3>
        <div class="asset-overview-types">
          <div v-for="item in planSummary" :key="item.label" class="asset-overview-type-row">
            <span class="asset-overview-type-label">{{ item.label }}</span>
            <el-tag size="small" type="info">{{ item.count }} 项</el-tag>
          </div>
        </div>
        <el-alert
          :title="'基础资产生成失败：' + phase.error"
          type="error"
          :closable="false"
        />
        <div class="asset-plan-overview-actions">
          <el-button type="primary" @click="handleGenerateBasic">
            重试生成基础资产
          </el-button>
        </div>
      </div>
    </div>

    <!-- manifest 就绪：完整正文区 -->
    <template v-else>
      <!-- 全局设置 -->
      <details v-if="hasGlobalInfo" class="asset-global-settings">
        <summary class="asset-global-toggle">全局设置</summary>
        <div class="asset-global-grid">
          <div v-if="voiceLabel" class="asset-global-field">
            <span class="asset-global-label">口播音色</span>
            <span class="asset-global-value">{{ voiceLabel }}</span>
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

      <!-- 资产概览（合并状态栏+详情） -->
      <details class="asset-overview-details">
        <summary class="asset-overview-toggle">
          <span class="asset-overview-toggle-title">
            资产概览
            <span class="asset-overview-progress-inline">
              {{ executionStats.completed }}/{{ assetTasks.length }}
            </span>
            <el-progress
              :percentage="assetTasks.length > 0 ? Math.round(executionStats.completed / assetTasks.length * 100) : 0"
              :status="canCompose ? 'success' : undefined"
              :stroke-width="8"
              class="asset-overview-progress-bar"
            />
          </span>
          <span v-if="blockedItems.length > 0" class="asset-overview-summary">
            {{ blockedItems.slice(0, 3).map(i => i.type).join('、') }}待生成，共 {{ blockedItems.length }} 项
          </span>
          <span class="asset-overview-toggle-actions" @click.stop>
            <el-button
              v-if="blockedItems.length > 0"
              type="primary"
              size="small"
              :loading="isAssetsBusy"
              :disabled="isAssetsBusy"
              @click="handleGenerateMissing"
            >
              {{ isAssetsBusy ? "生成中..." : "批量生成剩余" }}
            </el-button>
          </span>
          <p v-if="isAssetsBusy && generationProgress" class="asset-generating-progress">
            {{ generationProgress }}
          </p>
        </summary>

        <div class="asset-overview-body">
          <!-- 资产完成度 -->
          <div class="asset-overview-types-v2">
            <div
              v-for="item in visibleTypeBreakdown"
              :key="item.label"
              class="asset-type-pill"
              :class="{
                'asset-type-pill--done': item.completed === item.total && item.total > 0,
                'asset-type-pill--blocked': item.total > 0 && item.completed < item.total,
              }"
            >
              <span class="asset-type-pill-label">{{ item.label }}</span>
              <span class="asset-type-pill-count">
                {{ item.completed + '/' + item.total }}
              </span>
            </div>
          </div>

          <!-- 待处理项 -->
          <div v-if="blockedItems.length > 0" class="asset-detail-blocked">
            <h4 class="asset-detail-blocked-title">待处理项（{{ blockedItems.length }}）</h4>
            <div class="asset-blocked-chips">
              <button
                v-for="item in visibleBlockedItems"
                :key="item.taskId"
                class="asset-blocked-chip"
                @click="scrollToTask(item.taskId)"
              >
                <span class="asset-blocked-chip-check" @click.stop="toggleBlockedItem(item.taskId)">
                  {{ selectedBlockedIds.includes(item.taskId) ? '☑' : '☐' }}
                </span>
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

          <!-- 成本 -->
          <div class="asset-detail-cost">
            <h4 class="asset-detail-cost-title">已生成成本估算</h4>
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

          <!-- 批量操作 -->
          <div class="asset-detail-actions">
            <el-button
              v-if="selectedBlockedIds.length > 0"
              size="small"
              type="primary"
              :loading="isAssetsBusy"
              :disabled="isAssetsBusy"
              @click="handleGenerateSelected"
            >
              生成选中项（{{ selectedBlockedIds.length }}）
            </el-button>
            <el-button
              v-if="missingImageCount > 0"
              size="small"
              :loading="isAssetsBusy"
              :disabled="isAssetsBusy"
              @click="handleGenerateByType('image_still', '分镜图')"
            >
              生成全部图片（{{ missingImageCount }}）
            </el-button>
            <el-button
              v-if="missingVideoCount > 0"
              size="small"
              :loading="isAssetsBusy"
              :disabled="isAssetsBusy"
              @click="handleGenerateByType('video_clip', '分镜视频')"
            >
              生成全部视频（{{ missingVideoCount }}）
            </el-button>
            <el-button
              v-if="blockedItems.length > 0 && selectedBlockedIds.length === 0 && missingImageCount === 0 && missingVideoCount === 0"
              size="small"
              type="primary"
              :loading="isAssetsBusy"
              :disabled="isAssetsBusy"
              @click="handleGenerateMissing"
            >
              {{ isAssetsBusy ? "生成中..." : "生成全部剩余（" + blockedItems.length + "）" }}
            </el-button>
            <el-button
              v-if="upgradableSegments.length > 0"
              size="small"
              plain
              type="primary"
              @click="handleBatchUpgrade"
            >
              升级 {{ upgradableSegments.length }} 个分镜为 API 视频
            </el-button>
          </div>
        </div>
      </details>

      <!-- 口播音频 -->
      <details v-if="narrationArtifact && narrationAudioUrl" class="asset-narration-bar" :open="false">
        <summary class="asset-narration-bar-header">
          <span>口播音频 🔊</span>
          <span class="asset-narration-bar-meta">
            <span v-if="narrationDuration !== null">{{ narrationDuration.toFixed(1) }}s</span>
            <span v-if="costBreakdown.tts.charCount > 0">{{ costBreakdown.tts.charCount }} 字</span>
            <span>¥{{ costBreakdown.tts.total.toFixed(2) }}</span>
          </span>
        </summary>
        <div class="asset-narration-bar-body">
          <div class="asset-narration-audio-row">
            <audio controls :src="narrationAudioUrl" class="asset-narration-audio" />
            <span v-if="voiceLabel" class="asset-narration-voice-label">🎤 {{ voiceLabel }}</span>
          </div>
          <p v-if="fullScriptText"
             class="asset-narration-script-text"
             :class="{ 'asset-narration-script-text--collapsed': !narrationScriptExpanded }">
            {{ fullScriptText }}
          </p>
          <button v-if="narrationScriptLong" class="asset-narration-script-toggle" @click="narrationScriptExpanded = !narrationScriptExpanded">
            {{ narrationScriptExpanded ? '收起' : '展开全文' }}
          </button>
        </div>
      </details>

      <!-- 分镜列表 -->
      <div class="asset-segments-header">
        <span class="asset-segments-count">共 {{ segmentCount }} 个镜头</span>
        <span class="asset-segments-progress">{{ executionStats.completed }} / {{ assetTasks.length }} 已完成</span>
      </div>
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
          :generating-task-ids="assetsStore.state.generatingTaskIds"
          :project-id="projectId"
          :focus-task-id="focusTaskId"
          @upload-file="handleUploadFile"
          @generate-task="handleGenerateTask"
          @upgrade-video="handleUpgradeVideo"
        />
      </div>

      <!-- 粘性底栏 -->
      <div class="asset-bottom-bar">
        <div class="asset-bottom-left">
          <span class="asset-bottom-count">
            {{ executionStats.completed }} / {{ assetTasks.length }} 已完成
          </span>
          <p v-if="!canCompose" class="asset-bottom-reason">{{ blockedReasonText }}</p>
        </div>
        <div class="asset-bottom-actions">
          <el-tooltip
            v-if="!canCompose || isAssetsBusy"
            :content="isAssetsBusy ? '资产生成进行中，请等待完成后再操作' : blockedReasonText"
            placement="top"
          >
            <span>
              <button class="asset-bottom-confirm-btn" disabled>
                确认并进入合成渲染
              </button>
            </span>
          </el-tooltip>
          <button
            v-else
            class="asset-bottom-confirm-btn"
            @click="handleConfirm"
          >
            确认并进入合成渲染
          </button>
        </div>
      </div>

      <!-- Back to top -->
      <button
        v-if="showBackToTop"
        class="asset-back-to-top"
        @click="scrollToTop"
        title="回到顶部"
      >
        <svg viewBox="0 0 24 24"><path d="m18 15-6-6-6 6"/></svg>
      </button>
    </template>

    <StageLoadingBar
      :visible="isAssetsBusy"
      :text="assetLoadingBarText"
    />
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

.asset-demo-banner {
  border-radius: var(--radius-card);
}

/* ---- Error / Loading / Empty ---- */
.asset-error-card {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-md);
  border-radius: var(--radius-card);
  background: var(--bg-card);
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

.asset-plan-auto-generating {
  margin-top: var(--space-sm);
}

.asset-plan-overview-actions {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
  padding-top: var(--space-sm);
  border-top: 1px solid var(--border-default);
}

.asset-plan-overview-wrapper {
  display: grid;
  gap: var(--space-md);
}

.asset-inline-progress {
  display: grid;
  gap: var(--space-sm);
  margin-top: var(--space-sm);
}

/* ---- Asset overview details ---- */
.asset-overview-details {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--bg-card);
  overflow: hidden;
}

.asset-overview-toggle {
  cursor: pointer;
  padding: var(--space-md);
  font-size: 0.92rem;
  font-weight: var(--font-subheading);
  color: var(--text-heading);
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  user-select: none;
  list-style: none;
  flex-wrap: wrap;
}

.asset-overview-toggle::-webkit-details-marker { display: none; }

.asset-overview-toggle::before {
  content: "▸";
  font-size: 0.8rem;
  transition: transform 150ms ease;
}

details[open] > .asset-overview-toggle::before {
  transform: rotate(90deg);
}

details[open] > .asset-overview-toggle {
  border-bottom: 1px solid var(--border-default);
}

.asset-overview-toggle-title {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.asset-overview-progress-inline {
  font-size: 0.82rem;
  color: var(--text-muted);
  font-weight: 400;
  white-space: nowrap;
}

.asset-overview-progress-bar {
  width: 160px;
}

.asset-overview-summary {
  font-size: 0.82rem;
  color: var(--text-muted);
  font-weight: 400;
  margin-left: auto;
  margin-right: var(--space-md);
}

.asset-overview-toggle-actions {
  display: flex;
  gap: var(--space-xs);
  align-items: center;
}

.asset-overview-body {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-md);
}

.asset-detail-blocked {
  display: grid;
  gap: var(--space-xs);
  padding-top: var(--space-sm);
  border-top: 1px solid var(--border-default);
}

.asset-detail-blocked-title {
  margin: 0;
  font-size: 0.92rem;
  font-weight: var(--font-subheading);
  color: var(--color-warning);
}

.asset-detail-cost {
  display: grid;
  gap: var(--space-xs);
  padding-top: var(--space-sm);
  border-top: 1px solid var(--border-default);
}

.asset-detail-cost-title {
  margin: 0;
  font-size: 0.88rem;
  font-weight: var(--font-subheading);
  color: var(--text-heading);
}

.asset-detail-actions {
  padding-top: var(--space-sm);
  border-top: 1px solid var(--border-default);
}

/* ---- Segment card skeleton ---- */
.asset-loading {
  min-height: 360px;
  display: grid;
  place-items: center;
  padding: var(--space-xl);
}

.asset-loading-card {
  display: grid;
  gap: var(--space-xs);
  text-align: center;
  color: var(--text-secondary);
}

.asset-loading-card h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: 20px;
}

.asset-loading-card p {
  margin: 0;
  color: var(--text-muted);
}

.segment-card-skeleton {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: var(--space-md);
  padding: var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--bg-card);
}

.skeleton-header {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding-bottom: var(--space-md);
  border-bottom: 1px solid var(--border-default);
  margin-bottom: var(--space-md);
}

.skeleton-badge {
  width: 28px;
  height: 22px;
  border-radius: 4px;
  background: var(--bg-panel);
}

.skeleton-text-short {
  width: 120px;
  height: 14px;
  border-radius: 4px;
  background: var(--bg-panel);
}

.skeleton-body {
  display: contents;
}

.skeleton-media {
  aspect-ratio: 9 / 16;
  border-radius: var(--radius-sm);
  background: var(--bg-panel);
}

.skeleton-info {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.skeleton-line {
  width: 100%;
  height: 12px;
  border-radius: 4px;
  background: var(--bg-panel);
}

.skeleton-line--short {
  width: 60%;
}

/* ---- Deprecated: kept for clean removal later ---- */

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

.asset-bottom-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.asset-bottom-count {
  font-weight: var(--font-subheading);
  font-size: 0.92rem;
  color: var(--text-heading);
}

.asset-bottom-reason {
  font-size: 0.82rem;
  color: var(--color-warning);
  line-height: 1.5;
  max-width: 600px;
}

.asset-bottom-actions {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
}

.asset-bottom-confirm-btn {
  height: 38px;
  padding: 0 22px;
  border-radius: 10px;
  border: none;
  color: var(--text-inverse);
  font-family: inherit;
  font-size: 14px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
  background: var(--accent-gradient);
  box-shadow: 0 4px 14px rgba(184, 115, 51, 0.22);
  transition: transform 180ms ease, box-shadow 180ms ease, filter 180ms ease;
}

.asset-bottom-confirm-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 12px 30px rgba(201, 162, 39, 0.32);
  filter: brightness(1.05);
}

.asset-bottom-confirm-btn:active:not(:disabled) {
  transform: translateY(0);
}

.asset-bottom-confirm-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
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

.asset-blocked-chip--selected {
  border-color: var(--accent-primary);
  background: color-mix(in srgb, var(--accent-primary) 8%, var(--bg-panel));
}

.asset-blocked-chip-check {
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  padding: 0 2px;
}

.asset-blocked-chip-check:hover {
  color: var(--accent-primary);
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

/* ---- Global narration block ---- */
.asset-narration-card {
  padding: var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--bg-card);
  display: grid;
  gap: var(--space-sm);
}

.asset-narration-title {
  font-size: 0.88rem;
  font-weight: var(--font-subheading);
  color: var(--text-heading);
  margin: 0;
}

.asset-narration-player {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  flex-wrap: wrap;
}

.asset-narration-audio {
  height: 32px;
  min-width: 280px;
  border-radius: var(--radius-sm);
}

.asset-narration-audio-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
}

.asset-narration-voice-label {
  font-size: 0.82rem;
  font-weight: var(--font-subheading);
  color: var(--text-secondary);
  white-space: nowrap;
}

.asset-narration-meta {
  display: flex;
  gap: var(--space-md);
  font-size: 0.82rem;
  color: var(--text-muted);
}

.asset-narration-script {
  margin-top: var(--space-sm);
  padding-top: var(--space-sm);
  border-top: 1px solid var(--border-default);
}

.asset-narration-script-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-xs);
}

.asset-narration-script-label {
  font-size: 0.82rem;
  color: var(--text-muted);
  font-weight: 500;
}

.asset-narration-script-toggle {
  border: none;
  background: none;
  color: var(--accent-primary);
  font-size: 0.8rem;
  cursor: pointer;
  padding: 0;
}

.asset-narration-script-toggle:hover {
  text-decoration: underline;
}

.asset-narration-script-text {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.85;
  color: var(--text-body);
  white-space: pre-wrap;
}

.asset-narration-script-text--collapsed {
  display: -webkit-box;
  -webkit-line-clamp: 6;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ---- Segments header ---- */
.asset-segments-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.asset-segments-count {
  font-size: 0.88rem;
  color: var(--text-muted);
}

.asset-segments-progress {
  font-weight: var(--font-subheading);
  font-size: 0.88rem;
  color: var(--text-heading);
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

/* ---- Back to top ---- */
.asset-back-to-top {
  position: fixed;
  right: 28px;
  bottom: 28px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid rgba(201, 162, 39, 0.22);
  background:
    radial-gradient(circle at 50% 40%, rgba(201, 162, 39, 0.14), rgba(201, 162, 39, 0.04) 70%),
    var(--bg-card);
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.3);
  cursor: pointer;
  display: grid;
  place-items: center;
  z-index: 20;
  transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
  animation: assetBackToTopIn 220ms ease;
}

.asset-back-to-top:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.38);
  border-color: rgba(201, 162, 39, 0.35);
}

.asset-back-to-top svg {
  width: 18px;
  height: 18px;
  stroke: #e4c26f;
  fill: none;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

@keyframes assetBackToTopIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ---- Narration bar ---- */
.asset-narration-bar {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--bg-card);
  overflow: hidden;
}

.asset-narration-bar-header {
  cursor: pointer;
  padding: var(--space-sm) var(--space-md);
  font-size: 0.88rem;
  font-weight: var(--font-subheading);
  color: var(--text-heading);
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  list-style: none;
  user-select: none;
}

.asset-narration-bar-header::-webkit-details-marker { display: none; }

.asset-narration-bar-header::before {
  content: "▸";
  font-size: 0.8rem;
  transition: transform 150ms ease;
}

details[open] > .asset-narration-bar-header::before {
  transform: rotate(90deg);
}

.asset-narration-bar-meta {
  display: flex;
  gap: var(--space-md);
  font-size: 0.82rem;
  color: var(--text-muted);
  font-weight: 400;
  align-items: center;
  flex: 1;
  justify-content: flex-end;
}

.asset-narration-bar-body {
  padding: var(--space-sm) var(--space-md) var(--space-md);
  display: grid;
  gap: var(--space-sm);
  border-top: 1px solid var(--border-default);
}

/* ---- Responsive ---- */
@media (max-width: 640px) {
  .asset-overview-toggle {
    flex-direction: column;
    align-items: stretch;
  }
  .asset-overview-toggle-actions {
    justify-content: flex-end;
  }
}

@media (max-width: 480px) {
  .segment-card-skeleton {
    grid-template-columns: 1fr;
  }
  .skeleton-media { display: none; }
}
</style>
