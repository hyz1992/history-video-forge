import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type PromptStage = "topic" | "script" | "storyboard" | "asset_planning" | "assets" | "compose" | "render" | "publish" | "event_library";
export type PromptStatus = "active" | "draft" | "deprecated";

export interface PromptChangelogEntry {
  version: string;
  date: string;
  summary: string;
}

export interface PromptMetadata {
  id: string;
  version: string;
  stage: PromptStage;
  language: string;
  consumes: string[];
  produces: string[];
  status: PromptStatus;
}

export interface LoadedPrompt {
  metadata: PromptMetadata;
  body: string;
  filePath: string;
  aliases: string[];
  changelog: PromptChangelogEntry[];
}

interface ParsedFrontmatter {
  metadata: Record<string, string | string[]>;
  body: string;
  frontmatterBlock: string;
}

export function loadPromptFile(filePath: string): LoadedPrompt {
  const raw = readFileSync(filePath, "utf8");
  const { metadata, body, frontmatterBlock } = parseFrontmatter(raw);
  const stage = readStringField(metadata, "stage");
  const alias = buildPromptFileAlias(filePath, stage);

  const externalChangelog = loadExternalChangelog(filePath);
  const frontmatterChangelog = parseFrontmatterChangelog(frontmatterBlock);

  return {
    metadata: {
      id: readStringField(metadata, "id"),
      version: asPromptVersion(readStringField(metadata, "version")),
      stage: asPromptStage(stage),
      language: readStringField(metadata, "language"),
      consumes: readStringArrayField(metadata, "consumes"),
      produces: readStringArrayField(metadata, "produces"),
      status: asPromptStatus(readStringField(metadata, "status")),
    },
    body: body.trim(),
    filePath: path.resolve(filePath),
    aliases: [alias],
    changelog: externalChangelog ?? frontmatterChangelog ?? [],
  };
}

/**
 * 校验 prompt version 必须形如 `vX.Y.Z`，其中 X/Y/Z 都是非负整数。
 * 不接受预发布后缀（如 -alpha），保持简化 semver。
 */
const PROMPT_VERSION_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/u;

function asPromptVersion(value: string): string {
  if (!PROMPT_VERSION_PATTERN.test(value)) {
    throw new Error(
      `Prompt version must follow semver format vX.Y.Z (e.g. "v1.0.0). Received: "${value}".`,
    );
  }
  return value;
}

export function buildPromptFileAlias(
  filePath: string,
  stage: string,
): string {
  const basename = path.basename(filePath).replace(/\.prompt\.md$/u, "");
  return `${promptStageAliasPrefix(stage)}.${basename}`;
}

function parseFrontmatter(source: string): ParsedFrontmatter {
  const normalized = source.replace(/\r\n/gu, "\n");

  if (!normalized.startsWith("---\n")) {
    throw new Error("Prompt file is missing frontmatter start marker.");
  }

  const closingIndex = normalized.indexOf("\n---\n", 4);
  if (closingIndex === -1) {
    throw new Error("Prompt file is missing frontmatter end marker.");
  }

  const frontmatterBlock = normalized.slice(4, closingIndex);
  const body = normalized.slice(closingIndex + 5);
  const metadata: Record<string, string | string[]> = {};

  let currentArrayKey: string | null = null;
  let inChangelogBlock = false;
  for (const rawLine of frontmatterBlock.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      inChangelogBlock = false;
      continue;
    }

    // 跳过 changelog 子内容（由 parseFrontmatterChangelog 单独处理）
    if (inChangelogBlock) continue;

    const arrayItemMatch = line.match(/^\s*-\s+(.*)$/u);
    if (arrayItemMatch && currentArrayKey) {
      const list = metadata[currentArrayKey];
      if (!Array.isArray(list)) {
        throw new Error(`Prompt frontmatter field "${currentArrayKey}" is not an array.`);
      }
      list.push(arrayItemMatch[1].trim());
      continue;
    }

    const fieldMatch = line.match(/^([a-z_]+):\s*(.*)$/u);
    if (!fieldMatch) {
      throw new Error(`Unsupported prompt frontmatter line: ${line}`);
    }

    const [, key, rawValue] = fieldMatch;
    if (rawValue === "") {
      metadata[key] = [];
      currentArrayKey = key;
      // changelog 字段的内容是嵌套对象，交给 parseFrontmatterChangelog 解析
      if (key === "changelog") {
        inChangelogBlock = true;
        currentArrayKey = null;
      }
      continue;
    }

    metadata[key] = rawValue.trim();
    currentArrayKey = null;
    inChangelogBlock = false;
  }

  return { metadata, body, frontmatterBlock };
}

const CHANGELOG_BLOCK_PATTERN = /^changelog:\s*$/mu;
const CHANGELOG_ENTRY_VERSION_PATTERN = /^\s*-\s+version:\s*(.+)$/u;
const CHANGELOG_ENTRY_DATE_PATTERN = /^\s+date:\s*(.+)$/u;
const CHANGELOG_ENTRY_SUMMARY_PATTERN = /^\s+summary:\s*(.+)$/u;

/**
 * 从 frontmatter 原始文本中解析 changelog 数组。
 *
 * 格式：
 *   changelog:
 *     - version: v1.0.0
 *       date: 2026-07-18
 *       summary: 初始版本
 *
 * 返回 null 表示 frontmatter 中没有 changelog 字段（不是错误）。
 * 格式错误直接抛错。
 */
function parseFrontmatterChangelog(frontmatterBlock: string): PromptChangelogEntry[] | null {
  const lines = frontmatterBlock.split("\n");
  const changelogStartIdx = lines.findIndex((line) => CHANGELOG_BLOCK_PATTERN.test(line));
  if (changelogStartIdx === -1) return null;

  const entries: PromptChangelogEntry[] = [];
  let current: { version?: string; date?: string; summary?: string } | null = null;

  for (let i = changelogStartIdx + 1; i < lines.length; i++) {
    const line = lines[i];

    const versionMatch = line.match(CHANGELOG_ENTRY_VERSION_PATTERN);
    if (versionMatch) {
      if (current) {
        flushChangelogEntry(current, entries);
      }
      current = { version: versionMatch[1].trim() };
      continue;
    }

    const dateMatch = line.match(CHANGELOG_ENTRY_DATE_PATTERN);
    if (dateMatch && current) {
      current.date = dateMatch[1].trim();
      continue;
    }

    const summaryMatch = line.match(CHANGELOG_ENTRY_SUMMARY_PATTERN);
    if (summaryMatch && current) {
      current.summary = summaryMatch[1].trim();
      continue;
    }

    // 以 dash 开头但不是 version 的行，说明 changelog entry 格式错误
    if (/^\s*-\s+/.test(line)) {
      throw new Error(
        `Prompt frontmatter changelog entry must start with "version:" field. Received: ${line.trim()}`,
      );
    }

    // 遇到下一个顶级字段或空行，结束 changelog 区域
    if (current) {
      flushChangelogEntry(current, entries);
      current = null;
    }
    if (line.trim() === "" || /^[a-z_]+:\s/u.test(line)) {
      break;
    }
  }

  // 处理最后一个未刷新的 entry
  if (current) {
    flushChangelogEntry(current, entries);
  }

  return entries;
}

function flushChangelogEntry(
  partial: { version?: string; date?: string; summary?: string },
  entries: PromptChangelogEntry[],
): void {
  if (!partial.version) {
    throw new Error("Prompt frontmatter changelog entry is missing version field.");
  }
  if (!partial.date) {
    throw new Error("Prompt frontmatter changelog entry is missing date field.");
  }
  if (!partial.summary) {
    throw new Error("Prompt frontmatter changelog entry is missing summary field.");
  }
  entries.push(partial as PromptChangelogEntry);
}

const CHANGES_MD_ENTRY_PATTERN = /^##\s+v(\S+)\s+-\s+(.+)$/u;

/**
 * 从同目录 `.changes.md` 文件读取 changelog。
 *
 * 格式：
 *   ## vX.Y.Z - YYYY-MM-DD
 *   - summary line 1
 *   - summary line 2
 *
 * 返回 null 表示文件不存在（不是错误）。
 * 格式错误直接抛错。
 */
function loadExternalChangelog(promptFilePath: string): PromptChangelogEntry[] | null {
  const changesFilePath = promptFilePath.replace(/\.prompt\.md$/u, ".changes.md");
  if (!existsSync(changesFilePath)) return null;

  const raw = readFileSync(changesFilePath, "utf8");
  const normalized = raw.replace(/\r\n/gu, "\n");
  const lines = normalized.split("\n");

  const entries: PromptChangelogEntry[] = [];
  let currentEntry: PromptChangelogEntry | null = null;

  for (const line of lines) {
    const headerMatch = line.match(CHANGES_MD_ENTRY_PATTERN);
    if (headerMatch) {
      if (currentEntry) {
        if (!currentEntry.summary) {
          throw new Error(
            `Prompt .changes.md entry ${currentEntry.version} is missing summary lines.`,
          );
        }
        entries.push(currentEntry);
      }
      currentEntry = {
        version: `v${headerMatch[1]}`,
        date: headerMatch[2].trim(),
        summary: "",
      };
      continue;
    }

    if (currentEntry && line.startsWith("- ")) {
      const bullet = line.slice(2).trim();
      currentEntry.summary = currentEntry.summary
        ? `${currentEntry.summary}\n${bullet}`
        : bullet;
    }
  }

  if (currentEntry) {
    if (!currentEntry.summary) {
      throw new Error(
        `Prompt .changes.md entry ${currentEntry.version} is missing summary lines.`,
      );
    }
    entries.push(currentEntry);
  }

  if (entries.length === 0) {
    throw new Error(
      `Prompt .changes.md file ${changesFilePath} contains no valid changelog entries.`,
    );
  }

  return entries;
}

function readStringField(
  metadata: Record<string, string | string[]>,
  key: string,
): string {
  const value = metadata[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Prompt frontmatter field "${key}" must be a non-empty string.`);
  }

  return value;
}

function readStringArrayField(
  metadata: Record<string, string | string[]>,
  key: string,
): string[] {
  const value = metadata[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Prompt frontmatter field "${key}" must be a non-empty array.`);
  }

  return value;
}

function asPromptStage(value: string): PromptStage {
  if (
    value === "topic" ||
    value === "script" ||
    value === "storyboard" ||
    value === "asset_planning" ||
    value === "assets" ||
    value === "compose" ||
    value === "render" ||
    value === "publish" ||
    value === "event_library"
  ) {
    return value;
  }

  throw new Error(`Unsupported prompt stage: ${value}`);
}

function asPromptStatus(value: string): PromptStatus {
  if (value === "active" || value === "draft" || value === "deprecated") {
    return value;
  }

  throw new Error(`Unsupported prompt status: ${value}`);
}

function promptStageAliasPrefix(stage: string): string {
  if (stage === "asset_planning") {
    return "asset-planning";
  }
  if (stage === "event_library") {
    return "event-library";
  }

  return stage;
}
