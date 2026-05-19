import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import packageJson from "../../package.json";
import {
  resolveAssetsDashscopeVoiceLiveCheckRuntimeConfig,
} from "../../harness/scripts/runtime/assets-dashscope-voice-live-check";

const scriptPath = resolve(
  process.cwd(),
  "harness/scripts/runtime/assets-dashscope-voice-live-check.ts",
);
const tsxCliPath = resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");

describe("assets DashScope voice live check", () => {
  it("registers an explicit package script outside default automation", () => {
    expect(packageJson.scripts["harness:assets-dashscope-voice-live-check"]).toBe(
      "tsx harness/scripts/runtime/assets-dashscope-voice-live-check.ts",
    );
    expect(existsSync(scriptPath)).toBe(true);
  });

  it("refuses to run without explicit live-check confirmation", () => {
    let output = "";

    try {
      output = execFileSync(process.execPath, [tsxCliPath, scriptPath], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          RUN_DASHSCOPE_VOICE_LIVE_CHECK: "",
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

    expect(output).toContain("live_check_not_enabled");
    expect(output).not.toContain("ALIYUN_DASHSCOPE_API_KEY=");
  });

  it("uses the voice design target model for designed-voice TTS", () => {
    const config = resolveAssetsDashscopeVoiceLiveCheckRuntimeConfig({
      env: {
        ALIYUN_DASHSCOPE_API_KEY: "test-key",
        ALIYUN_DASHSCOPE_VOICE_DESIGN_TARGET_MODEL: "qwen3-tts-vd-test",
      },
    });

    expect(config.ttsModel).toBe("qwen3-tts-vd-test");
    expect(config.voiceDesignTargetModel).toBe("qwen3-tts-vd-test");
  });
});
