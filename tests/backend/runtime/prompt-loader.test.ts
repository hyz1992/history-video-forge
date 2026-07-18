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

// S2-3 Task 5：Prompt changelog 读取（两种格式）
describe("prompt-loader changelog（S2-3 Task 5）", () => {
  beforeAll(() => {
    mkdirSync(TEMP_DIR, { recursive: true });
  });

  afterAll(() => {
    rmSync(TEMP_DIR, { recursive: true, force: true });
  });

  function buildPromptWithChangelog(name: string, changelogBlock: string, body = "正文内容"): string {
    const frontmatter = [
      "---",
      "id: test.changelog",
      "version: v1.0.0",
      "stage: topic",
      "language: zh-CN",
      "consumes:",
      "  - Input",
      "produces:",
      "  - Output",
      "status: active",
      changelogBlock,
      "---",
    ].filter(Boolean).join("\n");
    const fullPath = join(TEMP_DIR, name);
    writeFileSync(fullPath, `${frontmatter}\n\n${body}\n`, "utf8");
    return fullPath;
  }

  function writeChangesMd(promptPath: string, content: string): void {
    const changesPath = promptPath.replace(/\.prompt\.md$/u, ".changes.md");
    writeFileSync(changesPath, content, "utf8");
  }

  it("frontmatter 含 changelog 数组：正确解析为 PromptChangelogEntry[]", () => {
    const filePath = buildPromptWithChangelog("with-changelog.prompt.md", [
      "changelog:",
      "  - version: v1.0.0",
      "    date: 2026-07-18",
      "    summary: 初始版本，支持 topic + script",
    ].join("\n"));

    const prompt = loadPromptFile(filePath);
    expect(prompt.changelog).toHaveLength(1);
    expect(prompt.changelog[0]).toEqual({
      version: "v1.0.0",
      date: "2026-07-18",
      summary: "初始版本，支持 topic + script",
    });
  });

  it("frontmatter 含多个 changelog entries", () => {
    const filePath = buildPromptWithChangelog("multi-changelog.prompt.md", [
      "changelog:",
      "  - version: v1.1.0",
      "    date: 2026-08-01",
      "    summary: 增加 thinking 控制",
      "  - version: v1.0.0",
      "    date: 2026-07-18",
      "    summary: 初始版本",
    ].join("\n"));

    const prompt = loadPromptFile(filePath);
    expect(prompt.changelog).toHaveLength(2);
    expect(prompt.changelog[0].version).toBe("v1.1.0");
    expect(prompt.changelog[1].version).toBe("v1.0.0");
  });

  it("frontmatter changelog 缺 version 字段时抛错", () => {
    const filePath = buildPromptWithChangelog("missing-version.prompt.md", [
      "changelog:",
      "  - date: 2026-07-18",
      "    summary: 缺 version",
    ].join("\n"));

    expect(() => loadPromptFile(filePath)).toThrowError(/must start with.*version/iu);
  });

  it("frontmatter changelog 缺 date 字段时抛错", () => {
    const filePath = buildPromptWithChangelog("missing-date.prompt.md", [
      "changelog:",
      "  - version: v1.0.0",
      "    summary: 缺 date",
    ].join("\n"));

    expect(() => loadPromptFile(filePath)).toThrowError(/missing date/iu);
  });

  it("frontmatter changelog 缺 summary 字段时抛错", () => {
    const filePath = buildPromptWithChangelog("missing-summary.prompt.md", [
      "changelog:",
      "  - version: v1.0.0",
      "    date: 2026-07-18",
    ].join("\n"));

    expect(() => loadPromptFile(filePath)).toThrowError(/missing summary/iu);
  });

  it("两种格式都不存在时 changelog 为空数组", () => {
    const filePath = buildPromptWithChangelog("no-changelog.prompt.md", "");
    const prompt = loadPromptFile(filePath);
    expect(prompt.changelog).toEqual([]);
  });

  it(".changes.md 存在时优先使用，覆盖 frontmatter changelog", () => {
    const filePath = buildPromptWithChangelog("override-test.prompt.md", [
      "changelog:",
      "  - version: v0.5.0",
      "    date: 2025-01-01",
      "    summary: 旧 frontmatter 版本",
    ].join("\n"));

    writeChangesMd(filePath, [
      "## v1.0.0 - 2026-07-18",
      "- 初始版本（来自 .changes.md）",
      "- 支持 topic + script 阶段",
    ].join("\n"));

    const prompt = loadPromptFile(filePath);
    expect(prompt.changelog).toHaveLength(1);
    expect(prompt.changelog[0]).toEqual({
      version: "v1.0.0",
      date: "2026-07-18",
      summary: "初始版本（来自 .changes.md）\n支持 topic + script 阶段",
    });
  });

  it(".changes.md 多 entry 正确解析", () => {
    const filePath = buildPromptWithChangelog("multi-changes.prompt.md", "");

    writeChangesMd(filePath, [
      "## v1.1.0 - 2026-08-01",
      "- 增加 thinking 控制",
      "",
      "## v1.0.0 - 2026-07-18",
      "- 初始版本",
      "- 支持 topic + script",
    ].join("\n"));

    const prompt = loadPromptFile(filePath);
    expect(prompt.changelog).toHaveLength(2);
    expect(prompt.changelog[0].version).toBe("v1.1.0");
    expect(prompt.changelog[1].version).toBe("v1.0.0");
    expect(prompt.changelog[1].summary).toBe("初始版本\n支持 topic + script");
  });

  it(".changes.md 格式错误（缺少 summary）时抛错", () => {
    const filePath = buildPromptWithChangelog("bad-changes.prompt.md", "");
    writeChangesMd(filePath, "## v1.0.0 - 2026-07-18\n");

    expect(() => loadPromptFile(filePath)).toThrowError(/missing summary/iu);
  });

  it(".changes.md 无有效 entry 时抛错", () => {
    const filePath = buildPromptWithChangelog("empty-changes.prompt.md", "");
    writeChangesMd(filePath, "没有有效的 changelog 条目\n");

    expect(() => loadPromptFile(filePath)).toThrowError(/no valid changelog/iu);
  });
});
