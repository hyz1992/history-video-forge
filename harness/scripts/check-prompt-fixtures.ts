#!/usr/bin/env tsx

/**
 * check-prompt-fixtures（S2-3 Task 9）
 *
 * 强 gate + allowlist：所有 fixture 必须声明 target_prompt.version_range，
 * 且与当前 prompt version 兼容。
 *
 * 用法：
 *   npx tsx harness/scripts/check-prompt-fixtures.ts
 *
 * 规则：
 * - 扫描 harness/samples/**\/*.fixture.json。
 * - allowlist 中的 fixture 可以没有 target_prompt（如非 prompt 类 fixture）。
 * - 不在 allowlist 的 fixture 必须有 target_prompt.id + target_prompt.version_range。
 * - 校验 target_prompt.id 在 PromptRegistry 中存在。
 * - 用 semver.satisfies 校验当前 version 与 version_range 兼容。
 * - allowlist 内的路径必须实际存在（防拼写错误）。
 * - exit code 0 = 全部通过，1 = 有错误。
 */

import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { createPromptRegistry } from "../../backend/src/runtime/prompts/prompt-registry.js";

const require = createRequire(import.meta.url);
const semver: {
  satisfies(version: string, range: string): boolean;
} = require("semver");

const FIXTURES_GLOB = resolve(process.cwd(), "harness/samples/**/*.fixture.json");

/**
 * 允许没有 target_prompt 的 fixture 列表（路径相对于项目根目录）。
 * 初始为空——所有 .fixture.json 必须有 target_prompt。
 */
const NON_PROMPT_FIXTURES: ReadonlySet<string> = new Set();

// ---- 工具函数 ----

function stripVPrefix(value: string): string {
  return value.startsWith("v") ? value.slice(1) : value;
}

function fixturesGlob(): string[] {
  return globSync(FIXTURES_GLOB);
}

// ---- 核心逻辑 ----

interface FixtureCheckError {
  file: string;
  message: string;
}

interface FixtureCheckResult {
  total: number;
  skipped: number;
  errors: FixtureCheckError[];
}

export function checkPromptFixtures(options: {
  allowlist: ReadonlySet<string>;
  projectRoot: string;
}): FixtureCheckResult {
  const errors: FixtureCheckError[] = [];
  let total = 0;
  let skipped = 0;

  // 校验 allowlist 路径存在
  for (const allowPath of options.allowlist) {
    const fullPath = resolve(options.projectRoot, allowPath);
    if (!existsSync(fullPath)) {
      errors.push({
        file: allowPath,
        message: `allowlist 路径不存在（可能拼写错误或文件已删除）`,
      });
    }
  }

  const promptRegistry = createPromptRegistry();
  const samplesGlob = resolve(options.projectRoot, "harness", "samples", "**/*.fixture.json");
  const fixtureFiles = globSync(samplesGlob);

  for (const filePath of fixtureFiles) {
    total++;
    const relPath = relative(options.projectRoot, filePath).replace(/\\/g, "/");

    // allowlist 检查
    if (options.allowlist.has(relPath)) {
      console.log(`[skip] ${relPath} (in allowlist)`);
      skipped++;
      continue;
    }

    let fixture: Record<string, unknown>;
    try {
      fixture = JSON.parse(readFileSync(filePath, "utf8"));
    } catch {
      errors.push({
        file: basename(filePath),
        message: "JSON 解析失败",
      });
      continue;
    }

    const targetPrompt = fixture.target_prompt as
      | { id: string; version_range: string }
      | undefined;

    if (!targetPrompt) {
      errors.push({
        file: basename(filePath),
        message: "缺少 target_prompt 字段（需声明 id + version_range，或加入 allowlist）",
      });
      continue;
    }

    if (!targetPrompt.id || !targetPrompt.version_range) {
      errors.push({
        file: basename(filePath),
        message: "target_prompt 缺少 id 或 version_range",
      });
      continue;
    }

    // 校验 prompt id 存在
    let prompt;
    try {
      prompt = promptRegistry.getPrompt(targetPrompt.id);
    } catch {
      errors.push({
        file: basename(filePath),
        message: `target_prompt.id "${targetPrompt.id}" 在 PromptRegistry 中不存在`,
      });
      continue;
    }

    // 校验 version_range 格式（必须有操作符）
    if (!/^[<>=^~]/.test(targetPrompt.version_range)) {
      errors.push({
        file: basename(filePath),
        message: `version_range "${targetPrompt.version_range}" 格式不合法（需包含范围操作符，如 ^v1.0.0）`,
      });
      continue;
    }

    // 校验版本兼容性
    const currentVersion = stripVPrefix(prompt.metadata.version);
    const range = stripVPrefix(targetPrompt.version_range);

    try {
      if (!semver.satisfies(currentVersion, range)) {
        errors.push({
          file: basename(filePath),
          message: `target_prompt.version_range "${targetPrompt.version_range}" 不兼容当前版本 ${prompt.metadata.version}`,
        });
      }
    } catch {
      errors.push({
        file: basename(filePath),
        message: `version_range "${targetPrompt.version_range}" 无法解析（semver 错误）`,
      });
    }
  }

  return { total, skipped, errors };
}

// ---- main ----

if (
  process.argv[1] &&
  (process.argv[1].endsWith("check-prompt-fixtures.ts") ||
    process.argv[1].endsWith("check-prompt-fixtures.js"))
) {
  const result = checkPromptFixtures({
    allowlist: NON_PROMPT_FIXTURES,
    projectRoot: process.cwd(),
  });

  if (result.skipped > 0) {
    console.log(`${result.skipped} fixture in allowlist, skipped`);
  }

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      console.error(`[FAIL] ${err.file}: ${err.message}`);
    }
    console.error(
      `\n${result.total} fixture checked, ${result.errors.length} errors`,
    );
    process.exit(1);
  }

  console.log(
    `${result.total}/${result.total} fixture prompt contracts ok`,
  );
}
