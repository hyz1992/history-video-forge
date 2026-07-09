import { useDemoMode } from "./useDemoMode";
import { useProjectStore } from "../stores/project";
import { ref } from "vue";

const MAX_PROJECTS = 10;

/** Shared reactive flag — imported components share the same ref */
export const showCompetitionNotice = ref(false);

/**
 * Competition mode guard: checks demo mode + project count limit.
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

  return {
    isDemoMode,
    isProjectLimitReached,
    checkCreateProject,
    checkRecompose,
    MAX_PROJECTS,
  };
}
