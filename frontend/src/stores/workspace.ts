import { type InjectionKey, type Ref, inject, readonly, ref } from "vue";

export type PipelineStep =
  | "topic"
  | "script"
  | "storyboard"
  | "asset"
  | "compose"
  | "render"
  | "publish";

export const PIPELINE_STEPS: {
  key: PipelineStep;
  label: string;
  index: number;
}[] = [
  { key: "topic", label: "选题", index: 0 },
  { key: "script", label: "文案", index: 1 },
  { key: "storyboard", label: "分镜", index: 2 },
  { key: "asset", label: "资产", index: 3 },
  { key: "compose", label: "合成", index: 4 },
  { key: "render", label: "渲染导出", index: 5 },
  { key: "publish", label: "发布交付", index: 6 },
];

export interface WorkspaceStoreState {
  currentStepIndex: number;
  sidebarCollapsed: boolean;
}

export interface WorkspaceStore {
  state: Readonly<Ref<WorkspaceStoreState>>;
  setCurrentStep: (index: number) => void;
  setCurrentStepByKey: (key: PipelineStep) => void;
  nextStep: () => void;
  prevStep: () => void;
  toggleSidebar: () => void;
  currentStepKey: () => PipelineStep;
  isLastStep: () => boolean;
  isFirstStep: () => boolean;
}

export const workspaceStoreKey: InjectionKey<WorkspaceStore> =
  Symbol("workspaceStore");

export function createWorkspaceStore(): WorkspaceStore {
  const state = ref<WorkspaceStoreState>({
    currentStepIndex: 0,
    sidebarCollapsed: false,
  });

  function setCurrentStep(index: number) {
    if (index >= 0 && index < PIPELINE_STEPS.length) {
      state.value = { ...state.value, currentStepIndex: index };
    }
  }

  function setCurrentStepByKey(key: PipelineStep) {
    const step = PIPELINE_STEPS.find((s) => s.key === key);
    if (step) setCurrentStep(step.index);
  }

  function nextStep() {
    setCurrentStep(state.value.currentStepIndex + 1);
  }

  function prevStep() {
    setCurrentStep(state.value.currentStepIndex - 1);
  }

  function toggleSidebar() {
    state.value = {
      ...state.value,
      sidebarCollapsed: !state.value.sidebarCollapsed,
    };
  }

  function currentStepKey(): PipelineStep {
    return PIPELINE_STEPS[state.value.currentStepIndex].key;
  }

  function isLastStep(): boolean {
    return state.value.currentStepIndex === PIPELINE_STEPS.length - 1;
  }

  function isFirstStep(): boolean {
    return state.value.currentStepIndex === 0;
  }

  return {
    state: readonly(state),
    setCurrentStep,
    setCurrentStepByKey,
    nextStep,
    prevStep,
    toggleSidebar,
    currentStepKey,
    isLastStep,
    isFirstStep,
  };
}

export function useWorkspaceStore(): WorkspaceStore {
  const store = inject(workspaceStoreKey);
  if (!store) throw new Error("WorkspaceStore not provided");
  return store;
}
