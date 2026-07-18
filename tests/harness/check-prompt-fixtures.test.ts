import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEMP_DIR = join(process.cwd(), ".tmp-check-fixtures-test");
const PROMPTS_DIR = join(process.cwd(), "harness", "prompts");

function writeFixture(
  relativePath: string,
  content: Record<string, unknown>,
): string {
  const fullPath = join(TEMP_DIR, "harness", "samples", relativePath);
  mkdirSync(join(fullPath, ".."), { recursive: true });
  writeFileSync(fullPath, JSON.stringify(content, null, 2), "utf8");
  return fullPath;
}

describe("check-prompt-fixtures（S2-3 Task 9）", () => {
  let testIndex = 0;

  function writeFixture(
    name: string,
    content: Record<string, unknown>,
  ): { dir: string } {
    testIndex++;
    const dir = join(TEMP_DIR, `test-${testIndex}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, "harness", "samples"), { recursive: true });
    const fullPath = join(dir, "harness", "samples", name);
    writeFileSync(fullPath, JSON.stringify(content, null, 2), "utf8");
    return { dir };
  }

  it("fixture missing target_prompt + not in allowlist → error", async () => {
    const { dir } = writeFixture("test-no-target.fixture.json", {
      sample_id: "test",
      expected_decision: "pass",
    });

    const { checkPromptFixtures } = await import(
      "../../harness/scripts/check-prompt-fixtures.js"
    );
    const result = checkPromptFixtures({
      allowlist: new Set(),
      projectRoot: dir,
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("缺少 target_prompt");
  });

  it("fixture missing target_prompt + in allowlist → skip", async () => {
    const { dir } = writeFixture("test-skipped.fixture.json", {
      sample_id: "test-skipped",
      expected_decision: "pass",
    });

    const { checkPromptFixtures } = await import(
      "../../harness/scripts/check-prompt-fixtures.js"
    );
    const result = checkPromptFixtures({
      allowlist: new Set(["harness/samples/test-skipped.fixture.json"]),
      projectRoot: dir,
    });
    expect(result.errors).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });

  it("allowlist path does not exist → error", async () => {
    const { dir } = writeFixture("dummy.fixture.json", {
      sample_id: "dummy",
      target_prompt: {
        id: "topic.selector",
        version_range: "^v1.0.0",
      },
    });

    const { checkPromptFixtures } = await import(
      "../../harness/scripts/check-prompt-fixtures.js"
    );
    const result = checkPromptFixtures({
      allowlist: new Set(["harness/samples/does-not-exist.fixture.json"]),
      projectRoot: dir,
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("allowlist 路径不存在");
  });

  it("target_prompt.id not in PromptRegistry → error", async () => {
    const { dir } = writeFixture("test-unknown-id.fixture.json", {
      sample_id: "test-unknown",
      target_prompt: {
        id: "nonexistent.prompt",
        version_range: "^v1.0.0",
      },
    });

    const { checkPromptFixtures } = await import(
      "../../harness/scripts/check-prompt-fixtures.js"
    );
    const result = checkPromptFixtures({
      allowlist: new Set(),
      projectRoot: dir,
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("不存在");
  });

  it("version_range without operator → error", async () => {
    const { dir } = writeFixture("test-bad-range.fixture.json", {
      sample_id: "test-bad-range",
      target_prompt: {
        id: "topic.selector",
        version_range: "v1.0.0",
      },
    });

    const { checkPromptFixtures } = await import(
      "../../harness/scripts/check-prompt-fixtures.js"
    );
    const result = checkPromptFixtures({
      allowlist: new Set(),
      projectRoot: dir,
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("格式不合法");
  });

  it("version_range compatible → pass", async () => {
    const { dir } = writeFixture("test-ok.fixture.json", {
      sample_id: "test-ok",
      target_prompt: {
        id: "topic.selector",
        version_range: "^v1.0.0",
      },
    });

    const { checkPromptFixtures } = await import(
      "../../harness/scripts/check-prompt-fixtures.js"
    );
    const result = checkPromptFixtures({
      allowlist: new Set(),
      projectRoot: dir,
    });
    expect(result.errors).toHaveLength(0);
  });

  it("version_range MAJOR incompatible → error", async () => {
    const { dir } = writeFixture("test-bad-version.fixture.json", {
      sample_id: "test-bad-version",
      target_prompt: {
        id: "topic.selector",
        version_range: "^v2.0.0",
      },
    });

    const { checkPromptFixtures } = await import(
      "../../harness/scripts/check-prompt-fixtures.js"
    );
    const result = checkPromptFixtures({
      allowlist: new Set(),
      projectRoot: dir,
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("不兼容");
  });
});
