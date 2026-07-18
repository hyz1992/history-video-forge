import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadPromptFile } from "../../../backend/src/runtime/prompts/prompt-loader.js";

const TEMP_DIR = join(process.cwd(), ".tmp-prompt-loader-test");

function buildFrontmatter(options: {
  exclude?: string[];
  overrides?: Record<string, string | string[]>;
} = {}): string {
  const { exclude = [], overrides = {} } = options;
  const defaults: Record<string, string | string[]> = {
    id: "test.prompt",
    version: "v1.0.0",
    stage: "topic",
    language: "zh-CN",
    consumes: ["Input"],
    produces: ["Output"],
    status: "active",
  };
  const filtered: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(defaults)) {
    if (exclude.includes(key)) continue;
    filtered[key] = key in overrides ? overrides[key] : value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!exclude.includes(key)) {
      filtered[key] = value;
    }
  }
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(filtered)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${item}`);
      }
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

function writeTempPrompt(name: string, frontmatter: string, body = "正文内容"): string {
  const fullPath = join(TEMP_DIR, name);
  writeFileSync(fullPath, `${frontmatter}\n\n${body}\n`, "utf8");
  return fullPath;
}

describe("prompt-loader version 字段（S2-3 Task 1）", () => {
  beforeAll(() => {
    mkdirSync(TEMP_DIR, { recursive: true });
  });

  afterAll(() => {
    rmSync(TEMP_DIR, { recursive: true, force: true });
  });

  it("合法 version 字段被正确解析", () => {
    const filePath = writeTempPrompt(
      "valid.prompt.md",
      buildFrontmatter({ overrides: { version: "v1.2.3" } }),
    );
    const prompt = loadPromptFile(filePath);
    expect(prompt.metadata.version).toBe("v1.2.3");
  });

  it("解析所有现有必填字段不受影响（id/stage/language/consumes/produces/status）", () => {
    const filePath = writeTempPrompt(
      "full.prompt.md",
      buildFrontmatter({ overrides: { version: "v2.0.0" } }),
    );
    const prompt = loadPromptFile(filePath);
    expect(prompt.metadata.id).toBe("test.prompt");
    expect(prompt.metadata.stage).toBe("topic");
    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.metadata.consumes).toEqual(["Input"]);
    expect(prompt.metadata.produces).toEqual(["Output"]);
    expect(prompt.metadata.status).toBe("active");
    expect(prompt.metadata.version).toBe("v2.0.0");
  });

  it("缺失 version 字段时抛错", () => {
    const filePath = writeTempPrompt(
      "missing-version.prompt.md",
      buildFrontmatter({ exclude: ["version"] }),
    );
    expect(() => loadPromptFile(filePath)).toThrowError(
      /version.*non-empty/iu,
    );
  });

  it("version 为空字符串时抛错", () => {
    const filePath = writeTempPrompt(
      "empty-version.prompt.md",
      buildFrontmatter({ overrides: { version: "" } }),
    );
    expect(() => loadPromptFile(filePath)).toThrowError(
      /version.*non-empty/iu,
    );
  });

  it("version 格式不合法（缺少 v 前缀）时抛错", () => {
    const filePath = writeTempPrompt(
      "no-v-prefix.prompt.md",
      buildFrontmatter({ overrides: { version: "1.0.0" } }),
    );
    expect(() => loadPromptFile(filePath)).toThrowError(
      /version.*semver.*vX\.Y\.Z/iu,
    );
  });

  it("version 格式不合法（只有两段）时抛错", () => {
    const filePath = writeTempPrompt(
      "two-segments.prompt.md",
      buildFrontmatter({ overrides: { version: "v1.0" } }),
    );
    expect(() => loadPromptFile(filePath)).toThrowError(
      /version.*semver.*vX\.Y\.Z/iu,
    );
  });

  it("version 格式不合法（非数字段）时抛错", () => {
    const filePath = writeTempPrompt(
      "non-numeric.prompt.md",
      buildFrontmatter({ overrides: { version: "vx.y.z" } }),
    );
    expect(() => loadPromptFile(filePath)).toThrowError(
      /version.*semver.*vX\.Y\.Z/iu,
    );
  });

  it("version 带预发布后缀（v1.0.0-alpha）目前不合法（保持简化 semver）", () => {
    const filePath = writeTempPrompt(
      "prerelease.prompt.md",
      buildFrontmatter({ overrides: { version: "v1.0.0-alpha" } }),
    );
    expect(() => loadPromptFile(filePath)).toThrowError(
      /version.*semver.*vX\.Y\.Z/iu,
    );
  });
});
