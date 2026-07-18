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
 * - 对每个 prompts/**\/*.prompt.md 文件：
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

const PROMPTS_GLOB = resolve(process.cwd(), "prompts/**/*.prompt.md");
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

interface CommitHistoryEntry {
  commitHash: string;
  /** 该 commit 中本文件实际对应的仓库相对路径（含 rename 历史追踪） */
  pathAtCommit: string;
}

/**
 * 获取文件在最近 N 次 commit 中的历史。
 *
 * 关键点：用 `git log --follow --name-status` 同时拿到 commit hash 和
 * 该 commit 中文件当时的实际路径（rename 后旧 commit 仍是旧路径）。
 * 后续 git show 必须用 pathAtCommit，否则在迁移场景下会读不到内容。
 */
export function gitLogForFile(
  filePath: string,
  maxCount: number,
  cwd: string,
): CommitHistoryEntry[] {
  try {
    const repoRoot = execSync(`git -C "${cwd}" rev-parse --show-toplevel`, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    }).trim();
    const normalizedPath = filePath.replace(/\\/g, "/");
    const normalizedRoot = repoRoot.replace(/\\/g, "/");
    const relativePath = normalizedPath.replace(normalizedRoot, "").replace(/^\//, "");

    // --follow 跟随 rename；--name-status 输出每条 commit 中本文件的路径
    // 格式示例：
    //   <hash>
    //   R100\told/path\tpnew/path   (rename)
    //   M\tnew/path                  (modify)
    //   A\tnew/path                  (add)
    const output = execSync(
      `git -C "${cwd}" log --follow --name-status --format=__COMMIT__%H -- "${relativePath}"`,
      { encoding: "utf8", maxBuffer: 1024 * 1024 },
    ).trim();
    if (!output) return [];

    const lines = output.split("\n");
    const entries: CommitHistoryEntry[] = [];
    let currentHash: string | null = null;

    for (const line of lines) {
      if (line.startsWith("__COMMIT__")) {
        currentHash = line.slice("__COMMIT__".length).trim();
        continue;
      }
      // git log --name-status 在 hash 行后会插一个空行，跳过
      if (!line.trim()) continue;
      if (!currentHash) continue;

      // name-status 行格式： <STATUS>\tpath   或   <STATUS>\toldPath\tnewPath
      const parts = line.split("\t");
      if (parts.length < 2) continue;

      // rename 时 git 给出 oldPath 和 newPath；本文件在该 commit 的路径是最后一个字段
      const pathAtCommit = parts[parts.length - 1];
      entries.push({ commitHash: currentHash, pathAtCommit });
      currentHash = null; // 一条 commit 只取一次
    }

    return entries.slice(0, maxCount);
  } catch {
    return [];
  }
}

function gitShowFile(
  commitHash: string,
  pathAtCommit: string,
  cwd: string,
): string | null {
  try {
    return execSync(
      `git -C "${cwd}" show ${commitHash}:"${pathAtCommit}"`,
      { encoding: "utf8", maxBuffer: 1024 * 1024 },
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
      console.warn(
        `[drift:skip] ${basename(filePath)}: 仅 ${commits.length} 个历史 commit，无法做 drift 检测（可能为新文件或 shallow clone）`,
      );
      totalPrompts++;
      continue;
    }

    const snapshots: Array<{
      commitHash: string;
      version: string | null;
      bodySha256: string | null;
    }> = [];

    // commits 按时间倒序返回（最新在最前），reverse 成正序后再比较相邻
    for (const entry of commits.slice().reverse()) {
      const content = gitShowFile(entry.commitHash, entry.pathAtCommit, repoCwd);
      if (!content) continue;
      const parsed = parsePromptFrontmatter(content);
      snapshots.push({
        commitHash: entry.commitHash,
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
        `[DRIFT] ${d.file}: ${d.version} body changed but version not bumped (${d.commitA} → ${d.commitB})`,
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
