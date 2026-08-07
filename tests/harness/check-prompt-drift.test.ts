import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";

describe("check-prompt-drift core logic（S2-3 Task 8）", () => {
  it("parses version and body sha256 from prompt file content", async () => {
    const { parsePromptFrontmatter } = await import(
      "../../harness/scripts/check-prompt-drift.js"
    );
    const content = [
      "---",
      "id: test.drift",
      "version: v1.0.0",
      "stage: topic",
      "language: zh-CN",
      "consumes:",
      "  - Input",
      "produces:",
      "  - Output",
      "status: active",
      "---",
      "",
      "测试正文内容",
    ].join("\n");

    const result = parsePromptFrontmatter(content);
    expect(result.version).toBe("v1.0.0");
    expect(result.bodySha256).toBeTruthy();
    expect(result.bodySha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("different bodies produce different sha256", async () => {
    const { parsePromptFrontmatter } = await import(
      "../../harness/scripts/check-prompt-drift.js"
    );
    const a = parsePromptFrontmatter([
      "---",
      "version: v1.0.0",
      "---",
      "",
      "正文-A",
    ].join("\n"));
    const b = parsePromptFrontmatter([
      "---",
      "version: v1.0.0",
      "---",
      "",
      "正文-B",
    ].join("\n"));
    expect(a.bodySha256).not.toBe(b.bodySha256);
  });

  it("same body with different frontmatter produces same sha256", async () => {
    const { parsePromptFrontmatter } = await import(
      "../../harness/scripts/check-prompt-drift.js"
    );
    const a = parsePromptFrontmatter([
      "---",
      "version: v1.0.0",
      "stage: topic",
      "---",
      "",
      "相同正文",
    ].join("\n"));
    const b = parsePromptFrontmatter([
      "---",
      "version: v1.0.0",
      "stage: topic",
      "language: zh-CN",
      "status: active",
      "---",
      "",
      "相同正文",
    ].join("\n"));
    expect(a.bodySha256).toBe(b.bodySha256);
  });

  it("exports checkPromptDrift and parsePromptFrontmatter without errors", async () => {
    const mod = await import("../../harness/scripts/check-prompt-drift.js");
    expect(typeof mod.checkPromptDrift).toBe("function");
    expect(typeof mod.parsePromptFrontmatter).toBe("function");
  });

  it("filters only explicitly registered historical prompt drift entries", async () => {
    const { filterKnownPromptDriftEntries } = await import(
      "../../harness/scripts/check-prompt-drift.js"
    );

    const knownEntry = {
      file: "candidate-builder.prompt.md",
      version: "v1.0.0",
      commitA: "068c556",
      commitB: "3273024",
    };
    const unknownEntry = {
      ...knownEntry,
      commitB: "abcdef0",
    };

    const result = filterKnownPromptDriftEntries(
      [knownEntry, unknownEntry],
      [
        {
          ...knownEntry,
          reason: "historical drift before prompt changelog gate",
        },
      ],
    );

    expect(result.knownDriftEntries).toEqual([knownEntry]);
    expect(result.activeDriftEntries).toEqual([unknownEntry]);
  });
});

/**
 * 真实 git repo 红灯测试（S2-3 Task 8 审查 P1-2 修复）
 *
 * 覆盖原 implementation-plan §Task 8 要求的三个核心场景：
 *   1. version 不变但 body 改了 → drift
 *   2. version bump + body 改 → pass
 *   3. frontmatter 改但 body 不变 → pass
 *
 * 额外覆盖 P1-2 rename 场景：
 *   4. 文件迁移后旧路径历史仍能被读取，drift 仍能被检出
 */
describe("check-prompt-drift git history（S2-3 Task 8）", () => {
  const BASE_DIR = join(tmpdir(), `_drift_test_${Date.now()}`);
  const PROMPT_FILE = join(BASE_DIR, "prompts", "topic", "selector.prompt.md");

  function makePrompt(opts: { version?: string; body: string; status?: string }): string {
    return [
      "---",
      "id: topic.selector",
      `version: ${opts.version ?? "v1.0.0"}`,
      "stage: topic",
      "language: zh-CN",
      "consumes:",
      "  - Input",
      "produces:",
      "  - Output",
      `status: ${opts.status ?? "active"}`,
      "---",
      "",
      opts.body,
    ].join("\n");
  }

  function git(args: string): string {
    return execSync(`git -C "${BASE_DIR}" ${args}`, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    }).trim();
  }

  function setupFreshRepo(): void {
    rmSync(BASE_DIR, { recursive: true, force: true });
    mkdirSync(join(BASE_DIR, "prompts", "topic"), { recursive: true });
    git("init");
    git('config user.email "test@drift.test"');
    git('config user.name "Drift Test"');
    git("config commit.gpgsign false");
  }

  afterAll(() => {
    rmSync(BASE_DIR, { recursive: true, force: true });
  });

  it("detects drift when body changes but version is not bumped", async () => {
    setupFreshRepo();

    writeFileSync(PROMPT_FILE, makePrompt({ body: "正文-A" }), "utf8");
    git("add -A");
    git('commit -m "v1 initial" -q');

    writeFileSync(PROMPT_FILE, makePrompt({ body: "正文-B" }), "utf8");
    git('commit -am "change body without bump" -q');

    const { checkPromptDrift } = await import("../../harness/scripts/check-prompt-drift.js");
    const result = checkPromptDrift([PROMPT_FILE], { maxHistory: 5, cwd: BASE_DIR });

    expect(result.driftCount).toBe(1);
    expect(result.driftEntries[0].version).toBe("v1.0.0");
  });

  it("passes when body changes AND version is bumped", async () => {
    setupFreshRepo();

    writeFileSync(PROMPT_FILE, makePrompt({ body: "正文-A" }), "utf8");
    git("add -A");
    git('commit -m "v1" -q');

    writeFileSync(
      PROMPT_FILE,
      makePrompt({ version: "v1.0.1", body: "正文-B" }),
      "utf8",
    );
    git('commit -am "bump" -q');

    const { checkPromptDrift } = await import("../../harness/scripts/check-prompt-drift.js");
    const result = checkPromptDrift([PROMPT_FILE], { maxHistory: 5, cwd: BASE_DIR });

    expect(result.driftCount).toBe(0);
  });

  it("passes when only frontmatter changed and body is identical", async () => {
    setupFreshRepo();

    writeFileSync(PROMPT_FILE, makePrompt({ body: "相同正文" }), "utf8");
    git("add -A");
    git('commit -m "v1" -q');

    writeFileSync(
      PROMPT_FILE,
      makePrompt({ body: "相同正文", status: "deprecated" }),
      "utf8",
    );
    git('commit -am "frontmatter only" -q');

    const { checkPromptDrift } = await import("../../harness/scripts/check-prompt-drift.js");
    const result = checkPromptDrift([PROMPT_FILE], { maxHistory: 5, cwd: BASE_DIR });

    expect(result.driftCount).toBe(0);
  });

  it("detects drift across a rename (harness/prompts → prompts)", async () => {
    setupFreshRepo();

    // setupFreshRepo 已创建空的 prompts/topic 目录，但 rename 场景下文件
    // 必须只在旧路径存在，否则 git mv 会因为目标已存在而失败。删除空 prompts/。
    rmSync(join(BASE_DIR, "prompts"), { recursive: true, force: true });

    // 先在旧路径提交两个 commit，第二个改 body 但不 bump（应 drift）
    const oldDir = join(BASE_DIR, "harness", "prompts", "topic");
    mkdirSync(oldDir, { recursive: true });
    const oldFile = join(oldDir, "selector.prompt.md");

    writeFileSync(oldFile, makePrompt({ body: "正文-A" }), "utf8");
    git("add -A");
    git('commit -m "v1 at old path" -q');

    writeFileSync(oldFile, makePrompt({ body: "正文-B" }), "utf8");
    git('commit -am "body change at old path" -q');

    // 模拟迁移：git mv
    git("mv harness/prompts prompts");
    git('commit -m "migrate to prompts/" -q');

    // 调试：确认 git log 能否看到历史
    const logOutput = git(
      'log --follow --format="%H" -- prompts/topic/selector.prompt.md',
    );
    expect(logOutput.length).toBeGreaterThan(0);

    const { checkPromptDrift } = await import("../../harness/scripts/check-prompt-drift.js");
    const result = checkPromptDrift([PROMPT_FILE], { maxHistory: 5, cwd: BASE_DIR });

    expect(result.promptCount).toBe(1);
    expect(result.driftCount).toBe(1);
    expect(result.driftEntries[0].version).toBe("v1.0.0");
  });
});
