import { readdirSync } from "node:fs";
import path from "node:path";

import { env } from "../../config/env.js";
import {
  buildPromptFileAlias,
  loadPromptFile,
  type LoadedPrompt,
} from "./prompt-loader.js";

export interface PromptRegistry {
  getPrompt(id: string): LoadedPrompt;
  listPrompts(): LoadedPrompt[];
}

class FilePromptRegistry implements PromptRegistry {
  private readonly promptsById: Map<string, LoadedPrompt>;

  constructor(private readonly promptsDir: string) {
    this.promptsById = loadPromptIndex(promptsDir);
  }

  getPrompt(id: string): LoadedPrompt {
    const prompt = this.promptsById.get(id);
    if (!prompt) {
      throw new Error(`Unknown prompt id: ${id}`);
    }

    return prompt;
  }

  listPrompts(): LoadedPrompt[] {
    return [...new Set(this.promptsById.values())];
  }
}

export function createPromptRegistry(options?: {
  promptsDir?: string;
}): PromptRegistry {
  return new FilePromptRegistry(options?.promptsDir ?? env.promptAssetsDir);
}

function loadPromptIndex(promptsDir: string): Map<string, LoadedPrompt> {
  const promptFiles = findPromptFiles(path.resolve(promptsDir));
  const promptsById = new Map<string, LoadedPrompt>();

  for (const filePath of promptFiles) {
    const prompt = loadPromptFile(filePath);
    const alias = buildPromptFileAlias(filePath, prompt.metadata.stage);
    if (!prompt.aliases.includes(alias)) {
      prompt.aliases.push(alias);
    }

    registerPromptId(promptsById, prompt.metadata.id, prompt);
    for (const promptAlias of prompt.aliases) {
      registerPromptId(promptsById, promptAlias, prompt);
    }
  }

  return promptsById;
}

function registerPromptId(
  promptsById: Map<string, LoadedPrompt>,
  id: string,
  prompt: LoadedPrompt,
): void {
  const existing = promptsById.get(id);
  if (existing && existing.filePath !== prompt.filePath) {
    throw new Error(`Duplicate prompt id detected: ${id}`);
  }

  promptsById.set(id, prompt);
}

function findPromptFiles(rootDir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findPromptFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".prompt.md")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}
