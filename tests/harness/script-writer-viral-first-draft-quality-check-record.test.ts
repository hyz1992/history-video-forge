import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("script writer viral first-draft quality check record", () => {
  it("records the five-round result, quality conclusion, risks, attribution, and patch recommendation", () => {
    const recordPath = join(
      process.cwd(),
      "docs/records/2026-05-06-script-writer-viral-first-draft-quality-check.md",
    );

    expect(existsSync(recordPath)).toBe(true);

    const content = readFileSync(recordPath, "utf8");
    for (const requiredText of [
      "5 轮结果表",
      "质量分层结论",
      "未解决问题",
      "上游材料归因",
      "semantic shadow 异常标签的人工归因",
      "是否建议进入 patch integration 设计",
      "yanzi-shichu",
      "zhuanzhu-ciwangliao",
      "julu-zhizhan",
      "hongmenyan",
      "yanzi-shichu repeat",
      "5 / 5 sample-ready",
      "5 / 5 local validation pass",
      "5 / 5 semantic shadow pass",
      "未达到爆款首稿线",
      "不接入 patch / regen 主链路",
    ]) {
      expect(content).toContain(requiredText);
    }
  });
});
