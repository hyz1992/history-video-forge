#!/usr/bin/env tsx

/**
 * check-prompt-drift（S2-3 Task 8）
 *
 * 通过 git 历史检测 "version 字符串未变但 body SHA 变了" 的 drift。
 *
 * 用法：
 *   npx tsx harness/scripts/check-prompt-drift.ts [--max-history N]
 *
 * 规则：
 * - 对每个 harness/prompts/**\/*.prompt.md 文件：
 *   1. git log --follow --format=%H 取最近 N 次 commit（默认 5）。
 *   2. git show <hash>:<file> 取当时文件内容。
 *   3. 解析 frontmatter.version + sha256(body.trim())。
 *   4. 相邻 commit 间 version 相同但 body SHA 不同 → DRIFT。
 * - exit code 0 = 无 drift，1 = 有 drift。
 */

import { createHash } from "node:crypto";
import { globSync } from "node:fs";
import { basename, resolve } from "node:path";
import { execSync } from "node:child_process";

const PROMPTS_GLOB = resolve(process.cwd(), "harness/prompts/**/*.prompt.md");
const DEFAULT_MAX_HISTORY = 5;

// ---- CLI ----

let maxHistory = DEFAULT_MAX_HISTORY;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--max-history" && process.argv[i + 1]) {
    maxHistory = parseInt(process.argv[i + 1], 10);
    if (isNaN(maxHistory) || maxHistory < 1) {
      console.error("--max-history 必须为正整数");
      process.exit(1);
    }
    break;
  }
}

// ---- 核心逻辑 ----

interface DriftEntry {
  file: string;
  version: string;
  commitA: string;
  commitB: string;
}

function gitLogForFile(filePath: string, maxCount: number, cwd: string): string[] {
  try {
    const repoRoot = execSync("git rev-parse --show-toplevel", {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      cwd,
    }).trim();
    const relativePath = filePath.replace(repoRoot, "").replace(/^[/\\]+/, "");
    const output = execSync(
      `git log --format=%H -- "${relativePath}"`,
      { encoding: "utf8", maxBuffer: 1024 * 1024, cwd },
    ).trim();
    if (!output) return [];
    return output.split("\n").slice(0, maxCount);
  } catch {
    return [];
  }
}

function gitShowFile(commitHash: string, filePath: string, cwd: string): string | null {
  try {
    const repoRoot = execSync("git rev-parse --show-toplevel", {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      cwd,
    }).trim();
    const relativePath = filePath.replace(repoRoot, "").replace(/^[/\\]+/, "");
    return execSync(
      `git show ${commitHash}:"${relativePath}"`,
      { encoding: "utf8", maxBuffer: 1024 * 1024, cwd },
    ).replace(/\r\n/gu, "\n");
  } catch {
    return null;
  }
}

export function parsePromptFrontmatter(source: string): {
  version: string | null;
  bodySha256: string | null;
} {
  const normalized = source.replace(/\r\n/gu, "\n");
  if (!normalized.startsWith("---\n")) {
    return { version: null, bodySha256: null };
  }

  const closingIndex = normalized.indexOf("\n---\n", 4);
  if (closingIndex === -1) {
    return { version: null, bodySha256: null };
  }

  const frontmatterBlock = normalized.slice(4, closingIndex);
  const body = normalized.slice(closingIndex + 5).trim();
  const bodySha256 = body
    ? createHash("sha256").update(body).digest("hex")
    : null;

  // 简易解析 version 字段
  const versionMatch = frontmatterBlock.match(/^version:\s*(.+)$/mu);
  const version = versionMatch ? versionMatch[1].trim() : null;

  return { version, bodySha256 };
}

export function checkPromptDrift(
  promptFiles: string[],
  opts: { maxHistory: number; cwd?: string },
): {
  driftCount: number;
  driftEntries: DriftEntry[];
  promptCount: number;
} {
  const repoCwd = opts.cwd ?? process.cwd();
  const driftEntries: DriftEntry[] = [];
  let totalPrompts = 0;

  for (const filePath of promptFiles) {
    const commits = gitLogForFile(filePath, opts.maxHistory, repoCwd);
    if (commits.length < 2) {
      totalPrompts++;
      continue;
    }

    const snapshots: Array<{
      commitHash: string;
      version: string | null;
      bodySha256: string | null;
    }> = [];

    for (const commitHash of commits.reverse()) {
      const content = gitShowFile(commitHash, filePath, repoCwd);
      if (!content) continue;
      const parsed = parsePromptFrontmatter(content);
      snapshots.push({
        commitHash,
        version: parsed.version,
        bodySha256: parsed.bodySha256,
      });
    }

    // 比较相邻 snapshot
    for (let i = 1; i < snapshots.length; i++) {
      const prev = snapshots[i - 1];
      const curr = snapshots[i];

      if (
        prev.version &&
        curr.version &&
        prev.bodySha256 &&
        curr.bodySha256 &&
        prev.version === curr.version &&
        prev.bodySha256 !== curr.bodySha256
      ) {
        driftEntries.push({
          file: basename(filePath),
          version: curr.version,
          commitA: prev.commitHash.slice(0, 7),
          commitB: curr.commitHash.slice(0, 7),
        });
      }
    }

    totalPrompts++;
  }

  return {
    driftCount: driftEntries.length,
    driftEntries,
    promptCount: totalPrompts,
  };
}

// ---- main ----

const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith("check-prompt-drift.ts") ||
   process.argv[1].endsWith("check-prompt-drift.js"));

if (isMainModule) {
  const promptFiles = globSync(PROMPTS_GLOB);
  const result = checkPromptDrift(promptFiles, { maxHistory });

  if (result.driftCount > 0) {
    for (const d of result.driftEntries) {
      console.error(
        `[DRIFT] ${d.file}: v${d.version} body changed but version not bumped (${d.commitA} → ${d.commitB})`,
      );
    }
    console.error(
      `\n${result.promptCount} prompt checked，${result.driftCount} drift detected`,
    );
    process.exit(1);
  }

  console.log(
    `${result.promptCount} prompt checked，no drift detected`,
  );
}
