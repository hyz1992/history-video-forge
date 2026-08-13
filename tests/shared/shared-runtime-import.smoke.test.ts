import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * S2-2A 任务 1 P1-1 整改：真实 tsx 运行时导入 smoke test。
 *
 * 审查发现：纯 TypeScript 类型（CapabilitySlot）被当作运行时值导出，Vitest/tsc 都
 * 没捕获，但项目日常 `dev:backend` 走的是 `node --import tsx` 路径，加载
 * shared/index.ts 时会抛 SyntaxError。该 smoke test 用真实 tsx 子进程导入
 * shared 公共入口与 resolver，确保公共入口在运行时可被 tsx 加载，且导出的
 * resolveGenerationConfiguration 是可调用的函数。
 *
 * 这条测试不能用 vitest 自带的 esbuild transform 代替，因为 esbuild 会消除纯类型
 * 导出，掩盖 tsx 路径的 SyntaxError。
 */

const repoRoot = resolve(__dirname, "..", "..");

describe("shared public entry is importable via tsx runtime", () => {
  let tempDir: string;
  let probePath: string;

  beforeEach(() => {
    // probe 必须放在 repo 内，这样相对 import 能解析到 shared/src/index.ts，
    // 且 Windows ESM 相对路径不需要 file:// URL scheme。复用 .tmp- 前缀，
    // 已被根 .gitignore 忽略。
    tempDir = mkdtempSync(join(repoRoot, ".tmp-shared-smoke-"));
    probePath = join(tempDir, "probe.mjs");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loads shared/src/index.ts and resolves a generation configuration without SyntaxError", () => {
    // 用相对路径引用仓库内的 shared 公共入口，确保走真实 tsx 解析。
    writeFileSync(
      probePath,
      `import { resolveGenerationConfiguration, DEFAULT_GENERATION_CONFIGURATION } from "../shared/src/index.ts";

const result = resolveGenerationConfiguration({
  projectConfiguration: DEFAULT_GENERATION_CONFIGURATION,
  projectConfigurationRevision: 1,
  sourceUserPreferenceRevision: null,
  systemConstraints: { apiVideoProviderEnabled: true },
  providerModelCatalog: [
    { provider_model_id: "dashscope.qwen-max", capability: "llm.smart", provider_key: "dashscope", model_id: "qwen-max", status: "active", is_default: true },
    { provider_model_id: "dashscope.qwen-flash", capability: "llm.flash", provider_key: "dashscope", model_id: "qwen-flash", status: "active", is_default: true },
    { provider_model_id: "dashscope.wanx", capability: "image.generate", provider_key: "dashscope", model_id: "wanx-v1", status: "active", is_default: true },
    { provider_model_id: "dashscope.video", capability: "video.image_to_video", provider_key: "dashscope", model_id: "video-v1", status: "active", is_default: true },
    { provider_model_id: "dashscope.tts", capability: "tts.synthesize", provider_key: "dashscope", model_id: "qwen3-tts", status: "active", is_default: true },
  ],
  operation: "assets.generate",
});

if (!result.ok) {
  console.error("RESOLVE_FAILED", result.error);
  process.exit(2);
}
console.log("PROBE_OK", typeof resolveGenerationConfiguration, result.value.configuration_hash.startsWith("fnv1a64:"));
`,
    );

    const res = spawnSync(
      process.execPath,
      ["--import", "tsx", probePath],
      { cwd: repoRoot, encoding: "utf8" },
    );

    if (res.status !== 0) {
      // 把 stderr 完整打印，便于排查 SyntaxError
      console.error("PROBE_STDERR:", res.stderr);
      console.error("PROBE_STDOUT:", res.stdout);
    }
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("PROBE_OK");
    expect(res.stdout).toContain("true");
    // 关键：没有 "does not provide an export" 类 SyntaxError
    expect(res.stderr).not.toContain("does not provide an export");
  }, 60000);
});
