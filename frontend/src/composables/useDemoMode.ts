import { ref, readonly } from "vue";

const demoMode = ref(false);
let initialized = false;

/**
 * Fetch backend healthcheck once to determine demo mode status.
 * Safe to call multiple times — only fetches on first invocation.
 */
export async function initDemoMode(): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    const res = await fetch("/api/healthcheck");
    if (res.ok) {
      const data = await res.json();
      demoMode.value = !!data.demoMode;
    }
  } catch {
    // If healthcheck fails, assume not demo mode
    demoMode.value = false;
  }
}

/**
 * Reactive readonly ref for demo mode status.
 */
export function useDemoMode() {
  return readonly(demoMode);
}
