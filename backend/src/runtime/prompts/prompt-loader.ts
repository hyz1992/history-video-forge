import { readFileSync } from "node:fs";
import path from "node:path";

export type PromptStage = "topic" | "script" | "storyboard" | "asset_planning" | "assets" | "compose" | "render" | "publish";
export type PromptStatus = "active" | "draft" | "deprecated";

export interface PromptMetadata {
  id: string;
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
}

interface ParsedFrontmatter {
  metadata: Record<string, string | string[]>;
  body: string;
}

export function loadPromptFile(filePath: string): LoadedPrompt {
  const raw = readFileSync(filePath, "utf8");
  const { metadata, body } = parseFrontmatter(raw);
  const stage = readStringField(metadata, "stage");
  const alias = buildPromptFileAlias(filePath, stage);

  return {
    metadata: {
      id: readStringField(metadata, "id"),
      stage: asPromptStage(stage),
      language: readStringField(metadata, "language"),
      consumes: readStringArrayField(metadata, "consumes"),
      produces: readStringArrayField(metadata, "produces"),
      status: asPromptStatus(readStringField(metadata, "status")),
    },
    body: body.trim(),
    filePath: path.resolve(filePath),
    aliases: [alias],
  };
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
  for (const rawLine of frontmatterBlock.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      continue;
    }

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
      continue;
    }

    metadata[key] = rawValue.trim();
    currentArrayKey = null;
  }

  return { metadata, body };
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
    value === "publish"
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

  return stage;
}
