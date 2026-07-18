import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEMP_DIR = join(process.cwd(), ".tmp-check-changelog-test");

/**
 * 在临时目录下写一个 .prompt.md 文件（含完整 frontmatter + body）。
 */
function writePromptFile(name: string, frontmatter: string): string {
  const dir = join(TEMP_DIR, name);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${name}.prompt.md`);
  writeFileSync(filePath, `${frontmatter}\n\n正文内容\n`, "utf8");
  return filePath;
}

/**
 * 在同目录写 .changes.md 文件。
 */
function writeChangesFile(
  dirName: string,
  name: string,
  content: string,
): void {
  const filePath = join(TEMP_DIR, dirName, `${name}.changes.md`);
  writeFileSync(filePath, content, "utf8");
}

function buildPromptFrontmatter(options: {
  id: string;
  version: string;
  status?: string;
}): string {
  return [
    "---",
    `id: ${options.id}`,
    `version: ${options.version}`,
    "stage: topic",
    "language: zh-CN",
    "consumes:",
    "  - Input",
    "produces:",
    "  - Output",
    `status: ${options.status ?? "active"}`,
    "---",
  ].join("\n");
}

describe("check-prompt-changelog（S2-3 Task 7）", () => {
  beforeAll(() => {
    mkdirSync(TEMP_DIR, { recursive: true });
  });

  afterAll(() => {
    rmSync(TEMP_DIR, { recursive: true, force: true });
  });

  it("prompt v1.0.0 with matching changelog entry → 0 errors", async () => {
    const fp = writePromptFile("ok-prompt", buildPromptFrontmatter({
      id: "test.ok",
      version: "v1.0.0",
    }));
    writeChangesFile("ok-prompt", "ok-prompt", [
      "## v1.0.0 - 2026-07-18",
      "- 初始版本",
    ].join("\n"));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { checkPromptChangelogs, default: mod } = await import(
      "../../harness/scripts/check-prompt-changelog.js"
    );
    const result = checkPromptChangelogs([fp]);
    expect(result.errors).toHaveLength(0);
  });

  it("prompt v1.0.0 with changelog only having v0.9.0 → 报错", async () => {
    const fp = writePromptFile("stale-prompt", buildPromptFrontmatter({
      id: "test.stale",
      version: "v1.0.0",
    }));
    writeChangesFile("stale-prompt", "stale-prompt", [
      "## v0.9.0 - 2026-01-01",
      "- 旧版本",
    ].join("\n"));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { checkPromptChangelogs } = await import(
      "../../harness/scripts/check-prompt-changelog.js"
    );
    const result = checkPromptChangelogs([fp]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("缺少当前版本");
    expect(result.errors[0].message).toContain("v1.0.0");
  });

  it("prompt without any changelog → 报错", async () => {
    const fp = writePromptFile("no-changelog", buildPromptFrontmatter({
      id: "test.nochangelog",
      version: "v1.0.0",
    }));
    // 不创建 .changes.md 也不写 frontmatter changelog

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { checkPromptChangelogs } = await import(
      "../../harness/scripts/check-prompt-changelog.js"
    );
    const result = checkPromptChangelogs([fp]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("无 changelog");
  });

  it("changelog entry with invalid date format → 报错", async () => {
    const fp = writePromptFile("bad-date", buildPromptFrontmatter({
      id: "test.baddate",
      version: "v1.0.0",
    }));
    writeChangesFile("bad-date", "bad-date", [
      "## v1.0.0 - 2026/07/18",
      "- 日期格式用斜杠",
    ].join("\n"));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { checkPromptChangelogs } = await import(
      "../../harness/scripts/check-prompt-changelog.js"
    );
    const result = checkPromptChangelogs([fp]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("格式不合法");
    expect(result.errors[0].message).toContain("YYYY-MM-DD");
  });

  it("changelog entry with empty summary → 报错", async () => {
    const fp = writePromptFile("empty-summary", buildPromptFrontmatter({
      id: "test.emptysummary",
      version: "v1.0.0",
    }));
    writeChangesFile("empty-summary", "empty-summary", [
      "## v1.0.0 - 2026-07-18",
      "- ",
    ].join("\n"));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { checkPromptChangelogs } = await import(
      "../../harness/scripts/check-prompt-changelog.js"
    );
    const result = checkPromptChangelogs([fp]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("加载失败");
    expect(result.errors[0].message).toContain("summary");
  });

  it("changelog entry with invalid version format → 报错", async () => {
    const fp = writePromptFile("bad-version-changelog", buildPromptFrontmatter({
      id: "test.badver",
      version: "v1.0.0",
    }));
    writeChangesFile("bad-version-changelog", "bad-version-changelog", [
      "## v1.0 - 2026-07-18",
      "- 版本号只有两段",
    ].join("\n"));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { checkPromptChangelogs } = await import(
      "../../harness/scripts/check-prompt-changelog.js"
    );
    const result = checkPromptChangelogs([fp]);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.some((e) => e.message.includes("格式不合法"))).toBe(true);
  });
});
