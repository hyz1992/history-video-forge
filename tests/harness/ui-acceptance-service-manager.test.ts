import { describe, expect, it } from "vitest";

import {
  buildUiAcceptanceServiceSpawnOptions,
  buildUiAcceptanceServiceStopCommand,
  buildUiAcceptanceServiceDefinitions,
  runWithUiAcceptanceServices,
  type UiAcceptanceServiceHandle,
} from "../../harness/scripts/ui-acceptance/service-manager";
import { waitForReady } from "../../harness/scripts/ui-acceptance/wait-for-ready";

describe("ui acceptance service manager", () => {
  it("fixes backend and frontend commands with readiness targets", () => {
    const services = buildUiAcceptanceServiceDefinitions("D:/myproject/story-video-forge2");

    expect(services).toEqual([
      {
        name: "backend",
        command: "npm",
        args: ["run", "dev:backend"],
        cwd: "D:/myproject/story-video-forge2",
        readyUrl: "http://127.0.0.1:3000/healthz",
        intervalMs: 500,
        timeoutMs: 30000,
      },
      {
        name: "frontend",
        command: "npm",
        args: ["run", "dev:frontend"],
        cwd: "D:/myproject/story-video-forge2",
        readyUrl: "http://127.0.0.1:5173/",
        intervalMs: 500,
        timeoutMs: 30000,
      },
    ]);
  });

  it("uses shell-based npm spawning on Windows to avoid spawn EINVAL", () => {
    expect(
      buildUiAcceptanceServiceSpawnOptions({
        name: "backend",
        command: "npm",
        args: ["run", "dev:backend"],
        cwd: "D:/myproject/story-video-forge2",
        readyUrl: "http://127.0.0.1:3000/healthz",
        intervalMs: 500,
        timeoutMs: 30000,
      }),
    ).toEqual({
      cwd: "D:/myproject/story-video-forge2",
      stdio: "pipe",
      shell: process.platform === "win32",
    });
  });

  it("uses taskkill tree termination on Windows service cleanup", () => {
    expect(buildUiAcceptanceServiceStopCommand(12345)).toEqual(
      process.platform === "win32"
        ? {
            command: "taskkill",
            args: ["/pid", "12345", "/T", "/F"],
            shell: true,
          }
        : null,
    );
  });

  it("polls readiness until the target becomes reachable", async () => {
    const sleepCalls: number[] = [];
    let attempt = 0;

    const result = await waitForReady(
      {
        serviceName: "backend",
        readyUrl: "http://127.0.0.1:3000/healthz",
        intervalMs: 250,
        timeoutMs: 2000,
      },
      {
        now: () => attempt * 250,
        probe: async () => {
          attempt += 1;
          return attempt >= 3;
        },
        sleep: async (ms) => {
          sleepCalls.push(ms);
        },
      },
    );

    expect(result).toEqual({
      serviceName: "backend",
      readyUrl: "http://127.0.0.1:3000/healthz",
      attempts: 3,
    });
    expect(sleepCalls).toEqual([250, 250]);
  });

  it("cleans up both services after a successful session", async () => {
    const lifecycle: string[] = [];

    const result = await runWithUiAcceptanceServices(
      async () => {
        lifecycle.push("task");
        return "ok";
      },
      {
        cwd: "D:/myproject/story-video-forge2",
        spawnService: async (service) => {
          lifecycle.push(`spawn:${service.name}`);
          return createHandle(service.name, lifecycle);
        },
        waitForService: async (service) => {
          lifecycle.push(`wait:${service.name}`);
        },
        stopService: async (handle) => {
          lifecycle.push(`stop:${handle.name}`);
        },
      },
    );

    expect(result).toBe("ok");
    expect(lifecycle).toEqual([
      "spawn:backend",
      "wait:backend",
      "spawn:frontend",
      "wait:frontend",
      "task",
      "stop:frontend",
      "stop:backend",
    ]);
  });

  it("cleans up already started services when the session fails", async () => {
    const lifecycle: string[] = [];

    await expect(
      runWithUiAcceptanceServices(
        async () => {
          lifecycle.push("task");
          throw new Error("browser_failed");
        },
        {
          cwd: "D:/myproject/story-video-forge2",
          spawnService: async (service) => {
            lifecycle.push(`spawn:${service.name}`);
            return createHandle(service.name, lifecycle);
          },
          waitForService: async (service) => {
            lifecycle.push(`wait:${service.name}`);
          },
          stopService: async (handle) => {
            lifecycle.push(`stop:${handle.name}`);
          },
        },
      ),
    ).rejects.toThrow("browser_failed");

    expect(lifecycle).toEqual([
      "spawn:backend",
      "wait:backend",
      "spawn:frontend",
      "wait:frontend",
      "task",
      "stop:frontend",
      "stop:backend",
    ]);
  });

  it("rolls back started services when readiness fails mid-startup", async () => {
    const lifecycle: string[] = [];

    await expect(
      runWithUiAcceptanceServices(
        async () => "unreachable",
        {
          cwd: "D:/myproject/story-video-forge2",
          spawnService: async (service) => {
            lifecycle.push(`spawn:${service.name}`);
            return createHandle(service.name, lifecycle);
          },
          waitForService: async (service) => {
            lifecycle.push(`wait:${service.name}`);
            if (service.name === "frontend") {
              throw new Error("frontend_not_ready");
            }
          },
          stopService: async (handle) => {
            lifecycle.push(`stop:${handle.name}`);
          },
        },
      ),
    ).rejects.toThrow("frontend_not_ready");

    expect(lifecycle).toEqual([
      "spawn:backend",
      "wait:backend",
      "spawn:frontend",
      "wait:frontend",
      "stop:frontend",
      "stop:backend",
    ]);
  });
});

function createHandle(
  name: string,
  lifecycle: string[],
): UiAcceptanceServiceHandle {
  return {
    name,
    stop: async () => {
      lifecycle.push(`handle-stop:${name}`);
    },
  };
}
