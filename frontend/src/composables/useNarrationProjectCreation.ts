import { computed, ref } from "vue";
import { NarrationCreationError, type CreateProjectInput, type NarrationSelectionOption } from "../stores/project";

export type { NarrationSelectionOption };

/** 用户取消选择：调用者收到后必须放弃后续选题动作。 */
export class NarrationCreationCancelled extends Error {
  constructor() {
    super("narration_creation_cancelled");
    this.name = "NarrationCreationCancelled";
  }
}

export interface NarrationCreationPending {
  reason: string;
  policyVersion: string;
  options: NarrationSelectionOption[];
}

export interface NarrationProjectCreationInput {
  name?: string;
}

/** 任务11C：只协调"创建 → 等待选择 → 带 selection 重试"，不引用 Vue 组件、不重写选题生成逻辑。 */
export type NarrationSelectionChoice = { provider_model_id: string; voice_profile_id: string; policy_version: string };

export function useNarrationProjectCreation(
  createProject: (input?: CreateProjectInput) => Promise<unknown>,
) {
  const pendingSelection = ref<NarrationCreationPending | null>(null);
  const waiting = computed(() => pendingSelection.value !== null);
  let onSelected: ((choice: NarrationSelectionChoice) => void) | null = null;
  let onCancelled: (() => void) | null = null;
  // 创建请求在途时的取消标记：取消先于资格错误到达时，错误到达后不进入等待、整笔放弃。
  let cancelledDuringFlight = false;

  async function attempt(
    input: NarrationProjectCreationInput | undefined,
    selection?: NarrationSelectionChoice,
  ): Promise<{ ok: true; project: unknown } | { ok: true; retrySelection: NarrationSelectionChoice } | { ok: false; error: unknown }> {
    try {
      const project = await createProject({
        ...input,
        ...(selection ? { narrationSelection: selection } : {}),
      });
      return { ok: true, project };
    } catch (error) {
      if (!(error instanceof NarrationCreationError)) return { ok: false, error };
      // 开关关闭：解释不可用，不擅自创建 legacy，也不进入选择等待。
      if (error.code === "narration_mode_unavailable") return { ok: false, error };
      if (cancelledDuringFlight) {
        cancelledDuringFlight = false;
        return { ok: false, error: new NarrationCreationCancelled() };
      }
      // 422 资格不合格 / 409 策略或偏好变化：展示（或更新）合格组合并等待用户选择。
      pendingSelection.value = { reason: error.reason, policyVersion: error.policyVersion, options: error.options };
      const chosen = await new Promise<NarrationSelectionChoice>((resolve, reject) => {
        onSelected = resolve;
        onCancelled = () => reject(new NarrationCreationCancelled());
      });
      return { ok: true, retrySelection: chosen };
    }
  }

  async function createOrAwait(input?: NarrationProjectCreationInput): Promise<unknown> {
    // 重入守卫：已有流程在等待选择时拒绝再次进入，防止覆盖选择回调使前序流程永久挂起。
    if (pendingSelection.value !== null) throw new NarrationCreationCancelled();
    cancelledDuringFlight = false;
    let selection: NarrationSelectionChoice | undefined;
    try {
      for (;;) {
        const result = await attempt(input, selection);
        if ("retrySelection" in result) {
          selection = result.retrySelection;
          continue;
        }
        if (!result.ok) throw result.error;
        return result.project;
      }
    } finally {
      pendingSelection.value = null;
      onSelected = null;
      onCancelled = null;
    }
  }

  function confirmSelection(choice: NarrationSelectionChoice) {
    onSelected?.(choice);
  }

  function cancelSelection() {
    if (onCancelled) onCancelled();
    else cancelledDuringFlight = true;
  }

  return { pendingSelection: computed(() => pendingSelection.value), waiting, createOrAwait, confirmSelection, cancelSelection };
}
