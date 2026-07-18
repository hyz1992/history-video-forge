import { describe, expect, it } from "vitest";

describe("check-prompt-drift core logic（S2-3 Task 8）", () => {
  // 测试核心逻辑：parsePromptFrontmatter 正确解析 version 与 body SHA
  it("parses version and body sha256 from prompt file content", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
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
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { parsePromptFrontmatter } = await import(
      "../../harness/scripts/check-prompt-drift.js"
    );
    const contentA = [
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
      "正文-A",
    ].join("\n");

    const contentB = [
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
      "正文-B",
    ].join("\n");

    const a = parsePromptFrontmatter(contentA);
    const b = parsePromptFrontmatter(contentB);
    expect(a.bodySha256).not.toBe(b.bodySha256);
  });

  it("same body with different frontmatter produces same sha256", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { parsePromptFrontmatter } = await import(
      "../../harness/scripts/check-prompt-drift.js"
    );
    const contentA = [
      "---",
      "id: test.drift",
      "version: v1.0.0",
      "stage: topic",
      "status: active",
      "---",
      "",
      "相同正文",
    ].join("\n");

    const contentB = [
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
      "相同正文",
    ].join("\n");

    const a = parsePromptFrontmatter(contentA);
    const b = parsePromptFrontmatter(contentB);
    expect(a.bodySha256).toBe(b.bodySha256);
  });

  // 通过导入来确认脚本不会在 import 时报错
  it("exports checkPromptDrift and parsePromptFrontmatter without errors", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = await import(
      "../../harness/scripts/check-prompt-drift.js"
    );
    expect(typeof mod.checkPromptDrift).toBe("function");
    expect(typeof mod.parsePromptFrontmatter).toBe("function");
  });
});
