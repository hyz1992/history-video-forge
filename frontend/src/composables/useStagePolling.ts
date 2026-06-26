import { onUnmounted, ref, type Ref } from "vue";

interface StagePollingOptions<T> {
  /** 加载当前快照 */
  loadSnapshot: () => Promise<T>;
  /** 快照是否处于生成中 */
  isGenerating: (snapshot: T) => boolean;
  /** 快照是否已完成 */
  isTerminal: (snapshot: T) => boolean;
  /** 轮询间隔 ms，默认 5000 */
  intervalMs?: number;
  /** 生成完成时的回调 */
  onComplete?: (snapshot: T) => void;
}

export interface StagePolling<T> {
  isPolling: Ref<boolean>;
  lastSnapshot: Ref<T | null>;
  pollError: Ref<string | null>;
  startPolling: () => void;
  stopPolling: () => void;
  /** 立即轮询一次，用于手动刷新 */
  pollNow: () => Promise<void>;
}

export function useStagePolling<T>(options: StagePollingOptions<T>): StagePolling<T> {
  const isPolling = ref(false);
  const lastSnapshot = ref<T | null>(null) as Ref<T | null>;
  const pollError = ref<string | null>(null);
  const consecutiveErrors = ref(0);

  let timer: ReturnType<typeof setInterval> | null = null;

  async function pollOnce() {
    try {
      const snapshot = await options.loadSnapshot();
      lastSnapshot.value = snapshot;
      consecutiveErrors.value = 0;
      pollError.value = null;

      if (options.isGenerating(snapshot)) {
        return;
      }
      if (options.isTerminal(snapshot)) {
        stopPolling();
        options.onComplete?.(snapshot);
      } else {
        stopPolling();
      }
    } catch {
      consecutiveErrors.value++;
      pollError.value = `无法获取最新状态，正在重试...（${consecutiveErrors.value} 次）`;
      if (consecutiveErrors.value > 20) {
        stopPolling();
      }
    }
  }

  function startPolling() {
    if (timer) return;
    isPolling.value = true;
    pollOnce();
    timer = setInterval(pollOnce, options.intervalMs ?? 5000);
  }

  function stopPolling() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    isPolling.value = false;
  }

  onUnmounted(() => stopPolling());

  return {
    isPolling,
    lastSnapshot,
    pollError,
    startPolling,
    stopPolling,
    pollNow: pollOnce,
  };
}
