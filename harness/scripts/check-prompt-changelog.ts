#!/usr/bin/env tsx

/**
 * check-prompt-changelog（S2-3 Task 7）
 *
 * 硬 gate：每个 prompt 的 metadata.version 必须在 changelog 中存在对应条目。
 *
 * 用法：
 *   npx tsx harness/scripts/check-prompt-changelog.ts
 *
 * 规则：
 * - 扫描 harness/prompts 下所有 .prompt.md 文件。
 * - 对每个 prompt 用 loadPromptFile 加载（校验 frontmatter + changelog 格式）。
 * - 检查 metadata.version 是否在 changelog 中存在对应条目。
 * - 检查 changelog 条目格式合法性（version/date 正则、summary 非空）。
 * - exit code 0 = 全部通过，1 = 有错误。
 */

import { globSync } from "node:fs";
import { basename, resolve } from "node:path";

import {
  loadPromptFile,
  type PromptChangelogEntry,
} from "../../backend/src/runtime/prompts/prompt-loader.js";

const PROMPTS_GLOB = resolve(process.cwd(), "harness/prompts/**/*.prompt.md");
const VERSION_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

interface CheckError {
  file: string;
  promptId: string;
  message: string;
}

interface CheckResult {
  promptCount: number;
  errors: CheckError[];
}

function validateChangelogEntry(
  entry: PromptChangelogEntry,
  context: { filePath: string; promptId: string },
): CheckError | null {
  if (!VERSION_PATTERN.test(entry.version)) {
    return {
      file: basename(context.filePath),
      promptId: context.promptId,
      message: `changelog entry version "${entry.version}" 格式不合法（需符合 vX.Y.Z）`,
    };
  }
  if (!DATE_PATTERN.test(entry.date)) {
    return {
      file: basename(context.filePath),
      promptId: context.promptId,
      message: `changelog entry date "${entry.date}" 格式不合法（需符合 YYYY-MM-DD）`,
    };
  }
  if (!entry.summary.trim()) {
    return {
      file: basename(context.filePath),
      promptId: context.promptId,
      message: `changelog entry version ${entry.version} summary 为空`,
    };
  }
  return null;
}

export function checkPromptChangelogs(promptFiles: string[]): CheckResult {
  const errors: CheckError[] = [];

  for (const filePath of promptFiles) {
    let prompt;
    try {
      prompt = loadPromptFile(filePath);
    } catch (error) {
      errors.push({
        file: basename(filePath),
        promptId: "unknown",
        message: `加载失败：${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    const ctx = { filePath, promptId: prompt.metadata.id };

    // 检查 changelog 非空
    if (prompt.changelog.length === 0) {
      errors.push({
        file: basename(filePath),
        promptId: ctx.promptId,
        message: `无 changelog（需要 .changes.md 或 frontmatter changelog）`,
      });
      continue;
    }

    // 检查当前 version 在 changelog 中是否存在
    const currentVersion = prompt.metadata.version;
    const found = prompt.changelog.some((e) => e.version === currentVersion);
    if (!found) {
      errors.push({
        file: basename(filePath),
        promptId: ctx.promptId,
        message: `changelog 中缺少当前版本 ${currentVersion} 的条目`,
      });
    }

    // 检查每个 changelog entry 格式
    for (const entry of prompt.changelog) {
      const err = validateChangelogEntry(entry, ctx);
      if (err) {
        errors.push(err);
      }
    }
  }

  return { promptCount: promptFiles.length, errors };
}

// ---- main ----

if (process.argv[1] && (process.argv[1].endsWith("check-prompt-changelog.ts") || process.argv[1].endsWith("check-prompt-changelog.js"))) {
  const promptFiles = globSync(PROMPTS_GLOB);
  const result = checkPromptChangelogs(promptFiles);

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      console.error(`[FAIL] ${err.file}: ${err.promptId} - ${err.message}`);
    }
    console.error(
      `\n${result.promptCount} prompt 检查完毕，${result.errors.length} 错误`,
    );
    process.exit(1);
  }

  console.log(
    `${result.promptCount}/${result.promptCount} prompt changelog ok`,
  );
}
