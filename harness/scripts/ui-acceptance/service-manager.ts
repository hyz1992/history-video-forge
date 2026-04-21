import { spawn, type ChildProcess } from "node:child_process";

import { waitForReady } from "./wait-for-ready";

export interface UiAcceptanceServiceDefinition {
  name: "backend" | "frontend";
  command: string;
  args: string[];
  cwd: string;
  readyUrl: string;
  intervalMs: number;
  timeoutMs: number;
}

export interface UiAcceptanceServiceHandle {
  name: UiAcceptanceServiceDefinition["name"];
  stop: () => Promise<void> | void;
}

export interface RunWithUiAcceptanceServicesDependencies {
  cwd?: string;
  spawnService?: (
    service: UiAcceptanceServiceDefinition,
  ) => Promise<UiAcceptanceServiceHandle> | UiAcceptanceServiceHandle;
  waitForService?: (
    service: UiAcceptanceServiceDefinition,
    handle: UiAcceptanceServiceHandle,
  ) => Promise<void> | void;
  stopService?: (handle: UiAcceptanceServiceHandle) => Promise<void> | void;
}

export function buildUiAcceptanceServiceDefinitions(
  cwd: string = process.cwd(),
): UiAcceptanceServiceDefinition[] {
  return [
    {
      name: "backend",
      command: "npm",
      args: ["run", "dev:backend"],
      cwd,
      readyUrl: "http://127.0.0.1:3000/healthz",
      intervalMs: 500,
      timeoutMs: 30000,
    },
    {
      name: "frontend",
      command: "npm",
      args: ["run", "dev:frontend"],
      cwd,
      readyUrl: "http://127.0.0.1:5173/",
      intervalMs: 500,
      timeoutMs: 30000,
    },
  ];
}

function getSpawnCommand(command: string) {
  if (process.platform === "win32" && command === "npm") {
    return "npm.cmd";
  }

  return command;
}

function createChildProcessHandle(
  service: UiAcceptanceServiceDefinition,
  childProcess: ChildProcess,
): UiAcceptanceServiceHandle {
  return {
    name: service.name,
    stop: async () => {
      if (childProcess.exitCode !== null) {
        return;
      }

      await new Promise<void>((resolve) => {
        childProcess.once("exit", () => resolve());
        childProcess.kill();
      });
    },
  };
}

async function defaultSpawnService(
  service: UiAcceptanceServiceDefinition,
): Promise<UiAcceptanceServiceHandle> {
  const childProcess = spawn(getSpawnCommand(service.command), service.args, {
    cwd: service.cwd,
    stdio: "pipe",
  });

  return createChildProcessHandle(service, childProcess);
}

async function defaultWaitForService(
  service: UiAcceptanceServiceDefinition,
): Promise<void> {
  await waitForReady({
    serviceName: service.name,
    readyUrl: service.readyUrl,
    intervalMs: service.intervalMs,
    timeoutMs: service.timeoutMs,
  });
}

async function defaultStopService(handle: UiAcceptanceServiceHandle): Promise<void> {
  await handle.stop();
}

export async function runWithUiAcceptanceServices<T>(
  task: (context: { services: UiAcceptanceServiceHandle[] }) => Promise<T> | T,
  dependencies: RunWithUiAcceptanceServicesDependencies = {},
): Promise<T> {
  const services = buildUiAcceptanceServiceDefinitions(dependencies.cwd);
  const spawnService = dependencies.spawnService ?? defaultSpawnService;
  const waitForService = dependencies.waitForService ?? defaultWaitForService;
  const stopService = dependencies.stopService ?? defaultStopService;
  const startedServices: UiAcceptanceServiceHandle[] = [];

  try {
    for (const service of services) {
      const handle = await spawnService(service);
      startedServices.push(handle);
      await waitForService(service, handle);
    }

    return await task({
      services: startedServices,
    });
  } finally {
    for (const handle of [...startedServices].reverse()) {
      await stopService(handle);
    }
  }
}
