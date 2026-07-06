import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

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
  prepareService?: (
    service: UiAcceptanceServiceDefinition,
  ) => Promise<void> | void;
  spawnService?: (
    service: UiAcceptanceServiceDefinition,
  ) => Promise<UiAcceptanceServiceHandle> | UiAcceptanceServiceHandle;
  waitForService?: (
    service: UiAcceptanceServiceDefinition,
    handle: UiAcceptanceServiceHandle,
  ) => Promise<void> | void;
  stopService?: (handle: UiAcceptanceServiceHandle) => Promise<void> | void;
  findListeningProcessIds?: (port: number) => Promise<number[]>;
  killProcessTree?: (pid: number) => Promise<void> | void;
}

function readBackendPort(): number {
  return Number(process.env.SERVER_PORT) || 3000;
}

export function buildUiAcceptanceServiceDefinitions(
  cwd: string = process.cwd(),
): UiAcceptanceServiceDefinition[] {
  const backendPort = readBackendPort();
  return [
    {
      name: "backend",
      command: "npm",
      args: ["run", "dev:backend"],
      cwd,
      readyUrl: `http://127.0.0.1:${backendPort}/healthz`,
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

export function buildUiAcceptanceServiceSpawnOptions(
  service: UiAcceptanceServiceDefinition,
): SpawnOptions {
  return {
    cwd: service.cwd,
    stdio: "pipe",
    shell: process.platform === "win32" && service.command === "npm",
  };
}

export function buildUiAcceptanceServiceStopCommand(pid: number) {
  if (process.platform !== "win32") {
    return null;
  }

  return {
    command: "taskkill",
    args: ["/pid", String(pid), "/T", "/F"],
    shell: true,
  } as const;
}

async function stopChildProcess(childProcess: ChildProcess) {
  if (childProcess.exitCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    childProcess.once("exit", () => resolve());

    const stopCommand =
      typeof childProcess.pid === "number"
        ? buildUiAcceptanceServiceStopCommand(childProcess.pid)
        : null;

    if (stopCommand) {
      const killer = spawn(stopCommand.command, stopCommand.args, {
        shell: stopCommand.shell,
        stdio: "ignore",
      });

      killer.once("exit", () => {
        if (childProcess.exitCode !== null) {
          resolve();
        }
      });
      return;
    }

    childProcess.kill();
  });
}

function createChildProcessHandle(
  service: UiAcceptanceServiceDefinition,
  childProcess: ChildProcess,
): UiAcceptanceServiceHandle {
  return {
    name: service.name,
    stop: async () => {
      await stopChildProcess(childProcess);
    },
  };
}

async function defaultSpawnService(
  service: UiAcceptanceServiceDefinition,
): Promise<UiAcceptanceServiceHandle> {
  const childProcess = spawn(
    service.command,
    service.args,
    buildUiAcceptanceServiceSpawnOptions(service),
  );

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

function readPortFromReadyUrl(readyUrl: string): number | null {
  try {
    const url = new URL(readyUrl);
    if (url.port) {
      return Number(url.port);
    }

    return url.protocol === "https:" ? 443 : 80;
  } catch {
    return null;
  }
}

function runCommand(command: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string; exitCode: number | null }>((resolve) => {
    const childProcess = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    childProcess.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    childProcess.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    childProcess.once("error", () => {
      resolve({
        stdout,
        stderr,
        exitCode: null,
      });
    });
    childProcess.once("exit", (exitCode) => {
      resolve({
        stdout,
        stderr,
        exitCode,
      });
    });
  });
}

async function defaultFindListeningProcessIds(port: number): Promise<number[]> {
  if (process.platform === "win32") {
    const result = await runCommand("netstat", ["-ano", "-p", "tcp"]);
    return result.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line.includes(`:${port}`) && line.includes("LISTENING"))
      .map((line) => line.split(/\s+/u).at(-1) ?? "")
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
  }

  const result = await runCommand("lsof", [`-nP`, `-iTCP:${port}`, `-sTCP:LISTEN`, `-t`]);
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => Number(line.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
}

async function defaultKillProcessTree(pid: number) {
  const stopCommand = buildUiAcceptanceServiceStopCommand(pid);
  if (stopCommand) {
    await new Promise<void>((resolve) => {
      const killer = spawn(stopCommand.command, stopCommand.args, {
        shell: stopCommand.shell,
        stdio: "ignore",
      });
      killer.once("error", () => resolve());
      killer.once("exit", () => resolve());
    });
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Ignore missing-process races in preflight cleanup.
  }
}

export async function ensureServicePortAvailable(
  service: UiAcceptanceServiceDefinition,
  dependencies: Pick<
    RunWithUiAcceptanceServicesDependencies,
    "findListeningProcessIds" | "killProcessTree"
  > = {},
) {
  const port = readPortFromReadyUrl(service.readyUrl);
  if (!port) {
    return;
  }

  const findListeningProcessIds =
    dependencies.findListeningProcessIds ?? defaultFindListeningProcessIds;
  const killProcessTree = dependencies.killProcessTree ?? defaultKillProcessTree;
  const processIds = await findListeningProcessIds(port);

  for (const processId of processIds) {
    await killProcessTree(processId);
  }
}

export async function runWithUiAcceptanceServices<T>(
  task: (context: { services: UiAcceptanceServiceHandle[] }) => Promise<T> | T,
  dependencies: RunWithUiAcceptanceServicesDependencies = {},
): Promise<T> {
  const services = buildUiAcceptanceServiceDefinitions(dependencies.cwd);
  const prepareService =
    dependencies.prepareService ??
    ((service: UiAcceptanceServiceDefinition) =>
      ensureServicePortAvailable(service, {
        findListeningProcessIds: dependencies.findListeningProcessIds,
        killProcessTree: dependencies.killProcessTree,
      }));
  const spawnService = dependencies.spawnService ?? defaultSpawnService;
  const waitForService = dependencies.waitForService ?? defaultWaitForService;
  const stopService = dependencies.stopService ?? defaultStopService;
  const startedServices: UiAcceptanceServiceHandle[] = [];

  try {
    for (const service of services) {
      await prepareService(service);
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
