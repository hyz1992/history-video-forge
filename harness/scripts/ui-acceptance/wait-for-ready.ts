export interface WaitForReadyInput {
  serviceName: string;
  readyUrl: string;
  intervalMs: number;
  timeoutMs: number;
}

export interface WaitForReadyResult {
  serviceName: string;
  readyUrl: string;
  attempts: number;
}

export interface WaitForReadyDependencies {
  now?: () => number;
  probe?: (readyUrl: string) => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
}

async function defaultProbe(readyUrl: string): Promise<boolean> {
  try {
    const response = await fetch(readyUrl);
    return response.ok;
  } catch {
    return false;
  }
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function waitForReady(
  input: WaitForReadyInput,
  dependencies: WaitForReadyDependencies = {},
): Promise<WaitForReadyResult> {
  const now = dependencies.now ?? Date.now;
  const probe = dependencies.probe ?? defaultProbe;
  const sleep = dependencies.sleep ?? defaultSleep;
  const startedAt = now();

  let attempts = 0;
  while (true) {
    attempts += 1;

    if (await probe(input.readyUrl)) {
      return {
        serviceName: input.serviceName,
        readyUrl: input.readyUrl,
        attempts,
      };
    }

    if (now() - startedAt >= input.timeoutMs) {
      throw new Error(`${input.serviceName}_not_ready`);
    }

    await sleep(input.intervalMs);
  }
}
