import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import packageJson from "../../package.json";
import {
  resolveAssetsDashscopeTtsLiveCheckRuntimeConfig,
} from "../../harness/scripts/runtime/assets-dashscope-tts-live-check";

const scriptPath = resolve(
  process.cwd(),
  "harness/scripts/runtime/assets-dashscope-tts-live-check.ts",
);
const tsxCliPath = resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");

describe("assets DashScope TTS live check", () => {
  it("registers an explicit package script for low-cost real TTS checks", () => {
    expect(packageJson.scripts["harness:assets-dashscope-tts-live-check"]).toBe(
      "tsx harness/scripts/runtime/assets-dashscope-tts-live-check.ts",
    );
    expect(existsSync(scriptPath)).toBe(true);
  });

  it("refuses to run without explicit TTS live-check confirmation", () => {
    let output = "";

    try {
      output = execFileSync(process.execPath, [tsxCliPath, scriptPath], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          RUN_DASHSCOPE_TTS_LIVE_CHECK: "",
          ALIYUN_DASHSCOPE_API_KEY: "",
        },
        stdio: "pipe",
      });
    } catch (error) {
      output = [
        "stdout" in (error as Record<string, unknown>)
          ? String((error as { stdout?: string }).stdout ?? "")
          : "",
        "stderr" in (error as Record<string, unknown>)
          ? String((error as { stderr?: string }).stderr ?? "")
          : "",
      ].join("\n");
    }

    expect(output).toContain("tts_live_check_not_enabled");
    expect(output).not.toContain("ALIYUN_DASHSCOPE_API_KEY=");
  });

  it("can target an existing provider voice id without voice design", () => {
    const config = resolveAssetsDashscopeTtsLiveCheckRuntimeConfig({
      env: {
        ALIYUN_DASHSCOPE_API_KEY: "test-key",
        ALIYUN_DASHSCOPE_TTS_MODEL: "qwen3-tts-vd-test",
        ALIYUN_DASHSCOPE_TTS_VOICE: "env-voice",
      },
      providerVoiceId: "provider-voice-001",
      text: "reuse check",
    });

    expect(config.voice).toBe("provider-voice-001");
    expect(config.model).toBe("qwen3-tts-vd-test");
    expect(config.text).toBe("reuse check");
  });
});
