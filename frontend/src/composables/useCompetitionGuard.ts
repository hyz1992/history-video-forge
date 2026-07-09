import { useDemoMode } from "./useDemoMode";
import { useProjectStore } from "../stores/project";
import { ref } from "vue";
import { ElMessage } from "element-plus";

const MAX_PROJECTS = 10;

/** Shared reactive flag — imported components share the same ref */
export const showCompetitionNotice = ref(false);

const STAGE_ORDER = ["topic", "script", "storyboard", "asset", "compose-render", "publish"] as const;
type StageKey = (typeof STAGE_ORDER)[number];

const STATUS_STAGE_MAP: Array<{ prefix: string; stage: StageKey }> = [
  { prefix: "topic", stage: "topic" },
  { prefix: "script", stage: "script" },
  { prefix: "storyboard", stage: "storyboard" },
  { prefix: "asset_plan", stage: "asset" },
  { prefix: "asset", stage: "asset" },
  { prefix: "compose", stage: "compose-render" },
  { prefix: "render", stage: "compose-render" },
  { prefix: "render_ready", stage: "publish" },
];

function getProjectStage(currentStatus: string): StageKey {
  const status = currentStatus || "";
  for (const entry of STATUS_STAGE_MAP) {
    if (status.startsWith(entry.prefix)) {
      return entry.stage;
    }
  }
  return "topic";
}

function getStageIndex(stage: StageKey): number {
  return STAGE_ORDER.indexOf(stage);
}

const STAGE_LABELS: Record<string, string> = {
  topic: "选题",
  script: "文案",
  storyboard: "分镜",
  asset: "资产",
};

/**
 * Competition mode guard: checks demo mode + project count limit + stage rollback.
 */
export function useCompetitionGuard() {
  const isDemoMode = useDemoMode();
  const projectStore = useProjectStore();

  function isProjectLimitReached(): boolean {
    if (!isDemoMode.value) return false;
    return projectStore.state.projects.length >= MAX_PROJECTS;
  }

  /** Show competition notice if demo mode is active and limit reached */
  function checkCreateProject(): boolean {
    if (isDemoMode.value && isProjectLimitReached()) {
      showCompetitionNotice.value = true;
      return false;
    }
    return true;
  }

  /** Show competition notice for re-render in demo mode */
  function checkRecompose(): boolean {
    if (isDemoMode.value) {
      showCompetitionNotice.value = true;
      return false;
    }
    return true;
  }

  /**
   * Check if the project has already advanced beyond the given stage.
   * In demo mode, stage rollback is forbidden.
   */
  function checkStageRollback(stage: StageKey): boolean {
    if (!isDemoMode.value) return true;

    const status = projectStore.state.currentStatus;
    const currentStage = getProjectStage(status);
    const currentIndex = getStageIndex(currentStage);
    const stageIndex = getStageIndex(stage);

    if (currentIndex > stageIndex) {
      const label = STAGE_LABELS[stage] || stage;
      ElMessage.warning(
        `比赛演示模式下，该项目的${label}阶段已完成，不允许重复操作。`,
      );
      return false;
    }
    return true;
  }

  return {
    isDemoMode,
    isProjectLimitReached,
    checkCreateProject,
    checkRecompose,
    checkStageRollback,
    MAX_PROJECTS,
  };
}
