import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_FIELDS = ["id", "stage", "language", "consumes", "produces", "status"] as const;
const VALID_STAGES = new Set(["topic", "script", "storyboard", "asset_planning"]);
const VALID_STATUSES = new Set(["active", "draft", "deprecated"]);

type PromptMetadata = Record<string, string | string[]>;

export function collectPromptFiles(dir: string, result: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const fullPath = join(dir, name);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      collectPromptFiles(fullPath, result);
      continue;
    }
    if (name.endsWith(".prompt.md")) {
      result.push(fullPath);
    }
  }
  return result;
}

function splitFrontmatter(content: string): { frontmatter: string; body: string } | null {
  const normalized = content.replace(/^\uFEFF/, "");
  if (!normalized.startsWith("---\n") && !normalized.startsWith("---\r\n")) {
    return null;
  }

  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return null;
  }

  return {
    frontmatter: match[1].trim(),
    body: match[2].trim(),
  };
}

function parseFrontmatter(frontmatter: string): PromptMetadata {
  const metadata: PromptMetadata = {};
  let currentListKey: string | null = null;

  for (const rawLine of frontmatter.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      continue;
    }

    const scalarMatch = line.match(/^([a-z_]+):\s*(.+)$/i);
    if (scalarMatch) {
      metadata[scalarMatch[1]] = scalarMatch[2].trim();
      currentListKey = null;
      continue;
    }

    const listStartMatch = line.match(/^([a-z_]+):\s*$/i);
    if (listStartMatch) {
      metadata[listStartMatch[1]] = [];
      currentListKey = listStartMatch[1];
      continue;
    }

    const listItemMatch = line.match(/^\s*-\s+(.+)$/);
    if (listItemMatch && currentListKey) {
      const existing = metadata[currentListKey];
      if (Array.isArray(existing)) {
        existing.push(listItemMatch[1].trim());
      }
    }
  }

  return metadata;
}

function containsChinese(text: string): boolean {
  return /[\u3400-\u9FFF]/u.test(text);
}

function stageMatchesPath(filePath: string, stage: string): boolean {
  const normalizedPath = normalize(filePath).toLowerCase();
  const stageDir = stage === "asset_planning" ? "asset-planning" : stage;
  const expectedTail = normalize(join("harness", "prompts", stageDir.toLowerCase())).toLowerCase();
  return normalizedPath.includes(expectedTail);
}

export function validatePromptContent(filePath: string, content: string): string[] {
  const issues: string[] = [];
  const split = splitFrontmatter(content);

  if (!split) {
    return ["缺少合法 frontmatter。"];
  }

  const metadata = parseFrontmatter(split.frontmatter);

  for (const field of REQUIRED_FIELDS) {
    if (!(field in metadata)) {
      issues.push(`缺少必需元数据字段：${field}`);
    }
  }

  const language = metadata.language;
  if (typeof language !== "string" || language !== "zh-CN") {
    issues.push("language 必须显式声明为 zh-CN");
  }

  const stage = metadata.stage;
  if (typeof stage !== "string" || !VALID_STAGES.has(stage)) {
    issues.push("stage 必须是 topic、script、storyboard 或 asset_planning");
  } else if (!stageMatchesPath(filePath, stage)) {
    issues.push(`stage 与 prompt 所在目录不一致：${stage}`);
  }

  const status = metadata.status;
  if (typeof status !== "string" || !VALID_STATUSES.has(status)) {
    issues.push("status 必须是 active、draft 或 deprecated");
  }

  for (const field of ["consumes", "produces"] as const) {
    const value = metadata[field];
    if (!Array.isArray(value) || value.length === 0) {
      issues.push(`${field} 必须是非空数组`);
    }
  }

  if (!split.body) {
    issues.push("prompt 正文不能为空");
  } else if (!containsChinese(split.body)) {
    issues.push("prompt 正文必须包含中文内容");
  }

  return issues;
}

function run(): number {
  const root = resolve(process.cwd(), "harness/prompts");
  const promptFiles = collectPromptFiles(root);
  const invalid: Array<{ file: string; issues: string[] }> = [];

  for (const file of promptFiles) {
    const content = readFileSync(file, "utf8");
    const issues = validatePromptContent(file, content);
    if (issues.length > 0) {
      invalid.push({ file, issues });
    }
  }

  if (invalid.length > 0) {
    console.error("以下正式 prompt 未通过语言与元数据检查：");
    for (const item of invalid) {
      console.error(`- ${item.file}`);
      for (const issue of item.issues) {
        console.error(`  - ${issue}`);
      }
    }
    return 1;
  }

  console.log(`prompt-language 检查通过，共检查 ${promptFiles.length} 个 prompt 文件。`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(run());
}
